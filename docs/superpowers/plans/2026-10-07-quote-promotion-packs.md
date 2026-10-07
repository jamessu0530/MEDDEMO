# 報價照促銷的口開 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 報價頁與拜訪錄音都能照促銷的「口」（小口、中口、大口）開 SAP 報價草稿，一口照每口售價、不再打折。

**Architecture:** 新增 `services/promo_packs.py` 讀語意層 `v_promotion_item`，集中「這一期有哪些口」「照編號查一口」「一口換算成報價的一列」。`sap_quotation_draft` 加四欄（`promo_code`、`packs`、`free_qty`、`amount`），報價頁 API、拜訪回寫、客戶檔案、今日路線都改用這幾欄。拜訪意向多一格 `promo_code`，AI 提示多一張這一期的促銷表。

**Tech Stack:** FastAPI、SQLAlchemy 2、Postgres（語意層 View）、pytest；React 19、TypeScript、Vitest。

**Spec:** `docs/superpowers/specs/2026-10-07-quote-promotion-packs-design.md`

## Global Constraints

- 哪一期：`v_promotion_item.status = '進行中'`（以 `app_today()` 判斷）。測試的系統日是 2026-10-28，進行中的是 202610 那一期。
- 促銷的列不打折，`discount_pct` 記 0；整張報價的折扣只套在沒促銷的列。
- 一張報價最多 20 列（`MAX_QUOTE_LINES`），兩種列合計。
- 金額讀 `sap_quotation_draft.amount`，不要用單價 × 數量回推。
- `models.py` 改了，部署時重建資料庫並重灌假資料（`schema_version` 指紋），不寫 migration。
- 程式註解與錯誤訊息用繁體中文，跟附近的程式一樣的密度與口吻。畫面不用 emoji。
- 後端測試指令（隔離的資料庫與 Redis，不動其他工作階段）：
  `TEST_DB_NAME=meddemo_test_promo TEST_REDIS_URL=redis://127.0.0.1:6379/13 uv run --project backend pytest <檔案> -q`
- 前端測試：`npm --prefix frontend test -- <檔案>`；型別：`npm --prefix frontend run typecheck`。

---

### Task 1: 報價的每一列記下自己的金額

**Files:**
- Modify: `backend/app/models.py`（`SapQuotationDraft`）
- Modify: `data/seed/generate.py`（`build_visits` 的報價草稿）
- Modify: `backend/app/services/writeback.py`（`_write_sap`）
- Modify: `backend/app/api/customers.py`（`create_quote`）
- Modify: `backend/app/services/customer_profile.py`（`_open_quotes`）
- Test: `backend/tests/test_quotes.py`、`backend/tests/test_seed.py`

**Interfaces:**
- Produces: `SapQuotationDraft.promo_code: str | None`、`packs: int | None`、`free_qty: int`（預設 0）、`amount: Decimal`（NOT NULL）。

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_quotes.py`，接在 `test_an_opened_quote_shows_up_in_the_profile` 後面：

```python
def test_each_quote_line_keeps_its_own_amount(client, engine):
    quote = client.post("/api/customers/C001/quotes", json={"items": [{"sku": "HS-FO30", "qty": 20}]}).json()
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT amount, discount_pct, free_qty, promo_code, packs FROM sap_quotation_draft WHERE quote_no = :q"),
            {"q": quote["quote_no"]},
        ).one()
    # 康泰忠孝店是連鎖：魚油 30 入 405 元 × 20
    assert (float(row.amount), float(row.discount_pct), row.free_qty, row.promo_code, row.packs) == (8100, 0, 0, None, None)
```

`backend/tests/test_seed.py`，在 `test_visit_fields_follow_schema_and_quote_the_transcript` 最後加：

```python
    # 歷史報價草稿沒有促銷：每一列的金額就是單價 × 數量
    assert rows(db, "SELECT count(*) FROM sap_quotation_draft WHERE amount <> unit_price * qty OR promo_code IS NOT NULL")[0][0] == 0
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `TEST_DB_NAME=meddemo_test_promo TEST_REDIS_URL=redis://127.0.0.1:6379/13 uv run --project backend pytest backend/tests/test_quotes.py::test_each_quote_line_keeps_its_own_amount -q`
Expected: FAIL（`column "amount" does not exist`）

- [ ] **Step 3: 改資料表**

`backend/app/models.py` 的 `SapQuotationDraft` 整段換成：

```python
class SapQuotationDraft(Base):
    __tablename__ = "sap_quotation_draft"
    __table_args__ = (
        UniqueConstraint("visit_id", "line_no"),
        UniqueConstraint("quote_no", "line_no"),
        CheckConstraint("qty > 0", name="qty_positive"),
        # 促銷的列同時有「哪一口」與「幾口」，沒促銷的列兩個都是 NULL
        CheckConstraint("(promo_code IS NULL) = (packs IS NULL) AND (packs IS NULL OR packs > 0)", name="promo_packs"),
        one_of("status", QUOTE_STATUSES, "status"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    # 同一張報價的品項共用一個單號。拜訪回寫開的用拜訪編號；在客戶檔案直接開的用 Q 開頭的單號
    quote_no: Mapped[str] = mapped_column(index=True)
    # 客戶檔案直接開的報價沒有拜訪（原型客戶檔案的「開報價」）
    visit_id: Mapped[str | None] = mapped_column(ForeignKey("visit.id"))
    created_by: Mapped[str | None] = mapped_column(ForeignKey("app_user.id"))
    line_no: Mapped[int]
    customer_id: Mapped[str] = mapped_column(ForeignKey("customer.id"))
    sku: Mapped[str] = mapped_column(ForeignKey("product.sku"))
    # 沒促銷的列是數量；促銷的列是付錢的數量（每口買的 × 口數）
    qty: Mapped[int]
    # 沒促銷的列是折扣後的單價；促銷的列是每口售價 ÷ 每口買的數量，只供參考，金額看 amount
    unit_price: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    # 這一列打的折扣：沒促銷的列記整張報價的折扣，促銷的列不打折記 0
    discount_pct: Mapped[Decimal] = mapped_column(Numeric(4, 1), server_default="0")
    # 哪一口（促銷品項編號）與幾口；沒促銷的列都是 NULL
    promo_code: Mapped[str | None] = mapped_column(ForeignKey("promotion_item.code"))
    packs: Mapped[int | None]
    # 同品送了幾個（每口送的 × 口數）
    free_qty: Mapped[int] = mapped_column(default=0, server_default="0")
    # 這一列的金額，到分。有的口除不盡（骨營粉劑直走 7 盒 $3,100），不能用單價 × 數量回推
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    status: Mapped[str] = mapped_column(server_default="draft")
    created_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())
```

- [ ] **Step 4: 假資料補金額**

`data/seed/generate.py` 的 `build_visits`，報價草稿那一段換成：

```python
        for line_no, item in enumerate(fields["intent"] or [], start=1):
            price = round(products[item["sku"]]["unit_price"] * PRICE_FACTOR[c["type"]])
            tables["sap_quotation_draft"].append({
                "quote_no": visit_id, "visit_id": visit_id, "line_no": line_no, "customer_id": c["id"], "sku": item["sku"],
                "created_by": c["owner_user_id"],
                "qty": item["qty"], "unit_price": price, "amount": price * item["qty"],
                "created_at": confirmed_at,
            })
```

- [ ] **Step 5: 拜訪回寫記金額**

`backend/app/services/writeback.py` 的 `_write_sap` 迴圈換成：

```python
    for line_no, item in enumerate(items, start=1):
        if not item.get("qty") or item.get("sku") not in prices:
            raise ValueError(f"意向第 {line_no} 項缺少品項或數量")
        # 報價以標準供貨價為基準（連鎖 9 折、獨立藥局 95 折、診所原價），與歷史報價一致
        price = supply_price(prices[item["sku"]], customer_type)
        session.execute(
            insert(SapQuotationDraft).values(
                quote_no=visit.id, visit_id=visit.id, line_no=line_no, customer_id=visit.customer_id,
                sku=item["sku"], qty=item["qty"], created_by=visit.user_id,
                unit_price=price, amount=price * item["qty"],
            ).on_conflict_do_nothing(index_elements=["visit_id", "line_no"])
        )
```

- [ ] **Step 6: 開報價記金額與折扣**

`backend/app/api/customers.py` 的 `create_quote`，`SapQuotationDraft(...)` 那一段加上 `amount`：

```python
        lines = [
            SapQuotationDraft(
                quote_no=quote_no, visit_id=None, created_by=user.id, line_no=n, customer_id=customer.id,
                sku=line.sku, qty=line.qty, unit_price=prices[line.sku], amount=prices[line.sku] * line.qty,
                discount_pct=body.discount_pct, status="pending_approval" if level else "draft",
            )
            for n, line in enumerate(body.items, start=1)
        ]
```

回傳的 `QuoteLine` 改用 `amount=float(l.amount)`。

- [ ] **Step 7: 客戶檔案加總記下的金額**

`backend/app/services/customer_profile.py` 的 `_open_quotes`：select 把 `SapQuotationDraft.unit_price` 換成 `SapQuotationDraft.amount`，迴圈裡：

```python
        quote.amount += float(row.amount)
```

- [ ] **Step 8: 跑測試，確認通過**

Run: `TEST_DB_NAME=meddemo_test_promo TEST_REDIS_URL=redis://127.0.0.1:6379/13 uv run --project backend pytest backend/tests/test_quotes.py backend/tests/test_seed.py backend/tests/test_visits.py backend/tests/test_customer_profile.py -q`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add backend/app/models.py data/seed/generate.py backend/app/services/writeback.py backend/app/api/customers.py backend/app/services/customer_profile.py backend/tests/test_quotes.py backend/tests/test_seed.py
git commit -m "Record each quote line's amount and leave room for promotion packs"
```

---

### Task 2: 促銷的口：這一期有哪些、照編號查、換算成一列

**Files:**
- Create: `backend/app/services/promo_packs.py`
- Test: `backend/tests/test_promo_packs.py`

**Interfaces:**
- Produces:
  - `Pack`（frozen dataclass）：`code: str, promotion_name: str, group_name: str, name: str, sku: str, deal: str, buy_qty: int, free_qty: int, deal_price: Decimal`
  - `current_packs(session) -> list[Pack]`：進行中的那一期，照編號排。
  - `packs_by_code(session, codes: Iterable[str]) -> dict[str, Pack]`：不管哪一期。
  - `PackLine`（frozen dataclass）：`qty: int, free_qty: int, unit_price: Decimal, amount: Decimal`
  - `pack_line(pack: Pack, packs: int) -> PackLine`
  - `line_label(product_name: str, qty: int, pack_name: str | None, packs: int | None) -> str`

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_promo_packs.py`：

