"""依固定亂數種子產生假資料。as_of 與種子相同時，產出的每一筆都相同。

所有日期都從 as_of 往前推。換 as_of 會連拜訪日期與內容一起變（拜訪只排平日），
評測題庫的標準答案要用同一個 as_of 產生的資料計算。

亂數分三條：原本 80 家客戶與交易、補的 170 家客戶與交易、拜訪各用一條。
改其中一段不會連帶改到另一段，例如重排拜訪時，交易金額與帳款一筆都不會變。
"""

import random
from math import exp
from datetime import date, datetime, time, timedelta, timezone

import catalog
from app.config import settings
from app.pricing import SUPPLY_PRICE_FACTOR as PRICE_FACTOR  # 與 SAP 回寫共用同一份折數
from app.services.auth import MIN_PASSWORD_LENGTH, hash_password

SEED = 20260914
TAIPEI = timezone(timedelta(hours=8))
HISTORY_DAYS = 365
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
# 刻意設計的「慢箋成長」：三區各一家診所，慢性處方從同一個時間點開始每次多進五成（原型今日路線的
# 「杏林診所 · 大安，商機，慢箋成長，帶學名藥比價表」）。這是今日路線「商機」提醒的驗證案例：
# 其他客戶單次進貨金額的變動九成在 4% 以內、最多 8%，這三家要明顯超過兩成的提醒門檻
GROWTH_CUSTOMERS = {"杏林診所 · 大安", "明倫家醫科診所 · 北屯", "光明家醫科診所 · 三民"}
GROWTH_CATEGORY = "慢性處方"
GROWTH_FACTOR = 1.5

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
LATE_PAYER_COUNT = 5
# 補的連鎖分店每次進貨量是原本分店的一半。補客戶是為了讓拜訪量符合一天 3～5 家；照原本的量，
# 分店剛好少進一次貨的波動會蓋過「北區保健品下滑」這個刻意設計的案例（量過：北區按保健品
# 掉的金額排，前七名有五家是新分店，南京店排第七，數字題 D01 只答出板橋店；減半後前兩名是
# 板橋店、南京店）
EXTRA_BRANCH_QTY_SCALE = 0.5

# 一位業務一天跑 3～5 家，只排平日
VISITS_PER_DAY = (3, 5)
# 每天挑「距離上次拜訪的天數 × 等級權重」最大的幾家去。權重照原本各等級一年排的拜訪次數
# （A 3、B 2、C 1），只決定等級之間誰先去；實際多久去一次由每天 3～5 家的量決定
VISIT_WEIGHT = {"A": 3, "B": 2, "C": 1}
# 挑的時候再乘上這個範圍的亂數，拜訪間隔才不會固定得像排班表
VISIT_JITTER = (0.8, 1.2)
# 排程先空跑 60 天再開始記錄：C 級客戶約一個多月才輪到一次，空跑完每家都去過，
# 記錄的第一週才不會全是「很久沒去」的客戶
VISIT_WARMUP_DAYS = 60
# 第一家的出門時間、兩家之間隔幾分鐘；排滿五家，最後一家最晚約下午五點
FIRST_VISIT_MINUTES = (9 * 60 + 30, 10 * 60 + 30)
VISIT_GAP_MINUTES = (50, 100)
# 主角客戶寫死那次的前一週不排別的拜訪，免得前一兩天才剛去過（A 級客戶一般十多天去一次）
SCRIPTED_QUIET_DAYS = 7
# 每次拜訪帶到各種內容的機率。原本一年只排 150 筆拜訪（每家約 1.9 次），現在每家約 21 次，
# 機率都除以 11：每家客戶一年裡被提到競品、客訴、下單意向、承諾、約再訪的次數跟原本一樣，
# 客戶檔案的提醒與待處理事項不會因為拜訪變多而暴增
RATE_SCALE = 11
CONTENT_RATES = {
    "competitor": 0.15 / RATE_SCALE,
    "complaint": 0.3 / RATE_SCALE,
    "intent": 0.5 / RATE_SCALE,
    "commitment": 0.4 / RATE_SCALE,
    "follow_up": 0.35 / RATE_SCALE,
}

