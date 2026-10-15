"""權限內的階層矩陣；各小計用 GROUPING SETS 聚合，畫面分頁不截斷總計。"""

from __future__ import annotations

import json
import math

from sqlalchemy import and_, func, or_, select, tuple_

from app.services import reports as r


def path_id(path) -> str:
    return json.dumps([(item.dimension, item.key) for item in path], ensure_ascii=False, separators=(",", ":"))


def _expressions(dimensions, keys, labels):
    result = []
    for index in dimensions:
        for expression in (keys[index], labels[index]):
            if not any(expression.compare(existing) for existing in result):
                result.append(expression)
    return result


def _grouped(query, keys, labels, aggregates, subsets):
    registered = {index for indices in subsets for index in indices}
    subsets = [*subsets, *[[index] for index in range(len(keys)) if index not in registered]]
    grouping = [tuple_(*_expressions(indices, keys, labels)) for indices in subsets]
    return query.with_only_columns(*keys, *labels, *(func.grouping(key) for key in keys), *aggregates, func.count()).group_by(func.grouping_sets(*grouping))


def _axis(session, query, dimensions, keys, labels, primary, options, view, axis, start, end, sort):
    if not dimensions:
        return [], 0, 1, 1, False
    size = len(dimensions)
    grouped = _grouped(query, keys, labels, [primary], [list(range(depth)) for depth in range(size + 1)])
    records = {}
    for row in session.execute(grouped):
        flags = row[size * 2:size * 3]
        depth = sum(flag == 0 for flag in flags)
        token = tuple(str(key) for key in row[:depth])
        entries = [r.MatrixPathEntry(dimension=dimensions[index], key=str(row[index]), label=r._point_label(dimensions[index], str(row[index]), str(row[size + index]))) for index in range(depth)]
        records[token] = (entries, r._number(row[size * 3]), int(row[size * 3 + 1]))
    records.setdefault((), ([], r.empty_metric_value(options.metrics[0]), 0))
    children = {}
    for token in records:
        if token:
            children.setdefault(token[:-1], []).append(token)
    # 日期層級保持可用期間順序；空月份不虛構交易，值在儲存格中保留 0／null。
    def pad(token):
        depth = len(token)
        if depth == size:
            return
        dimension = dimensions[depth]
        if dimension in r.DATE_DIMENSIONS:
            first, last = start, end
            for entry in records[token][0]:
                if entry.dimension in r.DATE_DIMENSIONS:
                    a, b = r.date_key_bounds(entry.dimension, entry.key)
                    first, last = max(first, a), min(last, b)
            for key in r._date_keys(first, last, dimension):
                next_token = (*token, key)
                if next_token not in records:
                    records[next_token] = ([*records[token][0], r.MatrixPathEntry(dimension=dimension, key=key, label=r._point_label(dimension, key, key))], r.empty_metric_value(options.metrics[0]), 0)
                    children.setdefault(token, []).append(next_token)
        for child in list(children.get(token, [])):
            pad(child)
    pad(())
    expanded = {path_id(path) for path in getattr(view, f"expanded_{axis}")}
    collapsed = {path_id(path) for path in getattr(view, f"collapsed_{axis}")}
    default_depth = getattr(view, f"{axis[:-1]}_expand_depth") or getattr(options, f"{axis[:-1]}_expand_depth")
    flattened = []
    def descend(token):
        depth = len(token)
        entries, value, count = records[token]
        id = path_id(entries)
        has_children = bool(children.get(token))
        is_expanded = has_children and (id in expanded or depth < default_depth and id not in collapsed)
        if axis == "rows" or options.show_subtotals or not is_expanded:
            flattened.append(r.MatrixNode(id=id, path=entries, label=entries[-1].label, depth=depth, has_children=has_children, expanded=is_expanded,
                show_values=options.show_subtotals or not is_expanded))
        if is_expanded:
            for child in sort_children(token):
                descend(child)
    def sort_children(token):
        values = children.get(token, [])
        dimension = dimensions[len(token)]
        if dimension in r.DATE_DIMENSIONS:
            return sorted(values)
        if axis == "columns":
            return sorted(values, key=lambda key: (records[key][0][-1].label, key))
        if sort == "label_asc":
            return sorted(values, key=lambda key: (records[key][0][-1].label, key))
        return sorted(values, key=lambda key: (records[key][1] is None, (records[key][1] or 0) * (1 if sort == "value_asc" else -1), key))
    for token in sort_children(()):
        descend(token)
    page_size = getattr(view, f"{axis[:-1]}_page_size")
    total = len(flattened)
    page = min(getattr(view, f"{axis[:-1]}_page"), max(1, math.ceil(total / page_size)))
    leaf_count = sum(bool(token) and not children.get(token) for token in records)
    padded = any(token and record[2] == 0 for token, record in records.items())
    return flattened[(page - 1) * page_size:page * page_size], total, page, leaf_count, padded


def _filter_prefix(keys, paths, depth):
    if not depth:
        return True
    values = [tuple(entry.key for entry in path) for path in paths if len(path) == depth]
    return keys[0].in_([value[0] for value in values]) if depth == 1 else tuple_(*keys[:depth]).in_(values)


