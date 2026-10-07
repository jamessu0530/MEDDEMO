# 跟上次訂的一樣 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 業務講一句「跟上次一樣」就照上次的單開這個月的 SAP 報價草稿，報價頁可以一鍵照上次填；客戶檔案先講清楚上次訂的哪幾項這期促銷變了；報價按「客戶下單了」就寫進交易紀錄與應收帳款。

**Architecture:** 新的 `services/last_order.py` 把上一次進貨（`sales_transaction`）與上一張報價（`sap_quotation_draft`）合成「上次訂的」，上次走口的列跟這一期比，算出變了什麼與這次抄成什麼；客戶檔案、報價頁、錄音展開都讀它。錄音的 AI 只多輸出 `repeat_last`（有沒有講跟上次一樣、哪些不要、加減多少），`services/repeat_order.py` 照上次訂的展開成下單意向，快照存在 `visit.repeat_last`。`services/orders.py` 把報價寫成交易與帳款，報價狀態多一個 `ordered`。

**Tech Stack:** FastAPI、SQLAlchemy 2、Postgres（語意層 View）、pytest；React 19、TypeScript、Vitest。

**Spec:** `docs/superpowers/specs/2026-10-07-repeat-last-order-design.md`

## Global Constraints

- 系統日 `app_today()` 在測試與假資料都是 2026-10-28；進行中的促銷是 202610 那一期，上個月是 202609。
- 「上次訂的」舊的那張只在跟新的相差 **31 天以內**才拿來補（`SUPPLEMENT_DAYS = 31`）；上一張報價**只算 `ordered`**（已成交）。還沒成交的草稿不算：忠孝店假資料 10/19 有一張一直沒成交的魚油草稿，算進來就蓋掉 9/30 那張的口。
- 待處理事項（`OPEN_QUOTE_STATUSES`）與今日路線的商機照舊只看 `draft`／`pending_approval`，不改。
- 「進門前三分鐘」那句：`上次訂的有 N 項這期促銷變了：A、B、C`，超過 3 個短句只列前 3 個再加「等」；排在進貨間隔那句後面。
- 那幾句話的寫法（後端產生、前端照抄）：
  - `terms`：「從買 10 送 2 變成買 15 送 2，一口 $800 → $1,200」／「一口從 $p 變 $p′」／「搭贈改成「…」」；短句「X要買的量變多／變少」或「X條件變了」。
  - `pack_gone`：「中口這期沒了，只剩小口（買 22 送 1，$3,080）」；短句「40EXa眼藥水(中口)沒了」。
  - `promo_gone`：「這期沒有促銷了」；短句「威鎮凝膠沒有促銷了」。
  - 送 0 個的口寫「直走 N」（跟前端 `packDeal` 一樣）。金額寫 `$1,200`（千分位、不帶小數）。
- 成交：單號 `SO{日期:%Y%m%d}-{客戶}-{報價單號}`；促銷列的交易數量是付錢的加送的；付款條件連鎖 60 天、獨立藥局與診所 30 天；費率用 `approvals.contract_terms`（近 90 天加總相除）。
- 一張報價最多 **30** 列（`MAX_QUOTE_LINES` 從 20 改成 30）：忠孝店上次進貨就有 18 項，加上上個月的 4 個口是 22 列，照上次填會超過 20。
- `models.py` 改了，部署時重建資料庫並重灌假資料（`schema_version` 指紋），不寫 migration。
- 程式註解與錯誤訊息用繁體中文，跟附近程式一樣的密度與口吻。畫面不用 emoji（警示用 lucide 的 `TriangleAlert`）。前端程式約 120 欄寬，**不要**跑 `prettier --write`。
- 後端測試指令（隔離的資料庫與 Redis，不動其他工作階段）：
  `TEST_DB_NAME=meddemo_test_repeat TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest <檔案> -q`
- 前端：worktree 第一次跑之前先 `npm --prefix frontend ci`。測試 `npm --prefix frontend test -- <檔案>`；型別 `npm --prefix frontend run typecheck`；lint `npm --prefix frontend run lint`。

## 檔案

| 檔案 | 做什麼 |
|---|---|
| `backend/app/services/last_order.py`（新） | 上次訂的：取兩張單、合併、跟這一期比、這次抄成什麼 |
| `backend/app/services/repeat_order.py`（新） | 錄音講跟上次一樣：照上次訂的展開下單意向、做快照 |
| `backend/app/services/orders.py`（新） | 報價成交：寫交易、帳款，報價改成已成交 |
| `backend/app/services/promo_packs.py` | 加 `period_packs`：照期別查每一口 |
| `backend/app/services/customer_profile.py` | 「進門前三分鐘」多一句 |
| `backend/app/services/extraction.py` | AI 輸出多 `repeat_last`、提示多兩條 |
| `backend/app/services/visit_processing.py` | 整理欄位後展開、存快照 |
| `backend/app/api/customers.py` | `GET /last-order`、`POST /quotes/{no}/order`、`MAX_QUOTE_LINES` |
| `backend/app/api/visits.py` | `VisitDetail.repeat_last` |
| `backend/app/models.py` | `QUOTE_STATUSES` 加 `ordered`、`Visit.repeat_last` |
| `data/seed/catalog.py`、`data/seed/generate.py` | 最後一期的促銷變化、上個月已成交的報價 |
| `frontend/src/api/customers.ts`、`frontend/src/api/visits.ts` | 型別與 API |
| `frontend/src/lib/last-order.ts`（新）、`frontend/src/lib/repeat.ts`（新）、`frontend/src/lib/quote.ts` | 純函式（有測試） |
| `frontend/src/components/change-note.tsx`（新） | 促銷變了的那一句 |
| `frontend/src/components/last-order-section.tsx`（新） | 客戶檔案「上次訂的」 |
| `frontend/src/components/visit/intent-lines.tsx`（新） | 確認頁照上次展開的意向 |
| `frontend/src/pages/customer.tsx`、`frontend/src/pages/quote.tsx`、`frontend/src/components/visit/confirm-view.tsx` | 畫面 |

---

### Task 1: 資料表與假資料

**Files:**
- Modify: `backend/app/models.py`（`QUOTE_STATUSES`、`Visit`）
- Modify: `data/seed/catalog.py`（`PROMOTION_ITEMS` 後面）
- Modify: `data/seed/generate.py`（`build_promotions`、`build_visits`、新的 `build_ordered_quotes`、`generate`）
- Test: `backend/tests/test_seed.py`、`backend/tests/test_api.py`、`backend/tests/test_quotes.py`（清理的 fixture）

**Interfaces:**
- Produces: `QUOTE_STATUSES = ("draft", "pending_approval", "rejected", "ordered")`；`Visit.repeat_last: dict[str, Any] | None`（JSONB）。
- Produces（假資料）：202610 那一期少了 40EXa 中口（`PP-028011`）、大口（`PP-028012`）與威鎮凝膠（`PP-027995`），金舒胃平小口（`PP-028007`）改成 <15+1>+1、買 15 送 2、$1,200；202609 的編號是 202608 的加 37（例如 40EXa 中口 `PP-027974`）。兩張 `ordered` 報價 `Q20260930-0001`（C001）、`Q20260930-0002`（C009），建立時間 2026-09-30 15:00（台灣）。

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_seed.py`：`test_promotions_run_monthly_up_to_the_as_of_month` 最後的 dict 改成 `"202610保藥特搭活動": 34`。在它後面加：

```python
def test_the_last_period_changes_three_promotions(db):
    # 202610（決賽日那一期）：40EXa 只剩小口、金舒胃平小口要買的量變多、威鎮凝膠這期沒有；前幾期照舊
    def packs(period, sku):
        return [tuple(r) for r in rows(db, """
            SELECT item_name, buy_qty, free_qty, deal_price::float FROM v_promotion_item
            WHERE promotion_name = :p AND sku = :s ORDER BY item_code
        """, p=f"{period}保藥特搭活動", s=sku)]

    assert [p[0] for p in packs("202609", "F763630")] == ["40EXa眼藥水(小口)", "40EXa眼藥水(中口)", "40EXa眼藥水(大口)"]
    assert [p[0] for p in packs("202610", "F763630")] == ["40EXa眼藥水(小口)"]
    assert packs("202609", "C130082")[0] == ("金舒胃平(小口)", 10, 2, 800.0)
    assert packs("202610", "C130082")[0] == ("金舒胃平(小口)", 15, 2, 1200.0)
    assert packs("202609", "D120013") == [("威鎮凝膠", 11, 2, 990.0)]
    assert packs("202610", "D120013") == []


def test_last_months_quotes_are_ordered(db):
    # 上個月已成交的兩張報價：忠孝店三種變化都有，士林店的口都沒變。口是 202609 那一期的；不補交易
    found = [tuple(r) for r in rows(db, """
        SELECT q.quote_no, q.customer_id, (q.created_at AT TIME ZONE 'Asia/Taipei')::date::text,
               string_agg(coalesce(i.name || ' × ' || q.packs || ' 口', q.sku || ' × ' || q.qty), '、' ORDER BY q.line_no)
        FROM sap_quotation_draft q LEFT JOIN promotion_item i ON i.code = q.promo_code
        WHERE q.status = 'ordered' GROUP BY 1, 2, 3 ORDER BY 1
    """)]
    assert found == [
        ("Q20260930-0001", "C001", "2026-09-30",
         "40EXa眼藥水(中口) × 1 口、金舒胃平(小口) × 3 口、威鎮凝膠 × 2 口、Premium眼藥水(小口) × 1 口、HS-FO30 × 40"),
        ("Q20260930-0002", "C009", "2026-09-30", "Premium眼藥水(小口) × 2 口、骨營膠囊600T(小口) × 1 口"),
    ]
    periods = rows(db, """
        SELECT DISTINCT i.promotion_id FROM sap_quotation_draft q JOIN promotion_item i ON i.code = q.promo_code
        WHERE q.status = 'ordered'
    """)
    assert [p[0] for p in periods] == ["PR-202609"]
    # 金額照報價的算法：口照每口售價 × 口數；魚油 30 入連鎖供貨價 405 × 40
    total = rows(db, "SELECT sum(amount)::float FROM sap_quotation_draft WHERE quote_no = 'Q20260930-0001'")[0][0]
    assert total == 7980 + 800 * 3 + 990 * 2 + 5500 + 405 * 40
```

同一檔：
- `test_every_synced_visit_landed_in_all_three_targets` 的
  `SELECT count(*) FROM sap_quotation_draft` 改成 `SELECT count(*) FROM sap_quotation_draft WHERE visit_id IS NOT NULL`；
  下一行改成
  `"SELECT count(*) FROM sap_quotation_draft WHERE visit_id IS NOT NULL AND (amount <> unit_price * qty OR promo_code IS NOT NULL)"`。
- `test_approval_history_leaves_the_trip_forms_and_quotes_alone` 的 `SELECT count(*) FROM sap_quotation_draft` 改成
  `SELECT count(*) FROM sap_quotation_draft WHERE visit_id IS NOT NULL`（還是 295）。

`backend/tests/test_api.py` 的 `test_promotions_list_every_period_newest_first`：`len(current["items"]) == 37` 改成 `== 34`。

`backend/tests/test_quotes.py` 的 `client` fixture 清理只刪今天開的報價，不刪假資料上個月那兩張：

```python
@pytest.fixture
def client(engine, sign_in):
    yield sign_in(TestClient(app), "U01")
    with engine.begin() as conn:
        # 只刪這次開的（單號是系統日）；上個月已成交的兩張是假資料
        conn.execute(text("DELETE FROM sap_quotation_draft WHERE quote_no LIKE 'Q' || to_char(app_today(), 'YYYYMMDD') || '-%'"))
    redis().flushdb()
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `TEST_DB_NAME=meddemo_test_repeat TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests/test_seed.py -q -k "last_period or ordered or monthly"`
Expected: FAIL（202610 還是 37 口、沒有 `ordered` 的報價）

- [ ] **Step 3: 改資料表**

`backend/app/models.py`：

```python
# draft：可以送給客戶；pending_approval：折扣超過業務的權限，等簽核；rejected：簽核被駁回或退回；
# ordered：客戶下單了，已寫進交易紀錄與應收帳款（services/orders.py）
QUOTE_STATUSES = ("draft", "pending_approval", "rejected", "ordered")
```

`Visit` 的 `error_message` 後面加：

```python
    # 講了「跟上次一樣」或跟上次比的加減時，展開那一刻的快照（services/repeat_order.py）。這次拜訪確認後
    # 也會開一張報價，「上次」就變成這一張，所以不能每次重算
    repeat_last: Mapped[dict[str, Any] | None]
```

（`Mapped[dict[str, Any] | None]` 在這個檔案已經對到 JSONB，跟 `fields_raw` 一樣。）

- [ ] **Step 4: 假資料的促銷變化與上個月的報價**

`data/seed/catalog.py`，在 `PROMOTION_ITEMS` 那份清單後面加：

```python
# 最後一期（as_of 那個月）的變化，讓「上次訂的」比得出促銷變了（docs/superpowers/specs/2026-10-07-repeat-last-order-design.md）。
# 鍵是 202608 那一期的編號；None 是這一期沒有這一口，tuple 是換成的（搭贈說明, 每口買, 每口送, 每口售價）。
# 挑測試沒用到的品項：Premium 與骨營的數字報價、促銷頁與問答的測試都在用
LAST_PERIOD_CHANGES = {
    "PP-027937": None,  # 40EXa眼藥水(中口)：只剩小口
    "PP-027938": None,  # 40EXa眼藥水(大口)
    "PP-027933": ("販促搭贈<15+1>+1", 15, 2, 1200),  # 金舒胃平(小口)：要買的量變多，每個一樣 80 元
    "PP-027921": None,  # 威鎮凝膠：這期沒有促銷
}

# 上個月已成交的報價：as_of 往前幾天，口用那天進行中那一期的。("pack", 促銷品項名稱, 口數) 或 ("sku", 料號, 數量)
ORDERED_QUOTE_DAYS = 28
ORDERED_QUOTES = [
    # 忠孝店：口沒了、條件變了、促銷沒了各一個，加一個沒變的口與一個兩邊都有的品項（魚油）
    ("C001", [
        ("pack", "40EXa眼藥水(中口)", 1), ("pack", "金舒胃平(小口)", 3), ("pack", "威鎮凝膠", 2),
        ("pack", "Premium眼藥水(小口)", 1), ("sku", "HS-FO30", 40),
    ]),
    # 士林店：口都沒變，「上次訂的」沒有警示
    ("C009", [("pack", "Premium眼藥水(小口)", 2), ("pack", "骨營膠囊600T(小口)", 1)]),
]
```

`data/seed/generate.py` 的 `build_promotions`：docstring 最後加一句「最後一期（as_of 那個月）套 catalog.LAST_PERIOD_CHANGES。」，迴圈裡改成：

```python
    while start <= as_of:
        end = (start + timedelta(days=31)).replace(day=1) - timedelta(days=1)
        month = f"{start:%Y%m}"
        promotion_id = f"PR-{month}"
        last = end >= as_of
        active = [(until, text, tag) for until, text, tag in catalog.PROMOTION_NOTES if until is None or month <= until]
        ended = [tag for until, _, tag in catalog.PROMOTION_NOTES if tag and until and month > until]
        promotions.append({
            "id": promotion_id, "name": f"{month}{catalog.PROMOTION_NAME}",
            "department": catalog.PROMOTION_DEPARTMENT, "type": catalog.PROMOTION_TYPE,
            "start_date": start, "end_date": end, "pm_note": "\n".join(text for _, text, _ in active),
        })
        for group, code, name, sku, deal, buy, free, price in catalog.PROMOTION_ITEMS:
            if last and code in catalog.LAST_PERIOD_CHANGES:
                change = catalog.LAST_PERIOD_CHANGES[code]
                if change is None:
                    continue  # 這一期沒有這一口；其他口的編號照舊
                deal, buy, free, price = change
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
```

`build_visits` 的報價草稿每一列補上新欄位（同一張表的每一列要有同一組鍵，才能跟上個月的報價整批寫入）：

```python
            tables["sap_quotation_draft"].append({
                "quote_no": visit_id, "visit_id": visit_id, "line_no": line_no, "customer_id": c["id"], "sku": item["sku"],
                "created_by": c["owner_user_id"],
                "qty": item["qty"], "unit_price": price, "amount": price * item["qty"],
                "free_qty": 0, "promo_code": None, "packs": None, "discount_pct": 0, "status": "draft",
                "created_at": confirmed_at,
            })
```

`build_approval_history` 前面（`build_notes` 後面）加：

```python
def build_ordered_quotes(as_of, customers, products, promotion_items):
    """上個月已成交的報價（catalog.ORDERED_QUOTES）：「上次訂的」才有口可以跟這一期比。

    口用那天進行中那一期的編號，金額照報價頁的算法（沒促銷照供貨價、不打折；口照每口售價 × 口數）。
    不補交易：問答的標準答案、常進品項、忠孝店「進貨間隔拉長」的情境都讀交易。
    """
    day = as_of - timedelta(days=catalog.ORDERED_QUOTE_DAYS)
    packs = {i["name"]: i for i in promotion_items if i["promotion_id"] == f"PR-{day:%Y%m}"}
    by_id = {c["id"]: c for c in customers}
    created_at = datetime.combine(day, time(15, 0), TAIPEI)
    rows = []
    for n, (customer_id, lines) in enumerate(catalog.ORDERED_QUOTES, start=1):
        c = by_id[customer_id]
        for line_no, (kind, key, count) in enumerate(lines, start=1):
            row = {
                "quote_no": f"Q{day:%Y%m%d}-{n:04d}", "visit_id": None, "line_no": line_no, "customer_id": customer_id,
                "created_by": c["owner_user_id"], "status": "ordered", "created_at": created_at, "discount_pct": 0,
            }
            if kind == "pack":
                p = packs[key]
                row |= {
                    "sku": p["sku"], "qty": p["buy_qty"] * count, "free_qty": p["free_qty"] * count,
                    "unit_price": round(p["deal_price"] / p["buy_qty"], 2), "amount": p["deal_price"] * count,
                    "promo_code": p["code"], "packs": count,
                }
            else:
                price = round(products[key]["unit_price"] * PRICE_FACTOR[c["type"]])
                row |= {
                    "sku": key, "qty": count, "free_qty": 0, "unit_price": price, "amount": price * count,
                    "promo_code": None, "packs": None,
                }
            rows.append(row)
    return rows
```