# 拜訪內容的機率跟客戶當下的狀態有關，不是每家每次都一樣。沒有這層關聯，拜訪紀錄裡就沒有
# 「哪些狀態的客戶值得先去」這個訊號，排序模型（backend/app/services/route_model.py）學不到東西。
#
# 係數的單位是「標準差」：把每個狀態值先換算成離平均幾個標準差，再乘上係數、取指數當倍率。
# 用標準差而不是原始值，是因為原始值的尺度差太多（間隔變化是比例、帳齡是天數），
# 而且假資料很規律，多數客戶的狀態都貼著平均，用原始值乘出來幾乎沒有差別（實測 AUC 0.51）。
CONTENT_SIGNALS = {
    # 進貨間隔拉長：補貨次數被分走，通常是陳列位被競品換掉的前兆，所以比較容易聊到競品
    "competitor": {"interval_change": 1.5},
    # 帳款拖著沒處理、上次拜訪隔太久：沒人去收的問題會累積下來
    "complaint": {"ar_age_days": 0.7, "visit_gap": 0.3},
    # 距上次進貨超過這家客戶平常的間隔：去了比較容易補到單
    "intent": {"order_gap": 1.3},
    # 帳款拖越久越要談付款，合約剩越少天越要談續約，兩種都會留下承諾
    "commitment": {"ar_age_days": 0.8, "contract_soon": 0.8},
    # 合約快到期的客戶比較會約下次再談
    "follow_up": {"contract_soon": 0.5},
}
# 「多久沒去」的係數壓得比其他低，是因為它本來就是排拜訪的依據。全靠它的話，排序模型學到的
# 只是現行規則已經知道的事；真正多出來的資訊在進貨、帳款與合約上。
# 指數前先把加總夾在這個範圍：不夾的話少數極端客戶會吃掉大部分的內容
CONTENT_SIGNAL_CLIP = 2.5

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


def scripted_date(as_of: date, days_ago: int) -> date:
    """寫死的拜訪日遇到週末就提前到週五：拜訪只排平日"""
    d = as_of - timedelta(days=days_ago)
    return d - timedelta(days=max(0, d.weekday() - 4))


def customer_specs(chains, independents, clinics):
    specs = []
    for group, region, branches in chains:
        for branch, city in branches:
            specs.append((f"{group} · {branch}", "chain", group, region, city))
    for name, area, region, city in independents:
        specs.append((f"{name} · {area}", "independent", None, region, city))
    for name, area, region, city in clinics:
        specs.append((f"{name} · {area}", "clinic", None, region, city))
    return specs


def build_customers(rng, as_of, specs, assigned, first_id=1):
    """同一區的客戶由該區業務輪流負責；assigned 記每一區已經分了幾家，補客戶時接著輪。"""
    customers = []
    for i, (name, type_, group, region, city) in enumerate(specs, start=first_id):
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


def build_basket(rng, customer, products, qty_scale=1.0):
    """每家客戶固定常進的品項與基準數量。貴的品項按單價縮小數量，qty_scale 再整體縮放。"""
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
    if qty_scale != 1:
        basket = {sku: max(1, round(qty * qty_scale)) for sku, qty in basket.items()}
    return basket


def build_orders(rng, customer, basket, products, as_of):
    type_ = customer["type"]
    base = 21 if customer["id"] == "C001" else rng.randint(*INTERVAL_DAYS[type_])
    scenario = customer["name"] in SCENARIO_CUSTOMERS
    north = customer["name"] in NORTH_DECLINE
    growing = customer["name"] in GROWTH_CUSTOMERS
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
            # 數量在亂數抽完之後才放大，不多抽亂數：其他客戶的交易一筆都不會變
            if growing and d >= slowdown_start and p["category"] == GROWTH_CATEGORY:
                qty = round(qty * GROWTH_FACTOR)
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


# 各等級大約幾天拜訪一次（排程排出來的結果，見 VISIT_WEIGHT 的註解）。判斷「這家是不是拖太久沒去」用的基準
VISIT_GAP_BY_GRADE = {"A": 12, "B": 17, "C": 32}
# 合約剩多久算「開始要談續約」。內部文件寫的是 3 個月，這裡用兩倍當斜坡的起點，分數才是連續的
CONTRACT_HORIZON_DAYS = 180