```python
"""促銷的口：這一期有哪些、照編號查、一口換算成報價的一列。"""

from decimal import Decimal

from sqlalchemy.orm import Session

from app.services import promo_packs


def test_current_packs_are_the_running_period(engine):
    with Session(engine) as session:
        packs = promo_packs.current_packs(session)
    # 系統日 2026-10-28：進行中的是 202610 那一期
    assert {p.promotion_name for p in packs} == {"202610保藥特搭活動"}
    small = next(p for p in packs if p.name == "Premium眼藥水(小口)")
    assert (small.sku, small.buy_qty, small.free_qty, small.deal_price) == ("F749579", 22, 1, Decimal("5500"))
    assert [p.code for p in packs] == sorted(p.code for p in packs)


def test_packs_can_be_found_by_code_in_any_period(engine):
    with Session(engine) as session:
        # PP-027942 是照搬的 202608 那一期，已經結束
        found = promo_packs.packs_by_code(session, ["PP-027942", "PP-NOPE"])
        assert promo_packs.packs_by_code(session, []) == {}
    assert list(found) == ["PP-027942"] and found["PP-027942"].name == "Premium眼藥水(小口)"


def test_a_pack_becomes_one_quote_line(engine):
    with Session(engine) as session:
        packs = {p.name: p for p in promo_packs.current_packs(session)}
    line = promo_packs.pack_line(packs["Premium眼藥水(小口)"], 2)
    assert line == promo_packs.PackLine(qty=44, free_qty=2, unit_price=Decimal("250.00"), amount=Decimal("11000"))
    # 除不盡的口：金額照每口售價，單價只到分
    powder = promo_packs.pack_line(packs["骨營粉劑"], 1)
    assert (powder.qty, powder.free_qty, powder.unit_price, powder.amount) == (7, 0, Decimal("442.86"), Decimal("3100"))


def test_line_label():
    assert promo_packs.line_label("魚油 30 入", 20, None, None) == "魚油 30 入 × 20"
    assert promo_packs.line_label("Premium眼藥水", 22, "Premium眼藥水(小口)", 1) == "Premium眼藥水(小口) × 1 口"
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `TEST_DB_NAME=meddemo_test_promo TEST_REDIS_URL=redis://127.0.0.1:6379/13 uv run --project backend pytest backend/tests/test_promo_packs.py -q`
Expected: FAIL（`cannot import name 'promo_packs'`）

- [ ] **Step 3: 實作**

`backend/app/services/promo_packs.py`：

```python
"""促銷的口：報價與拜訪意向照口開（docs/superpowers/specs/2026-10-07-quote-promotion-packs-design.md）。

一口是促銷的一個購買單位：買 buy_qty 個、同品送 free_qty 個，整口 deal_price。哪一期照系統日進行中的那一期，
跟促銷頁、問答一樣讀語意層的 v_promotion_item，數字只有一份。
"""

from collections.abc import Iterable
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

COLUMNS = """item_code AS code, promotion_name, group_name, item_name AS name, sku, deal, buy_qty, free_qty, deal_price"""


@dataclass(frozen=True)
class Pack:
    code: str
    promotion_name: str
    group_name: str
    # 促銷品項名稱，口數寫在括號裡，例如 Premium眼藥水(小口)
    name: str
    sku: str
    # 搭贈說明原文；另外加贈的品項（骨粉、葡萄籽…）只寫在這裡
    deal: str
    buy_qty: int
    free_qty: int
    deal_price: Decimal


@dataclass(frozen=True)
class PackLine:
    """一口換算成報價的一列。"""

    # 付錢的數量（每口買的 × 口數）
    qty: int
    # 同品送的數量（每口送的 × 口數）
    free_qty: int
    # 每口售價 ÷ 每口買的數量，到分，只供參考
    unit_price: Decimal
    # 每口售價 × 口數
    amount: Decimal


def current_packs(session: Session) -> list[Pack]:
    """進行中那一期的每一口，照促銷品項編號排：同一個品牌的編號本來就連在一起。"""
    rows = session.execute(text(f"SELECT {COLUMNS} FROM v_promotion_item WHERE status = '進行中' ORDER BY item_code"))
    return [Pack(**row) for row in rows.mappings()]


def packs_by_code(session: Session, codes: Iterable[str]) -> dict[str, Pack]:
    """照編號查，不管是哪一期：確認頁存檔、回寫重送時，那一期可能已經結束。"""
    codes = sorted(set(codes))
    if not codes:
        return {}
    query = text(f"SELECT {COLUMNS} FROM v_promotion_item WHERE item_code IN :codes").bindparams(
        bindparam("codes", expanding=True)
    )
    return {row["code"]: Pack(**row) for row in session.execute(query, {"codes": codes}).mappings()}


def pack_line(pack: Pack, packs: int) -> PackLine:
    return PackLine(
        qty=pack.buy_qty * packs,
        free_qty=pack.free_qty * packs,
        unit_price=(pack.deal_price / pack.buy_qty).quantize(Decimal("0.01"), ROUND_HALF_UP),
        amount=pack.deal_price * packs,
    )


def line_label(product_name: str, qty: int, pack_name: str | None, packs: int | None) -> str:
    """報價一列的寫法：沒促銷是「魚油 30 入 × 20」，促銷是「Premium眼藥水(小口) × 1 口」。"""
    return f"{pack_name} × {packs} 口" if pack_name else f"{product_name} × {qty}"
```

- [ ] **Step 4: 跑測試，確認通過**

Run: `TEST_DB_NAME=meddemo_test_promo TEST_REDIS_URL=redis://127.0.0.1:6379/13 uv run --project backend pytest backend/tests/test_promo_packs.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/promo_packs.py backend/tests/test_promo_packs.py
git commit -m "Read this period's promotion packs and turn a pack into a quote line"
```

---

### Task 3: 報價頁 API 照口開

**Files:**
- Modify: `backend/app/api/customers.py`
- Modify: `backend/app/services/oa.py`（`summary`）
- Test: `backend/tests/test_quotes.py`

**Interfaces:**
- Consumes: `promo_packs.current_packs`、`promo_packs.pack_line`（Task 2）。
- Produces:
  - `GET /api/customers/{id}/quote-promotion` → `QuotePromotion | null`：
    `{name, pm_note, products: [{group_name, sku, name, spec, unit, supply_price, usual, packs: [{code, name, deal, buy_qty, free_qty, deal_price}]}]}`
  - `POST /api/customers/{id}/quotes` 的 `items[]` 是 `{sku, qty}` 或 `{promo_code, packs}`；回傳的 `items[]` 多 `promo_code`、`packs`、`free_qty`、`deal`。
  - 優惠申請單 payload 多 `total_amount`。

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_quotes.py` 最上面的 import：`from sqlalchemy import func, select, text, update`、`from app.services import promo_packs`。檔案最後加：

```python
# ── 促銷的口：照每口售價、不再打折（docs/superpowers/specs/2026-10-07-quote-promotion-packs-design.md）────


def pack_code(session, name):
    return next(p.code for p in promo_packs.current_packs(session) if p.name == name)


def test_the_quote_page_lists_this_period_by_product(tx, api, auth):
    promotion = api.get("/api/customers/C001/quote-promotion", headers=auth("U01")).json()
    assert promotion["name"] == "202610保藥特搭活動" and "滿額贈" in promotion["pm_note"]
    premium = next(p for p in promotion["products"] if p["sku"] == "F749579")
    # 連鎖的供貨價打 9 折：Premium 眼藥水原出貨價 250 元
    assert (premium["group_name"], premium["supply_price"], premium["usual"]) == ("獅王眼藥水", 225, False)
    assert [p["name"] for p in premium["packs"]] == ["Premium眼藥水(小口)", "Premium眼藥水(中口)", "Premium眼藥水(大口)"]
    assert premium["packs"][0] | {"code": None} == {
        "code": None, "name": "Premium眼藥水(小口)", "deal": "常態搭贈<22+1>", "buy_qty": 22, "free_qty": 1, "deal_price": 5500,
    }
    assert api.get("/api/customers/C002/quote-promotion", headers=auth("U01")).status_code == 404  # 王冠宇的客戶


def test_no_running_period_means_no_promotion_section(tx, api, auth):
    tx.execute(text("UPDATE promotion SET end_date = start_date WHERE end_date >= DATE '2026-10-28'"))
    tx.flush()
    assert api.get("/api/customers/C001/quote-promotion", headers=auth("U01")).json() is None


def test_a_pack_is_quoted_at_its_deal_price(tx, api, auth):
    code = pack_code(tx, "Premium眼藥水(小口)")
    created = api.post(
        "/api/customers/C001/quotes", json={"items": [{"promo_code": code, "packs": 2}, {"sku": "HS-FO30", "qty": 20}]},
        headers=auth("U01"),
    )
    assert created.status_code == 201
    quote = created.json()
    assert quote["amount"] == 11000 + 8100 and quote["status"] == "draft"
    pack, fish = quote["items"]
    assert pack == {
        "sku": "F749579", "name": "Premium眼藥水(小口)", "qty": 44, "unit_price": 250.0, "amount": 11000.0,
        "promo_code": code, "packs": 2, "free_qty": 2, "deal": "常態搭贈<22+1>",
    }
    assert fish["promo_code"] is None and fish["amount"] == 8100.0
    row = tx.execute(select(SapQuotationDraft).where(SapQuotationDraft.quote_no == quote["quote_no"], SapQuotationDraft.line_no == 1)).scalar_one()
    assert (row.promo_code, row.packs, row.qty, row.free_qty, float(row.amount), float(row.discount_pct)) == (code, 2, 44, 2, 11000, 0)


