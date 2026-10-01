"""依固定亂數種子產生假資料。as_of 與種子相同時，產出的每一筆都相同。

所有日期都從 as_of 往前推。換 as_of 會連拜訪日期與內容一起變（拜訪只排平日），
評測題庫的標準答案要用同一個 as_of 產生的資料計算。例外是促銷方案：照搬的那一期是真實方案，
固定在 2026 年 8 月，換 as_of 只會改變模擬到哪個月。

亂數分四條：原本 80 家客戶與交易、補的 170 家客戶與交易、拜訪、優惠與合約的歷史申請單各用一條。
改其中一段不會連帶改到另一段，例如重排拜訪時，交易金額與帳款一筆都不會變。
"""

import calendar
import hashlib
import random
from math import exp, log1p
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


PLACE_BY_NAME = {name: place_id for place_id, name, _ in catalog.PLACES}


def customer_specs(chains, independents, clinics):
    """(名稱, 類型, 連鎖體系, 區處, 城市, 地區)。地區是連鎖的分店名、其他客戶名稱裡的地區，用來對到地點"""
    specs = []
    for group, region, branches in chains:
        for branch, city in branches:
            specs.append((f"{group} · {branch}", "chain", group, region, city, branch))
    for name, area, region, city in independents:
        specs.append((f"{name} · {area}", "independent", None, region, city, area))
    for name, area, region, city in clinics:
        specs.append((f"{name} · {area}", "clinic", None, region, city, area))
    return specs


def place_of(name: str, type_: str, city: str, area: str) -> str:
    """客戶所在的地點（catalog.PLACES 的 id）：台北市對到行政區，其他縣市就是縣市本身。
    對不到就直接失敗並點名是哪一家：地點決定討論串掛在哪、整區誰看得到，不能默默放錯。"""
    if city == "台北市":
        if type_ == "chain":
            district = catalog.TAIPEI_BRANCH_DISTRICT.get(area)
        else:
            district = catalog.TAIPEI_AREA_DISTRICT.get(area, area)
        place = PLACE_BY_NAME.get(f"台北市・{district}區")
    else:
        place = PLACE_BY_NAME.get(city)
    if place is None:
        raise ValueError(f"{name} 對不到地點（{city}・{area}），請在 catalog.py 的台北市對照表補上")
    return place


# 同一區的客戶錯開的最大幅度（度）：0.004 度約 400 公尺，還在同一區裡
LOCATION_JITTER = 0.004


def district_of(type_: str, city: str, area: str) -> str:
    """客戶所在的行政區或鄉鎮（不帶「區」「市」「鎮」），算車程與排序習慣的「地區」用。"""
    if city == "台北市" and type_ == "chain":
        return catalog.TAIPEI_BRANCH_DISTRICT[area]
    if area in catalog.AREA_DISTRICT:
        return catalog.AREA_DISTRICT[area]
    return area.removesuffix("店") if type_ == "chain" else area


def location_of(customer_id: str, city: str, district: str) -> tuple[float, float]:
    """那一區的中心點，依客戶 id 的雜湊錯開。用雜湊不用亂數：不能動到其他資料的亂數序列。"""
    centre = catalog.DISTRICT_COORDS.get((city, district))
    if centre is None:
        raise ValueError(f"{customer_id} 對不到位置（{city}・{district}），請在 catalog.py 的 DISTRICT_COORDS 補上")
    digest = hashlib.sha256(customer_id.encode()).digest()
    lat = centre[0] + (digest[0] / 255 * 2 - 1) * LOCATION_JITTER
    lng = centre[1] + (digest[1] / 255 * 2 - 1) * LOCATION_JITTER
    return round(lat, 6), round(lng, 6)