def trade_history(customers, transactions, receivables):
    """把交易與帳款整理成「每家客戶一份」，算狀態時才不必每次重掃全表。"""
    order_dates, invoices = {}, {}
    for c in customers:
        order_dates[c["id"]], invoices[c["id"]] = set(), []
    for line in transactions:
        order_dates[line["customer_id"]].add(line["date"])
    for row in receivables:
        invoices[row["customer_id"]].append((row["invoice_date"], row["paid_date"]))
    return {cid: sorted(dates) for cid, dates in order_dates.items()}, invoices


def customer_features(customer, day, last_visit, order_dates, invoices):
    """出門前就知道的客戶狀態，五個連續值。

    定義跟後端排序模型（backend/app/services/route_model.py）用的同一組，改了要兩邊一起改，
    否則模型訓練時看到的資料跟上線時算出來的不一樣。
    """
    before = [d for d in order_dates if d < day]
    recent = [d for d in before if d > day - timedelta(days=90)]
    older = [d for d in before if day - timedelta(days=180) < d <= day - timedelta(days=90)]

    def avg_gap(dates):
        return (dates[-1] - dates[0]).days / (len(dates) - 1) if len(dates) > 1 else None

    gap_now, gap_before = avg_gap(recent), avg_gap(older)
    typical_gap = gap_before or gap_now or 30
    ar_age = max(
        ((day - invoice_date).days for invoice_date, paid_date in invoices
         if invoice_date <= day and (paid_date is None or paid_date > day)),
        default=0,
    )
    contract_left = (customer["contract_end_date"] - day).days if customer["contract_end_date"] else None
    return {
        # 近 90 天的平均進貨間隔比之前拉長幾成（負的代表變密）
        "interval_change": gap_now / gap_before - 1 if gap_now and gap_before else 0.0,
        # 距上次拜訪幾天，除以這個等級平常的間隔
        "visit_gap": (day - last_visit).days / VISIT_GAP_BY_GRADE[customer["grade"]],
        # 距上次進貨幾天，除以這家平常的進貨間隔
        "order_gap": ((day - before[-1]).days if before else typical_gap) / typical_gap,
        # 帳齡最久的未收款發票拖了幾天
        "ar_age_days": float(ar_age),
        # 合約快到期的程度：剩半年以上（或沒有合約）是 0，到期當天是 1。
        # 不直接用「剩幾天」是因為多數客戶都是「還很久」，少數快到期的會變成極端值，
        # 標準化之後只剩這幾家有分數，排序全被合約綁架（實測過）
        "contract_soon": max(0.0, 1 - contract_left / CONTRACT_HORIZON_DAYS) if contract_left is not None else 0.0,
    }


def random_content(rng, basket, rates=CONTENT_RATES):
    content = {}
    if rng.random() < rates["competitor"]:
        name = rng.choices(catalog.COMPETITORS, weights=[1, 3, 3, 3])[0]
        content["competitor"] = [(name, rng.choice(catalog.COMPETITOR_DETAILS))]
    if rng.random() < rates["complaint"]:
        content["complaint"] = rng.choice(catalog.COMPLAINTS)
    if rng.random() < rates["intent"]:
        skus = rng.sample(sorted(basket), rng.choice([1, 1, 2]))
        content["intent"] = [(s, max(1, round(basket[s] * rng.uniform(0.5, 1.0)))) for s in skus]
    if rng.random() < rates["commitment"]:
        if rng.random() < 0.7:
            content["commitment"] = ("us", rng.choice(catalog.OUR_COMMITMENTS), rng.randint(3, 14))
        else:
            content["commitment"] = ("customer", rng.choice(catalog.CUSTOMER_COMMITMENTS), rng.randint(3, 14))
    if rng.random() < rates["follow_up"]:
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
        say(None, rng.choice(catalog.ROUTINE_NOTES))
    return "".join(parts), fields, sources