def test_the_discount_only_applies_to_lines_without_a_promotion(tx, api, auth, model):
    code = pack_code(tx, "Premium眼藥水(小口)")
    quote = open_quote(api, auth, 7, items=[*FISH_OIL, {"promo_code": code, "packs": 1}]).json()
    # 魚油 100 盒 405 元打 93 折是 37,665 元，小口照 5,500 元不打折
    assert (quote["status"], quote["amount"]) == ("pending_approval", 37665 + 5500)
    assert [i["amount"] for i in quote["items"]] == [37665.0, 5500.0]
    form = tx.get(OaExpenseForm, quote["approval"]["form_id"])
    # 簽核只看有打折的那幾列：模型是用沒有促銷的單訓練的
    assert form.payload == {
        "quote_no": quote["quote_no"], "discount_pct": 7.0, "list_amount": 40500, "amount": 37665, "cost": 27000,
        "reason": "競品開買十送一", "total_amount": 43165,
    }
    inbox = api.get("/api/oa/inbox", headers=auth("M01")).json()["items"]
    assert next(i for i in inbox if i["id"] == form.id)["summary"] == "折扣 7%，打折的品項 NT$ 37,665，整張報價 NT$ 43,165"


def test_bad_pack_quotes_are_rejected(tx, api, auth, model):
    code = pack_code(tx, "Premium眼藥水(小口)")
    post = lambda body: api.post("/api/customers/C001/quotes", json=body, headers=auth("U01"))  # noqa: E731
    pack = {"promo_code": code, "packs": 1}
    assert post({"items": [pack, pack]}).status_code == 422  # 同一口只能列一次
    assert post({"items": [{"promo_code": code, "packs": 0}]}).status_code == 422
    assert post({"items": [{"sku": "HS-FO30", "qty": 1, "promo_code": code, "packs": 1}]}).status_code == 422
    assert post({"items": [{"sku": "HS-FO30"}]}).status_code == 422
    ended = post({"items": [{"promo_code": "PP-027942", "packs": 1}]})  # 202608 那一期，已經結束
    assert ended.status_code == 422 and "換期" in ended.json()["detail"]
    only_packs = post({"items": [pack], "discount_pct": 2})
    assert only_packs.status_code == 422 and "沒促銷的品項" in only_packs.json()["detail"]
    # 同一個品項的小口與不走促銷可以同時開
    assert post({"items": [pack, {"sku": "F749579", "qty": 5}]}).status_code == 201
```

`test_a_deeper_discount_waits_for_the_manager_before_it_counts` 的 payload 期望值加上 `"total_amount": 37665`。

- [ ] **Step 2: 跑測試，確認失敗**

Run: `TEST_DB_NAME=meddemo_test_promo TEST_REDIS_URL=redis://127.0.0.1:6379/13 uv run --project backend pytest backend/tests/test_quotes.py -q`
Expected: FAIL（`quote-promotion` 404、`promo_code` 欄位 422 等）

- [ ] **Step 3: 輸入與輸出的模型**

`backend/app/api/customers.py`：import 加 `from pydantic import BaseModel, Field, model_validator`，`from app.services import approvals, customer_profile, negotiation, promo_packs, writeback`。`QuoteLineInput`、`QuoteLine` 換成：

```python
class QuoteLineInput(BaseModel):
    """一列是品項 × 數量（照供貨價，可以打折），或是促銷的某一口 × 口數（照每口售價，不打折），兩種擇一。"""

    sku: str | None = None
    qty: int | None = Field(default=None, gt=0)
    promo_code: str | None = None
    packs: int | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def one_kind(self):
        given = {key for key in ("sku", "qty", "promo_code", "packs") if getattr(self, key) is not None}
        if given not in ({"sku", "qty"}, {"promo_code", "packs"}):
            raise ValueError("每一列是品項與數量，或是促銷的口與口數，兩種擇一")
        return self
```

```python
class QuoteLine(BaseModel):
    sku: str
    name: str
    # 促銷的列是付錢的數量（每口買的 × 口數）
    qty: int
    # 折扣後的單價，到分；促銷的列是每口售價 ÷ 每口買的數量
    unit_price: float
    amount: float
    # 促銷的列才有：哪一口、幾口、同品送幾個、搭贈說明原文
    promo_code: str | None = None
    packs: int | None = None
    free_qty: int = 0
    deal: str | None = None
```

- [ ] **Step 4: 這一期的促銷（新的 API）**

接在 `quote_items` 後面：

```python
class QuotePack(BaseModel):
    code: str
    name: str
    deal: str
    buy_qty: int
    free_qty: int
    deal_price: float


class QuotePromotionProduct(BaseModel):
    group_name: str
    sku: str
    name: str
    spec: str
    unit: str
    # 這家的供貨價，給「不走促銷」那一列
    supply_price: int
    # 已經在常進品項裡：畫面上不重複列「不走促銷」
    usual: bool
    packs: list[QuotePack]


class QuotePromotion(BaseModel):
    name: str
    # PM 提醒原文：滿額贈這類看整張訂單的活動，系統不算，給業務參考
    pm_note: str
    products: list[QuotePromotionProduct]


@router.get("/{customer_id}/quote-promotion", response_model=QuotePromotion | None)
def quote_promotion(session: SessionDep, customer_id: str, user: CurrentUser):
    """開報價時這一期的促銷：依品項列出每一口；沒有進行中的一期回 null。"""
    customer, _ = _load(session, customer_id, user, SHARING_LEVEL["quote"])
    packs = promo_packs.current_packs(session)
    if not packs:
        return None
    # 正常只有一期進行中；萬一有兩期重疊，只列編號最前面那一期
    name = packs[0].promotion_name
    packs = [p for p in packs if p.promotion_name == name]
    today = customer_profile.app_today(session)
    usual = set(session.scalars(
        select(SalesTransaction.sku).distinct().where(
            SalesTransaction.customer_id == customer.id,
            SalesTransaction.date > today - timedelta(days=QUOTE_ITEM_DAYS),
        )
    ))
    products = {p.sku: p for p in session.scalars(select(Product).where(Product.sku.in_({p.sku for p in packs})))}
    grouped: dict[str, QuotePromotionProduct] = {}
    for pack in packs:
        product = products[pack.sku]
        entry = grouped.setdefault(pack.sku, QuotePromotionProduct(
            group_name=pack.group_name, sku=pack.sku, name=product.name, spec=product.spec, unit=product.unit,
            supply_price=supply_price(product.unit_price, customer.type), usual=pack.sku in usual, packs=[],
        ))
        entry.packs.append(QuotePack(
            code=pack.code, name=pack.name, deal=pack.deal, buy_qty=pack.buy_qty, free_qty=pack.free_qty,
            deal_price=float(pack.deal_price),
        ))
    pm_note = session.scalar(text("SELECT pm_note FROM v_promotion WHERE promotion_name = :name"), {"name": name})
    return QuotePromotion(name=name, pm_note=pm_note or "", products=list(grouped.values()))
```

import 加 `from sqlalchemy import Date, case, cast, func, select, text`。

- [ ] **Step 5: 開報價**

`create_quote` 從開頭到建 `lines` 之前、與建 `lines` 那一段、回傳，換成：

```python
    customer, _ = _load(session, customer_id, user, SHARING_LEVEL["quote"])
    plain = [line for line in body.items if line.sku is not None]
    promo = [line for line in body.items if line.promo_code is not None]
    skus = [line.sku for line in plain]
    if len(set(skus)) != len(skus):
        raise HTTPException(422, "同一個品項只能列一次")
    codes = [line.promo_code for line in promo]
    if len(set(codes)) != len(codes):
        raise HTTPException(422, "同一口只能列一次")
    products = {p.sku: p for p in session.scalars(select(Product).where(Product.sku.in_(skus)))}
    if missing := [sku for sku in skus if sku not in products]:
        raise HTTPException(422, f"找不到品項：{'、'.join(missing)}")
    current = {p.code: p for p in promo_packs.current_packs(session)}
    if any(code not in current for code in codes):
        raise HTTPException(422, "促銷已經換期，請重新整理")
    level, reason = _discount_level(body)
    if body.discount_pct and not plain:
        raise HTTPException(422, "折扣只套在沒促銷的品項上，這張報價沒有可以打折的品項")
    # 跟拜訪回寫一樣受模擬系統開關影響：展示「SAP 停機」時這裡也開不成
    if writeback.is_mock_down("sap"):
        raise HTTPException(503, "SAP 暫時連不上，報價草稿沒有開成，請稍後再試")
    if level:
        _oa_must_be_up("這個折扣要送簽核，報價沒有開成")

    today = customer_profile.app_today(session)
    # 折扣每 0.5% 一格，用整數算才不會有浮點數的尾差：405 元打 97 折是 392.85
    keep = Decimal(200 - round(body.discount_pct * 2)) / 200
    supply = {sku: supply_price(products[sku].unit_price, customer.type) for sku in skus}
    prices = {sku: (Decimal(price) * keep).quantize(Decimal("0.01"), ROUND_HALF_UP) for sku, price in supply.items()}
    pack_lines = {line.promo_code: promo_packs.pack_line(current[line.promo_code], line.packs) for line in promo}
    discounted = sum((prices[line.sku] * line.qty for line in plain), Decimal(0))
    # 金額到元，四捨五入（跟畫面上金額的進位方式一樣）。簽核只看有打折的那幾列
    amount = int((discounted + sum((p.amount for p in pack_lines.values()), Decimal(0))).quantize(Decimal("1"), ROUND_HALF_UP))
    discounted_amount = int(discounted.quantize(Decimal("1"), ROUND_HALF_UP))
    status = "pending_approval" if level else "draft"
    form = None
    for _attempt in range(3):  # 兩個人同時開報價可能拿到同一個單號，撞到唯一限制就換下一號
        quote_no = _next_quote_no(session, today)
        lines = []
        for n, line in enumerate(body.items, start=1):
            common = dict(quote_no=quote_no, visit_id=None, created_by=user.id, line_no=n, customer_id=customer.id, status=status)
            if line.promo_code:
                pack, pl = current[line.promo_code], pack_lines[line.promo_code]
                lines.append(SapQuotationDraft(
                    **common, sku=pack.sku, qty=pl.qty, free_qty=pl.free_qty, unit_price=pl.unit_price, amount=pl.amount,
                    discount_pct=0, promo_code=pack.code, packs=line.packs,
                ))
            else:
                lines.append(SapQuotationDraft(
                    **common, sku=line.sku, qty=line.qty, unit_price=prices[line.sku], amount=prices[line.sku] * line.qty,
                    discount_pct=body.discount_pct,
                ))
        session.add_all(lines)
        try:
            session.flush()
            if level:
                form = approvals.submit(
                    session, kind="discount", customer=customer,
                    # 申請人記客戶的負責人，跟出差單一樣：自建帳號、主管代開的單都在負責人的申請匣裡
                    applicant=session.get(AppUser, customer.owner_user_id),
                    payload={
                        "quote_no": quote_no, "discount_pct": body.discount_pct,
                        "list_amount": sum(supply[line.sku] * line.qty for line in plain), "amount": discounted_amount,
                        "cost": round(sum(products[line.sku].unit_cost * line.qty for line in plain)),
                        "reason": reason, "total_amount": amount,
                    },
                )
            session.commit()
            break
        except IntegrityError:
            session.rollback()
    else:
        raise HTTPException(409, "報價單號衝突，請再送一次")

    items = [
        QuoteLine(
            sku=l.sku, name=current[l.promo_code].name if l.promo_code else products[l.sku].name, qty=l.qty,
            unit_price=float(l.unit_price), amount=float(l.amount), promo_code=l.promo_code, packs=l.packs,
            free_qty=l.free_qty, deal=current[l.promo_code].deal if l.promo_code else None,
        )
        for l in lines
    ]
```