def build_customers(rng, as_of, specs, assigned, first_id=1):
    """同一區的客戶由該區業務輪流負責；assigned 記每一區已經分了幾家，補客戶時接著輪。"""
    customers = []
    for i, (name, type_, group, region, city, area) in enumerate(specs, start=first_id):
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
        customer_id = f"C{i:03d}"
        district = district_of(type_, city, area)
        lat, lng = location_of(customer_id, city, district)
        customers.append({
            "id": customer_id, "name": name, "type": type_, "chain_group": group,
            "region": region, "city": city, "place_id": place_of(name, type_, city, area), "grade": grade,
            "contract_end_date": contract_end, "owner_user_id": owner,
            "area": district, "lat": lat, "lng": lng,
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
            "form_no": f"OA{d:%Y%m}{n:05d}", "kind": "trip", "required_level": "manager",
            "visit_id": visit_id, "applicant_id": c["owner_user_id"], "trip_date": d,
            "customer_id": c["id"], "purpose": "客戶拜訪", "unit_name": c["region"],
            "status": "approved", "created_at": confirmed_at, "submitted_at": confirmed_at,
            # 優惠與合約申請單才有的欄位。同一張表的每一列要有同一組鍵，才能整批寫入
            "request_date": None, "payload": None, "model_probability": None, "model_features": None,
            "auto_approved": False,
        })
        for target in ("crm", "sap", "oa"):
            status = "skipped" if target == "sap" and not fields["intent"] else "success"
            tables["writeback_log"].append({
                "visit_id": visit_id, "target": target, "attempt": 1, "status": status,
                "created_at": confirmed_at, "finished_at": confirmed_at,
            })
    return tables


# 真實品項沒有成本資料，照虛構品項的成本率（約六成）估，毛利相關的欄位才不會是空的
PROMO_COST_RATIO = 0.6


def build_promotions(as_of):
    """CYH 的 202608 那一期照搬，之後每個月模擬一期到 as_of 那個月，決賽日才有一期「進行中」。

    模擬的每一期品項與搭贈照舊（獅王本來就標「常態搭贈」），PM 提醒只留還在期限內的段落。
    促銷品項編號接著往下編，一期用掉一段，同一個品項在每一期的相對位置不變。
    """
    promotions, items = [], []
    ship_price = {sku: ship for sku, _, _, _, _, ship, _, _ in catalog.PROMO_PRODUCTS}
    list_price = {sku: price for sku, _, _, _, _, _, price, _ in catalog.PROMO_PRODUCTS}
    start = catalog.PROMOTION_START
    period = 0
    while start <= as_of:
        end = (start + timedelta(days=31)).replace(day=1) - timedelta(days=1)
        month = f"{start:%Y%m}"
        promotion_id = f"PR-{month}"
        active = [(until, text, tag) for until, text, tag in catalog.PROMOTION_NOTES if until is None or month <= until]
        ended = [tag for until, _, tag in catalog.PROMOTION_NOTES if tag and until and month > until]
        promotions.append({
            "id": promotion_id, "name": f"{month}{catalog.PROMOTION_NAME}",
            "department": catalog.PROMOTION_DEPARTMENT, "type": catalog.PROMOTION_TYPE,
            "start_date": start, "end_date": end, "pm_note": "\n".join(text for _, text, _ in active),
        })
        for group, code, name, sku, deal, buy, free, price in catalog.PROMOTION_ITEMS:
            for tag in ended:
                deal = deal.removesuffix(f", {tag}")
            items.append({
                "code": f"PP-{int(code[3:]) + period * len(catalog.PROMOTION_ITEMS):06d}",
                "promotion_id": promotion_id, "group_name": group, "name": name, "sku": sku, "deal": deal,
                "buy_qty": buy, "free_qty": free, "deal_price": price,
                "list_price": list_price[sku], "ship_price": ship_price[sku],
            })
        start = end + timedelta(days=1)
        period += 1
    return promotions, items


# ── 優惠與合約的申請單：簽核模型（backend/app/services/approvals.py）的訓練資料 ─────────────
#
# 規則與特徵的定義跟 approvals.py 是同一組，改了要兩邊一起改；
# test_approvals.py 會抽歷史單，比對這裡算的特徵跟後端在那一天算出來的一樣。

