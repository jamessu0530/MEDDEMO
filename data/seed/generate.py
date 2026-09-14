"""依固定亂數種子產生假資料。as_of 與種子相同時，產出的每一筆都相同。

所有日期都從 as_of 往前推。換 as_of 會連拜訪日期與內容一起變（拜訪只排平日），
評測題庫的標準答案要用同一個 as_of 產生的資料計算。
"""

import random
from datetime import date, datetime, time, timedelta, timezone

import catalog
from app.pricing import SUPPLY_PRICE_FACTOR as PRICE_FACTOR  # 與 SAP 回寫共用同一份折數

SEED = 20260914
TAIPEI = timezone(timedelta(hours=8))
HISTORY_DAYS = 365
VISIT_TOTAL = 150
FIELD_KEYS = ("competitor", "complaint", "intent", "commitment", "follow_up_date")

# 刻意設計「進貨間隔拉長、單次進貨金額持平」的五家客戶，是警示規則與數字查詢的驗證案例。
# 前三家同時是「北區保健品下滑」的主角：魚油縮量最多，其中兩家近期拜訪紀錄提到御松田。
SCENARIO_CUSTOMERS = [
    "康泰連鎖藥局 · 忠孝店",
    "康泰連鎖藥局 · 南京店",
    "福安連鎖藥局 · 板橋店",
    "德安藥局 · 逢甲",
    "惠生連鎖藥局 · 左營店",
]
NORTH_DECLINE = set(SCENARIO_CUSTOMERS[:3])
# 34 / 21 ≈ 1.6，沿用原型上「進貨間隔 21 → 34 天」的案例
SLOWDOWN_FACTOR = 1.6
# 正常間隔最長 38 天（35 ± 3），從 130 天前開始拉長，v_customer_summary 近 90 天窗口裡
# 的每一段間隔才都是拉長後的，不會混進正常間隔把平均拉回來
SLOWDOWN_DAYS = 130
# 北區三家在拉長期間魚油只進原本的一半，讓「魚油縮最多」成立
NORTH_FISH_OIL_FACTOR = 0.5

# (上架費率, 通路獎勵率)；康泰沿用原型談判卡上的 8% ＋ 5%
CHAIN_FEES = {
    "康泰連鎖藥局": (0.08, 0.05),
    "福安連鎖藥局": (0.06, 0.04),
    "仁和健康藥局": (0.05, 0.04),
    "長青連鎖藥局": (0.05, 0.03),
    "惠生連鎖藥局": (0.07, 0.04),
    "百齡藥妝": (0.06, 0.05),
}
OTHER_FEES = {"independent": (0.0, 0.02), "clinic": (0.0, 0.0)}
PAYMENT_TERMS = {"chain": 60, "independent": 30, "clinic": 30}

BASKET_MIX = {
    "chain": {"保健品": 9, "一般用藥": 5, "醫材": 1},
    "independent": {"保健品": 5, "一般用藥": 4, "慢性處方": 2, "醫材": 1},
    "clinic": {"慢性處方": 7, "一般用藥": 2, "醫材": 1},
}
BASE_QTY = {"chain": (10, 30), "independent": (4, 12), "clinic": (6, 20)}
INTERVAL_DAYS = {"chain": (16, 24), "independent": (26, 35), "clinic": (28, 35)}
GRADE_WEIGHTS = {
    "chain": {"A": 5, "B": 5, "C": 0},
    "independent": {"A": 1, "B": 4, "C": 4},
    "clinic": {"A": 1, "B": 5, "C": 4},
}
VISITS_BY_GRADE = {"A": 3, "B": 2, "C": 1}
LATE_PAYER_COUNT = 5

# 五家主角客戶的最近一次拜訪寫死內容：(幾天前, 內容)。承諾與追蹤日為拜訪後第幾天。
SCRIPTED_VISITS = {
    "康泰連鎖藥局 · 忠孝店": (9, {
        "competitor": [("御松田", "條件比我們好")],
        "complaint": "補貨延遲三天",
        "intent": [("HS-FO30", 20)],
        "commitment": ("us", "回報檔期", 5),
        "follow_up": 5,
    }),
    "福安連鎖藥局 · 板橋店": (20, {
        "competitor": [("御松田", "想拿下櫃檯旁邊的陳列位")],
        "note": "魚油的架位最近被移到比較下面。",
        "commitment": ("customer", "回覆進貨數量", 7),
    }),
    "康泰連鎖藥局 · 南京店": (30, {
        "note": "店長說魚油最近賣得比較慢，架上位置有調整過。",
        "intent": [("HS-CA60", 12)],
    }),
    "德安藥局 · 逢甲": (15, {
        "competitor": [("康普樂", "開買十送一")],
        "complaint": "報價比別家高",
    }),
    "惠生連鎖藥局 · 左營店": (25, {
        "competitor": [("瑞得生技", "通路獎勵給得比較多")],
        "follow_up": 10,
    }),
}