`generate` 最後 `return data` 前面加：

```python
    # 上個月已成交的報價加在最後、不抽亂數：上面每一張表都跟加這一段之前一模一樣
    data["sap_quotation_draft"] += build_ordered_quotes(as_of, customers, products, promotion_items)
```

- [ ] **Step 5: 跑測試，確認通過**

Run: `TEST_DB_NAME=meddemo_test_repeat TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests/test_seed.py backend/tests/test_api.py backend/tests/test_quotes.py backend/tests/test_negotiation.py backend/tests/test_today_route.py backend/tests/test_promo_packs.py -q`
Expected: PASS。談判卡的促銷測試是照資料庫算期望值的，40EXa、威鎮換了也一樣通過；有不通過的照錯誤訊息找是不是寫死了 37 口或 40EXa 的中口、大口，改成這一期的數字。

- [ ] **Step 6: Commit**

```bash
git add backend/app/models.py data/seed/catalog.py data/seed/generate.py backend/tests/test_seed.py backend/tests/test_api.py backend/tests/test_quotes.py
git commit -m "Change three promotions in the last period and seed last month's ordered quotes"
```

---

### Task 2: 「上次訂的」的合併與比對（純函式）

**Files:**
- Create: `backend/app/services/last_order.py`
- Test: `backend/tests/test_last_order.py`

**Interfaces:**
- Consumes: `promo_packs.Pack`（`code, promotion_name, group_name, name, sku, deal, buy_qty, free_qty, deal_price`）。
- Produces：
  - `SUPPLEMENT_DAYS = 31`、`QUOTE_STATUSES = ("ordered",)`
  - `SourceLine(sku: str, qty: int, pack: Pack | None = None)`：走口時 `qty` 是口數
  - `Source(kind: str, no: str, date: dt.date, lines: tuple[SourceLine, ...])`：`kind` 是 `"order"`／`"quote"`
  - `Change(kind: str, text: str, short: str)`
  - `Repeat(sku: str, qty: int, pack: Pack | None = None)`：`pack` 是這一期的那一口，`None` 是不走促銷；`.promo_code` 屬性
  - `merge(order: Source | None, quote: Source | None) -> tuple[list[tuple[Source, SourceLine]], list[Source]]`
  - `same_pack(pack: Pack, previous: Sequence[Pack], current: Sequence[Pack]) -> Pack | None`
  - `compare(pack: Pack, packs: int, previous: Sequence[Pack], current: Sequence[Pack], product_name: str) -> tuple[Repeat, Change | None]`

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_last_order.py`：

```python
"""上次訂的（services/last_order.py）：兩張單怎麼合、上次走口的列跟這一期怎麼比。API 的測試在後面。"""

import datetime as dt
from decimal import Decimal

from app.services import last_order
from app.services.last_order import Change, Repeat, Source, SourceLine
from app.services.promo_packs import Pack


def pack(code, name, sku, buy, free, price, period="202609", deal=None):
    return Pack(
        code=code, promotion_name=f"{period}保藥特搭活動", group_name="測試", name=name, sku=sku,
        deal=deal or f"<{buy}+{free}>", buy_qty=buy, free_qty=free, deal_price=Decimal(price),
    )


def order(day, *lines):
    return Source("order", f"SO{day}", dt.date(2026, 10, day) if day > 0 else dt.date(2026, 9, 30 + day), tuple(lines))


def quote(day, *lines):
    return Source("quote", f"Q{day}", dt.date(2026, 10, day) if day > 0 else dt.date(2026, 9, 30 + day), tuple(lines))


SMALL = pack("P1", "Premium眼藥水(小口)", "F749579", 22, 1, 5500)
FISH = SourceLine("HS-FO30", 32)


def skus(rows):
    return [(source.kind, line.sku, line.qty) for source, line in rows]


def test_the_newer_one_leads_and_the_older_fills_in_what_it_lacks():
    newer = order(5, FISH, SourceLine("HS-CA60", 10))
    older = quote(0, SourceLine("HS-FO30", 40), SourceLine("F749579", 1, SMALL))
    rows, used = last_order.merge(newer, older)
    # 魚油兩邊都有，照比較新的進貨；報價補上進貨沒有的口
    assert skus(rows) == [("order", "HS-FO30", 32), ("order", "HS-CA60", 10), ("quote", "F749579", 1)]
    assert used == [newer, older]


def test_on_the_same_day_the_quote_leads():
    rows, used = last_order.merge(order(5, FISH), quote(5, SourceLine("HS-FO30", 40)))
    assert skus(rows) == [("quote", "HS-FO30", 40)] and [s.kind for s in used] == ["quote"]


def test_a_source_older_than_a_month_is_left_out():
    newer = order(5, FISH)
    rows, used = last_order.merge(newer, quote(-27, SourceLine("F749579", 1, SMALL)))  # 9/3，差 32 天
    assert skus(rows) == [("order", "HS-FO30", 32)] and used == [newer]


def test_packs_from_the_quote_replace_the_same_item_in_a_newer_order():
    # 報價成交之後才有交易：同一個品項交易記的是到貨數量，口要照報價
    newer = order(5, FISH, SourceLine("F749579", 23))
    older = quote(1, SourceLine("F749579", 1, SMALL), SourceLine("F749579", 10))
    rows, _ = last_order.merge(newer, older)
    assert skus(rows) == [("order", "HS-FO30", 32), ("quote", "F749579", 1), ("quote", "F749579", 10)]


def test_nothing_ordered_yet():
    assert last_order.merge(None, None) == ([], [])


MID_OLD = pack("P2", "40EXa眼藥水(中口)", "F763630", 57, 4, 7980)
SMALL_40 = pack("N1", "40EXa眼藥水(小口)", "F763630", 22, 1, 3080, period="202610")
JIN_OLD = pack("P3", "金舒胃平(小口)", "C130082", 10, 2, 800, deal="販促搭贈<10+1>+1")
WEI_OLD = pack("P4", "威鎮凝膠", "D120013", 11, 2, 990)


def test_an_unchanged_pack_is_copied_as_this_periods_pack():
    now = pack("N9", "Premium眼藥水(小口)", "F749579", 22, 1, 5500, period="202610")
    assert last_order.compare(SMALL, 2, [SMALL], [now], "Premium眼藥水") == (Repeat("F749579", 2, now), None)


def test_changed_terms_keep_the_pack_count():
    now = pack("N3", "金舒胃平(小口)", "C130082", 15, 2, 1200, period="202610", deal="販促搭贈<15+1>+1")
    repeat, change = last_order.compare(JIN_OLD, 3, [JIN_OLD], [now], "金舒胃平")
    assert repeat == Repeat("C130082", 3, now)
    assert change == Change("terms", "從買 10 送 2 變成買 15 送 2，一口 $800 → $1,200", "金舒胃平(小口)要買的量變多")


def test_other_kinds_of_term_changes():
    cheaper = pack("N3", "金舒胃平(小口)", "C130082", 10, 2, 700, period="202610", deal=JIN_OLD.deal)
    assert last_order.compare(JIN_OLD, 1, [JIN_OLD], [cheaper], "金舒胃平")[1] == Change(
        "terms", "一口從 $800 變 $700", "金舒胃平(小口)條件變了"
    )
    gift = pack("N3", "金舒胃平(小口)", "C130082", 10, 2, 800, period="202610", deal="販促搭贈<10+1>+1+贈試用包")
    assert last_order.compare(JIN_OLD, 1, [JIN_OLD], [gift], "金舒胃平")[1].text == "搭贈改成「販促搭贈<10+1>+1+贈試用包」"
    fewer = pack("N3", "金舒胃平(小口)", "C130082", 8, 1, 640, period="202610")
    assert last_order.compare(JIN_OLD, 1, [JIN_OLD], [fewer], "金舒胃平")[1].short == "金舒胃平(小口)要買的量變少"


def test_a_pack_that_is_gone_becomes_plain_at_the_paid_quantity():
    repeat, change = last_order.compare(MID_OLD, 1, [MID_OLD], [SMALL_40], "40EXa眼藥水")
    assert repeat == Repeat("F763630", 57)
    assert change == Change("pack_gone", "中口這期沒了，只剩小口（買 22 送 1，$3,080）", "40EXa眼藥水(中口)沒了")


def test_a_promotion_that_is_gone_becomes_plain_too():
    repeat, change = last_order.compare(WEI_OLD, 2, [WEI_OLD], [SMALL_40], "威鎮凝膠")
    assert repeat == Repeat("D120013", 22)
    assert change == Change("promo_gone", "這期沒有促銷了", "威鎮凝膠沒有促銷了")


def test_packs_with_the_same_name_match_by_rank():
    # 中化那種同名有好幾檔：照每口買的數量由小到大，取同一個順位
    old = [pack(f"O{n}", "固循魚油", "F764521", buy, free, price) for n, (buy, free, price) in
           enumerate([(5, 0, 4650), (9, 1, 8910), (17, 3, 16830)])]
    now = [pack(f"N{n}", "固循魚油", "F764521", buy, free, price, period="202610") for n, (buy, free, price) in
           enumerate([(5, 0, 4650), (9, 1, 8500), (17, 3, 16830)])]
    assert last_order.same_pack(old[1], old, now) == now[1]
    # 最大那一檔這期沒了：剩下的照這一期的順序列出來；送 0 個的口寫「直走」
    assert last_order.compare(old[2], 1, old, now[:2], "固循魚油")[1].text == (
        "固循魚油這期沒了，只剩固循魚油（直走 5，$4,650）、固循魚油（買 9 送 1，$8,500）"
    )
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `TEST_DB_NAME=meddemo_test_repeat TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests/test_last_order.py -q`
Expected: FAIL（`ImportError: cannot import name 'last_order'`）

- [ ] **Step 3: 寫 `last_order.py` 的純函式**

`backend/app/services/last_order.py`：

```python
"""上次訂的（docs/superpowers/specs/2026-10-07-repeat-last-order-design.md）：上一次進貨與上一張報價合起來，
上次走口的列跟這一期比。客戶檔案、報價頁的「照上次填」、錄音的「跟上次一樣」都讀這裡，數字只有一份。

內容只來自資料庫，不讓 AI 生成：變了什麼那幾句是照數字套規則寫的。
"""

import datetime as dt
import re
from collections.abc import Sequence
from dataclasses import dataclass

from app.services.promo_packs import Pack

# 舊的那張只在跟新的相差這麼多天以內才拿來補：促銷一個月一期，太舊的單不湊
SUPPLEMENT_DAYS = 31
# 上一張報價只算已成交的：還沒成交的草稿客戶還沒訂，今日路線也把它當「報價草稿還沒成交」的商機
QUOTE_STATUSES = ("ordered",)
# 促銷品項名稱把口寫在最後的括號裡，例如 40EXa眼藥水(中口)
SIZE = re.compile(r"\(([^()]*口)\)$")


@dataclass(frozen=True)
class SourceLine:
    """上次那張單的一列：沒走口是品項 × 數量；走口是某一口 × 口數（qty 是口數）。"""

    sku: str
    qty: int
    pack: Pack | None = None


@dataclass(frozen=True)
class Source:
    kind: str  # order＝進貨，quote＝報價
    no: str
    date: dt.date
    lines: tuple[SourceLine, ...]


@dataclass(frozen=True)
class Change:
    kind: str  # terms＝同一口條件變了，pack_gone＝這一口沒了，promo_gone＝這期沒有促銷
    text: str  # 寫在那一列下面
    short: str  # 「進門前三分鐘」那句用的


@dataclass(frozen=True)
class Repeat:
    """這次照抄成什麼：品項 × 數量，或這一期的某一口 × 口數。"""

    sku: str
    qty: int
    # 這一期的那一口；None 是不走促銷
    pack: Pack | None = None

    @property
    def promo_code(self) -> str | None:
        return self.pack.code if self.pack else None


def merge(order: Source | None, quote: Source | None) -> tuple[list[tuple[Source, SourceLine]], list[Source]]:
    """兩張單合成上次訂的，回傳（每一列與它來自哪張, 有用到的單）。

    新的為主、整張照抄；同一天報價為主（報價有記口）。舊的那張只在相差 SUPPLEMENT_DAYS 天以內才補新的沒有的品項。
    新的是進貨、舊的是報價時，報價裡走口的品項換成報價的列：真實流程報價成交後才有交易，不這樣口會被交易蓋掉。
    """
    sources = sorted((s for s in (order, quote) if s), key=lambda s: (s.date, s.kind == "quote"), reverse=True)
    if not sources:
        return [], []
    main = sources[0]
    rows = [(main, line) for line in main.lines]
    used = [main]
    if len(sources) == 2 and (main.date - sources[1].date).days <= SUPPLEMENT_DAYS:
        other = sources[1]
        if main.kind == "order":
            packed = {line.sku for line in other.lines if line.pack}
            rows = [(source, line) for source, line in rows if line.sku not in packed]
        have = {line.sku for _, line in rows}
        extra = [(other, line) for line in other.lines if line.sku not in have]
        if extra:
            rows += extra
            used.append(other)
    return rows, used


def _label(pack: Pack) -> str:
    """口的叫法：名稱括號裡的小口、中口、大口；名稱沒有括號的用整個名稱。"""
    found = SIZE.search(pack.name)
    return found.group(1) if found else pack.name


def _deal(pack: Pack) -> str:
    # 跟前端 lib/quote.ts 的 packDeal 一樣：送 0 個的是直走
    return f"買 {pack.buy_qty} 送 {pack.free_qty}" if pack.free_qty else f"直走 {pack.buy_qty}"


def _money(amount) -> str:
    return f"${amount:,.0f}"


def _siblings(pack: Pack, packs: Sequence[Pack]) -> list[Pack]:
    return sorted((p for p in packs if p.sku == pack.sku and p.name == pack.name), key=lambda p: (p.buy_qty, p.code))


def same_pack(pack: Pack, previous: Sequence[Pack], current: Sequence[Pack]) -> Pack | None:
    """這一期的同一口：同一個品項、同名；同名有好幾檔的，照每口買的數量由小到大取同一個順位。

    previous 是上次那一口所在那一期的每一口。
    """
    rank = [p.code for p in _siblings(pack, previous)].index(pack.code)
    now = _siblings(pack, current)
    return now[rank] if rank < len(now) else None


def _terms(old: Pack, new: Pack) -> Change | None:
    if (old.buy_qty, old.free_qty) != (new.buy_qty, new.free_qty):
        text = f"從{_deal(old)} 變成{_deal(new)}"
        if old.deal_price != new.deal_price:
            text += f"，一口 {_money(old.deal_price)} → {_money(new.deal_price)}"
    elif old.deal_price != new.deal_price:
        text = f"一口從 {_money(old.deal_price)} 變 {_money(new.deal_price)}"
    elif old.deal != new.deal:
        text = f"搭贈改成「{new.deal}」"
    else:
        return None
    if new.buy_qty > old.buy_qty:
        short = f"{old.name}要買的量變多"
    elif new.buy_qty < old.buy_qty:
        short = f"{old.name}要買的量變少"
    else:
        short = f"{old.name}條件變了"
    return Change("terms", text, short)


def compare(
    pack: Pack, packs: int, previous: Sequence[Pack], current: Sequence[Pack], product_name: str
) -> tuple[Repeat, Change | None]:
    """上次走的那一口跟這一期比：回傳（這次抄成什麼, 變了什麼）。

    同一口還在就抄這一期那一口、口數不變（條件變了照新條件）；口沒了或促銷沒了改成不走促銷，
    數量是上次付錢的數量（每口買的 × 口數）。
    """
    now = same_pack(pack, previous, current)
    if now:
        return Repeat(pack.sku, packs, now), _terms(pack, now)
    plain = Repeat(pack.sku, pack.buy_qty * packs)
    others = [p for p in current if p.sku == pack.sku]
    if others:
        left = "、".join(f"{_label(p)}（{_deal(p)}，{_money(p.deal_price)}）" for p in others)
        return plain, Change("pack_gone", f"{_label(pack)}這期沒了，只剩{left}", f"{pack.name}沒了")
    return plain, Change("promo_gone", "這期沒有促銷了", f"{product_name}沒有促銷了")
```

- [ ] **Step 4: 跑測試，確認通過**

Run: `TEST_DB_NAME=meddemo_test_repeat TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests/test_last_order.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/last_order.py backend/tests/test_last_order.py
git commit -m "Merge the last order with the last quote and compare its packs with this period"
```

---

### Task 3: 從資料庫算「上次訂的」與 `GET /last-order`

**Files:**
- Modify: `backend/app/services/promo_packs.py`（加 `period_packs`）
- Modify: `backend/app/services/last_order.py`（加 `Line`、`LastOrder`、`build`）
- Modify: `backend/app/api/customers.py`（回傳的模型與路由）
- Test: `backend/tests/test_last_order.py`