（`return Quote(...)` 保持原樣。）

`MAX_QUOTE_LINES` 的註解改成「一張報價最多幾列（品項與促銷的口合計）」。

- [ ] **Step 6: 申請單摘要**

`backend/app/services/oa.py` 的 `summary`，discount 那一行換成：

```python
    if form.kind == "discount":
        pct, amount = _percent(payload["discount_pct"]), payload["amount"]
        # 報價裡有促銷的口時，口不打折：分開寫打折的部分與整張報價（歷史單沒有 total_amount）
        total = payload.get("total_amount")
        if total is not None and total != amount:
            return f"折扣 {pct}，打折的品項 NT$ {amount:,.0f}，整張報價 NT$ {total:,.0f}"
        return f"折扣 {pct}，報價 NT$ {amount:,.0f}"
```

- [ ] **Step 7: 跑測試，確認通過**

Run: `TEST_DB_NAME=meddemo_test_promo TEST_REDIS_URL=redis://127.0.0.1:6379/13 uv run --project backend pytest backend/tests/test_quotes.py backend/tests/test_approvals.py backend/tests/test_oa.py -q`
Expected: PASS（`test_oa.py` 若不存在就略過那個檔案）

- [ ] **Step 8: Commit**

```bash
git add backend/app/api/customers.py backend/app/services/oa.py backend/tests/test_quotes.py
git commit -m "Let a quote take promotion packs at their deal price, discounting only the other lines"
```

---

### Task 4: 待處理事項與今日路線寫出是哪一口

**Files:**
- Modify: `backend/app/services/customer_profile.py`（`_open_quotes`）
- Modify: `backend/app/services/today_route.py`（`_opportunities`）
- Test: `backend/tests/test_quotes.py`

**Interfaces:**
- Consumes: `promo_packs.line_label`（Task 2）、`POST /quotes` 的口（Task 3）。

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_quotes.py` 最後加：

```python
def test_profile_and_route_name_the_pack(tx, api, auth):
    code = pack_code(tx, "Premium眼藥水(小口)")
    quote = api.post(
        "/api/customers/C001/quotes", json={"items": [{"promo_code": code, "packs": 1}, {"sku": "HS-FO30", "qty": 20}]},
        headers=auth("U01"),
    ).json()
    opened = open_quotes(api, auth)[quote["quote_no"]]
    assert opened["items"] == "Premium眼藥水(小口) × 1 口、魚油 30 入 × 20" and opened["amount"] == 13600
    # 今日路線一家只寫最近的一張報價：假資料的拜訪排在決賽日之前，把這張挪到決賽日當天才會是最近的
    tx.execute(
        update(SapQuotationDraft).where(SapQuotationDraft.quote_no == quote["quote_no"])
        .values(created_at=dt.datetime(2026, 10, 28, 9, tzinfo=dt.timezone(dt.timedelta(hours=8))))
    )
    route = today_route._opportunities(tx, "U01", dt.date(2026, 10, 28))
    assert route["C001"] == "10/28 想進Premium眼藥水(小口) × 1 口，報價草稿還沒成交"
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `TEST_DB_NAME=meddemo_test_promo TEST_REDIS_URL=redis://127.0.0.1:6379/13 uv run --project backend pytest backend/tests/test_quotes.py::test_profile_and_route_name_the_pack -q`
Expected: FAIL（items 是 `Premium眼藥水 × 22、…`）

- [ ] **Step 3: 客戶檔案**

`backend/app/services/customer_profile.py`：import 加 `PromotionItem` 與 `from app.services import promo_packs`（若有循環 import，改成函式內 import）。`_open_quotes` 的查詢：

```python
    rows = session.execute(
        select(
            SapQuotationDraft.quote_no, SapQuotationDraft.visit_id, SapQuotationDraft.qty, SapQuotationDraft.packs,
            SapQuotationDraft.amount, SapQuotationDraft.created_at, SapQuotationDraft.status, Product.name,
            PromotionItem.name.label("pack_name"), Visit.visited_at,
        )
        .join(Product, Product.sku == SapQuotationDraft.sku)
        .outerjoin(PromotionItem, PromotionItem.code == SapQuotationDraft.promo_code)
        .outerjoin(Visit, Visit.id == SapQuotationDraft.visit_id)
        .where(SapQuotationDraft.customer_id == customer_id, SapQuotationDraft.status.in_(OPEN_QUOTE_STATUSES))
        .order_by(func.coalesce(Visit.visited_at, SapQuotationDraft.created_at).desc(), SapQuotationDraft.line_no)
    ).all()
```

迴圈裡：

```python
        label = promo_packs.line_label(row.name, row.qty, row.pack_name, row.packs)
        quote.items = "、".join(filter(None, [quote.items, label]))
        quote.amount += float(row.amount)
```

- [ ] **Step 4: 今日路線**

`backend/app/services/today_route.py`：import 加 `PromotionItem` 與 `promo_packs`。查詢加 `SapQuotationDraft.packs, PromotionItem.name.label("pack_name")` 與 `.outerjoin(PromotionItem, PromotionItem.code == SapQuotationDraft.promo_code)`；句子換成：

```python
            label = promo_packs.line_label(q.name, q.qty, q.pack_name, q.packs)
            found[q.customer_id] = f"{quoted_on:%m/%d} 想進{label}，報價草稿還沒成交"
```

`line_label` 沒促銷時是 `魚油 30 入 × 20`，跟原本的 `想進{q.name} × {q.qty}` 一字不差。

- [ ] **Step 5: 跑測試，確認通過**

Run: `TEST_DB_NAME=meddemo_test_promo TEST_REDIS_URL=redis://127.0.0.1:6379/13 uv run --project backend pytest backend/tests/test_quotes.py backend/tests/test_today_route.py backend/tests/test_customer_profile.py -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/customer_profile.py backend/app/services/today_route.py backend/tests/test_quotes.py
git commit -m "Name the promotion pack in open quotes and the route's unclosed quotes"
```

---

### Task 5: 拜訪意向多一格「是哪一口」

**Files:**
- Modify: `backend/app/schemas/visit_fields.schema.json`
- Modify: `data/seed/generate.py`（`render_visit` 的意向）
- Modify: `backend/tests/test_visits.py`（`FIELDS`、`unclear`）、`backend/tests/test_eval_corpus.py`（`as_fields`）
- Modify: `frontend/src/api/visits.ts`、`frontend/src/components/visit/field-editor.tsx`（新列帶 `promo_code: null`）
- Modify: `docs/visit-fields.md`
- Test: `backend/tests/test_visits.py`、`backend/tests/test_llm.py`

**Interfaces:**
- Produces: 意向每一項 `{product_text, sku, qty, unit, promo_code}`；`promo_code` 有值時 `qty` 是口數、`unit` 是「口」。前端 `IntentItem.promo_code: string | null`。

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_llm.py` 的 `test_nullable_fields_keep_their_structure` 最後加：

```python
    intent = fields["intent"]["items"]
    assert intent["properties"]["promo_code"]["type"] == ["string", "null"]
    assert "promo_code" in intent["required"]
```

`backend/tests/test_visits.py` 加：

```python
def test_an_intent_line_must_say_whether_it_is_a_pack(client, providers):
    visit_id = make_draft(client, providers)
    without = [{"product_text": "魚油", "sku": "HS-FO30", "qty": 20, "unit": "盒"}]
    assert client.put(f"/api/visits/{visit_id}/fields", json={"fields": {**FIELDS, "intent": without}}).status_code == 422
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `TEST_DB_NAME=meddemo_test_promo TEST_REDIS_URL=redis://127.0.0.1:6379/13 uv run --project backend pytest backend/tests/test_llm.py backend/tests/test_visits.py -q`
Expected: FAIL（`KeyError: 'promo_code'`；沒有 promo_code 的意向被收下）

- [ ] **Step 3: 改 schema**

`backend/app/schemas/visit_fields.schema.json` 的 `intent.items`：

```json
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["product_text", "sku", "qty", "unit", "promo_code"],
        "properties": {
          "product_text": { "type": "string", "minLength": 1, "description": "口述原本的講法" },
          "sku": { "type": ["string", "null"], "description": "對不到唯一品項時為 null" },
          "qty": { "type": ["integer", "null"], "minimum": 1, "description": "數量；促銷的口是口數" },
          "unit": { "type": ["string", "null"], "description": "單位；促銷的口是「口」" },
          "promo_code": { "type": ["string", "null"], "description": "促銷的哪一口（促銷品項編號）；沒講口為 null" }
        }
      }
```

- [ ] **Step 4: 假資料、測試資料、前端型別補上 `promo_code`**

`data/seed/generate.py` 的 `render_visit`：

```python
            items.append({"product_text": p["aliases"][0], "sku": sku, "qty": qty, "unit": p["unit"], "promo_code": None})
```

`backend/tests/test_visits.py`：`FIELDS["intent"]` 改成 `[{"product_text": "魚油", "sku": "HS-FO30", "qty": 20, "unit": "盒", "promo_code": None}]`；`test_sap_needs_product_and_quantity_before_confirming` 的 `unclear` 項目加 `"promo_code": None`。

`backend/tests/test_eval_corpus.py` 的 `as_fields`：

```python
        "intent": [{"product_text": sku, "sku": sku, "qty": qty, "unit": None, "promo_code": None} for sku, qty in expected["intent"]]
```

`frontend/src/api/visits.ts`：