# 歷史申請單落在最近這麼多天裡。交易只有一年，申請當天要往回看 90 天的進貨金額，
# 再早的申請看到的會是不完整的 90 天
APPROVAL_HISTORY_DAYS = HISTORY_DAYS - 90
DISCOUNT_FORMS = 900
CONTRACT_FORMS = 300
# 客戶狀態看近 90 天，跟客戶檔案同一個時間窗
APPROVAL_STATE_DAYS = 90
# 《報價權限與折扣審核》：業務自己 3%、區處主管 8%、業務處長 12%，再上去總經理，最多收到 20%
DISCOUNT_BANDS = {"manager": (3.5, 8.0), "director": (8.5, 12.0), "gm": (12.5, 20.0)}
# 大多落在主管權限內，少數到處長，很少到總經理
DISCOUNT_BAND_WEIGHTS = {"manager": 72, "director": 22, "gm": 6}
# 連鎖量大、議價多，來要折扣的比獨立藥局與診所多
DISCOUNT_CUSTOMER_WEIGHT = {"chain": 3.0, "independent": 1.5, "clinic": 1.0}
# 要折扣的通常是比平常大的單：每個品項是平常一次進貨量的幾倍
DISCOUNT_QTY_SCALE = (1.0, 4.0)
# 續約三分之二照原費率；有調整的大多是通路要求調高（百分點）
CONTRACT_SAME_RATE = 2 / 3
CONTRACT_LISTING_STEPS = (-0.5, 0.5, 0.5, 1.0, 1.0, 1.5, 2.0)
CONTRACT_REWARD_STEPS = (0.0, 0.0, 0.5, 0.5, 1.0)
CONTRACT_TERMS = (12, 12, 12, 24)
# 簽核結果跟特徵的關聯，係數的單位是標準差（做法跟 CONTENT_SIGNALS 一樣）。沒有這層關聯，
# 簽核模型學不到東西。方向照設計文件：折扣越深、折後毛利越低、帳款拖越久越容易被退；
# 有競品壓力、進貨量大、等級高比較會過。合約則是費率調得越多越難過，淨毛利低、帳款久也難過。
DISCOUNT_APPROVAL = {
    "bias": 1.9,
    "discount_pct": -2.4, "margin_after": 1.0, "ar_age_days": -1.0,
    "competitor_recent": 0.5, "log_sales_90d": 0.6, "grade_weight": 0.4,
}
CONTRACT_APPROVAL = {
    "bias": 2.2,
    "fee_change": -2.2, "net_margin": 1.0, "ar_age_days": -1.0,
    "log_sales_90d": 0.5, "grade_weight": 0.4, "term_years": -0.2,
}
# 同樣條件的單，換一位主管、換一天簽，結果不會完全一樣：分數上再加一點常態雜訊
APPROVAL_NOISE_SD = 0.4
# 沒過的單多數是駁回，其餘退回請業務補資料
REFUSED_STATUSES = ("rejected", "rejected", "returned")
DISCOUNT_REASONS = [
    "競品開了更低的價格，客戶要求比照",
    "客戶這次進貨量比平常大，要求量大折扣",
    "客戶準備做檔期，要求進貨折扣",
    "新分店開幕，希望首批進貨給優惠",
    "庫存效期較近，客戶願意多進但要折扣",
]
CONTRACT_REASONS = [
    "合約即將到期，照去年條件續約",
    "客戶希望多簽一年換取穩定供貨",
    "通路總部要求調整費率才願意續約",
    "競品提出更高的通路獎勵，客戶要求比照",
]

# 給展示用的五張：陳建宏的簽核匣三張待簽，林昱辰名下兩張系統核准。都是林昱辰的客戶，前一天送的。
# (種類, 客戶, 內容, 狀態, 是不是系統核准)。優惠的內容是 (折扣, [(品項, 數量)], 理由)；
# 合約是 (月數, 上架費率調整幾個百分點, 通路獎勵調整幾個百分點, 理由)
DEMO_REQUESTS = [
    # 鶯歌店有帳款拖超過 60 天：規則上主管就能簽，但帳款這一條不交給模型，一定送人
    ("discount", "福安連鎖藥局 · 鶯歌店", (6.0, [("HS-FO30", 80), ("HS-CA60", 40)], "康普樂開買十送一，店長要求比照"), "pending", False),
    # 10% 超過區處主管的權限，主管簽完還要送業務處長
    ("discount", "福安連鎖藥局 · 板橋店", (10.0, [("HS-FO30", 120)], "御松田要搶櫃檯旁的陳列位，店長要求魚油比照競品條件"), "pending", False),
    ("contract", "康泰連鎖藥局 · 蘆洲店", (12, 0.5, 0.0, "總部要求上架費率調高半個百分點才願意續約"), "pending", False),
    ("discount", "康泰連鎖藥局 · 忠孝店", (4.0, [("HS-FO30", 60), ("HS-PB30", 30)], "御松田條件比我們好，店長願意先進魚油但要折扣"), "approved", True),
    ("discount", "康泰連鎖藥局 · 南港店", (5.0, [("HS-FO30", 50), ("HS-CA60", 30)], "這次進貨量比平常多一倍，要求量大折扣"), "approved", True),
]