def matrix_data(session, card, config, scope, start, end, today, align=None, calendar_offset=0):
    options = r.matrix_options(card)
    view = getattr(config, "matrix_views", {}).get(card.id, r.MatrixView())
    effective_start, effective_end = r.card_bounds(card, config, start, end)
    query_start, query_end = r.comparison_bounds(effective_start, effective_end, calendar_offset) if calendar_offset else (effective_start, effective_end)
    query, primary, date_col, owner_col, _, _ = r._base_query(card, config, scope, query_start, query_end, today, calendar_offset=calendar_offset)
    dimensions = options.rows + options.columns
    keys, labels = [], []
    for dimension in dimensions:
        query, key, label = r._dimension_query(query, dimension, date_col, owner_col)
        keys.append(key)
        labels.append(label)
    aggregates = [r._metric_aggregate(metric) if metric in r.SALES_METRICS else primary for metric in options.metrics]
    row_size = len(options.rows)
    root = r.MatrixNode(id="[]", path=[], label="總計", depth=0, has_children=False, expanded=False)
    if align:
        rows, columns = align.rows, align.columns
        row_total, column_total, row_page, column_page = align.row_total, align.column_total, align.row_page, align.column_page
        format_domains = align.format_domains
    else:
        # 每個軸只聚合自己的階層，完整樹不產生列 × 欄的笛卡兒積。
        rows, row_total, row_page, row_leaves, row_padded = _axis(session, query, options.rows, keys[:row_size], labels[:row_size], primary, options, view, "rows", effective_start, effective_end, card.sort)
        columns, column_total, column_page, column_leaves, column_padded = _axis(session, query, options.columns, keys[row_size:], labels[row_size:], primary, options, view, "columns", effective_start, effective_end, card.sort)
        # 色階與資料條以完整最低層分組定義，換頁／收合不改變刻度。
        leaf = query.with_only_columns(*(aggregate.label(f"metric_{index}") for index, aggregate in enumerate(aggregates))).group_by(*_expressions(range(len(keys)), keys, labels)).subquery()
        ranges = session.execute(select(*(expression for index in range(len(aggregates)) for expression in (func.min(leaf.c[f"metric_{index}"]), func.max(leaf.c[f"metric_{index}"]))), func.count()).select_from(leaf)).one()
        empty_cells = row_padded or column_padded or row_leaves * column_leaves > int(ranges[-1])
        format_domains = {}
        for index, metric in enumerate(options.metrics):
            lower, upper = r._number(ranges[index * 2]), r._number(ranges[index * 2 + 1])
            if empty_cells and metric not in r.NULLABLE_METRICS:
                lower, upper = min(lower or 0, 0), max(upper or 0, 0)
            format_domains[metric] = r.FormatDomain(minimum=lower, maximum=upper)
    row_nodes = [*rows, root]
    column_nodes = [*columns, root] if columns else [root]
    row_depths = {node.depth for node in row_nodes}
    column_depths = {node.depth for node in column_nodes}
    subsets, alternatives = [], []
    for row_depth in row_depths:
        for column_depth in column_depths:
            indices = [*range(row_depth), *range(row_size, row_size + column_depth)]
            subsets.append(indices)
            conditions = [func.grouping(key) == (0 if index in indices else 1) for index, key in enumerate(keys)]
            conditions += [_filter_prefix(keys[:row_size], [node.path for node in row_nodes], row_depth),
                _filter_prefix(keys[row_size:], [node.path for node in column_nodes], column_depth)]
            alternatives.append(and_(*conditions))
    grouped = _grouped(query, keys, labels, aggregates, subsets).having(or_(*alternatives))
    size = len(dimensions)
    values = {}
    for record in session.execute(grouped):
        flags = record[size * 2:size * 3]
        row_path = [r.ReportFilter(dimension=dimension, key=str(record[index])) for index, dimension in enumerate(options.rows) if flags[index] == 0]
        column_path = [r.ReportFilter(dimension=dimension, key=str(record[row_size + index])) for index, dimension in enumerate(options.columns) if flags[row_size + index] == 0]
        values[path_id(row_path), path_id(column_path)] = (
            {metric: r._number(record[size * 3 + index]) for index, metric in enumerate(options.metrics)}, int(record[-1]))
    cells = []
    for row in row_nodes:
        for column in column_nodes:
            amounts, count = values.get((row.id, column.id), ({metric: r.empty_metric_value(metric) for metric in options.metrics}, 0))
            cells.append(r.MatrixCell(row_id=row.id, column_id=column.id, values=amounts, row_count=count))
    totals = next(cell.values for cell in cells if cell.row_id == cell.column_id == "[]")
    return r.MatrixData(options=options, rows=rows, columns=columns, cells=cells, totals=totals, format_domains=format_domains,
        row_total=row_total, column_total=column_total, row_page=row_page, column_page=column_page,
        row_page_size=view.row_page_size, column_page_size=view.column_page_size,
        note="分頁只影響顯示；小計與總計依全部符合條件的資料重新聚合，去重數、平均及比率不能把儲存格直接相加。")