```ts
// promo_code 有值時是促銷的某一口：qty 是口數、unit 是「口」
export type IntentItem = { product_text: string; sku: string | null; qty: number | null; unit: string | null; promo_code: string | null }
```

`frontend/src/components/visit/field-editor.tsx` 的 `IntentEditor`：兩處新列改成 `{ product_text: "", sku: null, qty: null, unit: null, promo_code: null }`；`choose` 換品項時把口清掉：

```ts
    update(index, product ? { ...row, sku: product.sku, unit: product.unit, promo_code: null, product_text: row.product_text || product.name } : { ...row, sku: null, promo_code: null })
```

- [ ] **Step 5: 文件**

`docs/visit-fields.md` 的 `intent` 那一列：格式改成 `[{product_text, sku, qty, unit, promo_code}]`，例子 `[{"product_text": "魚油", "sku": "HS-FO30", "qty": 20, "unit": "盒", "promo_code": null}]`，表格下方（或該列說明）加一句：「講到促銷的口（小口、中口、大口）時 `promo_code` 是促銷品項編號，`qty` 是口數、`unit` 是「口」。」

- [ ] **Step 6: 跑測試，確認通過**

Run: `TEST_DB_NAME=meddemo_test_promo TEST_REDIS_URL=redis://127.0.0.1:6379/13 uv run --project backend pytest backend/tests/test_llm.py backend/tests/test_visits.py backend/tests/test_eval_corpus.py backend/tests/test_seed.py -q && npm --prefix frontend run typecheck`
Expected: PASS（假資料改了，第一個測試會重灌測試資料庫）

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas/visit_fields.schema.json data/seed/generate.py backend/tests/test_visits.py backend/tests/test_eval_corpus.py backend/tests/test_llm.py frontend/src/api/visits.ts frontend/src/components/visit/field-editor.tsx docs/visit-fields.md
git commit -m "Give each purchase intent a slot for the promotion pack"
```

---

### Task 6: AI 抽出口、存檔檢查口、回寫 SAP 照口寫

**Files:**
- Modify: `backend/app/services/extraction.py`
- Modify: `backend/app/services/visit_processing.py`
- Modify: `backend/app/api/visits.py`（`update_fields`）
- Modify: `backend/app/services/writeback.py`（`_write_sap`）
- Test: `backend/tests/test_visits.py`、`backend/tests/test_extraction_packs.py`

**Interfaces:**
- Consumes: `promo_packs.Pack`、`current_packs`、`packs_by_code`、`pack_line`（Task 2）。
- Produces:
  - `extraction.build_prompt(transcript, visit_date, products, packs=())`
  - `FieldExtractor.extract(transcript, visit_date, products, packs=())`
  - `extraction.drop_unknown_packs(intent: list | None, packs: Sequence[Pack]) -> list | None`
  - `extraction.intent_pack_problems(session, intent: list | None) -> list[str]`

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_extraction_packs.py`：

```python
"""拜訪意向裡的促銷的口：提示帶這一期的口、AI 對不上的口清掉、存檔時檢查。"""

from datetime import date
from decimal import Decimal

from sqlalchemy.orm import Session

from app.services import extraction, promo_packs

PACK = promo_packs.Pack(
    code="PP-000001", promotion_name="202610保藥特搭活動", group_name="獅王眼藥水", name="Premium眼藥水(小口)",
    sku="F749579", deal="常態搭贈<22+1>", buy_qty=22, free_qty=1, deal_price=Decimal("5500"),
)


def item(**values):
    return {"product_text": "小口 Premium", "sku": "F749579", "qty": 1, "unit": "口", "promo_code": "PP-000001"} | values


def test_the_prompt_lists_this_periods_packs():
    prompt = extraction.build_prompt("逐字稿", date(2026, 10, 28), [], [PACK])
    assert "PP-000001｜F749579｜Premium眼藥水(小口)｜常態搭贈<22+1>" in prompt
    assert "promo_code" in prompt
    assert "這一期沒有促銷" in extraction.build_prompt("逐字稿", date(2026, 10, 28), [], [])


def test_packs_the_ai_cannot_back_up_are_cleared():
    kept = item()
    wrong_code = item(promo_code="PP-999999")
    wrong_sku = item(sku="F762488")
    plain = item(promo_code=None, unit="盒", qty=20)
    assert extraction.drop_unknown_packs([kept, wrong_code, wrong_sku, plain], [PACK]) == [
        kept,
        # 數量是口數，只清口會變成 1 盒：品項也清掉，讓確認頁標「缺少品項」
        item(promo_code=None, sku=None),
        item(promo_code=None, sku=None),
        plain,
    ]
    assert extraction.drop_unknown_packs(None, [PACK]) is None


def test_saved_packs_must_exist_and_match_the_product(engine):
    with Session(engine) as session:
        code = next(p.code for p in promo_packs.current_packs(session) if p.name == "Premium眼藥水(小口)")
        assert extraction.intent_pack_problems(session, [item(promo_code=code)]) == []
        assert extraction.intent_pack_problems(session, None) == []
        # 已經結束的那一期也收：確認頁可能在換期之後才存
        assert extraction.intent_pack_problems(session, [item(promo_code="PP-027942")]) == []
        assert extraction.intent_pack_problems(session, [item(promo_code="PP-NOPE")]) == ["意向第 1 項的促銷 PP-NOPE 不存在"]
        assert extraction.intent_pack_problems(session, [item(promo_code=code, sku="HS-FO30")]) == [
            "意向第 1 項的促銷不是這個品項"
        ]
```

`backend/tests/test_visits.py`：`FakeExtractor.__init__` 加 `self.packs = ()`；`extract` 的簽名改成 `def extract(self, transcript, visit_date, products, packs=()):`，並記下 `self.packs = packs`。檔案最後加：

```python
def premium_small(engine):
    with engine.connect() as conn:
        return conn.execute(
            text("SELECT item_code FROM v_promotion_item WHERE status = '進行中' AND item_name = 'Premium眼藥水(小口)'")
        ).scalar_one()


def test_a_pack_in_the_voice_note_is_quoted_as_that_pack(client, providers, engine):
    code = premium_small(engine)
    pack = {"product_text": "小口 Premium 眼藥水", "sku": "F749579", "qty": 2, "unit": "口", "promo_code": code}
    extractor = FakeExtractor(fields={**FIELDS, "intent": [pack, *FIELDS["intent"]]})
    visit_id = make_draft(client, providers, extractor)
    assert code in {p.code for p in extractor.packs}  # 這一期的口有帶給模型
    assert client.get(f"/api/visits/{visit_id}").json()["fields"]["intent"][0] == pack

    visit = client.post(f"/api/visits/{visit_id}/confirm").json()
    assert statuses(visit)["sap"] == "success"
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT promo_code, packs, qty, free_qty, amount, unit_price FROM sap_quotation_draft WHERE visit_id = :v ORDER BY line_no"),
            {"v": visit_id},
        ).all()
    assert [tuple(r) for r in rows] == [(code, 2, 44, 2, 11000, 250), (None, None, 20, 0, 8100, 405)]


def test_a_pack_the_ai_made_up_is_cleared_for_the_rep_to_pick(client, providers):
    made_up = {"product_text": "小口眼藥水", "sku": "F749579", "qty": 1, "unit": "口", "promo_code": "PP-999999"}
    visit_id = make_draft(client, providers, FakeExtractor(fields={**FIELDS, "intent": [made_up]}))
    assert client.get(f"/api/visits/{visit_id}").json()["fields"]["intent"] == [made_up | {"sku": None, "promo_code": None}]
    assert "缺少品項" in str(client.post(f"/api/visits/{visit_id}/confirm").json())


def test_the_rep_cannot_save_a_pack_for_another_product(client, providers, engine):
    visit_id = make_draft(client, providers)
    wrong = [{"product_text": "魚油", "sku": "HS-FO30", "qty": 1, "unit": "口", "promo_code": premium_small(engine)}]
    response = client.put(f"/api/visits/{visit_id}/fields", json={"fields": {**FIELDS, "intent": wrong}})
    assert response.status_code == 422 and "不是這個品項" in str(response.json())
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `TEST_DB_NAME=meddemo_test_promo TEST_REDIS_URL=redis://127.0.0.1:6379/13 uv run --project backend pytest backend/tests/test_extraction_packs.py backend/tests/test_visits.py -q`
Expected: FAIL（`build_prompt() takes 3 positional arguments`、`drop_unknown_packs` 不存在等）

- [ ] **Step 3: 提示與檢查**

`backend/app/services/extraction.py`：

import 加：

```python
from collections.abc import Sequence

from app.services.promo_packs import Pack, packs_by_code
```

`PROMPT` 的第 8 條後面加第 9 條，品項表後面加促銷表：

```python
8. competitor 的 detail 填競品開的條件或做的事，沒講就填 null。
9. intent 講到促銷的口才填 promo_code：業務講了小口、中口、大口，或講了幾口、某一口的搭贈（例如「買 11 送 2」「直走」），而且對得到下方促銷表裡唯一的一口，promo_code 填那一口的編號、sku 填那一口的 sku、qty 填口數、unit 填「口」。講了口但沒講幾口算 1 口。沒講口就照第 7 條填數量，promo_code 填 null。講了口卻對不到唯一的一口（例如好幾個品項都有小口），sku 與 promo_code 都填 null，product_text 照原話。

品項表（sku｜名稱｜單位｜口語別名）：
{catalog}

這一期的促銷（編號｜sku｜名稱｜搭贈）：
{packs}

逐字稿：
{transcript}
```

`FieldExtractor`、`build_prompt`、`LLMFieldExtractor.extract`：

```python
class FieldExtractor(Protocol):
    def extract(
        self, transcript: str, visit_date: date, products: list[ProductHint], packs: Sequence[Pack] = ()
    ) -> Extraction: ...
```

```python
def build_prompt(transcript: str, visit_date: date, products: list[ProductHint], packs: Sequence[Pack] = ()) -> str:
    catalog = "\n".join(f"{p.sku}｜{p.name}｜{p.unit}｜{'、'.join(p.aliases)}" for p in products)
    pack_table = "\n".join(f"{p.code}｜{p.sku}｜{p.name}｜{p.deal}" for p in packs) or "（這一期沒有促銷）"
    return PROMPT.format(
        visit_date=visit_date.isoformat(),
        weekday=WEEKDAYS[visit_date.weekday()],
        catalog=catalog,
        packs=pack_table,
        transcript=transcript,
    )
```