**Interfaces:**
- Consumes: Task 2 的 `merge`、`compare`、`Source`、`SourceLine`、`Repeat`、`Change`、`QUOTE_STATUSES`。
- Produces：
  - `promo_packs.period_packs(session, names: Iterable[str]) -> dict[str, list[Pack]]`（鍵是促銷名稱）
  - `last_order.Line(sku, name, spec, unit, supply_price: int, qty: int, pack: Pack | None, source: str, change: Change | None, repeat: Repeat)`
  - `last_order.LastOrder(order: Source | None, quote: Source | None, lines: tuple[Line, ...])`，`.changed: int`
  - `last_order.build(session: Session, customer: Customer) -> LastOrder | None`
  - `GET /api/customers/{id}/last-order` → `LastOrderOut | null`：
    `{order: {order_no, date} | null, quote: {quote_no, date} | null, lines: [{sku, name, spec, unit, supply_price, qty, pack: {code, name, deal, buy_qty, free_qty, deal_price} | null, source, change: {kind, text, short} | null, repeat: {sku, qty} | {promo_code, packs}}], changed}`

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_last_order.py` 最上面的 import 加：

```python
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, text
from sqlalchemy.orm import Session

from app.main import app
from app.models import SalesTransaction, SapQuotationDraft
from app.services import promo_packs
from app.tasks import redis
```

檔案最後加：

```python
@pytest.fixture
def client(engine, sign_in):
    yield sign_in(TestClient(app), "U01")
    redis().flushdb()


def current_code(engine, name):
    with Session(engine) as session:
        return next(p.code for p in promo_packs.current_packs(session) if p.name == name)


def test_last_order_of_a_store_whose_packs_changed(client, engine):
    last = client.get("/api/customers/C001/last-order").json()
    # 10/5 進貨比 9/30 報價新、差 5 天：進貨整張照抄（18 項），報價補上 4 個口；魚油兩邊都有，照進貨
    assert last["order"] == {"order_no": "SO20261005-C001", "date": "2026-10-05"}
    assert last["quote"] == {"quote_no": "Q20260930-0001", "date": "2026-09-30"}
    assert len(last["lines"]) == 18 + 4 and last["changed"] == 3
    first = last["lines"][:3]
    assert [(line["pack"]["name"], line["change"]["kind"]) for line in first] == [
        ("40EXa眼藥水(中口)", "pack_gone"), ("金舒胃平(小口)", "terms"), ("威鎮凝膠", "promo_gone"),
    ]
    assert [line["change"]["text"] for line in first] == [
        "中口這期沒了，只剩小口（買 22 送 1，$3,080）",
        "從買 10 送 2 變成買 15 送 2，一口 $800 → $1,200",
        "這期沒有促銷了",
    ]
    assert [line["change"]["short"] for line in first] == ["40EXa眼藥水(中口)沒了", "金舒胃平(小口)要買的量變多", "威鎮凝膠沒有促銷了"]
    # 口沒了、促銷沒了：不走促銷，數量是上次付錢的數量；條件變了：這期那一口、口數不變
    assert [line["repeat"] for line in first] == [
        {"sku": "F763630", "qty": 57}, {"promo_code": current_code(engine, "金舒胃平(小口)"), "packs": 3}, {"sku": "D120013", "qty": 22},
    ]
    # 沒變的：進貨照金額由大到小，報價補的口在最後
    assert last["lines"][3]["sku"] == "HS-FO90" and last["lines"][3]["source"] == "order"
    premium = last["lines"][-1]
    assert (premium["pack"]["name"], premium["change"], premium["repeat"]) == (
        "Premium眼藥水(小口)", None, {"promo_code": current_code(engine, "Premium眼藥水(小口)"), "packs": 1},
    )
    with engine.connect() as conn:
        fish_qty = conn.execute(text("SELECT qty FROM sales_transaction WHERE order_no = 'SO20261005-C001' AND sku = 'HS-FO30'")).scalar_one()
    fish = next(line for line in last["lines"] if line["sku"] == "HS-FO30")
    assert (fish["source"], fish["qty"], fish["pack"], fish["unit"], fish["supply_price"]) == ("order", fish_qty, None, "盒", 405)


def test_unchanged_packs_carry_no_warning(client):
    last = client.get("/api/customers/C009/last-order").json()
    assert last["changed"] == 0 and len(last["lines"]) == 15 + 2
    assert [line["pack"]["name"] for line in last["lines"] if line["pack"]] == ["Premium眼藥水(小口)", "骨營膠囊600T(小口)"]


def test_someone_elses_customer_is_not_found(client, auth):
    assert client.get("/api/customers/C001/last-order", headers=auth("U03")).status_code == 404


def test_a_customer_who_never_ordered_has_no_last_order(tx, auth):
    tx.execute(delete(SalesTransaction).where(SalesTransaction.customer_id == "C001"))
    tx.execute(delete(SapQuotationDraft).where(SapQuotationDraft.customer_id == "C001"))
    found = TestClient(app).get("/api/customers/C001/last-order", headers=auth("U01"))
    assert found.status_code == 200 and found.json() is None
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `TEST_DB_NAME=meddemo_test_repeat TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests/test_last_order.py -q`
Expected: 新的四個 FAIL（404 Not Found：還沒有這條路由）

- [ ] **Step 3: `promo_packs.period_packs`**

`backend/app/services/promo_packs.py` 的 `packs_by_code` 後面加：

```python
def period_packs(session: Session, names: Iterable[str]) -> dict[str, list[Pack]]:
    """照促銷名稱查那幾期的每一口，鍵是促銷名稱。上次訂的要知道上次那一口在那一期排第幾。"""
    names = sorted(set(names))
    if not names:
        return {}
    query = text(f"SELECT {COLUMNS} FROM v_promotion_item WHERE promotion_name IN :names ORDER BY item_code").bindparams(
        bindparam("names", expanding=True)
    )
    found: dict[str, list[Pack]] = {name: [] for name in names}
    for row in session.execute(query, {"names": names}).mappings():
        found[row["promotion_name"]].append(Pack(**row))
    return found
```

- [ ] **Step 4: `last_order.build`**

`backend/app/services/last_order.py` 的 import 改成：

```python
import datetime as dt
import re
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import Date, cast, func, select
from sqlalchemy.orm import Session

from app.models import Customer, Product, SalesTransaction, SapQuotationDraft, Visit
from app.pricing import supply_price
from app.services import promo_packs
from app.services.promo_packs import Pack
from app.timeutil import local_date
```

`Repeat` 後面加兩個 dataclass：

```python
@dataclass(frozen=True)
class Line:
    sku: str
    name: str
    spec: str
    unit: str
    # 這家的供貨價：報價頁「照上次填」加列時用
    supply_price: int
    # 沒走口是數量；走口是口數
    qty: int
    # 上次走的那一口
    pack: Pack | None
    source: str  # order／quote
    change: Change | None
    repeat: Repeat


@dataclass(frozen=True)
class LastOrder:
    # 有用到的那次進貨與那張報價
    order: Source | None
    quote: Source | None
    lines: tuple[Line, ...]

    @property
    def changed(self) -> int:
        return sum(1 for line in self.lines if line.change)
```

檔案最後加：

```python
def _last_order(session: Session, customer_id: str) -> Source | None:
    """最新的一張訂單：同一個 order_no 的品項，日期取最早的那天；品項照金額由大到小。"""
    first_day = func.min(SalesTransaction.date)
    head = session.execute(
        select(SalesTransaction.order_no, first_day.label("date"))
        .where(SalesTransaction.customer_id == customer_id)
        .group_by(SalesTransaction.order_no)
        .order_by(first_day.desc(), SalesTransaction.order_no.desc())
        .limit(1)
    ).one_or_none()
    if head is None:
        return None
    rows = session.execute(
        select(SalesTransaction.sku, func.sum(SalesTransaction.qty).label("qty"))
        .where(SalesTransaction.customer_id == customer_id, SalesTransaction.order_no == head.order_no)
        .group_by(SalesTransaction.sku)
        .order_by(func.sum(SalesTransaction.amount).desc(), SalesTransaction.sku)
    ).all()
    return Source("order", head.order_no, head.date, tuple(SourceLine(row.sku, int(row.qty)) for row in rows))


def _last_quote(session: Session, customer_id: str) -> Source | None:
    """最新的一張已成交的報價：日期跟待處理事項一樣取拜訪時間、沒有拜訪取建立時間；同一天好幾張取最後建的。"""
    quoted_at = func.max(func.coalesce(Visit.visited_at, SapQuotationDraft.created_at))
    created_at = func.max(SapQuotationDraft.created_at)
    head = session.execute(
        select(SapQuotationDraft.quote_no, quoted_at.label("quoted_at"))
        .outerjoin(Visit, Visit.id == SapQuotationDraft.visit_id)
        .where(SapQuotationDraft.customer_id == customer_id, SapQuotationDraft.status.in_(QUOTE_STATUSES))
        .group_by(SapQuotationDraft.quote_no)
        .order_by(cast(func.timezone("Asia/Taipei", quoted_at), Date).desc(), created_at.desc())
        .limit(1)
    ).one_or_none()
    if head is None:
        return None
    rows = session.execute(
        select(SapQuotationDraft.sku, SapQuotationDraft.qty, SapQuotationDraft.promo_code, SapQuotationDraft.packs)
        .where(SapQuotationDraft.quote_no == head.quote_no)
        .order_by(SapQuotationDraft.line_no)
    ).all()
    packs = promo_packs.packs_by_code(session, (row.promo_code for row in rows if row.promo_code))
    lines = tuple(
        SourceLine(row.sku, row.packs, packs[row.promo_code]) if row.promo_code else SourceLine(row.sku, row.qty)
        for row in rows
    )
    return Source("quote", head.quote_no, local_date(head.quoted_at), lines)


def build(session: Session, customer: Customer) -> LastOrder | None:
    """這家上次訂的；還沒訂過是 None。變了的列在前，其餘照來源的順序。"""
    rows, used = merge(_last_order(session, customer.id), _last_quote(session, customer.id))
    if not rows:
        return None
    current = promo_packs.current_packs(session)
    previous = promo_packs.period_packs(session, (line.pack.promotion_name for _, line in rows if line.pack))
    products = {p.sku: p for p in session.scalars(select(Product).where(Product.sku.in_({line.sku for _, line in rows})))}
    lines = []
    for source, line in rows:
        product = products[line.sku]
        if line.pack:
            repeat, change = compare(line.pack, line.qty, previous[line.pack.promotion_name], current, product.name)
        else:
            repeat, change = Repeat(line.sku, line.qty), None
        lines.append(Line(
            sku=line.sku, name=product.name, spec=product.spec, unit=product.unit,
            supply_price=supply_price(product.unit_price, customer.type), qty=line.qty, pack=line.pack,
            source=source.kind, change=change, repeat=repeat,
        ))
    lines.sort(key=lambda line: line.change is None)  # sort 是穩定的：同一組裡照原本的順序
    return LastOrder(
        order=next((s for s in used if s.kind == "order"), None),
        quote=next((s for s in used if s.kind == "quote"), None),
        lines=tuple(lines),
    )
```

- [ ] **Step 5: API**

`backend/app/api/customers.py`：
- import 那行改成 `from app.services import approvals, customer_profile, last_order, negotiation, promo_packs, writeback`。
- 在 `# ── 開報價` 那段之前加回傳的模型與路由：

```python
# ── 上次訂的（docs/superpowers/specs/2026-10-07-repeat-last-order-design.md）─────────────


class LastOrderPack(BaseModel):
    code: str
    name: str
    deal: str
    buy_qty: int
    free_qty: int
    deal_price: float


class LastOrderChange(BaseModel):
    # terms：同一口條件變了；pack_gone：這一口沒了；promo_gone：這期沒有促銷
    kind: Literal["terms", "pack_gone", "promo_gone"]
    text: str
    short: str


class RepeatPlain(BaseModel):
    sku: str
    qty: int


class RepeatPack(BaseModel):
    promo_code: str
    packs: int


class LastOrderLine(BaseModel):
    sku: str
    name: str
    spec: str
    unit: str
    supply_price: int
    # 沒走口是數量；走口是口數
    qty: int
    pack: LastOrderPack | None
    source: Literal["order", "quote"]
    change: LastOrderChange | None
    # 這次照抄成什麼：品項 × 數量，或這一期的某一口 × 口數
    repeat: RepeatPlain | RepeatPack


class OrderRef(BaseModel):
    order_no: str
    date: date


class QuoteRef(BaseModel):
    quote_no: str
    date: date


class LastOrderOut(BaseModel):
    order: OrderRef | None
    quote: QuoteRef | None
    lines: list[LastOrderLine]
    changed: int


def _last_order_out(found: last_order.LastOrder) -> LastOrderOut:
    lines = []
    for line in found.lines:
        pack = line.pack
        repeat = line.repeat
        lines.append(LastOrderLine(
            sku=line.sku, name=line.name, spec=line.spec, unit=line.unit, supply_price=line.supply_price, qty=line.qty,
            pack=LastOrderPack(
                code=pack.code, name=pack.name, deal=pack.deal, buy_qty=pack.buy_qty, free_qty=pack.free_qty,
                deal_price=float(pack.deal_price),
            ) if pack else None,
            source=line.source,
            change=LastOrderChange(**dataclasses.asdict(line.change)) if line.change else None,
            repeat=RepeatPack(promo_code=repeat.pack.code, packs=repeat.qty) if repeat.pack else RepeatPlain(sku=repeat.sku, qty=repeat.qty),
        ))
    return LastOrderOut(
        order=OrderRef(order_no=found.order.no, date=found.order.date) if found.order else None,
        quote=QuoteRef(quote_no=found.quote.no, date=found.quote.date) if found.quote else None,
        lines=lines,
        changed=found.changed,
    )


@router.get("/{customer_id}/last-order", response_model=LastOrderOut | None)
def get_last_order(session: SessionDep, customer_id: str, user: CurrentUser):
    """上次訂的：上一次進貨與上一張報價合起來，上次走口的列跟這一期比（services/last_order.py）。沒訂過回 null。

    權限跟報價一樣：報價的內容與交易條件是負責人自己的。
    """
    customer, _ = _load(session, customer_id, user, SHARING_LEVEL["quote"])
    found = last_order.build(session, customer)
    return _last_order_out(found) if found else None
```

- [ ] **Step 6: 跑測試，確認通過**

Run: `TEST_DB_NAME=meddemo_test_repeat TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests/test_last_order.py backend/tests/test_promo_packs.py -q`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/promo_packs.py backend/app/services/last_order.py backend/app/api/customers.py backend/tests/test_last_order.py
git commit -m "Serve what each store ordered last time and how its packs changed"
```

---

### Task 4: 「進門前三分鐘」多一句

**Files:**
- Modify: `backend/app/services/customer_profile.py`（`build_profile`）
- Modify: `backend/app/services/today_route.py`（`_urgent`：首頁「需立即處理」的背景那句不拿這句）
- Test: `backend/tests/test_customer_profile.py`、`backend/tests/test_today_route.py`

**Interfaces:**
- Consumes: `last_order.build`、`Line.change.short`。
- Produces: `customer_profile.last_order_highlight(shorts: list[str]) -> str | None`；`LAST_ORDER_SHORTS = 3`；`LAST_ORDER_PREFIX = "上次訂的有"`。

首頁的「需立即處理」卡會從 `highlights` 挑一句當背景（`today_route._urgent` 的 `note`）。忠孝店加了這句之後，背景會從「答應客戶的…已過期限」變成「上次訂的…」；使用者只要這句出現在客戶檔案，所以 `_urgent` 跳過它。

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_customer_profile.py` 最上面加 `from app.services import customer_profile`，最後加：

```python
def test_the_brief_says_which_packs_changed_since_the_last_order(client):
    highlights = client.get("/api/customers/C001/profile").json()["highlights"]
    # 排在進貨間隔那句後面
    assert highlights[1] == "上次訂的有 3 項這期促銷變了：40EXa眼藥水(中口)沒了、金舒胃平(小口)要買的量變多、威鎮凝膠沒有促銷了"
    assert not any("上次訂的" in line for line in client.get("/api/customers/C030/profile").json()["highlights"])


def test_the_brief_lists_three_changes_at_most():
    shorts = ["甲沒了", "乙沒了", "丙沒了", "丁沒了"]
    assert customer_profile.last_order_highlight(shorts) == "上次訂的有 4 項這期促銷變了：甲沒了、乙沒了、丙沒了等"
    assert customer_profile.last_order_highlight([]) is None
```

（C030 是 M01 看得到、沒有上個月報價的那家；`client` 是 M01。）

`backend/tests/test_today_route.py` 的 import 改成：

```python
from app.models import Customer, RouteSignalWeight, RouteSnooze
from app.services import customer_profile, route_model, today_route
```

最後加：

```python
def test_the_urgent_card_does_not_borrow_the_last_order_sentence(engine):
    # 「上次訂的…促銷變了」只放在客戶檔案，首頁需立即處理那張卡的背景不拿它
    with Session(engine) as session:
        highlights = customer_profile.build_profile(session, session.get(Customer, "C001")).highlights
        assert any(h.startswith(customer_profile.LAST_ORDER_PREFIX) for h in highlights)
        candidate = next(c for c in route_model.candidates(session, TODAY, owner_id="U01") if c.customer_id == "C001")
        urgent = today_route._urgent(session, candidate, "interval", "進貨間隔拉長")
    assert urgent.note and not urgent.note.startswith(customer_profile.LAST_ORDER_PREFIX)
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `TEST_DB_NAME=meddemo_test_repeat TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests/test_customer_profile.py -q`
Expected: FAIL（`AttributeError: ... has no attribute 'last_order_highlight'`、highlights[1] 不是那句）

- [ ] **Step 3: 實作**

`backend/app/services/customer_profile.py`：
- import 加 `from app.services import last_order, promo_packs`（原本的 `from app.services import promo_packs` 改成這行）。
- 常數區 `MAX_HIGHLIGHTS` 後面加：

```python
# 「上次訂的促銷變了」那句最多列幾項，多的寫「等」；那句的開頭，首頁需立即處理那張卡靠它跳過（today_route._urgent）
LAST_ORDER_SHORTS = 3
LAST_ORDER_PREFIX = "上次訂的有"
```

- `build_profile` 前面加：

```python
def last_order_highlight(shorts: list[str]) -> str | None:
    """上次訂的走口的列這期變了：「上次訂的有 3 項這期促銷變了：40EXa眼藥水(中口)沒了、…」。"""
    if not shorts:
        return None
    more = "等" if len(shorts) > LAST_ORDER_SHORTS else ""
    return f"{LAST_ORDER_PREFIX} {len(shorts)} 項這期促銷變了：{'、'.join(shorts[:LAST_ORDER_SHORTS])}{more}"