def add_months(day, months):
    """往後加幾個月；落在比較短的月份就取那個月的最後一天。"""
    index = day.year * 12 + day.month - 1 + months
    year, month = divmod(index, 12)
    return date(year, month + 1, min(day.day, calendar.monthrange(year, month + 1)[1]))


def approval_index(customers, transactions, receivables, visits):
    """把交易、帳款、提到競品的拜訪整理成「每家客戶一份」，算申請當天的狀態時才不必每次重掃全表。"""
    trades = {c["id"]: [] for c in customers}
    invoices = {c["id"]: [] for c in customers}
    competitor_days = {c["id"]: [] for c in customers}
    for line in transactions:
        trades[line["customer_id"]].append(line)
    for row in receivables:
        invoices[row["customer_id"]].append((row["invoice_date"], row["paid_date"]))
    for visit in visits:
        if visit["fields_final"]["competitor"]:
            competitor_days[visit["customer_id"]].append(visit["visited_at"].date())
    return trades, invoices, competitor_days


def approval_state(customer, day, trades, invoices, competitor_days):
    """申請當天早上這家客戶的狀態。定義跟後端的 approvals.customer_state 是同一組。"""
    since = day - timedelta(days=APPROVAL_STATE_DAYS)
    recent = [line for line in trades if since < line["date"] < day]
    revenue = sum(line["amount"] for line in recent)
    fees = sum(line["cost"] + line["listing_fee"] + line["channel_reward"] for line in recent)
    # 進貨間隔的變化跟今日路線同一個算法（route_model 的 SQL）：每次進貨距離上一次幾天，算在這次進貨的日子上
    dates = sorted({line["date"] for line in trades if line["date"] < day})
    gaps = [(later, (later - earlier).days) for earlier, later in zip(dates, dates[1:])]
    now = [gap for d, gap in gaps if d > since]
    before = [gap for d, gap in gaps if day - timedelta(days=2 * APPROVAL_STATE_DAYS) < d <= since]
    gap_now = sum(now) / len(now) if now else None
    gap_before = sum(before) / len(before) if before else None
    return {
        "sales_90d": float(revenue),
        "net_margin": (revenue - fees) / revenue if revenue else 0.0,
        "interval_change": gap_now / gap_before - 1 if gap_now and gap_before else 0.0,
        "ar_age_days": float(max(
            ((day - invoice_date).days for invoice_date, paid_date in invoices
             if invoice_date <= day and (paid_date is None or paid_date > day)),
            default=0,
        )),
        # 申請當天的拜訪也算
        "competitor_recent": 1.0 if any(since <= d <= day for d in competitor_days) else 0.0,
        "grade_weight": float(VISIT_WEIGHT[customer["grade"]]),
    }


def discount_features(state, payload):
    amount, cost = float(payload["amount"]), float(payload["cost"])
    return {
        "discount_pct": float(payload["discount_pct"]),
        "margin_after": (amount - cost) / amount if amount else 0.0,
        "log_amount": log1p(amount),
        "log_sales_90d": log1p(state["sales_90d"]),
        "ar_age_days": state["ar_age_days"],
        "competitor_recent": state["competitor_recent"],
        "grade_weight": state["grade_weight"],
    }


def contract_features(state, payload):
    listing, reward = payload["listing_fee_rate"], payload["channel_reward_rate"]
    return {
        "fee_change": round(((listing["to"] - listing["from"]) + (reward["to"] - reward["from"])) * 100, 4),
        "term_years": payload["term_months"] / 12,
        "net_margin": state["net_margin"],
        "log_sales_90d": log1p(state["sales_90d"]),
        "interval_change": state["interval_change"],
        "ar_age_days": state["ar_age_days"],
        "grade_weight": state["grade_weight"],
    }


def discount_level(pct):
    return next(level for level, (_, high) in DISCOUNT_BANDS.items() if pct <= high)