```python
    def extract(
        self, transcript: str, visit_date: date, products: list[ProductHint], packs: Sequence[Pack] = ()
    ) -> Extraction:
        prompt = build_prompt(transcript, visit_date, products, packs)
        data = self.llm.json(system=SYSTEM, prompt=prompt, schema=output_schema())
        return Extraction(fields=data["fields"], sources={k: v for k, v in (data.get("sources") or {}).items() if v})
```

接在 `missing_sap_details` 後面：

```python
def drop_unknown_packs(intent: list[dict[str, Any]] | None, packs: Sequence[Pack]) -> list[dict[str, Any]] | None:
    """AI 抽出的口不是這一期的、或跟品項對不上：品項與口都清掉，讓確認頁標「缺少品項」請業務選。
    數量是口數，只清口的話會變成 1 盒。"""
    if not intent:
        return intent
    by_code = {p.code: p for p in packs}

    def check(item: dict[str, Any]) -> dict[str, Any]:
        code = item.get("promo_code")
        if code and (code not in by_code or by_code[code].sku != item.get("sku")):
            return {**item, "sku": None, "promo_code": None}
        return item

    return [check(item) for item in intent]


def intent_pack_problems(session: Session, intent: list[dict[str, Any]] | None) -> list[str]:
    """確認頁存檔時檢查：有口的項目，那一口要存在、而且是同一個品項。不檢查期別，確認頁只列進行中的口。"""
    items = intent or []
    found = packs_by_code(session, (i["promo_code"] for i in items if i.get("promo_code")))
    problems = []
    for number, item in enumerate(items, start=1):
        if not (code := item.get("promo_code")):
            continue
        if code not in found:
            problems.append(f"意向第 {number} 項的促銷 {code} 不存在")
        elif found[code].sku != item.get("sku"):
            problems.append(f"意向第 {number} 項的促銷不是這個品項")
    return problems
```

- [ ] **Step 4: 背景整理時帶這一期的口、清掉對不上的**

`backend/app/services/visit_processing.py`：

```python
from app.services.extraction import drop_unknown_packs, empty_fields, get_extractor, product_hints, validate_fields
from app.services.promo_packs import current_packs
```

`_extract` 的 try 區塊：

```python
        packs = current_packs(session)
        extraction = get_extractor().extract(visit.transcript, local_date(visit.visited_at), product_hints(session), packs)
        errors = validate_fields(extraction.fields)
        if errors:
            raise ValueError("；".join(errors))
        fields = {**extraction.fields, "intent": drop_unknown_packs(extraction.fields["intent"], packs)}
```

- [ ] **Step 5: 存檔時檢查**

`backend/app/api/visits.py`：import 加 `intent_pack_problems`；`update_fields`：

```python
    if errors := validate_fields(body.fields):
        raise HTTPException(422, errors)
    if problems := intent_pack_problems(session, body.fields.get("intent")):
        raise HTTPException(422, problems)
```

- [ ] **Step 6: 回寫 SAP 照口寫**

`backend/app/services/writeback.py`：import 加 `from app.services import promo_packs`。`_write_sap` 換成：

```python
def _write_sap(session: Session, visit: Visit) -> None:
    items = visit.fields_final["intent"] or []
    if not items:
        raise NothingToWrite("這次沒有購買意向，不需要報價草稿")
    prices = dict(session.execute(select(Product.sku, Product.unit_price).where(Product.sku.in_([i["sku"] for i in items]))).all())
    # 照編號查，不管哪一期：拜訪時那一期還在，回寫重送時可能已經換期，照當初的那一口與價錢寫
    packs = promo_packs.packs_by_code(session, (i["promo_code"] for i in items if i.get("promo_code")))
    customer_type = session.get(Customer, visit.customer_id).type
    for line_no, item in enumerate(items, start=1):
        if not item.get("qty") or item.get("sku") not in prices:
            raise ValueError(f"意向第 {line_no} 項缺少品項或數量")
        if code := item.get("promo_code"):
            if code not in packs:
                raise ValueError(f"意向第 {line_no} 項的促銷 {code} 不存在")
            line = promo_packs.pack_line(packs[code], item["qty"])
            values = {
                "promo_code": code, "packs": item["qty"], "qty": line.qty, "free_qty": line.free_qty,
                "unit_price": line.unit_price, "amount": line.amount,
            }
        else:
            # 報價以標準供貨價為基準（連鎖 9 折、獨立藥局 95 折、診所原價），與歷史報價一致
            price = supply_price(prices[item["sku"]], customer_type)
            values = {"qty": item["qty"], "unit_price": price, "amount": price * item["qty"]}
        session.execute(
            insert(SapQuotationDraft).values(
                quote_no=visit.id, visit_id=visit.id, line_no=line_no, customer_id=visit.customer_id,
                sku=item["sku"], created_by=visit.user_id, **values,
            ).on_conflict_do_nothing(index_elements=["visit_id", "line_no"])
        )
```

- [ ] **Step 7: 跑測試，確認通過**

Run: `TEST_DB_NAME=meddemo_test_promo TEST_REDIS_URL=redis://127.0.0.1:6379/13 uv run --project backend pytest backend/tests/test_extraction_packs.py backend/tests/test_visits.py backend/tests/test_llm.py backend/tests/test_eval_corpus.py -q`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add backend/app/services/extraction.py backend/app/services/visit_processing.py backend/app/api/visits.py backend/app/services/writeback.py backend/tests/test_extraction_packs.py backend/tests/test_visits.py
git commit -m "Pick out promotion packs from voice notes and write them to SAP as packs"
```

---

### Task 7: 報價頁的「這一期的促銷」

**Files:**
- Create: `frontend/src/lib/quote.ts`、`frontend/src/lib/quote.test.ts`
- Modify: `frontend/src/api/customers.ts`
- Modify: `frontend/src/pages/quote.tsx`

**Interfaces:**
- Consumes: `GET /quote-promotion`、`POST /quotes`（Task 3）。
- Produces:
  - `quoteTotal(plain: {qty: number; unitPrice: number}[], packs: {packs: number; dealPrice: number}[], pct: number): number`
  - `quoteBlocked(input: {plainCount: number; packCount: number; discount: number; route: DiscountSteps; reason: string}): string | null`
  - `packDeal(pack: {buy_qty: number; free_qty: number}): string`
  - `getQuotePromotion(id, signal)`、型別 `QuotePromotion`、`QuotePack`、`QuoteLineInput`

- [ ] **Step 1: 寫失敗的測試**

`frontend/src/lib/quote.test.ts`：

```ts
import { describe, expect, it } from "vitest"

import { discountSteps } from "@/lib/approval"
import { packDeal, quoteBlocked, quoteTotal } from "@/lib/quote"

describe("quoteTotal", () => {
  it("只打沒促銷的列，口照每口售價", () => {
    // 人工淚液 133 元打 98 折是 130.34 元 × 20，加小口 5,500 元
    expect(quoteTotal([{ qty: 20, unitPrice: 133 }], [{ packs: 1, dealPrice: 5500 }], 2)).toBe(8107)
    expect(quoteTotal([], [{ packs: 2, dealPrice: 3100 }], 0)).toBe(6200)
    // 405 元打 97 折是 392.85 元，跟後端一樣到分
    expect(quoteTotal([{ qty: 100, unitPrice: 405 }], [], 3)).toBe(39285)
  })
})

describe("quoteBlocked", () => {
  const base = { plainCount: 1, packCount: 0, discount: 0, route: discountSteps(0), reason: "" }
  it("照順序說明送不出去的原因", () => {
    expect(quoteBlocked({ ...base, plainCount: 0 })).toBe("至少要有一項數量大於 0")
    expect(quoteBlocked({ ...base, discount: 2.3, route: discountSteps(2.3) })).toBe(discountSteps(2.3).text)
    expect(quoteBlocked({ ...base, plainCount: 0, packCount: 1, discount: 2, route: discountSteps(2) })).toBe(
      "折扣只套在沒促銷的品項上"
    )
    expect(quoteBlocked({ ...base, discount: 5, route: discountSteps(5) })).toBe("要送簽核，請寫申請理由")
    expect(quoteBlocked({ ...base, packCount: 1, discount: 5, route: discountSteps(5), reason: "量大" })).toBeNull()
    expect(quoteBlocked({ ...base, plainCount: 0, packCount: 1 })).toBeNull()
  })
})

describe("packDeal", () => {
  it("買幾送幾；直走價不送同品", () => {
    expect(packDeal({ buy_qty: 22, free_qty: 1 })).toBe("買 22 送 1")
    expect(packDeal({ buy_qty: 7, free_qty: 0 })).toBe("直走 7")
  })
})
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `npm --prefix frontend test -- src/lib/quote.test.ts`
Expected: FAIL（找不到 `@/lib/quote`）

- [ ] **Step 3: 實作 lib**

`frontend/src/lib/quote.ts`：

```ts
import type { DiscountSteps } from "@/lib/approval"

/**
 * 整張報價的金額，算法跟後端一樣（api/customers.py）：折扣只套在沒促銷的列，單價到分；
 * 促銷的口照每口售價、不打折；整張到元
 */
export function quoteTotal(
  plain: { qty: number; unitPrice: number }[],
  packs: { packs: number; dealPrice: number }[],
  pct: number
) {
  const keep = 200 - Math.round(pct * 2)
  const discounted = plain.reduce((sum, line) => sum + (Math.round((line.unitPrice * keep) / 2) / 100) * line.qty, 0)
  return Math.round(discounted + packs.reduce((sum, line) => sum + line.dealPrice * line.packs, 0))
}

/** 送不出去的原因，寫在按鈕上；送得出去是 null */
export function quoteBlocked(input: {
  plainCount: number
  packCount: number
  discount: number
  route: DiscountSteps
  reason: string
}) {
  if (input.plainCount + input.packCount === 0) return "至少要有一項數量大於 0"
  if (!input.route.valid) return input.route.text
  if (input.discount > 0 && input.plainCount === 0) return "折扣只套在沒促銷的品項上"
  if (input.route.steps.length > 0 && !input.reason.trim()) return "要送簽核，請寫申請理由"
  return null
}

/** 一口的搭贈寫成一句：買 22 送 1；直走價不送同品，寫「直走 7」 */
export function packDeal(pack: { buy_qty: number; free_qty: number }) {
  return pack.free_qty > 0 ? `買 ${pack.buy_qty} 送 ${pack.free_qty}` : `直走 ${pack.buy_qty}`
}
```