```

- `build_profile` 裡，`if interval_alert:` 那整段（`highlights.append(sentence)` 結束）後面加：

```python
    # 出發前先知道上次訂的哪幾項這期促銷變了，排在進貨間隔後面（docs/superpowers/specs/2026-10-07-repeat-last-order-design.md）
    last = last_order.build(session, customer)
    if sentence := last_order_highlight([line.change.short for line in last.lines if line.change] if last else []):
        highlights.append(sentence)
```

注意：`if interval_alert:` 那段裡已經有一個區域變數叫 `sentence`，這裡用海象運算子重新指派沒有問題（那段已經結束）。

`backend/app/services/today_route.py` 的 `_urgent`，`note = …` 那行換成：

```python
    # 補一句別的提醒當背景，例如「間隔拉長」旁邊再提「上次提到競品」。「上次訂的…促銷變了」只放客戶檔案，不拿來當背景
    note = next(
        (h for h in highlights if h != detail and not h.startswith(customer_profile.LAST_ORDER_PREFIX)), None
    )
```

（原本那行上面的註解一起換掉。）

- [ ] **Step 4: 跑測試，確認通過**

Run: `TEST_DB_NAME=meddemo_test_repeat TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests/test_customer_profile.py backend/tests/test_today_route.py backend/tests/test_negotiation.py backend/tests/test_methods.py -q`
Expected: PASS（`test_profile_shows_the_lengthening_interval_and_open_items` 檢查的三句還在前四句裡）

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/customer_profile.py backend/app/services/today_route.py backend/tests/test_customer_profile.py backend/tests/test_today_route.py
git commit -m "Say in the pre-visit brief which packs from the last order changed"
```

---

### Task 5: AI 輸出多一個 `repeat_last`

**Files:**
- Modify: `backend/app/services/extraction.py`
- Test: `backend/tests/test_repeat_extraction.py`（新）

**Interfaces:**
- Produces：
  - `extraction.REPEAT_SCHEMA`（`{all: bool, except_skus: [str], relative: [{product_text, sku, promo_code, delta}]}` 或 null）
  - `extraction.SOURCE_KEYS = (*FIELD_KEYS, "repeat_last")`
  - `Extraction.repeat_last: dict[str, Any] | None = None`
  - `output_schema()` 多 `repeat_last`（列進 `required`），`sources` 多 `repeat_last`

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_repeat_extraction.py`：

```python
"""AI 聽出「跟上次一樣」：輸出格式與提示（services/extraction.py）。展開在 test_repeat_order.py。"""

from datetime import date

from app.llm import api_schema
from app.services import extraction

FIELDS = dict.fromkeys(extraction.FIELD_KEYS)


class FakeLLM:
    def __init__(self, data):
        self.data = data

    def json(self, *, system, prompt, schema, effort="medium", media=()):
        self.prompt, self.schema = prompt, schema
        return self.data


def test_the_output_has_repeat_last_next_to_the_fields():
    schema = extraction.output_schema()
    assert schema["required"] == ["fields", "sources", "repeat_last"]
    repeat = schema["properties"]["repeat_last"]
    assert repeat["type"] == ["object", "null"]
    assert repeat["required"] == ["all", "except_skus", "relative"]
    assert repeat["properties"]["relative"]["items"]["required"] == ["product_text", "sku", "promo_code", "delta"]
    assert "repeat_last" in schema["properties"]["sources"]["required"]
    # Gemini 只收得到支援的關鍵字；送出前清掉的不影響結構
    assert api_schema(schema)["properties"]["repeat_last"]["required"] == ["all", "except_skus", "relative"]


def test_the_prompt_explains_same_as_last_time_and_relative_changes():
    prompt = extraction.build_prompt("逐字稿", date(2026, 10, 28), [], [])
    assert "repeat_last" in prompt and "跟上次一樣" in prompt and "except_skus" in prompt and "relative" in prompt
    assert "delta" in prompt and "照上次填 0" in prompt


def test_the_extractor_passes_repeat_last_through():
    repeat = {"all": True, "except_skus": ["D120013"], "relative": []}
    llm = FakeLLM({"fields": FIELDS, "sources": {"repeat_last": "跟上次一樣就好", "intent": None}, "repeat_last": repeat})
    found = extraction.LLMFieldExtractor(llm).extract("跟上次一樣就好", date(2026, 10, 28), [])
    assert found.repeat_last == repeat and found.sources == {"repeat_last": "跟上次一樣就好"}
    assert extraction.LLMFieldExtractor(FakeLLM({"fields": FIELDS, "sources": {}, "repeat_last": None})).extract(
        "魚油二十盒", date(2026, 10, 28), []
    ).repeat_last is None
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `TEST_DB_NAME=meddemo_test_repeat TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests/test_repeat_extraction.py -q`
Expected: FAIL（`KeyError: 'repeat_last'`）

- [ ] **Step 3: 實作**

`backend/app/services/extraction.py`：

`FIELD_KEYS` 後面加：

```python
# sources 還多一格 repeat_last：講「跟上次一樣」的原話
SOURCE_KEYS = (*FIELD_KEYS, "repeat_last")
```

`PROMPT` 的第一段改成：

```
你是藥品通路業務的助理。下面是業務拜訪客戶後的口述逐字稿，請整理成六個欄位，另外判斷這次是不是照上次的單下（repeat_last）。
```

第 10 條後面加兩條：

```
11. repeat_last 是照上次的單：業務講了「跟上次一樣」「照上次」「老樣子」這類話，表示這次照上次那張單再下一次，all 填 true；說這次不要的品項（例如「威鎮這次先不要」）對照品項表把 sku 填進 except_skus。都沒講就整個 repeat_last 填 null，sources 的 repeat_last 照第 2 條附原文。
12. 業務講跟上次比的加減（例如「再加一口小口 Premium」「魚油比上次少 5 盒」「人工淚液照上次」），填進 repeat_last.relative：品項與口照第 7、9 條對，delta 是加減的數量（口是口數，少就是負數，照上次填 0）；這些不要再填進 intent。講了確定的總數（例如「魚油這次 40 盒」）才照第 7 條填 intent。只講加減、沒講跟上次一樣時 all 填 false。
```

`output_schema` 前面加：

```python
REPEAT_SCHEMA: dict[str, Any] = {
    "description": "照上次的單：講了跟上次一樣、這次不要哪些、跟上次比的加減；都沒講是 null",
    "type": ["object", "null"],
    "additionalProperties": False,
    "required": ["all", "except_skus", "relative"],
    "properties": {
        "all": {"type": "boolean", "description": "講了跟上次一樣、照上次、老樣子：照整張再下一次"},
        "except_skus": {"type": "array", "items": {"type": "string"}, "description": "這次不要的品項"},
        "relative": {
            "type": "array",
            "description": "跟上次比的加減",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["product_text", "sku", "promo_code", "delta"],
                "properties": {
                    "product_text": {"type": "string", "minLength": 1, "description": "口述原本的講法"},
                    "sku": {"type": ["string", "null"], "description": "對不到唯一品項時為 null"},
                    "promo_code": {"type": ["string", "null"], "description": "講到促銷的口才填"},
                    "delta": {"type": "integer", "description": "跟上次比加減多少；口是口數，照上次是 0"},
                },
            },
        },
    },
}
```

`output_schema` 換成：

```python
def output_schema() -> dict[str, Any]:
    """交給模型的輸出格式：六個欄位、每個有值欄位的逐字稿原文片段，加上照上次的單（repeat_last）。"""
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["fields", "sources", "repeat_last"],
        "properties": {
            "fields": fields_schema(),
            # 每個欄位都要列出來，沒有原文的填 null（結構化輸出要求物件的欄位全部明列）
            "sources": {
                "type": "object",
                "additionalProperties": False,
                "required": list(SOURCE_KEYS),
                "properties": {key: {"type": ["string", "null"]} for key in SOURCE_KEYS},
            },
            "repeat_last": REPEAT_SCHEMA,
        },
    }
```

`Extraction` 改成：

```python
@dataclass
class Extraction:
    fields: dict[str, Any]
    sources: dict[str, str] = field(default_factory=dict)
    # 照上次的單（REPEAT_SCHEMA）；沒講是 None。展開在 services/repeat_order.py
    repeat_last: dict[str, Any] | None = None
```

`LLMFieldExtractor.extract` 的 return 換成：

```python
        return Extraction(
            fields=data["fields"],
            sources={k: v for k, v in (data.get("sources") or {}).items() if v},
            repeat_last=data.get("repeat_last"),
        )
```

- [ ] **Step 4: 跑測試，確認通過**

Run: `TEST_DB_NAME=meddemo_test_repeat TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests/test_repeat_extraction.py backend/tests/test_extraction_packs.py backend/tests/test_visits.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/extraction.py backend/tests/test_repeat_extraction.py
git commit -m "Have the AI tell same-as-last-time, items to skip and relative changes apart"
```

---

### Task 6: 照上次訂的展開下單意向（純函式）

**Files:**
- Create: `backend/app/services/repeat_order.py`
- Test: `backend/tests/test_repeat_order.py`（新）

**Interfaces:**
- Consumes: `last_order.LastOrder`、`Line`、`Repeat`、`Source`；`promo_packs.Pack`；`extraction.ProductHint(sku, name, unit, aliases)`。
- Produces：
  - `repeat_order.EMPTY_NOTE = "說了跟上次一樣，但這家還沒有訂過，請手動填下單意向"`
  - `repeat_order.normalize(value: Any) -> dict | None`
  - `repeat_order.Expanded(intent: list[dict] | None, snapshot: dict, note: str | None)`
  - `repeat_order.expand(last: LastOrder | None, repeat: dict, intent: list[dict] | None, said: str | None, packs: Sequence[Pack], products: Mapping[str, ProductHint]) -> Expanded`
  - 快照：`{said, all, except_skus, except_names, order: {order_no, date} | None, quote: {quote_no, date} | None, empty, copied, changes: [{sku, promo_code, text}], relative: [{sku, promo_code, last_qty, delta}]}`（日期是 ISO 字串）

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_repeat_order.py`：

```python
"""錄音講「跟上次一樣」：照上次訂的展開成下單意向（services/repeat_order.py）。"""

from datetime import date
from decimal import Decimal

from app.services import repeat_order
from app.services.extraction import ProductHint
from app.services.last_order import Change, LastOrder, Line, Repeat, Source
from app.services.promo_packs import Pack


def pack(code, name, sku, buy, free, price, period="202610"):
    return Pack(
        code=code, promotion_name=f"{period}保藥特搭活動", group_name="測試", name=name, sku=sku,
        deal=f"<{buy}+{free}>", buy_qty=buy, free_qty=free, deal_price=Decimal(price),
    )


PREMIUM_OLD = pack("OLD-P", "Premium眼藥水(小口)", "F749579", 22, 1, 5500, period="202609")
PREMIUM = pack("NOW-P", "Premium眼藥水(小口)", "F749579", 22, 1, 5500)
MID_OLD = pack("OLD-M", "40EXa眼藥水(中口)", "F763630", 57, 4, 7980, period="202609")
PACKS = [PREMIUM, pack("NOW-S", "40EXa眼藥水(小口)", "F763630", 22, 1, 3080)]
HINTS = {
    "HS-FO30": ProductHint("HS-FO30", "魚油 30 入", "盒", []),
    "HS-CA60": ProductHint("HS-CA60", "鈣片 60 錠", "瓶", []),
    "D120013": ProductHint("D120013", "威鎮凝膠", "支", []),
}
GONE = Change("pack_gone", "中口這期沒了，只剩小口（買 22 送 1，$3,080）", "40EXa眼藥水(中口)沒了")


def line(sku, name, unit, qty, repeat, pack=None, change=None, source="order"):
    return Line(sku=sku, name=name, spec="", unit=unit, supply_price=100, qty=qty, pack=pack, source=source, change=change, repeat=repeat)


LAST = LastOrder(
    order=Source("order", "SO20261005-C001", date(2026, 10, 5), ()),
    quote=Source("quote", "Q20260930-0001", date(2026, 9, 30), ()),
    lines=(
        line("F763630", "40EXa眼藥水", "瓶", 1, Repeat("F763630", 57), pack=MID_OLD, change=GONE, source="quote"),
        line("HS-FO30", "魚油 30 入", "盒", 32, Repeat("HS-FO30", 32)),
        line("D120013", "威鎮凝膠", "支", 5, Repeat("D120013", 5)),
        # 上次本來就有 40EXa 不走促銷 10 瓶：跟中口換成的 57 瓶併成一列
        line("F763630", "40EXa眼藥水", "瓶", 10, Repeat("F763630", 10), source="quote"),
        line("F749579", "Premium眼藥水", "盒", 1, Repeat("F749579", 1, PREMIUM), pack=PREMIUM_OLD, source="quote"),
    ),
)


def item(sku, text, qty, unit, code=None):
    return {"product_text": text, "sku": sku, "qty": qty, "unit": unit, "promo_code": code}


def repeat(all_=True, except_skus=(), relative=()):
    return {"all": all_, "except_skus": list(except_skus), "relative": list(relative)}


def rel(sku, delta, code=None, text="口述"):
    return {"product_text": text, "sku": sku, "promo_code": code, "delta": delta}


def test_saying_nothing_about_last_time_is_none():
    assert repeat_order.normalize(None) is None
    assert repeat_order.normalize({"all": False, "except_skus": [], "relative": []}) is None
    assert repeat_order.normalize({"all": True, "except_skus": None, "relative": None}) == repeat()


def test_same_as_last_time_copies_the_whole_order():
    found = repeat_order.expand(LAST, repeat(), None, "跟上次一樣就好", PACKS, HINTS)
    assert found.intent == [
        item("F763630", "40EXa眼藥水", 67, "瓶"),
        item("HS-FO30", "魚油 30 入", 32, "盒"),
        item("D120013", "威鎮凝膠", 5, "支"),
        item("F749579", "Premium眼藥水(小口)", 1, "口", "NOW-P"),
    ]
    assert found.note is None
    assert found.snapshot == {
        "said": "跟上次一樣就好", "all": True, "except_skus": [], "except_names": [],
        "order": {"order_no": "SO20261005-C001", "date": "2026-10-05"},
        "quote": {"quote_no": "Q20260930-0001", "date": "2026-09-30"},
        "empty": False, "copied": 4,
        "changes": [{"sku": "F763630", "promo_code": None, "text": GONE.text}],
        "relative": [],
    }


def test_items_said_not_to_be_ordered_are_left_out():
    found = repeat_order.expand(LAST, repeat(except_skus=["D120013", "NOPE"]), None, None, PACKS, HINTS)
    assert [i["sku"] for i in found.intent] == ["F763630", "HS-FO30", "F749579"]
    assert found.snapshot["except_names"] == ["威鎮凝膠", "NOPE"] and found.snapshot["copied"] == 3


def test_relative_changes_use_last_times_quantities():
    found = repeat_order.expand(LAST, repeat(relative=[
        rel("F749579", 1, "NOW-P"),   # 再加一口小口 Premium：1 + 1
        rel("HS-FO30", -32),          # 魚油少 32 盒：拿掉
        rel("HS-CA60", 6),            # 上次沒有、加的：新增一列
        rel("D120013", -9),           # 少到 0 以下：拿掉
        rel("HS-PB30", -3),           # 上次沒有、減的：不理
    ]), None, None, PACKS, HINTS)
    assert found.intent == [
        item("F763630", "40EXa眼藥水", 67, "瓶"),
        item("F749579", "Premium眼藥水(小口)", 2, "口", "NOW-P"),
        item("HS-CA60", "鈣片 60 錠", 6, "瓶"),
    ]
    assert found.snapshot["relative"] == [
        {"sku": "F749579", "promo_code": "NOW-P", "last_qty": 1, "delta": 1},
        {"sku": "HS-FO30", "promo_code": None, "last_qty": 32, "delta": -32},
        {"sku": "HS-CA60", "promo_code": None, "last_qty": 0, "delta": 6},
        {"sku": "D120013", "promo_code": None, "last_qty": 5, "delta": -9},
    ]


def test_only_relative_changes_produce_only_those_items():
    # 「人工淚液照上次、Premium 多一口」：沒講跟上次一樣，只產生講到的那幾項
    found = repeat_order.expand(LAST, repeat(all_=False, relative=[rel("HS-FO30", 0), rel("F749579", 1, "NOW-P")]), None, None, PACKS, HINTS)
    assert found.intent == [item("HS-FO30", "魚油 30 入", 32, "盒"), item("F749579", "Premium眼藥水(小口)", 2, "口", "NOW-P")]
    assert found.snapshot["copied"] == 0