def discount_payload(customer, products, items, pct, reason):
    """一張報價折扣的申請內容。假資料不建報價草稿（會影響今日路線的商機），所以 quote_no 是 None。"""
    factor = PRICE_FACTOR[customer["type"]]
    list_amount = sum(qty * round(products[sku]["unit_price"] * factor) for sku, qty in items)
    return {
        "quote_no": None, "discount_pct": pct, "list_amount": list_amount,
        "amount": round(list_amount * (1 - pct / 100)),
        "cost": sum(qty * products[sku]["unit_cost"] for sku, qty in items), "reason": reason,
    }


def contract_payload(customer, old_end, term_months, listing_change, reward_change, reason):
    """一張續約的申請內容。調整的單位是百分點。"""
    listing, reward = CHAIN_FEES[customer["chain_group"]]
    return {
        "term_months": term_months,
        "listing_fee_rate": {"from": listing, "to": round(listing + listing_change / 100, 4)},
        "channel_reward_rate": {"from": reward, "to": round(reward + reward_change / 100, 4)},
        "old_end_date": old_end.isoformat(), "new_end_date": add_months(old_end, term_months).isoformat(),
        "reason": reason,
    }


def decide_requests(rng, requests, signals):
    """照特徵決定每張單過不過：每個特徵換算成離平均幾個標準差，乘上係數加起來當分數，再加雜訊。"""
    names = [name for name in signals if name != "bias"]
    rows = [features for _, features in requests]
    mean = {k: sum(r[k] for r in rows) / len(rows) for k in names}
    sd = {k: (sum((r[k] - mean[k]) ** 2 for r in rows) / len(rows)) ** 0.5 or 1.0 for k in names}
    statuses = []
    for features in rows:
        score = signals["bias"] + sum(signals[k] * (features[k] - mean[k]) / sd[k] for k in names)
        score += rng.gauss(0, APPROVAL_NOISE_SD)
        approved = rng.random() < 1 / (1 + exp(-score))
        statuses.append("approved" if approved else rng.choice(REFUSED_STATUSES))
    return statuses


def request_row(kind, prefix, seq, customer, at, payload, level, features, status, auto_approved=False):
    return {
        "form_no": f"{prefix}{at:%Y%m}{seq:05d}", "kind": kind, "required_level": level,
        "visit_id": None, "applicant_id": customer["owner_user_id"], "trip_date": None,
        "customer_id": customer["id"], "purpose": "報價折扣" if kind == "discount" else "連鎖續約",
        "unit_name": customer["region"], "status": status, "created_at": at, "submitted_at": at,
        "request_date": at.date(), "payload": payload,
        # 歷史單是人簽的，當時沒有模型；展示用的五張在灌資料時用訓練好的模型補上機率（seed.py）
        "model_probability": None, "model_features": features, "auto_approved": auto_approved,
    }