- [ ] **Step 4: 跑測試，確認通過**

Run: `npm --prefix frontend test -- src/lib/quote.test.ts`
Expected: PASS

- [ ] **Step 5: API 型別**

`frontend/src/api/customers.ts`，接在 `QuoteItem` 後面：

```ts
// 開報價時這一期的促銷：依品項列出每一口。supply_price 是這家的供貨價，給「不走促銷」那一列；
// usual 是這個品項已經在常進品項裡，不重複列「不走促銷」
export type QuotePack = { code: string; name: string; deal: string; buy_qty: number; free_qty: number; deal_price: number }
export type QuotePromotion = {
  name: string
  // PM 提醒原文：滿額贈這類看整張訂單的活動，系統不算
  pm_note: string
  products: {
    group_name: string
    sku: string
    name: string
    spec: string
    unit: string
    supply_price: number
    usual: boolean
    packs: QuotePack[]
  }[]
}

// 報價的一列：品項 × 數量，或是促銷的某一口 × 口數
export type QuoteLineInput = { sku: string; qty: number } | { promo_code: string; packs: number }
```

`Quote.items` 的型別換成：

```ts
  items: {
    sku: string
    name: string
    qty: number
    unit_price: number
    amount: number
    promo_code: string | null
    packs: number | null
    free_qty: number
    deal: string | null
  }[]
```

`getQuoteItems` 後面加：

```ts
/** 沒有進行中的一期是 null */
export function getQuotePromotion(id: string, signal?: AbortSignal) {
  return request<QuotePromotion | null>(`/api/customers/${encodeURIComponent(id)}/quote-promotion`, { signal })
}
```

`createQuote` 的 `items` 參數型別改成 `QuoteLineInput[]`，註解改成「數量或口數 0 的列不要送」。

- [ ] **Step 6: 報價頁**

`frontend/src/pages/quote.tsx`：

1. import：`createQuote, getCustomer, getQuoteItems, getQuotePromotion, type Customer, type QuoteItem, type QuotePromotion`；`import { packDeal, quoteBlocked, quoteTotal } from "@/lib/quote"`；`formatMoney` 已有。刪掉檔案裡的 `discountedTotal`。
2. `LoadState` 的 ready 加 `promotion: QuotePromotion | null`；載入：

```ts
    Promise.all([
      getCustomer(customerId, controller.signal),
      getQuoteItems(customerId, controller.signal),
      getQuotePromotion(customerId, controller.signal),
    ])
      .then(([customer, items, promotion]) => {
        // 預設都不列入：報價通常只有一兩項，全部預填常進數量的話，直接按送出就是一張十幾項的報價單寫進 SAP。
        // 每一列的「常進 N」點一下就填入；促銷的口與「不走促銷」也是 0
        const skus = [...items.map((item) => item.sku), ...(promotion?.products ?? []).filter((p) => !p.usual).map((p) => p.sku)]
        setQuantities(Object.fromEntries(skus.map((sku) => [sku, "0"])))
        setPackCounts(Object.fromEntries((promotion?.products ?? []).flatMap((p) => p.packs.map((pack) => [pack.code, "0"]))))
        setState({ status: "ready", customer, items, promotion })
      })
```

   加 state：`const [packCounts, setPackCounts] = useState<Quantities>({})`。
3. 計算（取代原本的 `lines`、`chosen`、`listTotal`、`total`、`blocked`）：

```ts
  const items = state.status === "ready" ? state.items : []
  const promotion = state.status === "ready" ? state.promotion : null
  // 促銷品項沒有交易，不在常進品項裡：「不走促銷」那一列照供貨價，跟常進品項一起算
  const extraPlain: QuoteItem[] = (promotion?.products ?? [])
    .filter((p) => !p.usual)
    .map((p) => ({ sku: p.sku, name: p.name, spec: p.spec, unit: p.unit, unit_price: p.supply_price, usual_qty: 0 }))
  const lines = items.map((item) => ({ item, qty: parseQty(quantities[item.sku]) }))
  const chosen = [...items, ...extraPlain]
    .map((item) => ({ item, qty: parseQty(quantities[item.sku]) }))
    .filter((line) => line.qty > 0)
  const packs = (promotion?.products ?? []).flatMap((p) => p.packs)
  const chosenPacks = packs.map((pack) => ({ pack, count: parseQty(packCounts[pack.code]) })).filter((line) => line.count > 0)
  const packLines = chosenPacks.map((line) => ({ packs: line.count, dealPrice: line.pack.deal_price }))
  const plainLines = chosen.map((line) => ({ qty: line.qty, unitPrice: line.item.unit_price }))
  const discount = parseDiscount(discountText)
  const route = discountSteps(discount)
  const needsApproval = route.steps.length > 0
  const listTotal = quoteTotal(plainLines, packLines, 0)
  const total = route.valid ? quoteTotal(plainLines, packLines, discount) : listTotal
  const blocked = quoteBlocked({ plainCount: chosen.length, packCount: chosenPacks.length, discount, route, reason })
```

4. `submit` 送出的 items：

```ts
        [
          ...chosen.map((line) => ({ sku: line.item.sku, qty: line.qty })),
          ...chosenPacks.map((line) => ({ promo_code: line.pack.code, packs: line.count })),
        ],
```

5. 「這家近半年沒有進貨紀錄」的 Notice 只在 `items.length === 0 && !promotion` 時顯示；清單與底部固定區塊的條件 `items.length > 0` 改成 `items.length > 0 || promotion !== null`；常進品項的說明與 `<ul>` 只在 `items.length > 0` 時顯示。
6. 常進品項 `</ul>` 後面加「這一期的促銷」區塊。品牌分組照第一次出現的順序：

```tsx
        {promotion && (
          <section className="flex flex-col gap-2 pt-2">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold">這一期的促銷</h2>
              <span className="text-xs text-muted-foreground">{promotion.name}</span>
            </div>
            {promotion.pm_note && (
              <details className="rounded-xl border-2 bg-card px-4 py-3 text-xs shadow-lip">
                <summary className="min-h-11 cursor-pointer content-center font-medium">整張訂單的活動</summary>
                <p className="mt-1 whitespace-pre-line text-muted-foreground">{promotion.pm_note}</p>
                <p className="mt-2 text-muted-foreground">系統不算滿額贈與禮券，給你跟客戶談的時候參考。</p>
              </details>
            )}
            {groupBy(promotion.products, (p) => p.group_name).map(([group, products]) => (
              <div key={group} className="flex flex-col gap-2">
                <h3 className="pt-1 text-xs font-medium text-muted-foreground">{group}</h3>
                {products.map((product) => (
                  <ul key={product.sku} className="flex flex-col gap-2">
                    {product.packs.map((pack) => {
                      const count = parseQty(packCounts[pack.code])
                      return (
                        <li key={pack.code} className={cn("rounded-xl border-2 bg-card px-4 py-3 shadow-lip", count === 0 && "bg-muted/60")}>
                          <div className="flex items-baseline justify-between gap-3">
                            <p className={cn("min-w-0 text-sm font-medium", count === 0 && "text-muted-foreground")}>{pack.name}</p>
                            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatMoney(pack.deal_price)} / 口</span>
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {packDeal(pack)}・{pack.deal}
                          </p>
                          <div className="mt-2 flex items-center gap-2">
                            <Input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              step={1}
                              value={packCounts[pack.code] ?? ""}
                              onChange={(event) => setPackCounts((current) => ({ ...current, [pack.code]: event.target.value }))}
                              aria-label={`${pack.name} 口數`}
                              className="h-11 w-24 bg-card tabular-nums"
                            />
                            <span className="text-sm text-muted-foreground">口</span>
                            <span className={cn("ml-auto text-sm tabular-nums", count === 0 ? "text-muted-foreground" : "font-medium")}>
                              {count === 0 ? "不列入" : formatMoney(count * pack.deal_price)}
                            </span>
                          </div>
                        </li>
                      )
                    })}
                    {!product.usual && (
                      <li className={cn("rounded-xl border-2 bg-card px-4 py-3 shadow-lip", parseQty(quantities[product.sku]) === 0 && "bg-muted/60")}>
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="min-w-0 text-sm font-medium text-muted-foreground">
                            {product.name} 不走促銷
                          </p>
                          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                            {formatMoney(product.supply_price)} / {product.unit}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <Input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            step={1}
                            value={quantities[product.sku] ?? ""}
                            onChange={(event) => setQuantities((current) => ({ ...current, [product.sku]: event.target.value }))}
                            aria-label={`${product.name} 不走促銷的數量`}
                            className="h-11 w-24 bg-card tabular-nums"
                          />
                          <span className="text-sm text-muted-foreground">{product.unit}</span>
                          <span className="ml-auto text-sm tabular-nums text-muted-foreground">
                            {parseQty(quantities[product.sku]) === 0
                              ? "不列入"
                              : formatMoney(parseQty(quantities[product.sku]) * product.supply_price)}
                          </span>
                        </div>
                      </li>
                    )}
                  </ul>
                ))}
              </div>
            ))}
          </section>
        )}
```

   檔案裡加一個小工具（放在 `parseQty` 後面）：

```ts
/** 依 key 分組，保留第一次出現的順序：促銷品項的編號本來就依品牌排在一起 */
function groupBy<T>(rows: T[], key: (row: T) => string): [string, T[]][] {
  const groups = new Map<string, T[]>()
  for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row])
  return [...groups]
}
```

7. 底部固定區塊：折扣說明那一行下面，有選口時加一行：

```tsx
          {chosenPacks.length > 0 && <p className="text-xs text-muted-foreground">折扣只套在沒促銷的品項，促銷的口照每口售價</p>}
```

   合計那一行改成 `合計 {chosen.length + chosenPacks.length} 項`。