def test_spoken_totals_replace_the_same_item_and_unmatched_items_go_last():
    spoken = [item("HS-FO30", "魚油", 40, "盒"), item(None, "那個新的眼藥水", None, None)]
    found = repeat_order.expand(LAST, repeat(relative=[rel("F749579", 1, "OLD-P"), rel(None, 2, text="什麼膠囊")]), spoken, None, PACKS, HINTS)
    assert found.intent == [
        item("F763630", "40EXa眼藥水", 67, "瓶"),
        item("D120013", "威鎮凝膠", 5, "支"),
        item("F749579", "Premium眼藥水(小口)", 1, "口", "NOW-P"),
        item("HS-FO30", "魚油", 40, "盒"),
        # 對不到品項的、口不是這一期的（OLD-P）都加在最後，確認頁標「缺少品項」
        item(None, "那個新的眼藥水", None, None),
        item(None, "口述", None, None),
        item(None, "什麼膠囊", None, None),
    ]


def test_a_customer_who_never_ordered_keeps_only_what_was_said():
    spoken = [item("HS-FO30", "魚油", 20, "盒")]
    found = repeat_order.expand(None, repeat(), spoken, "跟上次一樣", PACKS, HINTS)
    assert found.intent == spoken and found.note == repeat_order.EMPTY_NOTE
    assert found.snapshot["empty"] is True and found.snapshot["order"] is None and found.snapshot["copied"] == 0
    assert repeat_order.expand(None, repeat(), None, None, PACKS, HINTS).intent is None


def test_skipping_everything_leaves_no_intent():
    every = [l.sku for l in LAST.lines]
    assert repeat_order.expand(LAST, repeat(except_skus=every), None, None, PACKS, HINTS).intent is None
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `TEST_DB_NAME=meddemo_test_repeat TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests/test_repeat_order.py -q`
Expected: FAIL（`ImportError: cannot import name 'repeat_order'`）

- [ ] **Step 3: 實作**

`backend/app/services/repeat_order.py`：

```python
"""錄音講「跟上次一樣」與跟上次比的加減：照上次訂的展開成下單意向
（docs/superpowers/specs/2026-10-07-repeat-last-order-design.md）。

AI 只聽出有沒有講、哪些不要、加減多少（extraction.REPEAT_SCHEMA）；要抄哪幾列、這期對應哪一口、變了什麼，
都照 last_order 算。展開那一刻的快照存在 visit.repeat_last，確認頁照它寫每一列變了什麼。
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from app.services.extraction import ProductHint
from app.services.last_order import LastOrder
from app.services.promo_packs import Pack

EMPTY_NOTE = "說了跟上次一樣，但這家還沒有訂過，請手動填下單意向"


@dataclass
class Expanded:
    intent: list[dict[str, Any]] | None
    snapshot: dict[str, Any]
    # 確認頁最上面那行提示（visit.error_message）
    note: str | None


def normalize(value: Any) -> dict[str, Any] | None:
    """AI 的 repeat_last：all 是 false、沒有不要的、也沒有加減，當成沒講。"""
    if not value:
        return None
    repeat = {
        "all": bool(value.get("all")),
        "except_skus": list(value.get("except_skus") or []),
        "relative": list(value.get("relative") or []),
    }
    return repeat if repeat["all"] or repeat["except_skus"] or repeat["relative"] else None


def _plain(sku: str, name: str, unit: str | None, qty: int) -> dict[str, Any]:
    return {"product_text": name, "sku": sku, "qty": qty, "unit": unit, "promo_code": None}


def _packed(pack: Pack, packs: int) -> dict[str, Any]:
    return {"product_text": pack.name, "sku": pack.sku, "qty": packs, "unit": "口", "promo_code": pack.code}


def _unmatched(text: str) -> dict[str, Any]:
    return {"product_text": text, "sku": None, "qty": None, "unit": None, "promo_code": None}


def _key(item: dict[str, Any]) -> tuple[str | None, str | None]:
    return item["sku"], item["promo_code"]


def _base(last: LastOrder) -> list[dict[str, Any]]:
    """上次訂的每一列抄成下單意向的一項；同一個品項不走促銷的併成一列（報價不允許列兩次）。"""
    items: list[dict[str, Any]] = []
    for line in last.lines:
        repeat = line.repeat
        if repeat.pack:
            items.append(_packed(repeat.pack, repeat.qty))
        elif same := next((i for i in items if _key(i) == (repeat.sku, None)), None):
            same["qty"] += repeat.qty
        else:
            items.append(_plain(repeat.sku, line.name, line.unit, repeat.qty))
    return items


def _ref(source, key: str) -> dict[str, str] | None:
    return {key: source.no, "date": source.date.isoformat()} if source else None


def expand(
    last: LastOrder | None,
    repeat: dict[str, Any],
    intent: list[dict[str, Any]] | None,
    said: str | None,
    packs: Sequence[Pack],
    products: Mapping[str, ProductHint],
) -> Expanded:
    """照上次訂的展開：整張（all）→ 拿掉不要的 → 套加減 → 業務講的總數蓋掉同品項 → 對不到品項的加在最後。"""
    current = {p.code: p for p in packs}
    spoken = intent or []
    absolute = [i for i in spoken if i.get("sku")]
    unmatched = [i for i in spoken if not i.get("sku")]
    excepted = repeat["except_skus"]
    base = _base(last) if last else []
    result = [dict(i) for i in base if i["sku"] not in excepted] if repeat["all"] else []
    copied = len(result)
    relative = []
    for r in repeat["relative"]:
        code = r.get("promo_code")
        # 對不到品項、或口不是這一期的：當成對不到品項，讓確認頁標「缺少品項」
        if not r.get("sku") or (code and (code not in current or current[code].sku != r["sku"])):
            unmatched.append(_unmatched(r["product_text"]))
            continue
        if last is None:
            continue
        key = (r["sku"], code)
        before = next((i for i in base if _key(i) == key), None)
        at = next((n for n, i in enumerate(result) if _key(i) == key), None)
        if before is None:
            # 上次沒有這一列：加的就新增一列，減的或照上次不理
            if r["delta"] > 0:
                hint = products.get(r["sku"])
                result.append(_packed(current[code], r["delta"]) if code else _plain(
                    r["sku"], hint.name if hint else r["product_text"], hint.unit if hint else None, r["delta"]
                ))
                relative.append({"sku": r["sku"], "promo_code": code, "last_qty": 0, "delta": r["delta"]})
            continue
        qty = before["qty"] + r["delta"]
        if at is not None and qty > 0:
            result[at]["qty"] = qty
        elif at is not None:
            del result[at]
        elif qty > 0:
            result.append({**before, "qty": qty})
        relative.append({"sku": r["sku"], "promo_code": code, "last_qty": before["qty"], "delta": r["delta"]})
    replaced = {i["sku"] for i in absolute}
    result = [i for i in result if i["sku"] not in replaced] + absolute + unmatched
    snapshot = {
        "said": said,
        "all": repeat["all"],
        "except_skus": excepted,
        "except_names": [products[sku].name if sku in products else sku for sku in excepted],
        "order": _ref(last.order, "order_no") if last else None,
        "quote": _ref(last.quote, "quote_no") if last else None,
        "empty": last is None,
        "copied": copied,
        "changes": [
            {"sku": line.sku, "promo_code": line.repeat.promo_code, "text": line.change.text}
            for line in (last.lines if last else ())
            if line.change and line.sku not in excepted
        ],
        "relative": relative,
    }
    return Expanded(result or None, snapshot, EMPTY_NOTE if last is None else None)
```

- [ ] **Step 4: 跑測試，確認通過**

Run: `TEST_DB_NAME=meddemo_test_repeat TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests/test_repeat_order.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/repeat_order.py backend/tests/test_repeat_order.py
git commit -m "Expand same-as-last-time into this visit's intent from the last order"
```

---

### Task 7: 錄音整理完就展開，快照給確認頁

**Files:**
- Modify: `backend/app/services/visit_processing.py`（`_extract`）
- Modify: `backend/app/api/visits.py`（`VisitDetail`、`_detail`）
- Test: `backend/tests/test_repeat_visits.py`（新）

**Interfaces:**
- Consumes: `repeat_order.normalize`、`repeat_order.expand`、`last_order.build`、`Extraction.repeat_last`、`extraction.product_hints`。
- Produces: `GET /api/visits/{id}` 多回 `repeat_last`（快照或 null）。

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_repeat_visits.py`：

```python
"""錄音講「跟上次一樣」：整理完就照上次訂的展開下單意向，確認頁拿得到快照，送出就是這個月的 SAP 報價草稿。"""

from sqlalchemy import text
from sqlalchemy.orm import Session
from test_visits import FakeExtractor, client, providers, run_jobs, statuses, upload  # noqa: F401  client、providers 是 fixture

from app.services import last_order, promo_packs, repeat_order
from app.services.extraction import Extraction

FIELDS = {"competitor": None, "complaint": None, "intent": None, "commitment": None, "follow_up_date": None, "notes": None}
SAID = "跟上次一樣就好"
TRANSCRIPT = "跟店長聊了一下，跟上次一樣就好，威鎮這次先不要，Premium 小口再加一口。"


class RepeatExtractor:
    def __init__(self, repeat, intent=None, said=SAID):
        self.repeat, self.intent, self.said = repeat, intent, said

    def extract(self, transcript, visit_date, products, packs=()):
        return Extraction({**FIELDS, "intent": self.intent}, {"repeat_last": self.said}, repeat_last=self.repeat)


def draft(client, providers, extractor):
    """沒有語音辨識：上傳後轉文字失敗，再用手打的逐字稿整理。"""
    providers(extractor=extractor)
    visit_id = upload(client).json()["id"]
    run_jobs()
    client.post(f"/api/visits/{visit_id}/transcript", json={"text": TRANSCRIPT})
    run_jobs()
    return client.get(f"/api/visits/{visit_id}").json()


def current_code(engine, name):
    with Session(engine) as session:
        return next(p.code for p in promo_packs.current_packs(session) if p.name == name)


def test_same_as_last_time_becomes_this_months_quote(client, providers, engine):
    premium = current_code(engine, "Premium眼藥水(小口)")
    visit = draft(client, providers, RepeatExtractor({
        "all": True, "except_skus": ["D120013"],
        "relative": [{"product_text": "Premium 小口", "sku": "F749579", "promo_code": premium, "delta": 1}],
    }))
    intent = {(i["sku"], i["promo_code"]): i for i in visit["fields"]["intent"]}
    # 忠孝店上次訂的 22 列，威鎮不要
    assert len(intent) == 21 and ("D120013", None) not in intent
    assert intent[("F749579", premium)]["qty"] == 2
    assert intent[("F763630", None)] == {"product_text": "40EXa眼藥水", "sku": "F763630", "qty": 57, "unit": "瓶", "promo_code": None}
    snapshot = visit["repeat_last"]
    assert (snapshot["said"], snapshot["copied"], snapshot["except_names"]) == (SAID, 21, ["威鎮凝膠"])
    assert snapshot["order"] == {"order_no": "SO20261005-C001", "date": "2026-10-05"}
    assert [c["text"] for c in snapshot["changes"]] == [
        "中口這期沒了，只剩小口（買 22 送 1，$3,080）", "從買 10 送 2 變成買 15 送 2，一口 $800 → $1,200",
    ]
    assert snapshot["relative"] == [{"sku": "F749579", "promo_code": premium, "last_qty": 1, "delta": 1}]
    # 意向沒有自己的原文，用「跟上次一樣」那句
    assert visit["sources"]["intent"] == SAID and visit["error_message"] is None

    confirmed = client.post(f"/api/visits/{visit['id']}/confirm").json()
    assert statuses(confirmed)["sap"] == "success"
    with engine.connect() as conn:
        jin = conn.execute(
            text("SELECT packs, amount FROM sap_quotation_draft WHERE visit_id = :v AND sku = 'C130082'"), {"v": visit["id"]}
        ).one()
    # 金舒胃平小口照這期的條件：一口 1,200 × 3 口
    assert (jin.packs, float(jin.amount)) == (3, 3600)


def test_same_as_last_time_for_a_customer_who_never_ordered(client, providers, monkeypatch):
    monkeypatch.setattr(last_order, "build", lambda session, customer: None)
    spoken = [{"product_text": "魚油", "sku": "HS-FO30", "qty": 20, "unit": "盒", "promo_code": None}]
    visit = draft(client, providers, RepeatExtractor({"all": True, "except_skus": [], "relative": []}, intent=spoken))
    assert visit["fields"]["intent"] == spoken
    assert visit["error_message"] == repeat_order.EMPTY_NOTE and visit["repeat_last"]["empty"] is True


def test_no_snapshot_without_same_as_last_time_and_it_is_rebuilt_on_retyping(client, providers):
    visit = draft(client, providers, RepeatExtractor({"all": True, "except_skus": [], "relative": []}))
    assert visit["repeat_last"]["all"] is True
    # 業務改了逐字稿重新整理：這次沒講跟上次一樣，快照跟著清掉
    providers(extractor=FakeExtractor())
    client.post(f"/api/visits/{visit['id']}/transcript", json={"text": TRANSCRIPT})
    run_jobs()
    assert client.get(f"/api/visits/{visit['id']}").json()["repeat_last"] is None
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `TEST_DB_NAME=meddemo_test_repeat TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests/test_repeat_visits.py -q`
Expected: FAIL（`KeyError: 'repeat_last'`）

- [ ] **Step 3: 展開**

`backend/app/services/visit_processing.py`：

import 改成：

```python
from app.db import session_factory
from app.models import Customer, Visit, VisitAudio
from app.services import last_order, repeat_order
from app.services.extraction import drop_unknown_packs, empty_fields, get_extractor, product_hints, validate_fields
```

`_extract` 換成：

```python
def _extract(session: Session, visit: Visit) -> None:
    set_progress(visit.id, "extracting")
    note = None
    snapshot = None
    try:
        packs = current_packs(session)
        hints = product_hints(session)
        extraction = get_extractor().extract(visit.transcript, local_date(visit.visited_at), hints, packs)
        errors = validate_fields(extraction.fields)
        if errors:
            raise ValueError("；".join(errors))
        # AI 抽出的口對不上這一期，就清掉讓業務在確認頁選
        fields = {**extraction.fields, "intent": drop_unknown_packs(extraction.fields["intent"], packs)}
        sources = {key: quote for key, quote in extraction.sources.items() if quote and fields.get(key) is not None}
        # 講了跟上次一樣或跟上次比的加減：照上次訂的展開下單意向，快照留給確認頁
        if repeat := repeat_order.normalize(extraction.repeat_last):
            said = extraction.sources.get("repeat_last")
            last = last_order.build(session, session.get(Customer, visit.customer_id))
            expanded = repeat_order.expand(last, repeat, fields["intent"], said, packs, {h.sku: h for h in hints})
            fields["intent"], snapshot, note = expanded.intent, expanded.snapshot, expanded.note
            if fields["intent"] is None:
                sources.pop("intent", None)
            elif not sources.get("intent") and said:
                sources["intent"] = said
    except Exception as exc:
        log.warning("整理欄位失敗 visit=%s：%s", visit.id, exc)
        fields, sources, snapshot = empty_fields(), {}, None
        note = f"欄位沒有自動整理出來，請手動填寫（{exc}）"
    visit.fields_raw = fields
    visit.fields_final = fields
    visit.field_sources = sources
    visit.repeat_last = snapshot
    visit.error_message = note
    visit.status = "draft"
    session.commit()
    set_progress(visit.id, "done")
```

- [ ] **Step 4: API 回傳快照**

`backend/app/api/visits.py` 的 `VisitDetail`，`oa_form_id` 後面加：

```python
    # 講了跟上次一樣或跟上次比的加減時，展開那一刻的快照（services/repeat_order.py）；確認頁照它寫每一列變了什麼
    repeat_last: dict[str, Any] | None = None
```

`_detail` 的 `VisitDetail(...)` 最後加 `repeat_last=visit.repeat_last,`。

- [ ] **Step 5: 跑測試，確認通過**

Run: `TEST_DB_NAME=meddemo_test_repeat TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests/test_repeat_visits.py backend/tests/test_visits.py backend/tests/test_oa.py backend/tests/test_privacy.py -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/visit_processing.py backend/app/api/visits.py backend/tests/test_repeat_visits.py
git commit -m "Expand same-as-last-time right after extraction and keep a snapshot for the confirm page"
```

---

### Task 8: 報價成交寫進交易與帳款

**Files:**
- Create: `backend/app/services/orders.py`
- Modify: `backend/app/api/customers.py`（路由、`MAX_QUOTE_LINES`）
- Test: `backend/tests/test_orders.py`（新）

**Interfaces:**
- Consumes: `approvals.contract_terms(session, customer, today) -> {"listing_fee_rate": float, "channel_reward_rate": float, ...}`、`customer_profile.app_today`。
- Produces：
  - `orders.PAYMENT_DAYS = {"chain": 60, "independent": 30, "clinic": 30}`
  - `orders.Placed(order_no: str, date: dt.date, amount: float)`
  - `orders.place(session, customer: Customer, quote_no: str) -> Placed | None`（`None`：這張不是 `draft`）
  - `POST /api/customers/{id}/quotes/{quote_no}/order` → `{order_no, date, amount}`；不是 `draft` 回 409，沒有這張回 404
  - `MAX_QUOTE_LINES = 30`

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_orders.py`：

```python
"""報價成交（客戶下單了）：寫進交易紀錄與應收帳款，報價改成已成交，不能復原。"""

import datetime as dt
from decimal import ROUND_HALF_UP, Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update

from app.main import app
from app.models import Customer, Receivable, SalesTransaction, SapQuotationDraft
from app.services import approvals, promo_packs, today_route
from app.tasks import redis
from app.timeutil import TAIPEI

TODAY = dt.date(2026, 10, 28)


@pytest.fixture
def api(tx, sign_in):
    yield sign_in(TestClient(app), "U01")
    redis().flushdb()