def build_approval_history(rng, customers, baskets, products, as_of, transactions, receivables, visits):
    """優惠與合約的歷史申請單（全部已經有結果），加上給展示用的五張。

    每張單的關卡與活動日誌在 seed.py 補，做法跟歷史出差單一樣。
    """
    trades, invoices, competitor_days = approval_index(customers, transactions, receivables, visits)

    def state(customer, day):
        cid = customer["id"]
        return approval_state(customer, day, trades[cid], invoices[cid], competitor_days[cid])

    def moment(day):
        return datetime.combine(day, time(rng.randint(9, 17), rng.randint(0, 59)), TAIPEI)

    workdays = [d for d in (as_of - timedelta(days=n) for n in range(APPROVAL_HISTORY_DAYS, 0, -1)) if d.weekday() < 5]
    weights = [DISCOUNT_CUSTOMER_WEIGHT[c["type"]] for c in customers]
    chains = [c for c in customers if c["type"] == "chain"]

    discounts = []
    for _ in range(DISCOUNT_FORMS):
        customer = rng.choices(customers, weights=weights)[0]
        at = moment(rng.choice(workdays))
        band = rng.choices(list(DISCOUNT_BAND_WEIGHTS), weights=list(DISCOUNT_BAND_WEIGHTS.values()))[0]
        low, high = DISCOUNT_BANDS[band]
        # 每 0.5% 一格；同一級裡淺的折扣比深的常見
        steps = [low + 0.5 * i for i in range(int((high - low) * 2) + 1)]
        pct = rng.choices(steps, weights=[len(steps) - i / 2 for i in range(len(steps))])[0]
        basket = baskets[customer["id"]]
        items = [
            (sku, max(1, round(basket[sku] * rng.uniform(*DISCOUNT_QTY_SCALE))))
            for sku in rng.sample(sorted(basket), rng.choice([1, 1, 2, 2, 3]))
        ]
        payload = discount_payload(customer, products, items, pct, rng.choice(DISCOUNT_REASONS))
        discounts.append(((customer, at, payload, band), discount_features(state(customer, at.date()), payload)))

    contracts = []
    for _ in range(CONTRACT_FORMS):
        customer = rng.choice(chains)
        at = moment(rng.choice(workdays))
        # 續約協商在到期前 3 個月內啟動（《連鎖通路合約條件》）
        old_end = at.date() + timedelta(days=rng.randint(15, 90))
        if rng.random() < CONTRACT_SAME_RATE:
            listing_change, reward_change, reason = 0.0, 0.0, rng.choice(CONTRACT_REASONS[:2])
        else:
            listing_change, reward_change = rng.choice(CONTRACT_LISTING_STEPS), rng.choice(CONTRACT_REWARD_STEPS)
            reason = rng.choice(CONTRACT_REASONS[2:])
        payload = contract_payload(customer, old_end, rng.choice(CONTRACT_TERMS), listing_change, reward_change, reason)
        level = "manager" if (listing_change, reward_change) == (0.0, 0.0) else "director"
        contracts.append(((customer, at, payload, level), contract_features(state(customer, at.date()), payload)))

    rows = []
    numbering = {}

    def add(kind, prefix, customer, at, payload, level, features, status, auto_approved=False):
        seq = numbering[prefix, at.year, at.month] = numbering.get((prefix, at.year, at.month), 0) + 1
        rows.append(request_row(kind, prefix, seq, customer, at, payload, level, features, status, auto_approved))

    for kind, prefix, requests, signals in (
        ("discount", "DC", discounts, DISCOUNT_APPROVAL), ("contract", "CT", contracts, CONTRACT_APPROVAL),
    ):
        statuses = decide_requests(rng, requests, signals)
        # 照送單時間排，同一個月的單號才是先送的在前面
        for ((customer, at, payload, level), features), status in sorted(
            zip(requests, statuses), key=lambda item: (item[0][0][1], item[0][0][0]["id"])
        ):
            add(kind, prefix, customer, at, payload, level, features, status)

    # 展示用的五張：前一天下午送的，每張隔十分鐘
    by_name = {c["name"]: c for c in customers}
    yesterday = as_of - timedelta(days=1)
    for n, (kind, name, spec, status, auto_approved) in enumerate(DEMO_REQUESTS):
        customer = by_name[name]
        at = datetime.combine(yesterday, time(14, 10 * n), TAIPEI)
        if kind == "discount":
            pct, items, reason = spec
            payload = discount_payload(customer, products, items, pct, reason)
            level, features = discount_level(pct), discount_features(state(customer, yesterday), payload)
        else:
            term_months, listing_change, reward_change, reason = spec
            payload = contract_payload(customer, customer["contract_end_date"], term_months, listing_change, reward_change, reason)
            level = "manager" if (listing_change, reward_change) == (0.0, 0.0) else "director"
            features = contract_features(state(customer, yesterday), payload)
        add(kind, "DC" if kind == "discount" else "CT", customer, at, payload, level, features, status, auto_approved)
    return rows


# 方法卡是幾天前寫的。回饋落在寫好之後、灌資料之前
METHOD_CARD_AGE_DAYS = (60, 150)
# 回饋是上班時間按的（從零點起算的分鐘數）
FEEDBACK_MINUTES = (9 * 60, 18 * 60)