def schedule_visits(rng, customers, as_of):
    """每位業務每個平日排 3～5 家，挑「距離上次拜訪的天數 × 等級權重」最大的幾家。

    主角客戶寫死的那次拜訪照日期排進去，之前一週與之後都不排別的，最近一次拜訪才會是寫死的那次。
    回傳 [(客戶, 拜訪時間, 寫死的內容或 None)]，依時間排序。
    """
    first_day = as_of - timedelta(days=HISTORY_DAYS - 1)
    day = first_day - timedelta(days=VISIT_WARMUP_DAYS)
    scripted = {}
    for c in customers:
        if c["name"] in SCRIPTED_VISITS:
            days_ago, content = SCRIPTED_VISITS[c["name"]]
            scripted[c["id"]] = (scripted_date(as_of, days_ago), content)
    quiet_from = {cid: d - timedelta(days=SCRIPTED_QUIET_DAYS) for cid, (d, _) in scripted.items()}
    by_rep = {}
    for c in customers:
        by_rep.setdefault(c["owner_user_id"], []).append(c)
    last = {c["id"]: day - timedelta(days=rng.randint(1, 30)) for c in customers}

    planned = []
    while day < as_of:
        if day.weekday() < 5:
            for rep in sorted(by_rep):
                fixed = [c for c in by_rep[rep] if c["id"] in scripted and scripted[c["id"]][0] == day]
                pool = [c for c in by_rep[rep] if c["id"] not in quiet_from or day < quiet_from[c["id"]]]
                priority = {c["id"]: (day - last[c["id"]]).days * VISIT_WEIGHT[c["grade"]] * rng.uniform(*VISIT_JITTER) for c in pool}
                pool.sort(key=lambda c: priority[c["id"]], reverse=True)
                today = pool[:rng.randint(*VISITS_PER_DAY) - len(fixed)] + fixed
                rng.shuffle(today)
                minutes = rng.randint(*FIRST_VISIT_MINUTES)
                for c in today:
                    last[c["id"]] = day
                    if day >= first_day:
                        content = scripted[c["id"]][1] if c in fixed else None
                        planned.append((c, datetime.combine(day, time(minutes // 60, minutes % 60), TAIPEI), content))
                    minutes += rng.randint(*VISIT_GAP_MINUTES)
        day += timedelta(days=1)
    planned.sort(key=lambda x: (x[1], x[0]["id"]))
    return planned


def plan_content_rates(planned, customers, transactions, receivables):
    """每次拜訪各種內容的機率：照客戶當下的狀態算倍率，再整體縮回原本的平均機率。

    縮回去這一步是為了讓每種內容一年出現幾次跟以前一樣，客戶檔案的「待處理事項」才不會變多變少；
    倍率只決定這些內容落在哪些客戶身上。
    """
    order_dates, invoices = trade_history(customers, transactions, receivables)
    by_id = {c["id"]: c for c in customers}
    last_visit = {}
    rows = []
    for c, visited_at, _ in planned:
        day = visited_at.date()
        # 第一次出現的客戶沒有上一次可比，就當作剛好照正常間隔來
        previous = last_visit.get(c["id"], day - timedelta(days=VISIT_GAP_BY_GRADE[c["grade"]]))
        rows.append(customer_features(by_id[c["id"]], day, previous, order_dates[c["id"]], invoices[c["id"]]))
        last_visit[c["id"]] = day

    names = list(rows[0])
    mean = {k: sum(r[k] for r in rows) / len(rows) for k in names}
    sd = {k: (sum((r[k] - mean[k]) ** 2 for r in rows) / len(rows)) ** 0.5 or 1.0 for k in names}
    multipliers = []
    for r in rows:
        z = {k: (r[k] - mean[k]) / sd[k] for k in names}
        multipliers.append({
            key: exp(max(-CONTENT_SIGNAL_CLIP, min(CONTENT_SIGNAL_CLIP, sum(coef * z[name] for name, coef in weights.items()))))
            for key, weights in CONTENT_SIGNALS.items()
        })
    scale = {
        key: CONTENT_RATES[key] / (sum(m[key] for m in multipliers) / len(multipliers))
        for key in CONTENT_RATES
    }
    return [{key: m[key] * scale[key] for key in CONTENT_RATES} for m in multipliers]


def build_visits(rng, customers, baskets, products, as_of, transactions, receivables):
    tables = {name: [] for name in ("visit", "crm_visit_record", "sap_quotation_draft", "oa_expense_form", "writeback_log")}
    planned = schedule_visits(rng, customers, as_of)
    rates = plan_content_rates(planned, customers, transactions, receivables)
    for n, ((c, visited_at, content), rate) in enumerate(zip(planned, rates), start=1):
        visit_id = f"V{n:05d}"
        d = visited_at.date()
        if content is None:
            # 主角客戶其他的拜訪都是例行拜訪：提醒只來自寫死的那次，客戶檔案與題庫的答案才不會被亂數改掉
            content = {} if c["name"] in SCENARIO_CUSTOMERS else random_content(rng, baskets[c["id"]], rate)
        transcript, fields, sources = render_visit(rng, c, d, content, products)
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
                "quote_no": visit_id, "visit_id": visit_id, "line_no": line_no, "customer_id": c["id"], "sku": item["sku"],
                "created_by": c["owner_user_id"],
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
    # 帳號是公司給的，沒有註冊功能。Email 用工號，密碼八個帳號都一樣，由 DEMO_PASSWORD 設定
    password = settings().demo_password
    # 部署時灌資料失敗會讓整次部署失敗，比線上帳號默默變成弱密碼好發現
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"DEMO_PASSWORD 至少要 {MIN_PASSWORD_LENGTH} 碼")
    password_hash = hash_password(password)
    users = [
        {"id": i, "name": n, "role": r, "region": g,
         "email": f"{i.lower()}@meddemo.tw", "password_hash": password_hash, "session_version": 1}
        for i, n, r, g in catalog.USERS
    ]
    products = {
        sku: {"sku": sku, "name": name, "category": cat, "spec": spec, "unit": unit,
              "unit_price": price, "unit_cost": cost, "aliases": aliases}
        for sku, name, cat, spec, unit, price, cost, aliases in catalog.PRODUCTS
    }
    assigned = {region: 0 for region in catalog.REGION_SALES}
    customers = build_customers(rng, as_of, customer_specs(catalog.CHAINS, catalog.INDEPENDENTS, catalog.CLINICS), assigned)
    candidates = [c["id"] for c in customers if c["name"] not in SCENARIO_CUSTOMERS]
    late_payers = set(rng.sample(candidates, LATE_PAYER_COUNT))

    baskets, transactions, receivables = {}, [], []

    def add_trade(stream, group, late, branch_scale=1.0):
        for c in group:
            baskets[c["id"]] = build_basket(stream, c, products, branch_scale if c["type"] == "chain" else 1.0)
            lines = build_orders(stream, c, baskets[c["id"]], products, as_of)
            transactions.extend(lines)
            receivables.extend(build_receivables(stream, c, lines, as_of, c["id"] in late))

    add_trade(rng, customers, late_payers)

    # 補的客戶用第二條亂數，上面原本 80 家的等級、交易與帳款一筆都不變
    extra_rng = random.Random(seed + 1)
    specs = customer_specs(catalog.EXTRA_CHAINS, catalog.EXTRA_INDEPENDENTS, catalog.EXTRA_CLINICS)
    extra = build_customers(extra_rng, as_of, specs, assigned, first_id=len(customers) + 1)
    # 拖款戶照原本 80 家抽 5 家的比例
    extra_late = set(extra_rng.sample([c["id"] for c in extra], round(len(extra) * LATE_PAYER_COUNT / len(customers))))
    add_trade(extra_rng, extra, extra_late, branch_scale=EXTRA_BRANCH_QTY_SCALE)
    customers += extra

    return {
        "app_user": users,
        "product": list(products.values()),
        "customer": customers,
        "sales_transaction": transactions,
        "receivable": receivables,
        # 拜訪用第三條亂數：改排程或內容機率，不會動到客戶與交易
        **build_visits(random.Random(seed + 2), customers, baskets, products, as_of, transactions, receivables),
    }