def open_quote(api, tx, items):
    quote = api.post("/api/customers/C001/quotes", json={"items": items}).json()
    # 報價的建立時間是真的現在；改成系統日，「上次訂的」與商機的日期才固定
    tx.execute(
        update(SapQuotationDraft).where(SapQuotationDraft.quote_no == quote["quote_no"])
        .values(created_at=dt.datetime(2026, 10, 28, 10, tzinfo=TAIPEI))
    )
    return quote["quote_no"]


def fee(amount, rate):
    return float((Decimal(amount) * Decimal(str(rate))).quantize(Decimal("1"), ROUND_HALF_UP))


def test_placing_an_order_writes_the_sale_and_the_invoice(tx, api):
    premium = next(p.code for p in promo_packs.current_packs(tx) if p.name == "Premium眼藥水(小口)")
    quote_no = open_quote(api, tx, [{"sku": "HS-FO30", "qty": 20}, {"promo_code": premium, "packs": 1}])
    rates = approvals.contract_terms(tx, tx.get(Customer, "C001"), TODAY)

    placed = api.post(f"/api/customers/C001/quotes/{quote_no}/order")
    order_no = f"SO20261028-C001-{quote_no}"
    assert placed.status_code == 200
    assert placed.json() == {"order_no": order_no, "date": "2026-10-28", "amount": 8100 + 5500}

    lines = tx.execute(
        select(SalesTransaction).where(SalesTransaction.order_no == order_no).order_by(SalesTransaction.id)
    ).scalars().all()
    # 魚油 20 盒照報價金額；小口買 22 送 1，到貨 23 盒
    assert [(l.customer_id, l.date, l.sku, l.qty, float(l.amount)) for l in lines] == [
        ("C001", TODAY, "HS-FO30", 20, 8100), ("C001", TODAY, "F749579", 23, 5500),
    ]
    assert [float(l.cost) for l in lines] == [270 * 20, 150 * 23]
    assert [float(l.listing_fee) for l in lines] == [fee(8100, rates["listing_fee_rate"]), fee(5500, rates["listing_fee_rate"])]
    assert [float(l.channel_reward) for l in lines] == [fee(8100, rates["channel_reward_rate"]), fee(5500, rates["channel_reward_rate"])]

    invoice = tx.get(Receivable, order_no)
    # 連鎖的付款條件 60 天
    assert (invoice.customer_id, invoice.invoice_date, invoice.due_date, float(invoice.amount), invoice.paid_date) == (
        "C001", TODAY, TODAY + dt.timedelta(days=60), 13600, None,
    )
    assert set(tx.scalars(select(SapQuotationDraft.status).where(SapQuotationDraft.quote_no == quote_no))) == {"ordered"}
    profile = api.get("/api/customers/C001/profile").json()
    assert quote_no not in [q["quote_no"] for q in profile["open_quotes"]]
    # 同一天的進貨與報價以報價為主：口還在
    last = api.get("/api/customers/C001/last-order").json()
    assert last["quote"]["quote_no"] == quote_no
    assert [(l["sku"], l["pack"]["name"] if l["pack"] else None) for l in last["lines"]] == [
        ("HS-FO30", None), ("F749579", "Premium眼藥水(小口)"),
    ]
    # 再按一次不會寫兩次
    assert api.post(f"/api/customers/C001/quotes/{quote_no}/order").status_code == 409


def test_only_draft_quotes_can_be_ordered(tx, api, auth):
    quote_no = open_quote(api, tx, [{"sku": "HS-FO30", "qty": 20}])
    assert api.post(f"/api/customers/C001/quotes/{quote_no}/order", headers=auth("U03")).status_code == 404
    assert api.post("/api/customers/C001/quotes/Q-NOPE/order").status_code == 404
    tx.execute(update(SapQuotationDraft).where(SapQuotationDraft.quote_no == quote_no).values(status="pending_approval"))
    assert api.post(f"/api/customers/C001/quotes/{quote_no}/order").status_code == 409


def test_an_ordered_quote_is_no_longer_an_opportunity(tx, api):
    # 用 17 盒：假資料 10/19 那次拜訪已經有一張魚油 20 盒、一直沒成交的草稿，它還會是商機
    quote_no = open_quote(api, tx, [{"sku": "HS-FO30", "qty": 17}])
    assert "想進魚油 30 入 × 17" in today_route._opportunities(tx, "U01", TODAY).get("C001", "")
    api.post(f"/api/customers/C001/quotes/{quote_no}/order")
    assert "想進魚油 30 入 × 17" not in today_route._opportunities(tx, "U01", TODAY).get("C001", "")


def test_a_quote_can_have_thirty_lines(api, tx):
    skus = [row["sku"] for row in api.get("/api/customers/C001/quote-items").json()]
    items = [{"sku": sku, "qty": 1} for sku in skus[:18]]
    packs = [{"promo_code": p.code, "packs": 1} for p in promo_packs.current_packs(tx)[:12]]
    assert api.post("/api/customers/C001/quotes", json={"items": items + packs}).status_code == 201
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `TEST_DB_NAME=meddemo_test_repeat TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests/test_orders.py -q`
Expected: FAIL（405／404：還沒有路由；30 列回 422）

- [ ] **Step 3: `orders.py`**

`backend/app/services/orders.py`：

```python
"""報價成交（docs/superpowers/specs/2026-10-07-repeat-last-order-design.md）：客戶下單了，把報價寫成今天的進貨。

交易紀錄與應收帳款都寫，報價改成已成交（ordered）。不能復原：之後的進貨間隔、帳齡、問答的數字都跟著變。
"""

import datetime as dt
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import Customer, Product, Receivable, SalesTransaction, SapQuotationDraft
from app.services import approvals
from app.services.customer_profile import app_today

# 《付款條件與帳齡管理》：連鎖 60 天，獨立藥局與診所 30 天。跟假資料（data/seed/generate.py 的 PAYMENT_TERMS）同一組數字
PAYMENT_DAYS = {"chain": 60, "independent": 30, "clinic": 30}


@dataclass
class Placed:
    order_no: str
    date: dt.date
    amount: float


def _fee(amount: Decimal, rate: float) -> Decimal:
    # 每筆交易的費用到元，跟假資料一樣
    return (amount * Decimal(str(rate))).quantize(Decimal("1"), ROUND_HALF_UP)


def place(session: Session, customer: Customer, quote_no: str) -> Placed | None:
    """把一張 draft 的報價寫成系統日的進貨；不是 draft（已經成交、還在等簽核、被駁回）回 None。

    先把狀態改掉再寫交易：兩個人同時按，後到的那個改不到任何一列，不會寫兩次。
    """
    lines = session.execute(
        update(SapQuotationDraft)
        .where(
            SapQuotationDraft.quote_no == quote_no, SapQuotationDraft.customer_id == customer.id,
            SapQuotationDraft.status == "draft",
        )
        .values(status="ordered")
        .returning(SapQuotationDraft.line_no, SapQuotationDraft.sku, SapQuotationDraft.qty, SapQuotationDraft.free_qty, SapQuotationDraft.amount)
    ).all()
    if not lines:
        return None
    lines.sort(key=lambda line: line.line_no)
    today = app_today(session)
    order_no = f"SO{today:%Y%m%d}-{customer.id}-{quote_no}"
    costs = dict(session.execute(select(Product.sku, Product.unit_cost).where(Product.sku.in_({l.sku for l in lines}))).all())
    # 費率跟合約頁同一個算法：近 90 天交易的加總相除；沒有交易就是 0
    terms = approvals.contract_terms(session, customer, today)
    for line in lines:
        # 到貨的數量：促銷的列是付錢的加送的
        qty = line.qty + line.free_qty
        session.add(SalesTransaction(
            order_no=order_no, customer_id=customer.id, date=today, sku=line.sku, qty=qty, amount=line.amount,
            cost=costs[line.sku] * qty, listing_fee=_fee(line.amount, terms["listing_fee_rate"]),
            channel_reward=_fee(line.amount, terms["channel_reward_rate"]),
        ))
    total = sum((line.amount for line in lines), Decimal(0))
    session.add(Receivable(
        invoice_no=order_no, customer_id=customer.id, invoice_date=today,
        due_date=today + dt.timedelta(days=PAYMENT_DAYS[customer.type]), amount=total, paid_date=None,
    ))
    session.flush()
    return Placed(order_no, today, float(total))
```

- [ ] **Step 4: 路由與列數上限**

`backend/app/api/customers.py`：
- import 改成 `from app.services import approvals, customer_profile, last_order, negotiation, orders, promo_packs, writeback`。
- `MAX_QUOTE_LINES` 那兩行換成：

```python
# 一張報價最多幾列（品項與促銷的口合計）：「照上次填」會把上次整張帶進來，忠孝店上次進貨就有 18 項，
# 加上上個月的口是 22 列；30 列以上多半是誤操作
MAX_QUOTE_LINES = 30
```

- `create_quote` 後面（`# ── 連鎖續約` 之前）加：

```python
class OrderPlaced(BaseModel):
    order_no: str
    date: date
    amount: float


@router.post("/{customer_id}/quotes/{quote_no}/order", response_model=OrderPlaced)
def place_order(session: SessionDep, customer_id: str, quote_no: str, user: CurrentUser):
    """客戶下單了：把這張報價寫成今天的進貨，交易紀錄與應收帳款都寫，報價改成已成交（services/orders.py）。不能復原。"""
    customer, _ = _load(session, customer_id, user, SHARING_LEVEL["quote"])
    placed = orders.place(session, customer, quote_no)
    if placed is None:
        exists = session.scalar(
            select(func.count()).select_from(SapQuotationDraft)
            .where(SapQuotationDraft.quote_no == quote_no, SapQuotationDraft.customer_id == customer.id)
        )
        if not exists:
            raise HTTPException(404, "找不到這張報價")
        raise HTTPException(409, "這張報價已經成交，或還在等簽核")
    session.commit()
    return OrderPlaced(**dataclasses.asdict(placed))
```

- [ ] **Step 5: 跑測試，確認通過**

Run: `TEST_DB_NAME=meddemo_test_repeat TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests/test_orders.py backend/tests/test_quotes.py backend/tests/test_today_route.py -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/orders.py backend/app/api/customers.py backend/tests/test_orders.py
git commit -m "Turn a quote into today's sale and invoice when the customer orders"
```

---

### Task 9: 前端型別與純函式

**Files:**
- Modify: `frontend/src/api/customers.ts`、`frontend/src/api/visits.ts`
- Create: `frontend/src/lib/last-order.ts`、`frontend/src/lib/last-order.test.ts`
- Create: `frontend/src/lib/repeat.ts`、`frontend/src/lib/repeat.test.ts`
- Modify: `frontend/src/lib/quote.ts`、`frontend/src/lib/quote.test.ts`（30 列上限）

**Interfaces:**
- Produces（`api/customers.ts`）：`LastOrderPack`、`LastOrderChange`、`LastOrderLine`、`LastOrder`、`getLastOrder(id, signal)`、`placeOrder(id, quoteNo)`、`OrderPlaced`。
- Produces（`api/visits.ts`）：`RepeatSnapshot`；`Visit.repeat_last: RepeatSnapshot | null`。
- Produces（`lib/last-order.ts`）：`LAST_ORDER_SHOWN = 5`、`lastOrderSources(last, separator?)`、`lastOrderLine(line)`、`splitLastOrder(lines, shown?) -> { visible, hidden }`、`repeatFill(last, skus, codes) -> RepeatFill`（`{ quantities, packCounts, extra: QuoteItem[], notes }`）。
- Produces（`lib/repeat.ts`）：`repeatHeader(snapshot) -> string | null`、`repeatNotes(item, snapshot) -> { warnings: string[]; notes: string[] }`。
- Produces（`lib/quote.ts`）：`MAX_QUOTE_LINES = 30`；`quoteBlocked` 超過時回「一張報價最多 30 項」。

- [ ] **Step 1: 型別與 API**

`frontend/src/api/customers.ts`，`createQuote` 後面加：

```ts
// 上次訂的（後端 services/last_order.py）：上一次進貨與上一張報價合起來，上次走口的列跟這一期比
export type LastOrderPack = { code: string; name: string; deal: string; buy_qty: number; free_qty: number; deal_price: number }
// terms：同一口條件變了；pack_gone：這一口沒了；promo_gone：這期沒有促銷。text 寫在那一列下面
export type LastOrderChange = { kind: "terms" | "pack_gone" | "promo_gone"; text: string; short: string }
export type LastOrderLine = {
  sku: string
  name: string
  spec: string
  unit: string
  // 這家的供貨價：照上次填加列時用
  supply_price: number
  // 沒走口是數量，走口是口數
  qty: number
  pack: LastOrderPack | null
  source: "order" | "quote"
  change: LastOrderChange | null
  // 這次照抄成什麼
  repeat: QuoteLineInput
}
export type LastOrder = {
  // 有用到的那次進貨與那張報價
  order: { order_no: string; date: string } | null
  quote: { quote_no: string; date: string } | null
  // 變了的列在前
  lines: LastOrderLine[]
  changed: number
}

/** 這家還沒訂過是 null */
export function getLastOrder(id: string, signal?: AbortSignal) {
  return request<LastOrder | null>(`/api/customers/${encodeURIComponent(id)}/last-order`, { signal })
}

export type OrderPlaced = { order_no: string; date: string; amount: number }

/** 客戶下單了：報價寫成今天的進貨與應收帳款，不能復原；已經成交或還在等簽核回 409 */
export function placeOrder(id: string, quoteNo: string) {
  return request<OrderPlaced>(
    `/api/customers/${encodeURIComponent(id)}/quotes/${encodeURIComponent(quoteNo)}/order`,
    { method: "POST" }
  )
}
```

`frontend/src/api/visits.ts`，`Visit` 前面加：

```ts
// 講了跟上次一樣、或跟上次比加減時，展開那一刻的快照（後端 services/repeat_order.py）
export type RepeatSnapshot = {
  said: string | null
  all: boolean
  except_skus: string[]
  except_names: string[]
  order: { order_no: string; date: string } | null
  quote: { quote_no: string; date: string } | null
  // 這家還沒訂過
  empty: boolean
  // 照上次抄了幾項（拿掉不要的之後）
  copied: number
  // promo_code 是這次抄成的口，不走促銷是 null
  changes: { sku: string; promo_code: string | null; text: string }[]
  relative: { sku: string; promo_code: string | null; last_qty: number; delta: number }[]
}
```

`Visit` 的 `oa_form_id` 後面加：

```ts
  // 沒講跟上次一樣、也沒講跟上次比的加減是 null
  repeat_last: RepeatSnapshot | null
```

- [ ] **Step 2: 寫失敗的測試**

`frontend/src/lib/last-order.test.ts`：

```ts
import { describe, expect, it } from "vitest"

import type { LastOrder, LastOrderLine } from "@/api/customers"
import { lastOrderLine, lastOrderSources, repeatFill, splitLastOrder } from "@/lib/last-order"

const MID = { code: "OLD-M", name: "40EXa眼藥水(中口)", deal: "<57+4>", buy_qty: 57, free_qty: 4, deal_price: 7980 }

function line(values: Partial<LastOrderLine>): LastOrderLine {
  return {
    sku: "HS-FO30", name: "魚油 30 入", spec: "30 粒", unit: "盒", supply_price: 405, qty: 32, pack: null,
    source: "order", change: null, repeat: { sku: "HS-FO30", qty: 32 }, ...values,
  }
}

const GONE = { kind: "pack_gone" as const, text: "中口這期沒了，只剩小口（買 22 送 1，$3,080）", short: "40EXa眼藥水(中口)沒了" }
const LAST: LastOrder = {
  order: { order_no: "SO20261005-C001", date: "2026-10-05" },
  quote: { quote_no: "Q20260930-0001", date: "2026-09-30" },
  lines: [
    line({ sku: "F763630", name: "40EXa眼藥水", unit: "瓶", qty: 1, pack: MID, source: "quote", change: GONE, repeat: { sku: "F763630", qty: 57 } }),
    line({}),
    line({ sku: "D120013", name: "威鎮凝膠", unit: "支", supply_price: 81, qty: 2, source: "quote", repeat: { sku: "D120013", qty: 22 } }),
    line({ sku: "F749579", name: "Premium眼藥水", qty: 1, source: "quote", repeat: { promo_code: "NOW-P", packs: 1 } }),
  ],
  changed: 1,
}

describe("lastOrderSources", () => {
  it("只寫有用到的那張", () => {
    expect(lastOrderSources(LAST)).toBe("10/5 進貨 · 9/30 報價")
    expect(lastOrderSources({ ...LAST, quote: null }, "、")).toBe("10/5 進貨")
  })
})

describe("lastOrderLine", () => {
  it("走口的寫口數，沒走口的寫數量與單位", () => {
    expect(lastOrderLine(LAST.lines[0])).toBe("40EXa眼藥水(中口) × 1 口")
    expect(lastOrderLine(LAST.lines[1])).toBe("魚油 30 入 × 32 盒")
  })
})

describe("splitLastOrder", () => {
  it("變了的全部列出，沒變的先列幾項", () => {
    const { visible, hidden } = splitLastOrder(LAST.lines, 2)
    expect(visible.map((l) => l.sku)).toEqual(["F763630", "HS-FO30", "D120013"])
    expect(hidden.map((l) => l.sku)).toEqual(["F749579"])
  })
})

describe("repeatFill", () => {
  it("先清成 0 再照上次填，頁面上沒有的品項加列", () => {
    const fill = repeatFill(LAST, ["HS-FO30", "HS-CA60", "F763630"], ["NOW-P", "NOW-S"])
    expect(fill.quantities).toEqual({ "HS-FO30": "32", "HS-CA60": "0", F763630: "57", D120013: "22" })
    expect(fill.packCounts).toEqual({ "NOW-P": "1", "NOW-S": "0" })
    expect(fill.extra).toEqual([{ sku: "D120013", name: "威鎮凝膠", spec: "30 粒", unit: "支", unit_price: 81, usual_qty: 0 }])
    expect(fill.notes).toEqual({ F763630: GONE.text })
  })

  it("同一個品項不走促銷出現兩次，數量相加", () => {
    const twice = { ...LAST, lines: [LAST.lines[0], line({ sku: "F763630", qty: 10, repeat: { sku: "F763630", qty: 10 } })] }
    expect(repeatFill(twice, ["F763630"], []).quantities).toEqual({ F763630: "67" })
  })
})
```