DIGITS = "零一二三四五六七八九"


def num_zh(n: int) -> str:
    """口語數字：20 → 二十，2 → 兩。100 以上直接用阿拉伯數字。"""
    if n == 2:
        return "兩"
    if n < 10:
        return DIGITS[n]
    if n < 100:
        tens, ones = divmod(n, 10)
        return ("" if tens == 1 else DIGITS[tens]) + "十" + (DIGITS[ones] if ones else "")
    return str(n)


def say_date(d: date) -> str:
    return f"{d.month}月{d.day}號"


def build_customers(rng, as_of):
    specs = []
    for group, region, branches in catalog.CHAINS:
        for branch, city in branches:
            specs.append((f"{group} · {branch}", "chain", group, region, city))
    for name, area, region, city in catalog.INDEPENDENTS:
        specs.append((f"{name} · {area}", "independent", None, region, city))
    for name, area, region, city in catalog.CLINICS:
        specs.append((f"{name} · {area}", "clinic", None, region, city))

    customers = []
    assigned = {region: 0 for region in catalog.REGION_SALES}
    for i, (name, type_, group, region, city) in enumerate(specs, start=1):
        owners = catalog.REGION_SALES[region]
        owner = owners[assigned[region] % len(owners)]
        assigned[region] += 1
        weights = GRADE_WEIGHTS[type_]
        grade = rng.choices(list(weights), weights=list(weights.values()))[0]
        if i == 1:
            grade = "A"
        elif name in SCENARIO_CUSTOMERS and grade == "C":
            grade = "B"
        has_contract = type_ == "chain" or (type_ == "independent" and rng.random() < 0.4)
        contract_end = as_of + timedelta(days=rng.randint(20, 400)) if has_contract else None
        customers.append({
            "id": f"C{i:03d}", "name": name, "type": type_, "chain_group": group,
            "region": region, "city": city, "grade": grade,
            "contract_end_date": contract_end, "owner_user_id": owner,
        })
    return customers


def build_basket(rng, customer, products):
    """每家客戶固定常進的品項與基準數量。貴的品項按單價縮小數量。"""
    type_ = customer["type"]
    lo, hi = BASE_QTY[type_]
    by_category = {}
    for p in products.values():
        by_category.setdefault(p["category"], []).append(p["sku"])
    chosen = []
    for category, n in BASKET_MIX[type_].items():
        chosen += rng.sample(sorted(by_category[category]), n)
    if type_ == "chain":
        chosen += [s for s in ("HS-FO30", "HS-CA60", "HS-PB30") if s not in chosen]
    basket = {}
    for sku in chosen:
        scale = min(1.0, 500 / products[sku]["unit_price"])
        basket[sku] = max(1, round(rng.randint(lo, hi) * scale))
    if type_ == "chain":
        basket["HS-FO30"] = rng.randint(30, 40)  # 魚油是連鎖通路的主力品項
    return basket


def build_orders(rng, customer, basket, products, as_of):
    type_ = customer["type"]
    base = 21 if customer["id"] == "C001" else rng.randint(*INTERVAL_DAYS[type_])
    scenario = customer["name"] in SCENARIO_CUSTOMERS
    north = customer["name"] in NORTH_DECLINE
    slowdown_start = as_of - timedelta(days=SLOWDOWN_DAYS)
    listing_rate, reward_rate = CHAIN_FEES.get(customer["chain_group"]) or OTHER_FEES[type_]
    factor = PRICE_FACTOR[type_]

    lines = []
    d = as_of - timedelta(days=HISTORY_DAYS - rng.randint(0, base - 1))
    while d < as_of:
        slowed = scenario and d >= slowdown_start
        order_no = f"SO{d:%Y%m%d}-{customer['id']}"
        for sku, base_qty in basket.items():
            p = products[sku]
            qty = max(1, round(base_qty * rng.uniform(0.85, 1.15)))
            if north and slowed and sku == "HS-FO30":
                qty = max(1, round(qty * NORTH_FISH_OIL_FACTOR))
            amount = round(qty * p["unit_price"] * factor)
            lines.append({
                "order_no": order_no, "customer_id": customer["id"], "date": d, "sku": sku,
                "qty": qty, "amount": amount, "cost": qty * p["unit_cost"],
                "listing_fee": round(amount * listing_rate),
                "channel_reward": round(amount * reward_rate),
            })
        gap = base * SLOWDOWN_FACTOR if slowed else base
        d += timedelta(days=round(gap) + rng.randint(-3, 3))
    return lines


