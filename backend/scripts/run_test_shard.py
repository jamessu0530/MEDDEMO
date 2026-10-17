"""依測試檔分組；每個 CI job 在自己的 PostgreSQL、Redis 上執行。"""

import argparse
from collections import defaultdict

import pytest


def select_shard(items, shard: int, total: int):
    if not 1 <= shard <= total:
        raise ValueError("shard 必須介於 1 與 total 之間")
    files = defaultdict(list)
    for item in items:
        files[str(item.path)].append(item)
    # 大檔先分配給測試數最少的一組；同一檔的 fixture 與執行順序留在一起。
    loads = [0] * total
    owners = {}
    for path, tests in sorted(files.items(), key=lambda row: (-len(row[1]), row[0])):
        owner = min(range(total), key=lambda index: (loads[index], index))
        owners[path] = owner
        loads[owner] += len(tests)
    return [item for item in items if owners[str(item.path)] == shard - 1]


class ShardPlugin:
    def __init__(self, shard: int, total: int):
        self.shard, self.total = shard, total

    @pytest.hookimpl(trylast=True)
    def pytest_collection_modifyitems(self, config, items):
        selected = select_shard(items, self.shard, self.total)
        selected_ids = {item.nodeid for item in selected}
        deselected = [item for item in items if item.nodeid not in selected_ids]
        count = len(items)
        items[:] = selected
        config.hook.pytest_deselected(items=deselected)
        reporter = config.pluginmanager.get_plugin("terminalreporter")
        if reporter is not None:
            reporter.write_line(f"Backend shard {self.shard}/{self.total}: {len(selected)}/{count} tests")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--shard", type=int, required=True)
    parser.add_argument("--total", type=int, default=2)
    parser.add_argument("pytest_args", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if not 1 <= args.shard <= args.total:
        parser.error("shard 必須介於 1 與 total 之間")
    pytest_args = args.pytest_args
    if pytest_args[:1] == ["--"]:
        pytest_args = pytest_args[1:]
    return pytest.main(pytest_args or ["backend/tests", "-q"], plugins=[ShardPlugin(args.shard, args.total)])


if __name__ == "__main__":
    raise SystemExit(main())