`frontend/src/lib/repeat.test.ts`：

```ts
import { describe, expect, it } from "vitest"

import type { IntentItem, RepeatSnapshot } from "@/api/visits"
import { repeatHeader, repeatNotes } from "@/lib/repeat"

const SNAPSHOT: RepeatSnapshot = {
  said: "跟上次一樣就好",
  all: true,
  except_skus: ["D120013"],
  except_names: ["威鎮凝膠"],
  order: { order_no: "SO20261005-C001", date: "2026-10-05" },
  quote: { quote_no: "Q20260930-0001", date: "2026-09-30" },
  empty: false,
  copied: 21,
  changes: [
    { sku: "F763630", promo_code: null, text: "中口這期沒了，只剩小口（買 22 送 1，$3,080）" },
    { sku: "C130082", promo_code: "NOW-J", text: "從買 10 送 2 變成買 15 送 2，一口 $800 → $1,200" },
  ],
  relative: [
    { sku: "F749579", promo_code: "NOW-P", last_qty: 1, delta: 1 },
    { sku: "HS-FO30", promo_code: null, last_qty: 32, delta: -5 },
    { sku: "HS-CA60", promo_code: null, last_qty: 0, delta: 6 },
    { sku: "HS-GL60", promo_code: null, last_qty: 18, delta: 0 },
  ],
}

const item = (sku: string, promo_code: string | null, unit: string | null): IntentItem => ({
  product_text: sku, sku, qty: 1, unit, promo_code,
})

describe("repeatHeader", () => {
  it("寫抄了幾項、照哪兩張、幾項促銷變了", () => {
    expect(repeatHeader(SNAPSHOT)).toBe("照上次的單抄了 21 項（10/5 進貨、9/30 報價），2 項促銷變了")
    expect(repeatHeader({ ...SNAPSHOT, changes: [], quote: null })).toBe("照上次的單抄了 21 項（10/5 進貨）")
    expect(repeatHeader({ ...SNAPSHOT, all: false })).toBeNull()
    expect(repeatHeader({ ...SNAPSHOT, empty: true })).toBeNull()
  })
})

describe("repeatNotes", () => {
  it("照品項與口對到變了什麼、加減多少", () => {
    expect(repeatNotes(item("F763630", null, "瓶"), SNAPSHOT)).toEqual({ warnings: [SNAPSHOT.changes[0].text], notes: [] })
    // 口對不上就不是同一列：這期的小口不是上次的不走促銷
    expect(repeatNotes(item("F763630", "NOW-S", "口"), SNAPSHOT)).toEqual({ warnings: [], notes: [] })
    expect(repeatNotes(item("F749579", "NOW-P", "口"), SNAPSHOT).notes).toEqual(["上次 1 口，這次多 1 口"])
    expect(repeatNotes(item("HS-FO30", null, "盒"), SNAPSHOT).notes).toEqual(["上次 32 盒，這次少 5 盒"])
    expect(repeatNotes(item("HS-CA60", null, "瓶"), SNAPSHOT).notes).toEqual(["上次沒有，這次加 6 瓶"])
    expect(repeatNotes(item("HS-GL60", null, "瓶"), SNAPSHOT).notes).toEqual(["照上次 18 瓶"])
  })
})
```

`frontend/src/lib/quote.test.ts` 的 `quoteBlocked` 測試加一行：

```ts
    expect(quoteBlocked({ ...base, plainCount: 20, packCount: 11 })).toBe("一張報價最多 30 項")
```

- [ ] **Step 3: 跑測試，確認失敗**

Run: `npm --prefix frontend ci && npm --prefix frontend test -- src/lib/last-order.test.ts src/lib/repeat.test.ts src/lib/quote.test.ts`
Expected: FAIL（找不到 `@/lib/last-order`、`@/lib/repeat`；`quoteBlocked` 回 null）

- [ ] **Step 4: 實作**

`frontend/src/lib/last-order.ts`：

```ts
import type { LastOrder, LastOrderLine, QuoteItem } from "@/api/customers"
import { formatDate } from "@/lib/format"

// 客戶檔案「上次訂的」：沒變的列先列幾項，其他收在「再看 N 項」
export const LAST_ORDER_SHOWN = 5

/** 有用到的那張：「10/5 進貨 · 9/30 報價」 */
export function lastOrderSources(last: LastOrder, separator = " · ") {
  return [last.order && `${formatDate(last.order.date)} 進貨`, last.quote && `${formatDate(last.quote.date)} 報價`]
    .filter(Boolean)
    .join(separator)
}

/** 一列：走口的「40EXa眼藥水(中口) × 1 口」，沒走口的「魚油 30 入 × 32 盒」 */
export function lastOrderLine(line: LastOrderLine) {
  return line.pack ? `${line.pack.name} × ${line.qty} 口` : `${line.name} × ${line.qty} ${line.unit}`
}

/** 變了的全部列出（後端已經排在前面），沒變的先列 shown 項，其他收起來 */
export function splitLastOrder(lines: LastOrderLine[], shown = LAST_ORDER_SHOWN) {
  const same = lines.filter((line) => !line.change)
  return { visible: [...lines.filter((line) => line.change), ...same.slice(0, shown)], hidden: same.slice(shown) }
}

export type RepeatFill = {
  quantities: Record<string, string>
  packCounts: Record<string, string>
  // 頁面上沒有那一列的品項（例如這期沒促銷的威鎮凝膠），加在常進品項最後面
  extra: QuoteItem[]
  // 變了的列下面那句話：不走促銷的列用料號，口用促銷品項編號
  notes: Record<string, string>
}

/**
 * 報價頁「照上次填」：數量與口數先全部清成 0，再照上次每一列抄成的寫法填；同一個品項不走促銷的數量相加。
 * skus 是頁面上已經有數量欄的料號（常進品項與「不走促銷」），codes 是這一期的每一口
 */
export function repeatFill(last: LastOrder, skus: string[], codes: string[]): RepeatFill {
  const quantities: Record<string, string> = Object.fromEntries(skus.map((sku) => [sku, "0"]))
  const packCounts: Record<string, string> = Object.fromEntries(codes.map((code) => [code, "0"]))
  const extra: QuoteItem[] = []
  const notes: Record<string, string> = {}
  for (const line of last.lines) {
    const repeat = line.repeat
    if ("promo_code" in repeat) {
      packCounts[repeat.promo_code] = String(Number(packCounts[repeat.promo_code] ?? 0) + repeat.packs)
      if (line.change) notes[repeat.promo_code] = line.change.text
      continue
    }
    if (!(repeat.sku in quantities)) {
      extra.push({ sku: line.sku, name: line.name, spec: line.spec, unit: line.unit, unit_price: line.supply_price, usual_qty: 0 })
      quantities[repeat.sku] = "0"
    }
    quantities[repeat.sku] = String(Number(quantities[repeat.sku]) + repeat.qty)
    if (line.change) notes[repeat.sku] = line.change.text
  }
  return { quantities, packCounts, extra, notes }
}
```

`frontend/src/lib/repeat.ts`：

```ts
import type { IntentItem, RepeatSnapshot } from "@/api/visits"
import { formatDate } from "@/lib/format"

/** 確認頁意向最上面：「照上次的單抄了 21 項（10/5 進貨、9/30 報價），2 項促銷變了」。沒講跟上次一樣、或沒訂過是 null */
export function repeatHeader(snapshot: RepeatSnapshot): string | null {
  if (!snapshot.all || snapshot.empty) return null
  const sources = [snapshot.order && `${formatDate(snapshot.order.date)} 進貨`, snapshot.quote && `${formatDate(snapshot.quote.date)} 報價`]
    .filter(Boolean)
    .join("、")
  const changed = snapshot.changes.length ? `，${snapshot.changes.length} 項促銷變了` : ""
  return `照上次的單抄了 ${snapshot.copied} 項（${sources}）${changed}`
}

/** 意向一項下面的話：warnings 是促銷變了什麼，notes 是跟上次比加減多少。照品項與口對，口不同就不是同一列 */
export function repeatNotes(item: IntentItem, snapshot: RepeatSnapshot) {
  const same = (entry: { sku: string; promo_code: string | null }) => entry.sku === item.sku && entry.promo_code === item.promo_code
  const unit = item.promo_code ? "口" : (item.unit ?? "")
  const notes = snapshot.relative.filter(same).map(({ last_qty, delta }) => {
    if (delta === 0) return `照上次 ${last_qty} ${unit}`
    if (last_qty === 0) return `上次沒有，這次加 ${delta} ${unit}`
    return `上次 ${last_qty} ${unit}，這次${delta > 0 ? "多" : "少"} ${Math.abs(delta)} ${unit}`
  })
  return { warnings: snapshot.changes.filter(same).map((change) => change.text), notes }
}
```

`frontend/src/lib/quote.ts`：`quoteBlocked` 前面加

```ts
// 一張報價最多幾列，跟後端 MAX_QUOTE_LINES 一樣：照上次填會把上次整張帶進來
export const MAX_QUOTE_LINES = 30
```

`quoteBlocked` 裡 `if (input.plainCount + input.packCount === 0) return "至少要有一項數量大於 0"` 後面加：

```ts
  if (input.plainCount + input.packCount > MAX_QUOTE_LINES) return `一張報價最多 ${MAX_QUOTE_LINES} 項`
```

- [ ] **Step 5: 跑測試與型別，確認通過**

Run: `npm --prefix frontend test -- src/lib/last-order.test.ts src/lib/repeat.test.ts src/lib/quote.test.ts && npm --prefix frontend run typecheck`
Expected: PASS（前端沒有自己拼 `Visit` 物件的地方，多一個欄位不影響其他檔案）

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/customers.ts frontend/src/api/visits.ts frontend/src/lib/last-order.ts frontend/src/lib/last-order.test.ts frontend/src/lib/repeat.ts frontend/src/lib/repeat.test.ts frontend/src/lib/quote.ts frontend/src/lib/quote.test.ts
git commit -m "Add the last-order and repeat-snapshot types and their pure helpers"
```

---

### Task 10: 客戶檔案「上次訂的」與「客戶下單了」

**Files:**
- Create: `frontend/src/components/change-note.tsx`
- Create: `frontend/src/components/last-order-section.tsx`
- Modify: `frontend/src/pages/customer.tsx`

**Interfaces:**
- Consumes: Task 9 的 `getLastOrder`、`placeOrder`、`lastOrderSources`、`lastOrderLine`、`splitLastOrder`。
- Produces: `<ChangeNote text className? />`、`<LastOrderSection customerId />`。

- [ ] **Step 1: 警示那一句**

`frontend/src/components/change-note.tsx`：

```tsx
import { TriangleAlert } from "lucide-react"

import { cn } from "@/lib/utils"

/** 促銷變了的那一句：客戶檔案「上次訂的」、報價頁照上次填、確認頁共用 */
export function ChangeNote({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn("flex items-start gap-1.5 text-xs leading-snug text-warning", className)}>
      <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
      <span className="min-w-0">{text}</span>
    </span>
  )
}
```

- [ ] **Step 2: 「上次訂的」那一區**

`frontend/src/components/last-order-section.tsx`：

```tsx
import { useEffect, useState } from "react"

import { getLastOrder, type LastOrder } from "@/api/customers"
import { ChangeNote } from "@/components/change-note"
import { lastOrderLine, lastOrderSources, splitLastOrder } from "@/lib/last-order"

type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; last: LastOrder | null }

/**
 * 客戶檔案「上次訂的」：上一次進貨與上一張報價合起來，促銷變了的列在前、底下寫變了什麼（services/last_order.py）。
 * 載不到只有這一區顯示失敗，客戶檔案其他區照常
 */
export function LastOrderSection({ customerId }: { customerId: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    getLastOrder(customerId, controller.signal)
      .then((last) => setState({ status: "ready", last }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" })
      })
    return () => controller.abort()
  }, [customerId, attempt])

  const last = state.status === "ready" ? state.last : null
  const { visible, hidden } = last ? splitLastOrder(last.lines) : { visible: [], hidden: [] }
  const rows = expanded ? [...visible, ...hidden] : visible

  return (
    <section className="rounded-2xl border-2 bg-card px-4 pb-3 shadow-lip">
      <div className="flex items-baseline justify-between gap-3 py-3">
        <p className="text-sm font-semibold">上次訂的</p>
        {last && <span className="text-xs text-muted-foreground">{lastOrderSources(last)}</span>}
      </div>
      {state.status === "loading" && <p className="pb-1 text-sm text-muted-foreground">載入上次訂的中…</p>}
      {state.status === "error" && (
        <p className="pb-1 text-sm text-muted-foreground">
          上次訂的沒有載入。
          <button type="button" className="ml-1 min-h-11 text-primary" onClick={() => setAttempt((n) => n + 1)}>
            重新載入
          </button>
        </p>
      )}
      {state.status === "ready" && !last && <p className="pb-1 text-sm text-muted-foreground">這家還沒有訂過。</p>}
      {last && (
        <>
          <ul className="flex flex-col">
            {rows.map((line, index) => (
              <li key={`${line.source}-${line.sku}-${line.pack?.code ?? "plain"}-${index}`} className="flex flex-col gap-1 border-t py-2 first:border-t-0">
                <span className="text-sm">{lastOrderLine(line)}</span>
                {line.change && <ChangeNote text={line.change.text} />}
              </li>
            ))}
          </ul>
          {hidden.length > 0 && !expanded && (
            <button type="button" onClick={() => setExpanded(true)} className="flex min-h-11 items-center text-sm text-primary">
              再看 {hidden.length} 項
            </button>
          )}
          <p className="pt-1 text-xs text-muted-foreground">錄音時講「跟上次一樣」，就照這份開報價；促銷變了的那幾項會照上面寫的改。</p>
        </>
      )}
    </section>
  )
}
```

- [ ] **Step 3: 放進客戶檔案，待處理事項加「客戶下單了」**

`frontend/src/pages/customer.tsx`：

import：
- `@/api/customers` 那段加 `placeOrder,`。
- 加 `import { LastOrderSection } from "@/components/last-order-section"`。
- 加 `import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"`。

`CustomerPage` 裡 `contract` 那行後面加：

```tsx
  // 待處理事項按了「客戶下單了」的那張報價，確認框開著；notice 是成交之後的提示
  const [ordering, setOrdering] = useState<CustomerProfile["open_quotes"][number] | null>(null)
  const [placing, setPlacing] = useState(false)
  const [orderError, setOrderError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function confirmOrder() {
    if (!ordering || placing) return
    setPlacing(true)
    setOrderError(null)
    try {
      const placed = await placeOrder(customerId, ordering.quote_no)
      setNotice(`報價 ${ordering.quote_no} 成交了，已寫進今天的進貨 ${formatMoney(placed.amount)}`)
      setOrdering(null)
      // 進貨數字、待處理事項、上次訂的都跟著變：整頁重新載入
      setAttempt((n) => n + 1)
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : "沒有寫成，請再試一次")
    } finally {
      setPlacing(false)
    }
  }
```

`{flash && …}` 那行後面加：

```tsx
        {notice && <p className="rounded-xl bg-primary/10 px-3 py-2 text-sm text-primary">{notice}</p>}
```

`<NextNotes … />` 後面加：

```tsx
        {/* 跟著整頁重新載入：成交之後「上次」就是剛成交的那張 */}
        <LastOrderSection key={attempt} customerId={customer.id} />
```

`<PendingItems profile={profile} />` 改成 `<PendingItems profile={profile} onOrder={(quote) => { setOrderError(null); setOrdering(quote) }} />`。

`</main>` 後面（底部按鈕列之前）加確認框：

```tsx
      <Dialog open={ordering !== null} onOpenChange={(open) => !open && !placing && setOrdering(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>把這張報價寫成今天的進貨？</DialogTitle>
            <DialogDescription>
              {ordering && `${ordering.quote_no}，${formatMoney(ordering.amount)}。`}會寫進交易紀錄與應收帳款，不能復原。
            </DialogDescription>
          </DialogHeader>
          {orderError && <p className="text-sm text-destructive">{orderError}</p>}
          <DialogFooter>
            <Button variant="outline" className="h-11" disabled={placing} onClick={() => setOrdering(null)}>
              不要
            </Button>
            <Button className="h-11" disabled={placing} onClick={confirmOrder}>
              {placing ? "寫入中…" : "客戶下單了"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

`PendingItems` 換成（列的型別多一個 `quote`，報價那幾列多按鈕或說明）：

```tsx
type OpenQuote = CustomerProfile["open_quotes"][number]