def build_receivables(rng, customer, lines, as_of, late):
    orders = {}
    for line in lines:
        o = orders.setdefault(line["order_no"], {"date": line["date"], "amount": 0})
        o["amount"] += line["amount"]
    terms = PAYMENT_TERMS[customer["type"]]
    rows = []
    for order_no, o in orders.items():
        due = o["date"] + timedelta(days=terms)
        paid = due + timedelta(days=rng.randint(20, 45) if late else rng.randint(-10, 3))
        rows.append({
            "invoice_no": order_no, "customer_id": customer["id"], "invoice_date": o["date"],
            "due_date": due, "amount": o["amount"], "paid_date": paid if paid < as_of else None,
        })
    return rows


def random_content(rng, customer, basket, visited_on):
    content = {}
    if customer["name"] not in NORTH_DECLINE and rng.random() < 0.15:
        name = rng.choices(catalog.COMPETITORS, weights=[1, 3, 3, 3])[0]
        content["competitor"] = [(name, rng.choice(catalog.COMPETITOR_DETAILS))]
    if rng.random() < 0.3:
        content["complaint"] = rng.choice(catalog.COMPLAINTS)
    if rng.random() < 0.5:
        skus = rng.sample(sorted(basket), rng.choice([1, 1, 2]))
        content["intent"] = [(s, max(1, round(basket[s] * rng.uniform(0.5, 1.0)))) for s in skus]
    if rng.random() < 0.4:
        if rng.random() < 0.7:
            content["commitment"] = ("us", rng.choice(catalog.OUR_COMMITMENTS), rng.randint(3, 14))
        else:
            content["commitment"] = ("customer", rng.choice(catalog.CUSTOMER_COMMITMENTS), rng.randint(3, 14))
    if rng.random() < 0.35:
        content["follow_up"] = rng.randint(7, 21)
    return content


def render_visit(rng, customer, visited_on, content, products):
    """把內容組成一段口述逐字稿，並回傳五個欄位與每個欄位對應的原文片段。"""
    contact = rng.choice(catalog.CONTACTS[customer["type"]])
    store, _, area = customer["name"].partition(" · ")
    place = f"{store}{area}" if customer["type"] == "chain" else f"{area}的{store}"
    parts = [f"今天去{place}，跟{contact}聊了一下。"]
    fields = dict.fromkeys(FIELD_KEYS)
    sources = {}

    def say(key, text):
        parts.append(text)
        if key:
            sources[key] = text

    if comps := content.get("competitor"):
        fields["competitor"] = [{"name": n, "detail": d} for n, d in comps]
        say("competitor", "，".join(f"{n}有來談，{d}" for n, d in comps) + "。")
    if complaint := content.get("complaint"):
        fields["complaint"] = complaint
        say("complaint", f"{contact}抱怨{complaint}。")
    if note := content.get("note"):
        say(None, note)
    if intent := content.get("intent"):
        items = []
        for sku, qty in intent:
            p = products[sku]
            items.append({"product_text": p["aliases"][0], "sku": sku, "qty": qty, "unit": p["unit"]})
        fields["intent"] = items
        say("intent", "他想先進" + "、".join(f"{i['product_text']}{num_zh(i['qty'])}{i['unit']}" for i in items) + "。")
    if commitment := content.get("commitment"):
        by, text, days = commitment
        due = visited_on + timedelta(days=days)
        fields["commitment"] = {"by": by, "text": text, "due": due.isoformat()}
        if by == "us":
            say("commitment", f"我答應{say_date(due)}前{text}。")
        else:
            say("commitment", f"{contact}說{say_date(due)}前會{text}。")
    if (days := content.get("follow_up")) is not None:
        follow_up = visited_on + timedelta(days=days)
        fields["follow_up_date"] = follow_up.isoformat()
        say("follow_up_date", f"{say_date(follow_up)}再過去看看。")
    if len(parts) == 1:
        say(None, "例行拜訪，沒有特別的事。")
    return "".join(parts), fields, sources


def plan_visit_counts(rng, customers):
    counts = {c["id"]: VISITS_BY_GRADE[c["grade"]] for c in customers}
    ids = sorted(counts)
    while sum(counts.values()) > VISIT_TOTAL:
        counts[rng.choice([i for i in ids if counts[i] > 1])] -= 1
    while sum(counts.values()) < VISIT_TOTAL:
        counts[rng.choice(ids)] += 1
    return counts