- [ ] **Step 7: 型別與 lint**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend run lint && npm --prefix frontend test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib/quote.ts frontend/src/lib/quote.test.ts frontend/src/api/customers.ts frontend/src/pages/quote.tsx
git commit -m "Show this period's packs on the quote page and quote them at their deal price"
```

---

### Task 8: 確認頁選口、一行摘要寫出口

**Files:**
- Create: `frontend/src/components/visit/field-format.test.ts`
- Modify: `frontend/src/components/visit/field-format.ts`
- Modify: `frontend/src/components/visit/field-editor.tsx`
- Modify: `frontend/src/components/visit/confirm-view.tsx`

**Interfaces:**
- Consumes: `IntentItem.promo_code`（Task 5）、`packDeal`（Task 7）、`listPromotions`、`PromotionItem`（`@/api/promotions`）。
- Produces: `summarize(key, fields, packs?: Record<string, PromotionItem>)`、`intentLine(item: IntentItem, pack?: PromotionItem): string`、`usePromotions(): Promotion[]`（`field-editor.tsx` 匯出，`confirm-view.tsx` 用）。

- [ ] **Step 1: 寫失敗的測試**

`frontend/src/components/visit/field-format.test.ts`：

```ts
import { describe, expect, it } from "vitest"

import type { PromotionItem } from "@/api/promotions"
import { intentLine } from "@/components/visit/field-format"

const SMALL = {
  code: "PP-1",
  name: "Premium眼藥水(小口)",
  sku: "F749579",
  buy_qty: 22,
  free_qty: 1,
  deal_price: 5500,
} as PromotionItem

describe("intentLine", () => {
  it("促銷的口寫出買幾送幾與金額", () => {
    const item = { product_text: "小口 Premium", sku: "F749579", qty: 2, unit: "口", promo_code: "PP-1" }
    expect(intentLine(item, SMALL)).toBe("Premium眼藥水(小口) × 2 口（買 22 送 1，NT$11,000）")
  })
  it("沒促銷、或查不到那一口，照口述講法", () => {
    expect(intentLine({ product_text: "魚油", sku: "HS-FO30", qty: 20, unit: "盒", promo_code: null })).toBe("魚油 × 20盒")
    expect(intentLine({ product_text: "小口眼藥水", sku: null, qty: 1, unit: "口", promo_code: "PP-9" })).toBe("小口眼藥水 × 1口")
  })
})
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `npm --prefix frontend test -- src/components/visit/field-format.test.ts`
Expected: FAIL（`intentLine` 不存在）

- [ ] **Step 3: 一行摘要**

`frontend/src/components/visit/field-format.ts`：import 加 `import type { PromotionItem } from "@/api/promotions"`、`import { formatMoney } from "@/lib/format"`、`import { packDeal } from "@/lib/quote"`、`IntentItem` 型別。

```ts
/** 意向的一項：促銷的口寫「Premium眼藥水(小口) × 1 口（買 22 送 1，NT$5,500）」，其他照口述講法 */
export function intentLine(item: IntentItem, pack?: PromotionItem) {
  if (item.promo_code && pack && item.qty) {
    return `${pack.name} × ${item.qty} 口（${packDeal(pack)}，${formatMoney(pack.deal_price * item.qty)}）`
  }
  return `${item.product_text} × ${item.qty ?? "？"}${item.unit ?? ""}`
}
```

`summarize` 加第三個參數 `packs: Record<string, PromotionItem> = {}`，intent 那一行：

```ts
      return fields.intent?.map((i) => intentLine(i, i.promo_code ? packs[i.promo_code] : undefined)).join("、") || null
```

- [ ] **Step 4: 跑測試，確認通過**

Run: `npm --prefix frontend test -- src/components/visit/field-format.test.ts`
Expected: PASS

- [ ] **Step 5: 編輯時選口**

`frontend/src/components/visit/field-editor.tsx`：

import 加 `import { listPromotions, type Promotion } from "@/api/promotions"`、`import { formatMoney } from "@/lib/format"`、`import { packDeal } from "@/lib/quote"`。在 `useProducts` 旁加（同樣用模組層的 promise 快取）：

```ts
let promotionsPromise: Promise<Promotion[]> | null = null

/** 每一期的促銷：確認頁的摘要照編號查（不管哪一期），編輯時只列進行中那一期的口 */
export function usePromotions() {
  const [promotions, setPromotions] = useState<Promotion[]>([])
  useEffect(() => {
    promotionsPromise ??= listPromotions()
    promotionsPromise.then(setPromotions).catch(() => {
      promotionsPromise = null
    })
  }, [])
  return promotions
}
```

`IntentEditor` 裡：

```ts
  const promotions = usePromotions()
  const running = promotions.find((p) => p.status === "進行中")?.items ?? []
  const allPacks = promotions.flatMap((p) => p.items)

  function choosePack(index: number, code: string) {
    const row = rows[index]
    const product = products.find((p) => p.sku === row.sku)
    update(index, { ...row, promo_code: code || null, unit: code ? "口" : (product?.unit ?? row.unit) })
  }
```

每一列的品項選單下面、數量欄上面加：

```tsx
          {(() => {
            // 這一期這個品項的口；已經選了別期的口（換期前抽的）也列出來，選單才不會跳掉
            const options = running.filter((pack) => pack.sku === row.sku)
            const chosen = allPacks.find((pack) => pack.code === row.promo_code)
            if (chosen && !options.includes(chosen)) options.push(chosen)
            if (!row.sku || options.length === 0) return null
            return (
              <select
                value={row.promo_code ?? ""}
                onChange={(e) => choosePack(index, e.target.value)}
                aria-label="促銷的口"
                className="h-11 min-w-0 rounded-xl border-2 border-input bg-card px-3 text-sm shadow-lip"
              >
                <option value="">不走促銷</option>
                {options.map((pack) => (
                  <option key={pack.code} value={pack.code}>
                    {pack.name}　{packDeal(pack)}　{formatMoney(pack.deal_price)}/口
                  </option>
                ))}
              </select>
            )
          })()}
```

數量欄的 `placeholder` 與 `aria-label` 改成 `row.promo_code ? "口數" : "數量"`。說明文字改成「送出 SAP 報價草稿需要每一項都有品項和數量；選了促銷的口，數量就是口數。」

- [ ] **Step 6: 確認頁傳入口的資料**

`frontend/src/components/visit/confirm-view.tsx`：import `usePromotions`；元件裡：

```ts
  const promotions = usePromotions()
  const packs = Object.fromEntries(promotions.flatMap((p) => p.items).map((pack) => [pack.code, pack]))
```

`summarize(key, visit.fields)` 改成 `summarize(key, visit.fields, packs)`。

- [ ] **Step 7: 型別、lint、全部前端測試**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend run lint && npm --prefix frontend test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/visit/field-format.ts frontend/src/components/visit/field-format.test.ts frontend/src/components/visit/field-editor.tsx frontend/src/components/visit/confirm-view.tsx
git commit -m "Let the rep pick a promotion pack on the confirm page and show it in the summary"
```

---

### Task 9: 文件、真的 Gemini、整套跑起來看

**Files:**
- Modify: `README.md`（「開報價」那一條、「口述到回寫」、目錄說明加 `promo_packs.py`）
- Create（不 commit）: scratchpad 裡的 `check_promo_extraction.py`、`drive_quote.mjs`

- [ ] **Step 1: README**

「客戶檔案與談判卡」的「開報價」那一條，最後加：

```markdown
  - **照促銷的口開**（`docs/superpowers/specs/2026-10-07-quote-promotion-packs-design.md`）：常進品項下面列這一期的促銷，依品牌、品項列出每一口（小口、中口、大口），填口數就照每口售價列入；每個促銷品項另有一列「不走促銷」照供貨價（促銷品項沒有交易，不會出現在常進品項）。折扣只套在沒促銷的列，簽核看的金額與毛利也只算那幾列。三種客戶都能選口，連鎖照供貨價有時比較便宜，由業務自己判斷。滿額贈與禮券不算，只列 PM 提醒原文。
```

「口述到回寫」第 2 點後面加一句：「意向講到促銷的口（「幫我開小口 Premium 眼藥水」）時，AI 對照這一期的促銷填是哪一口，數量是口數；講得模糊、對不到唯一一口的就留空讓業務在確認頁選。回寫 SAP 照每口售價記。」

目錄說明在 `backend/app/services/approvals.py` 那一行前面加：

```
backend/app/services/promo_packs.py 促銷的口：這一期有哪些、照編號查、一口換算成報價的一列
```

- [ ] **Step 2: 全部後端測試**

Run: `TEST_DB_NAME=meddemo_test_promo TEST_REDIS_URL=redis://127.0.0.1:6379/13 uv run --project backend pytest backend/tests -q`
Expected: PASS

- [ ] **Step 3: 真的 Gemini 抽六句**

把主 checkout 的 `backend/.env` 複製進 worktree 的 `backend/.env`（不讀內容），用 scratchpad 的腳本跑 `LLMFieldExtractor`。六句：

1. 「店長說幫我開一個小口 Premium 眼藥水。」→ Premium 小口那一口、1 口
2. 「金舒胃得大口兩口。」→ 金舒胃得大口那一口、2 口
3. 「他想先進魚油二十盒。」→ HS-FO30、20 盒、`promo_code` null
4. 「小口眼藥水先來一個。」→ `sku` 與 `promo_code` 都 null
5. 「骨營膠囊大口一口，另外 Premium 眼藥水不要促銷的二十盒。」→ 骨營大口 1 口；F749579 20 盒、`promo_code` null
6. 「威鎮凝膠買十一送二那個來兩口。」→ 威鎮凝膠那一口、2 口

腳本照 `visit_processing._extract` 的做法：`current_packs` → `extract` → `validate_fields` → `drop_unknown_packs`，印出每句的 intent 與是否符合期望。跑完刪掉 worktree 的 `backend/.env`。
Expected: 六句都沒有 schema 錯誤；抽出來的口與口數照期望。不符合的句子調整第 9 條規則的措辭後重跑。

- [ ] **Step 4: 整套跑起來，用 headless Chrome 開一張報價**

照 `run-stack-from-a-worktree` 的做法：建 `meddemo_promo_dev` 資料庫並灌假資料，API 開在 8012（`REDIS_URL=redis://127.0.0.1:6379/12`），前端 build 之後用靜態伺服器與臨時 proxy。headless Chrome 每段不超過 20 秒：

1. 林昱辰登入，開康泰忠孝店（C001）的報價頁，截圖確認「這一期的促銷」與「不走促銷」。
2. 填 Premium 小口 1 口、魚油 20 盒、折扣 2%，確認合計，送出。
3. 回到客戶檔案，確認待處理事項寫「魚油 30 入 × 20、Premium眼藥水(小口) × 1 口」（順序照填的列）與金額。

Expected: 畫面跟上面一致；手機寬度（390px）沒有橫向捲動。

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "Describe quoting by promotion pack in the README"
```