function PendingItems({ profile, onOrder }: { profile: CustomerProfile; onOrder: (quote: OpenQuote) => void }) {
  const rows: { key: string; tone: Tone; title: string; meta: string; tag?: string; quote?: OpenQuote }[] = [
    ...profile.commitments.map((item) => ({
      key: `commitment-${item.visit_id}`,
      tone: (item.overdue ? "alert" : "warn") as Tone,
      title: `${item.by === "us" ? "我方答應" : "客戶答應"}：${item.text}`,
      meta: item.due ? `${formatDate(item.due)} ${item.overdue ? "已過期" : "到期"}` : "沒有期限",
    })),
    ...profile.complaints.map((item) => ({
      key: `complaint-${item.visit_id}`,
      tone: "warn" as Tone,
      title: `客訴：${item.text}`,
      meta: formatDate(item.visit_date),
    })),
    // 直接開的報價沒有 visit_id，用報價單號分辨。折扣還在等簽核的標出來：核准之前不能送給客戶，也不能成交
    ...profile.open_quotes.map((item) => ({
      key: `quote-${item.quote_no}`,
      tone: undefined as Tone,
      title: `報價草稿 ${item.quote_no}：${item.items}`,
      meta: formatMoney(item.amount),
      tag: item.status === "pending_approval" ? "待簽核" : undefined,
      quote: item,
    })),
  ]
  return (
    <section className="rounded-2xl border-2 bg-card px-4 pb-1 shadow-lip">
      <p className="py-3 text-sm font-semibold">待處理事項</p>
      {rows.length === 0 && <p className="pb-3 text-sm text-muted-foreground">沒有待處理的事項。</p>}
      {rows.map((row) => (
        <div key={row.key} className="flex flex-col gap-1 border-t py-2">
          <div className="flex min-h-8 items-center gap-3">
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                row.tone === "alert" ? "bg-destructive" : row.tone === "warn" ? "bg-warning" : "bg-muted-foreground/40"
              )}
            />
            <p className="flex-1 text-sm">
              {row.title}
              {row.tag && (
                <Badge variant="outline" className="ml-2 align-middle">
                  {row.tag}
                </Badge>
              )}
            </p>
            <span className={cn("shrink-0 text-xs", row.tone === "alert" ? "text-destructive" : "text-muted-foreground")}>{row.meta}</span>
          </div>
          {row.quote?.status === "draft" && (
            <Button variant="outline" className="ml-5 h-11 self-start" onClick={() => onOrder(row.quote!)}>
              客戶下單了
            </Button>
          )}
          {row.quote?.status === "pending_approval" && <p className="ml-5 text-xs text-muted-foreground">核准後才能成交</p>}
        </div>
      ))}
    </section>
  )
}
```

- [ ] **Step 4: 型別與 lint**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend run lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/change-note.tsx frontend/src/components/last-order-section.tsx frontend/src/pages/customer.tsx
git commit -m "Show what the store ordered last time on the profile and let the rep mark a quote ordered"
```

---

### Task 11: 報價頁「照上次填」

**Files:**
- Modify: `frontend/src/pages/quote.tsx`

**Interfaces:**
- Consumes: `getLastOrder`、`repeatFill`、`lastOrderSources`、`ChangeNote`。

- [ ] **Step 1: 實作**

`frontend/src/pages/quote.tsx`：

import：
- `@/api/customers` 那段加 `getLastOrder,` 與 `type LastOrder,`。
- 加 `import { ChangeNote } from "@/components/change-note"` 與 `import { lastOrderSources, repeatFill } from "@/lib/last-order"`。

`QuotePage` 的 state 加：

```tsx
  // 上次訂的：沒訂過或載不到是 null，就不顯示「照上次填」
  const [last, setLast] = useState<LastOrder | null>(null)
  // 照上次填加的列（頁面上本來沒有的品項）與變了的那幾句（不走促銷用料號、口用促銷品項編號）
  const [extraItems, setExtraItems] = useState<QuoteItem[]>([])
  const [notes, setNotes] = useState<Record<string, string>>({})
```

原本的 `useEffect` 後面加一個：

```tsx
  // 上次訂的另外問：問不到就少一個按鈕，不擋開報價
  useEffect(() => {
    const controller = new AbortController()
    getLastOrder(customerId, controller.signal)
      .then(setLast)
      .catch(() => {
        if (!controller.signal.aborted) setLast(null)
      })
    return () => controller.abort()
  }, [customerId])
```

`const items = …` 那行改成：

```tsx
  const baseItems = state.status === "ready" ? state.items : []
  // 照上次填加的列接在常進品項後面，算法跟常進品項一樣
  const items = [...baseItems, ...extraItems]
```

`hasLines` 不用改（`items` 已經含加的列）。

`submit` 前面加：

```tsx
  function fillFromLast() {
    if (!last) return
    const skus = [...baseItems, ...extraPlain].map((item) => item.sku)
    const codes = (promotion?.products ?? []).flatMap((p) => p.packs.map((pack) => pack.code))
    const fill = repeatFill(last, skus, codes)
    setQuantities(fill.quantities)
    setPackCounts(fill.packCounts)
    setExtraItems(fill.extra)
    setNotes(fill.notes)
  }
```

`{items.length > 0 && (` 那段的最前面（說明文字 `<p>` 之前）加按鈕；整段改成：

```tsx
        {state.status === "ready" && last && (
          <Button variant="outline" className="h-11" onClick={fillFromLast}>
            照上次填（{lastOrderSources(last, "、")}）
          </Button>
        )}
        {items.length > 0 && (
          <>
            <p className="text-xs text-muted-foreground">這家近半年常進的品項，單價是給這家的供貨價。填了數量的才會列進報價。</p>
            <ul className="flex flex-col gap-2">
              {lines.map(({ item, qty }) => (
                <li key={item.sku} className={cn("rounded-xl border-2 bg-card px-4 py-3 shadow-lip", qty === 0 && "bg-muted/60")}>
                  {/* …原本的品項名稱、數量輸入框照舊… */}
                  {item.usual_qty > 0 && (
                    <button
                      type="button"
                      onClick={() => setQuantities((current) => ({ ...current, [item.sku]: String(item.usual_qty) }))}
                      className="mt-1 -ml-2 flex min-h-11 items-center rounded-lg px-2 text-xs text-primary active:bg-muted"
                    >
                      填入常進數量 {item.usual_qty} {item.unit}
                    </button>
                  )}
                  {notes[item.sku] && <ChangeNote text={notes[item.sku]} className="mt-1" />}
                </li>
              ))}
            </ul>
          </>
        )}
```

（「…原本的…」那兩個 `<div>` 不動，只把「填入常進數量」包上 `item.usual_qty > 0 &&`——照上次加的列沒有常進數量——再加 `ChangeNote` 那行。）

`<PromotionSection … />` 多傳 `notes={notes}`；`PromotionSectionProps` 加 `notes: Record<string, string>`，函式參數解構加 `notes`。在每一口的 `<li>` 裡、口數那一列 `<div className="mt-2 flex items-center gap-2">…</div>` 後面加：

```tsx
                      {notes[pack.code] && <ChangeNote text={notes[pack.code]} className="mt-1" />}
```

「不走促銷」那個 `<li>` 的數量那一列後面加：

```tsx
                    {notes[product.sku] && <ChangeNote text={notes[product.sku]} className="mt-1" />}
```

- [ ] **Step 2: 型別與 lint**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend run lint && npm --prefix frontend test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/quote.tsx
git commit -m "Fill the quote from the last order with one tap"
```

---

### Task 12: 確認頁照上次展開的意向

**Files:**
- Create: `frontend/src/components/visit/intent-lines.tsx`
- Modify: `frontend/src/components/visit/confirm-view.tsx`

**Interfaces:**
- Consumes: `repeatHeader`、`repeatNotes`、`intentLine`（`field-format.ts`）、`ChangeNote`、`Visit.repeat_last`。
- Produces: `<IntentLines visit packs />`。

- [ ] **Step 1: 一項一行的意向**

`frontend/src/components/visit/intent-lines.tsx`：

```tsx
import type { PromotionItem } from "@/api/promotions"
import type { Visit } from "@/api/visits"
import { ChangeNote } from "@/components/change-note"
import { intentLine } from "@/components/visit/field-format"
import { repeatHeader, repeatNotes } from "@/lib/repeat"

/**
 * 意向照上次展開時，一項一行，下面寫促銷變了什麼與跟上次比加減多少（lib/repeat.ts）。
 * 照品項與口對快照；業務刪掉的那一列，那句話就不出現
 */
export function IntentLines({ visit, packs }: { visit: Visit; packs: Record<string, PromotionItem> }) {
  const snapshot = visit.repeat_last
  if (!snapshot) return null
  const items = visit.fields.intent ?? []
  const header = repeatHeader(snapshot)
  return (
    <span className="flex flex-col gap-1.5">
      {header && <span className="text-xs font-normal text-muted-foreground">{header}</span>}
      {snapshot.all && snapshot.except_names.length > 0 && (
        <span className="text-xs font-normal text-muted-foreground">這次不要：{snapshot.except_names.join("、")}</span>
      )}
      {items.length === 0 && <span className="font-normal text-muted-foreground">沒提到</span>}
      {items.map((item, index) => {
        const { warnings, notes } = repeatNotes(item, snapshot)
        return (
          <span key={`${item.sku}-${item.promo_code}-${index}`} className="flex flex-col gap-0.5">
            <span>{intentLine(item, item.promo_code ? packs[item.promo_code] : undefined)}</span>
            {warnings.map((text) => (
              <ChangeNote key={text} text={text} className="font-normal" />
            ))}
            {notes.map((text) => (
              <span key={text} className="text-xs font-normal text-muted-foreground">
                {text}
              </span>
            ))}
          </span>
        )
      })}
    </span>
  )
}
```

- [ ] **Step 2: 放進確認頁**

`frontend/src/components/visit/confirm-view.tsx`：
- 加 `import { IntentLines } from "@/components/visit/intent-lines"`。
- `FieldRow` 用 `children ?? value` 決定顯示什麼；放兩個條件子節點的話 React 會包成陣列（`[null, null]` 不是 null），
  摘要就不顯示了。所以在呼叫端先算好一個 `detail`。`FIELD_ORDER.map` 那整段換成：

```tsx
        {FIELD_ORDER.map((key) => {
          // 有給就取代純文字摘要：競品要標「首次」，意向照上次展開時一項一行、寫變了什麼
          const detail =
            key === "competitor" && visit.fields.competitor?.length ? (
              <CompetitorNames visit={visit} />
            ) : key === "intent" && visit.repeat_last ? (
              <IntentLines visit={visit} packs={packs} />
            ) : null
          return (
            <FieldRow
              key={key}
              label={FIELD_LABEL[key]}
              value={summarize(key, visit.fields, packs)}
              unsourced={visit.unsourced.includes(key)}
              onEdit={() => setEditing(key)}
            >
              {detail}
            </FieldRow>
          )
        })}
```

（`FieldRow` 裡的 `{children ?? value ?? "沒提到"}` 不改：`detail` 是 `null` 時照舊顯示摘要。）

- [ ] **Step 3: 型別、lint、測試**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend run lint && npm --prefix frontend test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/visit/intent-lines.tsx frontend/src/components/visit/confirm-view.tsx
git commit -m "List the repeated intent line by line on the confirm page with what changed"
```

---

### Task 13: 文件、真的 Gemini、整套跑起來看

**Files:**
- Modify: `docs/visit-fields.md`、`README.md`
- Create（不 commit）: scratchpad 裡的 `check_repeat_extraction.py`、`drive_repeat.mjs`

- [ ] **Step 1: 文件**

`docs/visit-fields.md` 的「規則」第 10 條後面加：

```markdown
11. **講「跟上次一樣」不是欄位，是 `repeat_last`。** AI 在六個欄位旁邊另外輸出 `repeat_last`：`all` 是有沒有講「跟上次一樣」「照上次」「老樣子」，`except_skus` 是這次不要的品項，`relative` 是跟上次比的加減（`delta` 是口數或數量，少是負數，「照上次」是 0）。講了確定的總數（「魚油這次 40 盒」）才填 `intent`。要抄哪幾列、這期對應哪一口、變了什麼都由後端照上次訂的算（`services/repeat_order.py`），展開後的結果寫進 `intent`，快照存在 `visit.repeat_last`（見 `docs/superpowers/specs/2026-10-07-repeat-last-order-design.md`）。

    | 業務說 | 抽出來 |
    |---|---|
    | 跟上次一樣就好 | `all` true |
    | 跟上次一樣，魚油改 40 盒 | `all` true；`intent` 魚油 30 入 × 40 盒 |
    | 老樣子，威鎮這次先不要 | `all` true；`except_skus` 威鎮凝膠 |
    | 跟上次一樣，再加一口小口 Premium | `all` true；`relative` Premium眼藥水小口 +1 |
    | 魚油比上次少 5 盒 | `all` false；`relative` 魚油 30 入 −5 |
    | 人工淚液照上次，其他不用 | `all` false；`relative` 人工淚液 0 |
```

`README.md`：
- 「口述到回寫」第 2 點的「備忘」那個子項目後面加：

```markdown
   - **跟上次一樣**（`docs/superpowers/specs/2026-10-07-repeat-last-order-design.md`）：講「跟上次一樣」「照上次」就照上次訂的開這個月的報價，「威鎮這次先不要」拿掉那一項，「Premium 再加一口」照上次的口數加。上次訂的是上一次進貨與上一張報價合起來：新的那張為主，舊的只補新的沒有的品項（相差 31 天以內）。上次走的口這期變了的，條件變了照新條件、口沒了或促銷沒了改成不走促銷、數量照上次付錢的數量，確認頁每一項下面寫變了什麼。
```

- 「客戶檔案與談判卡」的「開報價」那一條的子項目最後加：

```markdown
  - **照上次填**：一鍵把上次訂的帶進來（數量與口數先清成 0），頁面上沒有的品項加在常進品項後面，促銷變了的列寫變了什麼。一張報價最多 30 列。
  - **客戶下單了**：待處理事項裡每張報價草稿有這個按鈕，按了寫成今天的進貨（交易紀錄與應收帳款，連鎖 60 天、其他 30 天到期），報價改成已成交，不能復原。之後的進貨間隔、帳齡、問答的數字都跟著變；等簽核的報價要先核准。
  - **上次訂的**：客戶檔案一區，列上次訂的每一項，促銷這期變了的排前面、寫變了什麼；「進門前三分鐘」也多一句「上次訂的有 3 項這期促銷變了：…」。
```

- 目錄說明在 `backend/app/services/promo_packs.py` 那一行後面加：

```
backend/app/services/last_order.py 上次訂的：上一次進貨與上一張報價合起來，上次走口的列跟這一期比
backend/app/services/repeat_order.py 錄音講「跟上次一樣」：照上次訂的展開下單意向、做快照
backend/app/services/orders.py     報價成交：寫進交易紀錄與應收帳款
```

- [ ] **Step 2: 全部後端與前端測試**

Run: `TEST_DB_NAME=meddemo_test_repeat TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests -q`
Run: `npm --prefix frontend test && npm --prefix frontend run typecheck && npm --prefix frontend run lint && npm --prefix frontend run build`
Expected: 全部 PASS

- [ ] **Step 3: 真的 Gemini 抽七句**

把主 checkout 的 `backend/.env` 複製進 worktree 的 `backend/.env`（不讀內容），在 scratchpad 寫 `check_repeat_extraction.py`，照 `visit_processing._extract` 的做法：`current_packs` → `LLMFieldExtractor(get_llm()).extract` → `validate_fields` → `drop_unknown_packs` → `repeat_order.normalize`，印出每句的 `repeat_last` 與 `intent`。七句：

1. 「跟店長聊了一下，跟上次一樣就好。」→ `all` true，`intent` null
2. 「跟上次一樣，魚油改 40 盒。」→ `all` true；`intent` HS-FO30 × 40
3. 「老樣子，威鎮這次先不要。」→ `all` true；`except_skus` ["D120013"]
4. 「跟上次一樣，再加一口小口 Premium。」→ `all` true；`relative` F749579、這期 Premium 小口、+1
5. 「魚油比上次少 5 盒。」→ `all` false；`relative` HS-FO30 −5
6. 「人工淚液照上次，其他不用。」→ `all` false；`relative` 人工淚液 0
7. 「他想先進魚油二十盒。」→ `repeat_last` null；`intent` HS-FO30 × 20

跑完刪掉 worktree 的 `backend/.env`。
Expected: 七句都沒有 schema 錯誤；`repeat_last` 照期望。不符合的句子調整第 11、12 條規則的措辭後重跑。

- [ ] **Step 4: 整套跑起來，用 headless Chrome 走一遍**

照 `run-stack-from-a-worktree` 的做法：建 `meddemo_repeat_dev` 資料庫並灌假資料，API 開在 8013（`REDIS_URL=redis://127.0.0.1:6379/8`、自己給 `JWT_SECRET`），前端 build 之後用靜態伺服器與臨時 proxy。headless Chrome 每段不超過 20 秒，林昱辰（U01）登入：

1. 忠孝店（C001）客戶檔案：截圖確認「進門前三分鐘」第二句、「上次訂的」那一區（三句警示在前、「再看 N 項」）。
2. 報價頁按「照上次填」：確認 40EXa 不走促銷 57、金舒胃平小口 3 口、威鎮凝膠加在常進品項最後、三句警示；開 SAP 報價草稿。
3. 回客戶檔案，待處理事項那張按「客戶下單了」→ 確認框 → 確認；看提示、待處理事項少一張、近 3 月進貨數字變了、「上次訂的」變成剛成交那張。
4. 換士林店（C009）錄音頁，手打逐字稿「跟上次一樣，Premium 再加一口」（沒有語音辨識時的手動流程），確認頁看第一行「照上次的單抄了 … 項」與 Premium「上次 2 口，這次多 1 口」，確認送出。

Expected: 畫面跟上面一致；手機寬度（390px）沒有橫向捲動；深色模式（`meddemo:skin`）警示字看得清楚。跑完刪掉複製進來的 `.env` 與臨時 vite 設定。

- [ ] **Step 5: Commit**

```bash
git add docs/visit-fields.md README.md
git commit -m "Describe same-as-last-time, filling from the last order and placing orders"
```