def visit_datetime(rng, d):
    minutes = rng.randint(9 * 60 + 30, 17 * 60 + 30)
    return datetime.combine(d, time(minutes // 60, minutes % 60), TAIPEI)


def build_visits(rng, customers, baskets, products, as_of):
    counts = plan_visit_counts(rng, customers)
    planned = []
    for c in customers:
        k = counts[c["id"]]
        scripted = SCRIPTED_VISITS.get(c["name"])
        if scripted:
            days_ago, content = scripted
            planned.append((c, as_of - timedelta(days=days_ago), content))
            k -= 1
        # 隨機拜訪日落在主角拜訪之前，平日才出門
        latest = scripted[0] + 1 if scripted else 1
        pool = [as_of - timedelta(days=n) for n in range(latest, 360) if (as_of - timedelta(days=n)).weekday() < 5]
        for d in rng.sample(pool, k):
            planned.append((c, d, None))
    planned.sort(key=lambda x: (x[1], x[0]["id"]))

    tables = {name: [] for name in ("visit", "crm_visit_record", "sap_quotation_draft", "oa_expense_form", "writeback_log")}
    for n, (c, d, content) in enumerate(planned, start=1):
        visit_id = f"V{n:05d}"
        if content is None:
            content = random_content(rng, c, baskets[c["id"]], d)
        transcript, fields, sources = render_visit(rng, c, d, content, products)
        visited_at = visit_datetime(rng, d)
        confirmed_at = visited_at + timedelta(minutes=10)
        tables["visit"].append({
            "id": visit_id, "customer_id": c["id"], "user_id": c["owner_user_id"],
            "visited_at": visited_at, "transcript": transcript,
            "fields_raw": fields, "fields_final": fields, "field_sources": sources,
            "status": "synced", "created_at": visited_at, "confirmed_at": confirmed_at,
        })
        tables["crm_visit_record"].append({
            "visit_id": visit_id, "customer_id": c["id"], "rep_id": c["owner_user_id"], "visit_date": d,
            "competitor": "、".join(x["name"] for x in fields["competitor"]) if fields["competitor"] else None,
            "complaint": fields["complaint"],
            "intent_summary": "、".join(f"{x['product_text']} × {x['qty']}{x['unit']}" for x in fields["intent"]) if fields["intent"] else None,
            "commitment": f"{fields['commitment']['text']}（{fields['commitment']['due']} 前）" if fields["commitment"] else None,
            "follow_up_date": fields["follow_up_date"], "created_at": confirmed_at,
        })
        for line_no, item in enumerate(fields["intent"] or [], start=1):
            tables["sap_quotation_draft"].append({
                "visit_id": visit_id, "line_no": line_no, "customer_id": c["id"], "sku": item["sku"],
                "qty": item["qty"], "unit_price": round(products[item["sku"]]["unit_price"] * PRICE_FACTOR[c["type"]]),
                "created_at": confirmed_at,
            })
        tables["oa_expense_form"].append({
            "visit_id": visit_id, "applicant_id": c["owner_user_id"], "trip_date": d,
            "customer_id": c["id"], "purpose": "客戶拜訪", "created_at": confirmed_at,
        })
        for target in ("crm", "sap", "oa"):
            status = "skipped" if target == "sap" and not fields["intent"] else "success"
            tables["writeback_log"].append({
                "visit_id": visit_id, "target": target, "attempt": 1, "status": status,
                "created_at": confirmed_at, "finished_at": confirmed_at,
            })
    return tables


def generate(as_of: date, seed: int = SEED) -> dict[str, list[dict]]:
    rng = random.Random(seed)
    users = [{"id": i, "name": n, "role": r, "region": g} for i, n, r, g in catalog.USERS]
    products = {
        sku: {"sku": sku, "name": name, "category": cat, "spec": spec, "unit": unit,
              "unit_price": price, "unit_cost": cost, "aliases": aliases}
        for sku, name, cat, spec, unit, price, cost, aliases in catalog.PRODUCTS
    }
    customers = build_customers(rng, as_of)
    candidates = [c["id"] for c in customers if c["name"] not in SCENARIO_CUSTOMERS]
    late_payers = set(rng.sample(candidates, LATE_PAYER_COUNT))

    baskets, transactions, receivables = {}, [], []
    for c in customers:
        baskets[c["id"]] = build_basket(rng, c, products)
        lines = build_orders(rng, c, baskets[c["id"]], products, as_of)
        transactions += lines
        receivables += build_receivables(rng, c, lines, as_of, c["id"] in late_payers)

    return {
        "app_user": users,
        "product": list(products.values()),
        "customer": customers,
        "sales_transaction": transactions,
        "receivable": receivables,
        **build_visits(rng, customers, baskets, products, as_of),
    }