def build_method_cards(customers, seed):
    """catalog.METHOD_CARDS 的卡片，加上每張卡的回饋：照目標次數分散到業務各自名下、這張卡適用的那種客戶。

    用自己的亂數，而且只讀客戶清單：前面的客戶、交易、拜訪一筆都不會變。
    時間只給「幾天前、幾點幾分」，由 seed.py 從灌資料那一刻往前推：回饋跟頻道的對話一樣是最近的事，不跟著 as_of。
    卡片的 id 是資料庫自己編的，回饋先記卡片標題，寫入時再查回 id。
    """
    rng = random.Random(seed + 101)
    cards, feedback = [], []
    for title, situation, approach, customer_type, tags, author_id, adopted, not_helped in catalog.METHOD_CARDS:
        age = rng.randint(*METHOD_CARD_AGE_DAYS)
        cards.append({
            "title": title, "situation": situation, "approach": approach, "customer_type": customer_type,
            "tags": tags, "author_id": author_id, "status": "published", "days_ago": age,
        })
        # 一家客戶只有一位負責人，客戶不重複抽，(卡片, 業務, 客戶) 就不會重複
        pool = [c for c in customers if customer_type in (None, c["type"])]
        answers = [True] * adopted + [False] * not_helped
        rng.shuffle(answers)
        for c, helped in zip(rng.sample(pool, len(answers)), answers):
            feedback.append({
                "card_title": title, "user_id": c["owner_user_id"], "customer_id": c["id"], "helped": helped,
                "days_ago": rng.randint(1, age - 1), "minute": rng.randint(*FEEDBACK_MINUTES),
            })
    return {"method_card": cards, "method_card_feedback": feedback}


def generate(as_of: date, seed: int = SEED) -> dict[str, list[dict]]:
    rng = random.Random(seed)
    # 公司給的帳號。Email 用工號，密碼十個帳號都一樣，由 DEMO_PASSWORD 設定
    password = settings().demo_password
    # 部署時灌資料失敗會讓整次部署失敗，比線上帳號默默變成弱密碼好發現
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"DEMO_PASSWORD 至少要 {MIN_PASSWORD_LENGTH} 碼")
    password_hash = hash_password(password)
    # org_path 與 region 是衍生值，seed.py 寫入前才依組織樹算（services/org.py）
    users = [
        {"id": i, "name": n, "role": r,
         "email": e or f"{i.lower()}@meddemo.tw", "password_hash": password_hash, "session_version": 1,
         "manager_id": m, "unit_id": u}
        for i, n, r, m, u, e in catalog.USERS
    ]
    org_units = [
        {"id": i, "name": n, "kind": k, "parent_id": p,
         "lat": catalog.REGION_OFFICE.get(i, (None, None))[0], "lng": catalog.REGION_OFFICE.get(i, (None, None))[1]}
        for i, n, k, p in catalog.ORG_UNITS
    ]
    places = [{"id": i, "name": n, "unit_id": u} for i, n, u in catalog.PLACES]
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

    # 促銷的真實品項只進品項表，不放進上面的 products：常進品項是從 products 抽的
    promo_products = [
        {"sku": sku, "name": name, "category": cat, "spec": spec, "unit": unit,
         "unit_price": ship, "unit_cost": round(ship * PROMO_COST_RATIO), "aliases": aliases}
        for sku, name, cat, spec, unit, ship, _, aliases in catalog.PROMO_PRODUCTS
    ]
    promotions, promotion_items = build_promotions(as_of)

    data = {
        "org_unit": org_units,
        "place": places,
        "app_user": users,
        "product": list(products.values()) + promo_products,
        "promotion": promotions,
        "promotion_item": promotion_items,
        "customer": customers,
        "sales_transaction": transactions,
        "receivable": receivables,
        # 拜訪用第三條亂數：改排程或內容機率，不會動到客戶與交易
        **build_visits(random.Random(seed + 2), customers, baskets, products, as_of, transactions, receivables),
        # 模擬 SAP 的人員主檔：固定的清單，不抽亂數，上面每一張表都不受影響
        "sap_employee": [
            {"user_id": user_id, "employee_no": number, "hire_date": hired, "product_lines": list(lines)}
            for user_id, number, hired, lines in catalog.SAP_EMPLOYEES
        ],
        # 方法卡放最後、用自己的亂數（seed + 101）：上面每一張表的產出都跟沒有方法卡時一模一樣
        **build_method_cards(customers, seed),
    }
    # 優惠與合約的申請單加在最後、用自己的亂數（seed + 102）：上面每一張表都跟加這一段之前一模一樣，
    # 也不新增任何報價草稿
    data["oa_expense_form"] += build_approval_history(
        random.Random(seed + 102), customers, baskets, products, as_of, transactions, receivables, data["visit"],
    )
    return data
