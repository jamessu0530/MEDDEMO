# 頻道左右兩欄與文字頻道 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 頻道頁改成 Discord 手機版的左右兩欄，整區與全國頻道底下可以開「文字頻道」（區的在職主管與 IT 開，全國只有 IT）。

**Architecture:** 文字頻道是既有 `channel` 表的新種類 `topic`，用 `unit_id` 指它所在的區或根節點，`describe` 把它的上層算成那一區（全國）的頻道，訊息、記憶、往上傳、搜尋、在線狀態全部沿用。開、改名、封存放在新的 `services/channel_topics.py` 與兩個新端點，commit 後發 `{"type": "channels"}` 即時事件。前端 `/channels` 改成左欄（`components/channel-rail.tsx`）加右欄（`components/channel-panel.tsx`），純邏輯放 `lib/channel-rail.ts` 並用 vitest 測。

**Tech Stack:** FastAPI、SQLAlchemy 2、PostgreSQL（pgvector 映像）、Redis pub/sub、pytest；React 19、react-router 8、Tailwind 4、shadcn 元件、lucide-react、vitest。

**Spec:** `docs/superpowers/specs/2026-10-01-channel-rail-design.md`

## Global Constraints

- 所有程式註解、畫面文字、錯誤訊息用繁體中文，語氣跟既有程式一樣（短句、說為什麼）。
- 畫面不用表情符號，圖示一律用 lucide 線條圖示。
- 文字頻道名稱 1～20 字（前後空白去掉後算），同一個單位（區或根節點）不能重名、不分大小寫，封存的也算。
- 開頻道：區裡是 `user.unit_id` 等於那一區的在職主管與 IT；全國只有 IT。小組、地點底下不能開；業務與自建帳號都不能開。
- 改名、封存：文字頻道所在那一區的在職主管與 IT（全國的文字頻道只有 IT），不限原本開的人。不能刪除。
- 封存的文字頻道：還看得到、唯讀（發言 409、記憶不能改、熊熊滾不回答不整理）、可以解除封存。封存的小組頻道規則不變（只有 IT 看得到）。
- 錯誤碼：看不到 404；上層不是全國或整區、要改的不是文字頻道 400；不能管 403；名稱不對 422；重名 409（訊息「北區已經有叫「新品上市」的頻道」）。
- 現有網址 `/channels/:id`、`/channels/:id/threads`、`/channels/search` 不改。
- 手機版面，跟其他頁一樣；不做平板與電腦的三欄。
- 語音、通話、直播都不做。

## 開發環境（每個任務都一樣）

工作目錄是 worktree：`/Users/jamessu/Desktop/computersciencehomework/MEDDEMO/.worktrees/channel-rail`。其他 session 同時在別的 worktree 改頻道，**不要**在主目錄動任何東西。

- 後端測試（PostgreSQL 在 docker-compose 的 5433、Redis 在 6379）：
  `TEST_DB_NAME=meddemo_test_rail TEST_REDIS_URL=redis://127.0.0.1:6379/7 uv run --project backend pytest backend/tests -q`
  單一檔案把最後的路徑換成檔案，例如 `backend/tests/test_channel_topics.py`。
- 前端（第一次先在 `frontend/` 跑 `npm ci`）：`npm --prefix frontend test`、`npm --prefix frontend run typecheck`、`npm --prefix frontend run lint`、`npm --prefix frontend run build`。
- commit 訊息用英文祈使句（跟 `git log` 一樣，例如 "Let managers open text channels in their region"），結尾加一行空白與
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。

## 檔案地圖

| 檔案 | 動作 | 責任 |
|---|---|---|
| `backend/app/models.py` | 改 | `Channel` 多 `topic` 種類、`name`、`created_by`、`archived_at`；約束與部分唯一索引 |
| `backend/app/services/channels.py` | 改 | `describe`、`can_see`、排序、`ensure_channels`、紅點認得文字頻道 |
| `backend/app/services/channel_topics.py` | 新 | 誰能管、開、改名、封存 |
| `backend/app/api/channels.py` | 改 | `can_manage` 欄位、`POST /api/channels`、`PATCH /api/channels/{id}`、封存訊息 |
| `backend/app/api/memory.py` | 改 | 封存訊息不再寫死「小組頻道」 |
| `backend/app/api/presence.py` | 改 | WebSocket 轉送 `channels` 事件 |
| `backend/app/realtime.py` | 改 | `channels_changed()` |
| `backend/app/services/channel_ai.py` | 改 | `KIND_LABEL` 多 `topic` |
| `data/seed/catalog.py`、`data/seed/seed.py` | 改 | 示範文字頻道與對話 |
| `backend/tests/test_channel_topics.py` | 新 | 文字頻道的測試 |
| `backend/tests/test_channels.py`、`test_seed.py` 等 | 改 | 灌資料多了文字頻道後的數字 |
| `backend/scripts/stress_channels.py` | 新 | 本機壓力測試 |
| `frontend/src/api/channels.ts` | 改 | `topic`、`can_manage`、`createTopic`、`updateTopic` |
| `frontend/src/lib/channel-rail.ts`（＋`.test.ts`） | 新 | 左欄分組、兩個字、未讀加總、預設選哪個、返回路徑 |
| `frontend/src/lib/channels.ts`（＋`.test.ts`） | 改 | 移除 `groupChannels`、`sortUnreadFirst`；多 `KIND_LABEL` |
| `frontend/src/lib/realtime.ts`（＋`.test.ts`） | 改 | 收 `channels` 事件 |
| `frontend/src/components/channel-rail.tsx` | 新 | 左欄 |
| `frontend/src/components/channel-panel.tsx` | 新 | 右欄 |
| `frontend/src/components/topic-dialogs.tsx` | 新 | 新增與管理對話框 |
| `frontend/src/components/channel-row.tsx` | 改 | 匯出 `channelDetail` |
| `frontend/src/components/user-avatar.tsx` | 改 | 匯出底色 `AVATAR_TONES` |
| `frontend/src/pages/channels.tsx` | 重寫 | 兩欄頁 |
| `frontend/src/pages/channel.tsx` | 改 | 返回路徑、`state.tab`、`KIND_LABEL`、封存文字 |
| `frontend/src/pages/channel-search.tsx` | 改 | 返回鍵優先用 `state.backTo` |
| `README.md` | 改 | 頻道段落 |

---

### Task 1: 文字頻道的資料、權限、排序與紅點（含示範資料）

**Files:**
- Modify: `backend/app/models.py:657-695`（`CHANNEL_KINDS` 與 `class Channel`）
- Modify: `backend/app/services/channels.py`（`KIND_ORDER`、`LEVEL` 附近、`ChannelInfo`、`ensure_channels`、`describe`、`can_see`、`_order`、`visible_channels`、`badge_count`）
- Modify: `backend/app/api/channels.py`（`post_message` 的 409 訊息）
- Modify: `backend/app/api/memory.py:121`
- Modify: `backend/app/services/channel_ai.py:34-36`
- Modify: `data/seed/catalog.py`（`CONVERSATIONS` 前後）
- Modify: `data/seed/seed.py:135-165`、`:358-360`
- Create: `backend/tests/test_channel_topics.py`
- Modify: `backend/tests/test_channels.py`、`backend/tests/test_seed.py`（以及跑全套後因為多了示範文字頻道而變的數字）

**Interfaces:**
- Produces:
  - `models.Channel.name: str | None`、`created_by: str | None`、`archived_at: datetime | None`；`kind` 可以是 `"topic"`；`models.TOPIC_NAME_MAX = 20`。
  - 索引名稱：`uq_channel_unit_id`（全國與整區每單位一個）、`uq_channel_topic_name`（同單位文字頻道名稱不分大小寫唯一）。
  - `channels.describe` 對 `topic` 回 `ChannelInfo(kind="topic", name=channel.name, path=單位 id, region_id=區 id 或 None, parent_id=該單位的全國／整區頻道 id, archived=archived_at 有值, audience=...)`。
  - `channels.can_see` 只對 `kind == "team"` 的封存頻道限 IT。
  - `channels.Archived` 也用在封存的文字頻道；API 訊息「這個頻道已封存，不能再發言」。
  - 示範資料：全國「公司公告」（A01）、北區「新品上市」「補貨問題」（M01），依這個順序建立。

- [ ] **Step 1: 寫失敗的測試** — 新檔 `backend/tests/test_channel_topics.py`：

```python
"""文字頻道（docs/superpowers/specs/2026-10-01-channel-rail-design.md）：區的主管與 IT 在整區頻道、IT 在全國頻道底下開的頻道。

灌資料放了三個：全國「公司公告」（A01 開）、北區「新品上市」「補貨問題」（M01 開）。
會發言或改資料的測試都跑在 tx fixture 的交易裡（conftest.py），測完回滾。
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.main import app
from app.models import Channel
from app.services import channels


@pytest.fixture
def client():
    return TestClient(app)


def listing(client, headers) -> list[dict]:
    response = client.get("/api/channels", headers=headers)
    assert response.status_code == 200
    return response.json()


def by_name(client, headers) -> dict[str, dict]:
    return {c["name"]: c for c in listing(client, headers)}


def topic_names(client, headers) -> list[str]:
    return [c["name"] for c in listing(client, headers) if c["kind"] == "topic"]


def post(client, headers, channel_id: int, body: str):
    return client.post(f"/api/channels/{channel_id}/messages", json={"body": body}, headers=headers)


def test_topics_hang_under_their_region_or_the_whole_company(engine):
    with Session(engine) as session:
        infos = {i.name: i for i in channels.describe(session, list(session.scalars(select(Channel))))}
    news, notice = infos["新品上市"], infos["公司公告"]
    assert (news.kind, news.path, news.region_id, news.parent_id) == ("topic", "TW.N", "TW.N", infos["北區"].id)
    assert (news.audience, news.archived) == ("北區所有人都看得到", False)
    assert (notice.kind, notice.path, notice.region_id, notice.parent_id) == ("topic", "TW", None, infos["全國"].id)
    assert notice.audience == "全公司都看得到"
    # 文字頻道也用 unit_id 指北區，整區與小組頻道的上層不能被它搶走
    assert infos["北區"].parent_id == infos["全國"].id
    assert infos["陳建宏小組"].parent_id == infos["北區"].id
    assert infos["台北市・大安區"].parent_id == infos["北區"].id


def test_everyone_in_the_region_sees_its_topics_and_everyone_sees_the_national_ones(client, auth):
    assert topic_names(client, auth("U01")) == ["公司公告", "新品上市", "補貨問題"]
    assert topic_names(client, auth("M01")) == ["公司公告", "新品上市", "補貨問題"]
    assert topic_names(client, auth("U04")) == ["公司公告"]
    assert topic_names(client, auth("A01")) == ["公司公告", "新品上市", "補貨問題"]
    news = by_name(client, auth("U01"))["新品上市"]
    assert news["parent_id"] == by_name(client, auth("U01"))["北區"]["id"]
    for path in (f"/api/channels/{news['id']}", f"/api/channels/{news['id']}/messages"):
        assert client.get(path, headers=auth("U04")).status_code == 404


def test_topics_sit_right_after_their_parent(client, auth):
    order = [c["name"] for c in listing(client, auth("U01"))]
    assert order[:6] == ["全國", "公司公告", "北區", "新品上市", "補貨問題", "陳建宏小組"]


def test_an_archived_topic_stays_visible_but_read_only(tx, client, auth):
    news = by_name(client, auth("U01"))["新品上市"]
    tx.execute(update(Channel).where(Channel.id == news["id"]).values(archived_at=func.now()))
    tx.flush()
    listed = by_name(client, auth("U01"))["新品上市"]
    assert listed["archived"] is True
    # 封存的排在同一層沒封存的後面
    assert topic_names(client, auth("U01")) == ["公司公告", "補貨問題", "新品上市"]
    assert client.get(f"/api/channels/{news['id']}/messages", headers=auth("U01")).status_code == 200
    refused = post(client, auth("U01"), news["id"], "還能說嗎")
    assert refused.status_code == 409
    assert refused.json()["detail"] == "這個頻道已封存，不能再發言"


def test_the_badge_counts_topics_under_my_region_and_the_whole_company(tx, client, auth):
    def badge(user_id: str) -> int:
        return client.get("/api/channels/unread", headers=auth(user_id)).json()["count"]

    south = Channel(kind="topic", unit_id="TW.S", name="南區檔期", created_by="M03")
    tx.add(south)
    tx.flush()
    u01, u04 = badge("U01"), badge("U04")
    assert post(client, auth("M03"), south.id, "高雄這週加訂").status_code == 201
    assert (badge("U01"), badge("U04")) == (u01, u04 + 1)
    news = by_name(client, auth("U01"))["新品上市"]
    assert post(client, auth("M01"), news["id"], "試吃包下週到").status_code == 201
    assert badge("U01") == u01 + 1
    # 封存的文字頻道不算紅點：灌資料的兩則加上剛剛那一則都不算了
    tx.execute(update(Channel).where(Channel.id == news["id"]).values(archived_at=func.now()))
    tx.flush()
    assert badge("U01") == u01 - 2


def test_ensure_channels_does_not_mistake_a_topic_for_the_region_channel(tx):
    tx.execute(delete(Channel).where(Channel.kind == "region", Channel.unit_id == "TW.C"))
    tx.add(Channel(kind="topic", unit_id="TW.C", name="中區檔期", created_by="M02"))
    tx.flush()
    channels.ensure_channels(tx)
    assert tx.scalar(select(func.count()).select_from(Channel).where(Channel.kind == "region", Channel.unit_id == "TW.C")) == 1


@pytest.mark.parametrize(
    "duplicate",
    [
        lambda: Channel(kind="region", unit_id="TW.N"),
        lambda: Channel(kind="topic", unit_id="TW.N", name="新品上市", created_by="M01"),
        lambda: Channel(kind="topic", unit_id="TW", name="公司公告", created_by="A01"),
    ],
    ids=["second-region-channel", "same-topic-name", "same-national-topic-name"],
)
def test_the_database_refuses_duplicates(tx, duplicate):
    with pytest.raises(IntegrityError), tx.begin_nested():
        tx.add(duplicate())
        tx.flush()


def test_topic_names_ignore_case_and_only_clash_within_one_unit(tx):
    tx.add(Channel(kind="topic", unit_id="TW.N", name="Promo", created_by="M01"))
    tx.add(Channel(kind="topic", unit_id="TW.S", name="新品上市", created_by="M03"))
    tx.flush()
    with pytest.raises(IntegrityError), tx.begin_nested():
        tx.add(Channel(kind="topic", unit_id="TW.N", name="PROMO", created_by="M01"))
        tx.flush()


def test_only_topics_have_a_name_and_every_topic_has_one(tx):
    for bad in (
        Channel(kind="topic", unit_id="TW.N", created_by="M01"),
        Channel(kind="region", unit_id="TW.N", name="北北區"),
    ):
        with pytest.raises(IntegrityError), tx.begin_nested():
            tx.add(bad)
            tx.flush()
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `TEST_DB_NAME=meddemo_test_rail TEST_REDIS_URL=redis://127.0.0.1:6379/7 uv run --project backend pytest backend/tests/test_channel_topics.py -q`
Expected: FAIL（`Channel` 沒有 `name` 參數，或找不到「新品上市」）。

- [ ] **Step 3: 改資料表** — `backend/app/models.py`。`CHANNEL_KINDS` 那一段換成：

```python
# national：全國；region：整區；team：一位主管帶的小組；place：地點（縣市，台北市到行政區）；customer：一家客戶的討論串；
# topic：文字頻道，區的主管與 IT 在整區頻道、IT 在全國頻道底下開的（docs/superpowers/specs/2026-10-01-channel-rail-design.md）
CHANNEL_KINDS = ("national", "region", "team", "place", "customer", "topic")
# 文字頻道的名稱最多幾個字（services/channel_topics.py、前端的新增對話框一樣）
TOPIC_NAME_MAX = 20
```

`class Channel` 的 docstring、`__table_args__` 與欄位換成：

```python
class Channel(Base):
    """頻道。不存路徑，只記屬於誰：路徑每次從組織樹現算（services/channels.py），
    主管調區、客戶換負責人都不必另外同步。文字頻道另外存名稱、誰開的、封存時間。"""

    __tablename__ = "channel"
    __table_args__ = (
        one_of("kind", CHANNEL_KINDS, "kind"),
        # 依種類只有一個歸屬欄位有值；文字頻道用 unit_id 指它所在的區或根節點，另外一定要有名稱
        CheckConstraint(
            "(kind IN ('national', 'region')"
            "  AND unit_id IS NOT NULL AND manager_id IS NULL AND place_id IS NULL AND customer_id IS NULL)"
            " OR (kind = 'team'"
            "  AND manager_id IS NOT NULL AND unit_id IS NULL AND place_id IS NULL AND customer_id IS NULL)"
            " OR (kind = 'place'"
            "  AND place_id IS NOT NULL AND unit_id IS NULL AND manager_id IS NULL AND customer_id IS NULL)"
            " OR (kind = 'customer'"
            "  AND customer_id IS NOT NULL AND unit_id IS NULL AND manager_id IS NULL AND place_id IS NULL)"
            " OR (kind = 'topic'"
            "  AND unit_id IS NOT NULL AND name IS NOT NULL AND manager_id IS NULL AND place_id IS NULL"
            "  AND customer_id IS NULL)",
            name="owner",
        ),
        # 只有文字頻道有自己的名稱、開的人與封存時間；其他頻道的名稱從組織樹與地點現算
        CheckConstraint(
            "kind = 'topic' OR (name IS NULL AND created_by IS NULL AND archived_at IS NULL)", name="topic_fields"
        ),
        # 每個區（與根節點）只有一個整區（全國）頻道。文字頻道也用 unit_id，不算在內
        Index("uq_channel_unit_id", "unit_id", unique=True, postgresql_where=text("kind IN ('national', 'region')")),
        # 同一個單位的文字頻道不能重名，不分大小寫；封存的也算，要沿用舊名稱先把舊的改名
        Index(
            "uq_channel_topic_name", "unit_id", text("lower(name)"), unique=True,
            postgresql_where=text("kind = 'topic'"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    kind: Mapped[str]
    # 每個歸屬只有一個頻道（NULL 不算重複）；unit_id 的唯一性只限全國與整區，見上面的索引
    unit_id: Mapped[str | None] = mapped_column(ForeignKey("org_unit.id"))
    manager_id: Mapped[str | None] = mapped_column(ForeignKey("app_user.id"), unique=True)
    place_id: Mapped[str | None] = mapped_column(ForeignKey("place.id"), unique=True)
    customer_id: Mapped[str | None] = mapped_column(ForeignKey("customer.id"), unique=True)
    # 文字頻道的名稱、誰開的、封存時間（封存了還看得到，只是不能發言）
    name: Mapped[str | None] = mapped_column(String(TOPIC_NAME_MAX))
    created_by: Mapped[str | None] = mapped_column(ForeignKey("app_user.id"))
    archived_at: Mapped[dt.datetime | None]
    # 熊熊滾已經把對話整理到哪一則（services/channel_memory.py）；還沒整理過是 NULL
    memory_through_id: Mapped[int | None] = mapped_column(BigInteger)
    created_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())
```

注意：`Channel` 有兩個指向 `app_user` 的外鍵（`manager_id`、`created_by`）。這個類別沒有 `relationship()`，所以不會有「不知道走哪條外鍵」的問題；如果哪裡用了 `select(Channel).join(AppUser)` 沒寫 ON 條件，改成明寫 `AppUser.id == Channel.manager_id`（`grep -rn "join(AppUser" backend/app` 檢查一次）。

- [ ] **Step 4: 改 `services/channels.py`**

`KIND_ORDER` 與 `LEVEL` 那一段：

```python
KIND_ORDER = ("national", "region", "topic", "team", "place", "customer")
LEVEL = {
    "national": SHARING_LEVEL["channel_national"],
    "region": SHARING_LEVEL["channel_region"],
    "team": SHARING_LEVEL["channel_team"],
    "place": SHARING_LEVEL["channel_region"],
    "customer": SHARING_LEVEL["channel_region"],
}
```

`ChannelInfo` 的 `parent_id`、`archived` 註解改成：

```python
    # 上層頻道：客戶討論串 → 地點 → 整區 → 全國；小組 → 整區；文字頻道 → 它所在的整區或全國
    parent_id: int | None
    # 不能發言：主管不在的小組頻道（只剩 IT 看得到），或有人封存的文字頻道（照樣看得到）
    archived: bool
```

`Archived` 的 docstring 改成 `"""頻道封存了：主管不在的小組頻道，或有人封存的文字頻道。只能看，不能發言。"""`

`ensure_channels` 第一行改成只看全國與整區：

```python
    have_units = set(session.scalars(select(Channel.unit_id).where(Channel.kind.in_(("national", "region")))))
```

`describe` 裡的 `by_unit` 改成只拿全國與整區（文字頻道也有 unit_id，不濾掉的話 dict 會被它蓋掉）：

```python
    # 每個單位的全國或整區頻道。文字頻道也用 unit_id，要濾掉，不然會被當成那一區的頻道
    by_unit = dict(session.execute(
        select(Channel.unit_id, Channel.id).where(Channel.kind.in_(("national", "region")))
    ).all())
```

`describe` 迴圈裡，在 `elif c.kind == "place":` 那一段後面、`else:`（客戶討論串）前面加：

```python
        elif c.kind == "topic":
            unit = units[c.unit_id]
            archived = c.archived_at is not None
            if unit.kind == "root":
                infos.append(ChannelInfo(c.id, "topic", c.name, unit.id, None, by_unit[unit.id], archived, None, "全公司都看得到"))
            else:
                infos.append(ChannelInfo(
                    c.id, "topic", c.name, unit.id, unit.id, by_unit[unit.id], archived, None, everyone_in(unit.id),
                ))
```

`can_see` 換成：

```python
def _level(info: ChannelInfo) -> int:
    """共享層級。文字頻道跟著所在的單位：開在區裡同整區頻道，開在全國同全國頻道。"""
    if info.kind == "topic":
        return LEVEL["region"] if info.region_id else LEVEL["national"]
    return LEVEL[info.kind]


def can_see(user: AppUser, info: ChannelInfo) -> bool:
    if info.archived and info.kind == "team":
        # 主管已經不在，組員也都換到別組了，留給 IT 查。封存的文字頻道照樣看得到，只是不能發言
        return user.role == "it"
    scope = Scope.for_user(user)
    if info.path is not None and scope.can_see(_level(info), info.path):
        return True
    # IT 可以把客戶交給別區的業務（org_admin.reassign_customer 不限區），那位業務截到整區看不到這個地點
    return info.kind == "customer" and scope.can_see(SELF, info.owner_path)
```

（`SHARING_LEVEL` 的值是什麼型別就回傳什麼型別；如果不是 `int`，把 `_level` 的回傳型別改成跟 `Scope.can_see` 第一個參數一樣。）

`_order` 換成：

```python
def _order(info: ChannelInfo) -> tuple[int, int, int, bool, str, int]:
    national = info.kind == "national" or (info.kind == "topic" and info.region_id is None)
    group = 0 if national else 2 if info.archived and info.kind == "team" else 1
    region = REGION_ORDER.index(info.region_id) if info.region_id in REGION_ORDER else len(REGION_ORDER)
    # 地點照名稱排，台北市的行政區會排在一起；文字頻道沒封存的在前、照開的先後；其他照建立的先後
    name = info.name if info.kind == "place" else ""
    return (group, region, KIND_ORDER.index(info.kind), info.kind == "topic" and info.archived, name, info.id)
```

`visible_channels` 的 docstring 改成：
`"""看得到的頻道，不含客戶討論串（太多了，從地點頻道或客戶檔案進去）。全國與全國的文字頻道在最前面，接著各區由北到南（整區、文字頻道、小組、地點），封存的小組頻道在最後。"""`

`badge_count` 換成：

```python
def badge_count(session: Session, user: AppUser) -> int:
    """分頁列紅點的數字：全國、自己的區、自己的小組，加上自己負責（主管是組內業務負責）的客戶討論串。
    文字頻道跟著上層：上層算進紅點的話，底下沒封存的文字頻道也算。
    地點頻道與別人客戶的討論串太多，只在列表上顯示未讀，不算進紅點。IT 看得到每一組，只算全國與三個區。"""
    kinds = ("national", "region") if user.role == "it" else ("national", "region", "team")
    visible = visible_channels(session, user)
    counted = {info.id for info in visible if info.kind in kinds and not info.archived}
    ids = [*counted, *(info.id for info in visible if info.kind == "topic" and not info.archived and info.parent_id in counted)]
    if user.role != "it":
        mine = Scope.for_user(user).customers_at(SELF)
        ids += list(session.scalars(select(Channel.id).join(Customer, Customer.id == Channel.customer_id).where(mine)))
    return sum(unread_counts(session, user, ids).values())
```

- [ ] **Step 5: 封存訊息與熊熊滾看得懂的頻道種類**

`backend/app/api/channels.py` 的 `post_message`：

```python
    except channels.Archived:
        raise HTTPException(409, "這個頻道已封存，不能再發言") from None
```

`backend/app/api/memory.py` 的 `_guarded`：

```python
    except channels.Archived:
        raise HTTPException(409, "這個頻道已封存，重點不能再改") from None
```

`backend/app/services/channel_ai.py` 的 `KIND_LABEL`：

```python
KIND_LABEL = {
    "national": "全國頻道", "region": "整區頻道", "team": "小組頻道", "place": "地點頻道", "customer": "客戶討論串",
    "topic": "文字頻道",
}
```

然後 `grep -rn "小組頻道已封存" backend/tests` 找到斷言舊訊息的測試，改成新訊息。

- [ ] **Step 6: 示範資料** — `data/seed/catalog.py`，在 `CONVERSATIONS = [` 前面加：

```python
# 文字頻道（docs/superpowers/specs/2026-10-01-channel-rail-design.md）：(所在的區或根節點, 名稱, 誰開的)。
# 依序建立，畫面上照這個順序排；名稱在整份示範資料裡不重複，灌對話時用名稱找頻道
TOPICS = [
    ("TW", "公司公告", "A01"),
    ("TW.N", "新品上市", "M01"),
    ("TW.N", "補貨問題", "M01"),
]
```

`CONVERSATIONS` 上面的說明「頻道是 ("team", 主管工號)、("place", 地點 id) 或 ("customer", 客戶名稱)」改成「頻道是 ("team", 主管工號)、("place", 地點 id)、("customer", 客戶名稱) 或 ("topic", 文字頻道名稱)」，並在 `CONVERSATIONS` 清單最後（`(("team", "M04"), [...]),` 後面）加：

```python
    (("topic", "新品上市"), [
        (2, "10:15", "M01", "固循魚油下個月換新包裝，舊包裝這個月先清，店家問起來就照這個說"),
        (1, "14:30", "U02", "南京店想要新包裝的試吃包，上架那週可以放在櫃檯"),
    ]),
    (("topic", "補貨問題"), [
        (1, "09:30", "U01", "改成一週補兩次之後，忠孝店這週兩次都準時到了"),
    ]),
    (("topic", "公司公告"), [
        (2, "08:30", "A01", "月底結帳日改成 28 號，發票有問題的請在那之前處理完"),
    ]),
```

`data/seed/seed.py`：在 `seed_conversations` 前面加

```python
def seed_topics(session: Session) -> None:
    """示範的文字頻道（catalog.TOPICS），照清單的順序建立，畫面上就照這個順序排。"""
    for unit_id, name, created_by in catalog.TOPICS:
        session.add(models.Channel(kind="topic", unit_id=unit_id, name=name, created_by=created_by))
    session.flush()
```

`seed_conversations` 裡 `column = {...}[kind]` 那一行改成：

```python
            column = {"team": models.Channel.manager_id, "place": models.Channel.place_id, "topic": models.Channel.name}[kind]
```

`seed()` 裡 `ensure_channels(session)` 後面、`seed_conversations` 前面加 `seed_topics(session)`，註解改成：

```python
        # 全國、整區、地點與小組頻道（客戶討論串第一次有人打開才建），再加上示範的文字頻道
        ensure_channels(session)
        seed_topics(session)
```

- [ ] **Step 7: 跑新測試確認通過**

Run: `TEST_DB_NAME=meddemo_test_rail TEST_REDIS_URL=redis://127.0.0.1:6379/7 uv run --project backend pytest backend/tests/test_channel_topics.py -q`
Expected: PASS（測試資料庫會因為 `schema_version` 變了自動重灌；如果沒有，看 `backend/tests/conftest.py` 的 `engine` fixture 怎麼決定重灌）。

- [ ] **Step 8: 更新因為多了示範文字頻道而變的既有測試**

`backend/tests/test_channels.py`：

1. `test_channels_follow_the_org_tree_and_places` 只看組織樹產生的頻道：`where(Channel.kind != "customer")` 改成 `where(Channel.kind.not_in(("customer", "topic")))`，其他不動（還是 25）。
2. `test_each_account_sees_its_own_team_its_region_and_the_whole_company`：

```python
def test_each_account_sees_its_own_team_its_region_and_the_whole_company(client, auth):
    north = {"全國", "公司公告", "北區", "新品上市", "補貨問題", "陳建宏小組"} | NORTH_PLACES
    assert names(client, auth("U01")) == north
    assert names(client, auth("M01")) == north
    # 南區兩組各看各的小組頻道，整區、地點與全國的文字頻道一樣
    assert names(client, auth("U04")) == {"全國", "公司公告", "南區", "許文彬小組", "高雄市", "台南市"}
    assert names(client, auth("U05")) == {"全國", "公司公告", "南區", "蔡宗翰小組", "高雄市", "台南市"}
    assert names(client, auth("M04")) == {"全國", "公司公告", "南區", "蔡宗翰小組", "高雄市", "台南市"}
    # IT 坐在根節點上，全部看得到，包括各組的原始對話
    everything = listing(client, auth("A01"))
    assert len(everything) == 28
    # 全國與它的文字頻道在最前面，接著北區、北區的文字頻道、小組、地點（照名稱排），再來中區、南區
    order = [c["name"] for c in everything]
    assert order[:7] == ["全國", "公司公告", "北區", "新品上市", "補貨問題", "陳建宏小組", "台北市・中山區"]
    assert order.index("台北市・萬華區") < order.index("新北市")
    assert order.index("中區") < order.index("南區")
```

3. `test_a_self_created_account_sees_what_the_demo_rep_sees`：期望值改成 `{"全國", "公司公告", "北區", "新品上市", "補貨問題", "陳建宏小組"} | NORTH_PLACES`。
4. `test_the_badge_counts_my_team_my_region_and_my_customers_only`：

```python
    # 灌資料放的對話：陳建宏小組 5 則（林昱辰 2、陳建宏 2、王冠宇 1）、大安區 2 則、忠孝店討論串 2 則（林昱辰），
    # 文字頻道：新品上市 2 則（陳建宏、王冠宇）、補貨問題 1 則（林昱辰）、公司公告 1 則（James）
    assert badge("U02") == 7          # 小組裡別人發的 4 則、新品上市 1、補貨問題 1、公司公告 1；地點頻道不算紅點
    assert badge("U01") == 6          # 小組裡別人發的 3 則、新品上市 2、公司公告 1；忠孝店與補貨問題是自己發的
    assert badge("M01") == 8          # 小組 3 則、組員負責的忠孝店 2 則、新品上市 1、補貨問題 1、公司公告 1
    assert badge("A01") == 3          # IT 只算全國與三個區，加上底下的文字頻道：新品上市 2、補貨問題 1
    national = channel_id(client, auth, "全國", "U04")
    post(client, auth("U04"), national, "南區這週辦檔期")
    assert badge("U02") == 8 and badge("A01") == 4
```

`backend/tests/test_seed.py` 的 `test_seeded_conversations_sit_in_their_channels`：SQL 的 CASE 加一行 `WHEN 'topic' THEN ch.name`（放在 `WHEN 'place'` 後面），期望值改成：

```python
    assert found == {
        "陳建宏小組": 5, "台北市・大安區": 2, "康泰連鎖藥局 · 忠孝店": 2, "許文彬小組": 2, "蔡宗翰小組": 2,
        "新品上市": 2, "補貨問題": 1, "公司公告": 1,
    }
    # 全國 1、整區 3、小組 4、地點 17、文字頻道 3，加上灌資料建的忠孝店討論串
    assert rows(db, "SELECT count(*) FROM channel")[0][0] == 29
```

- [ ] **Step 9: 跑全套後端測試，修掉其他只是數字變了的斷言**

Run: `TEST_DB_NAME=meddemo_test_rail TEST_REDIS_URL=redis://127.0.0.1:6379/7 uv run --project backend pytest backend/tests -q`
Expected: 全部 PASS。可能還要改的：`test_presence.py`、`test_channel_proactive.py`、`test_memory_search.py`、`test_admin.py` 裡寫死的頻道數、名稱集合或未讀數。**只改「因為多了三個示範文字頻道與四則訊息」而變的數字與集合，並在旁邊的註解寫清楚多了什麼**；如果某個失敗不是這個原因（例如行為變了），停下來回報，不要硬改測試。

- [ ] **Step 10: Commit**

```bash
git add backend/app/models.py backend/app/services/channels.py backend/app/api/channels.py backend/app/api/memory.py \
  backend/app/services/channel_ai.py data/seed/catalog.py data/seed/seed.py backend/tests
git commit -m "Add text channels that hang under a region or the whole company

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 開、改名、封存文字頻道的 API 與即時事件

**Files:**
- Create: `backend/app/services/channel_topics.py`
- Modify: `backend/app/api/channels.py`（`ChannelItem`、`_items`、兩個新端點）
- Modify: `backend/app/realtime.py`
- Modify: `backend/app/api/presence.py:203-215`（`listen`）
- Test: `backend/tests/test_channel_topics.py`（接在 Task 1 的測試後面）

**Interfaces:**
- Consumes: Task 1 的 `Channel.name/created_by/archived_at`、`channels.get_channel`、`channels.describe`、`channels.NotFound`、`TOPIC_NAME_MAX`。
- Produces:
  - `channel_topics.can_manage(user: AppUser, info: ChannelInfo) -> bool`
  - `channel_topics.create(session, user, parent_id: int, name: str) -> ChannelInfo`
  - `channel_topics.update(session, user, channel_id: int, *, name: str | None = None, archived: bool | None = None) -> ChannelInfo`
  - 例外：`channel_topics.NotHere`（400）、`Forbidden`（403）、`Invalid`（422）、`Duplicate`（409），`channels.NotFound`（404）。
  - `ChannelItem.can_manage: bool`（GET 列表、單一頻道、討論串、新端點都有）。
  - `POST /api/channels` body `{"parent_id": int, "name": str}` → 201 `ChannelItem`。
  - `PATCH /api/channels/{id}` body `{"name"?: str, "archived"?: bool}` → 200 `ChannelItem`。
  - `realtime.channels_changed()` 發 `{"type": "channels"}`；WebSocket 原樣轉給每條連線。

- [ ] **Step 1: 寫失敗的測試** — 接在 `backend/tests/test_channel_topics.py` 最後：

```python
# 開、改名、封存


def create(client, headers, parent_id: int, name: str):
    return client.post("/api/channels", json={"parent_id": parent_id, "name": name}, headers=headers)


def change(client, headers, channel_id: int, **body):
    return client.patch(f"/api/channels/{channel_id}", json=body, headers=headers)


def ids(client, auth) -> dict[str, int]:
    return {name: c["id"] for name, c in by_name(client, auth("A01")).items()}


def test_who_can_open_a_topic_where(tx, client, auth):
    c = ids(client, auth)
    made = create(client, auth("M01"), c["北區"], "  陳列競賽 ")
    assert made.status_code == 201
    topic = made.json()
    assert (topic["kind"], topic["name"], topic["parent_id"], topic["region_id"]) == ("topic", "陳列競賽", c["北區"], "TW.N")
    assert (topic["audience"], topic["archived"], topic["can_manage"]) == ("北區所有人都看得到", False, True)
    assert "陳列競賽" in topic_names(client, auth("U02"))
    assert "陳列競賽" not in topic_names(client, auth("U04"))
    # 主管只管自己這一區，全國只有 IT
    assert create(client, auth("M01"), c["全國"], "北區也想公告").status_code == 403
    assert create(client, auth("M01"), c["南區"], "南區的事").status_code == 404
    assert create(client, auth("M03"), c["南區"], "左營檔期").status_code == 201
    assert create(client, auth("M04"), c["南區"], "台南診所").status_code == 201
    assert create(client, auth("U01"), c["北區"], "業務自己開").status_code == 403
    assert create(client, auth("A01"), c["全國"], "教育訓練").status_code == 201
    assert create(client, auth("A01"), c["中區"], "中區檔期").status_code == 201
    # 小組、地點、文字頻道底下不能再開
    assert create(client, auth("M01"), c["陳建宏小組"], "小組裡開").status_code == 400
    assert create(client, auth("A01"), c["台北市・大安區"], "地點裡開").status_code == 400
    assert create(client, auth("A01"), c["新品上市"], "頻道裡開").status_code == 400
    assert create(client, auth("A01"), 999_999, "不存在").status_code == 404


def test_a_self_created_account_cannot_open_topics(tx, client):
    created = client.post(
        "/api/auth/register", json={"name": "評審", "email": "judge@topics.test", "password": "judge-pass-1"}
    ).json()
    headers = {"Authorization": f"Bearer {created['token']}"}
    north = by_name(client, headers)["北區"]
    assert north["can_manage"] is False
    assert create(client, headers, north["id"], "評審開的").status_code == 403


def test_topic_names_are_trimmed_limited_and_unique_within_a_unit(tx, client, auth):
    c = ids(client, auth)
    assert create(client, auth("M01"), c["北區"], "   ").status_code == 422
    assert create(client, auth("M01"), c["北區"], "字" * 21).status_code == 422
    assert create(client, auth("M01"), c["北區"], "字" * 20).status_code == 201
    taken = create(client, auth("M01"), c["北區"], " 新品上市 ")
    assert taken.status_code == 409
    assert taken.json()["detail"] == "北區已經有叫「新品上市」的頻道"
    assert create(client, auth("M01"), c["北區"], "Promo").status_code == 201
    assert create(client, auth("M01"), c["北區"], "PROMO").status_code == 409
    # 別區可以用同一個名字；全國的重名訊息寫「全國」
    assert create(client, auth("M03"), c["南區"], "新品上市").status_code == 201
    assert create(client, auth("A01"), c["全國"], "公司公告").json()["detail"] == "全國已經有叫「公司公告」的頻道"


def test_managers_of_the_region_rename_and_archive_any_topic_there(tx, client, auth):
    c = ids(client, auth)
    topic = create(client, auth("A01"), c["北區"], "陳列競賽").json()["id"]
    renamed = change(client, auth("M01"), topic, name="陳列比賽")
    assert renamed.status_code == 200 and renamed.json()["name"] == "陳列比賽"
    assert change(client, auth("M01"), topic, name="補貨問題").status_code == 409
    assert change(client, auth("M01"), topic, name="  ").status_code == 422
    assert change(client, auth("M03"), topic, archived=True).status_code == 404
    assert change(client, auth("U01"), topic, archived=True).status_code == 403
    archived = change(client, auth("M01"), topic, archived=True)
    assert archived.status_code == 200 and archived.json()["archived"] is True
    assert by_name(client, auth("U01"))["陳列比賽"]["archived"] is True
    assert post(client, auth("U01"), topic, "還能說嗎").status_code == 409
    restored = change(client, auth("M01"), topic, archived=False)
    assert restored.json()["archived"] is False
    assert post(client, auth("U01"), topic, "又能說了").status_code == 201
    # 全國的文字頻道只有 IT 能動；整區頻道本身不能改名或封存
    assert change(client, auth("M01"), c["公司公告"], archived=True).status_code == 403
    assert change(client, auth("A01"), c["公司公告"], archived=True).status_code == 200
    assert change(client, auth("A01"), c["北區"], name="北北區").status_code == 400


def test_can_manage_follows_the_region(client, auth):
    m01 = by_name(client, auth("M01"))
    assert m01["北區"]["can_manage"] and m01["新品上市"]["can_manage"]
    assert not m01["全國"]["can_manage"] and not m01["公司公告"]["can_manage"]
    assert not m01["陳建宏小組"]["can_manage"] and not m01["台北市・大安區"]["can_manage"]
    assert not any(c["can_manage"] for c in listing(client, auth("U01")))
    m03 = by_name(client, auth("M03"))
    assert m03["南區"]["can_manage"] and not m03["全國"]["can_manage"]
    a01 = by_name(client, auth("A01"))
    assert all(a01[name]["can_manage"] for name in ("全國", "北區", "中區", "南區", "公司公告", "新品上市"))
    assert not a01["陳建宏小組"]["can_manage"]


def test_an_archived_topics_memory_cannot_be_edited(tx, client, auth):
    from app.models import MemoryItem

    news = by_name(client, auth("U01"))["新品上市"]["id"]
    memory = MemoryItem(channel_id=news, category="decision", text="新包裝下個月上市")
    tx.add(memory)
    tx.flush()
    assert change(client, auth("M01"), news, archived=True).status_code == 200
    refused = client.patch(f"/api/memory/{memory.id}", json={"text": "改一下"}, headers=auth("U01"))
    assert refused.status_code == 409
    assert refused.json()["detail"] == "這個頻道已封存，重點不能再改"


def test_shared_topic_memory_reaches_the_region_and_national_boards(tx, client, auth):
    from app.models import MemoryItem

    c = ids(client, auth)
    shared = MemoryItem(
        channel_id=c["新品上市"], category="decision", text="固循魚油下個月換新包裝，舊包裝先清",
        shared=True, shared_text="固循魚油下個月換新包裝",
    )
    tx.add(shared)
    tx.flush()
    for board in (c["北區"], c["全國"]):
        below = client.get(f"/api/channels/{board}/board", headers=auth("U01")).json()["below"]
        group = next(g for g in below if g["channel_id"] == c["新品上市"])
        assert [i["text"] for i in group["items"] if i["id"] == shared.id] == ["固循魚油下個月換新包裝"]


def test_opening_renaming_and_archiving_tell_every_socket(tx, client, engine, auth):
    from conftest import token_for

    def next_channels_event(ws) -> dict:
        while True:
            event = ws.receive_json()
            if event["type"] == "channels":
                return event

    c = ids(client, auth)
    with client.websocket_connect("/api/ws") as ws:
        ws.send_json({"type": "auth", "token": token_for(engine, "U04"), "active": True})
        assert ws.receive_json()["type"] == "ready"
        topic = create(client, auth("M01"), c["北區"], "陳列競賽").json()["id"]
        # 事件不帶內容，看不到北區的人也收得到；收到只是重新載入自己看得到的列表
        assert next_channels_event(ws) == {"type": "channels"}
        change(client, auth("M01"), topic, name="陳列比賽")
        assert next_channels_event(ws) == {"type": "channels"}
        change(client, auth("M01"), topic, archived=True)
        assert next_channels_event(ws) == {"type": "channels"}
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `TEST_DB_NAME=meddemo_test_rail TEST_REDIS_URL=redis://127.0.0.1:6379/7 uv run --project backend pytest backend/tests/test_channel_topics.py -q`
Expected: 新加的測試 FAIL（`POST /api/channels` 回 405、`can_manage` KeyError）。

- [ ] **Step 3: 新檔 `backend/app/services/channel_topics.py`**

```python
"""文字頻道：區的在職主管與 IT 在整區頻道、IT 在全國頻道底下開的頻道（docs/superpowers/specs/2026-10-01-channel-rail-design.md）。

開好的頻道整區（全國的是全公司）都看得到、都能發言，看得到與否照舊由 services/channels.py 決定。
能開、改名、封存的人一樣：那一區的在職主管與 IT，全國只有 IT；不限原本開的人。不能刪除，訊息與記憶要留著。
同一個單位不能重名由資料庫的部分唯一索引守（models.Channel），兩個人同時開同名的也只會成功一個。
"""

from __future__ import annotations

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import TOPIC_NAME_MAX, AppUser, Channel, OrgUnit
from app.services import channels
from app.services.channels import ChannelInfo


class NotHere(Exception):
    """上層不是全國或整區頻道，或要改的不是文字頻道。"""


class Forbidden(Exception):
    """看得到，但不是那一區的主管或 IT。"""


class Invalid(Exception):
    """名稱去掉空白後是空的，或超過上限。"""


class Duplicate(Exception):
    """同一個單位已經有同名的文字頻道。"""


def can_manage(user: AppUser, info: ChannelInfo) -> bool:
    """全國與整區頻道：能不能在底下開文字頻道；文字頻道：能不能改名、封存。其他種類一律不行。
    主管只管自己那一區（unit_id 就是區），全國的只有 IT。自建帳號是業務，不行。"""
    if info.kind not in ("national", "region", "topic"):
        return False
    if user.role == "it":
        return True
    return user.role == "manager" and user.deactivated_at is None and info.region_id is not None and user.unit_id == info.region_id


def clean_name(raw: str) -> str:
    name = raw.strip()
    if not name or len(name) > TOPIC_NAME_MAX:
        raise Invalid(f"頻道名稱要 1～{TOPIC_NAME_MAX} 個字")
    return name


def _save(session: Session, channel: Channel, name: str) -> None:
    """寫進去；同一個單位已經有同名的，資料庫擋下來時換成 Duplicate。"""
    try:
        with session.begin_nested():
            session.add(channel)
            session.flush()
    except IntegrityError:
        unit = session.get(OrgUnit, channel.unit_id)
        raise Duplicate(f"{unit.name}已經有叫「{name}」的頻道") from None


def create(session: Session, user: AppUser, parent_id: int, name: str) -> ChannelInfo:
    """在 parent_id（全國或整區頻道）底下開一個文字頻道。看不到上層丟 channels.NotFound；呼叫端負責 commit。"""
    parent = channels.get_channel(session, user, parent_id)
    if parent.kind not in ("national", "region"):
        raise NotHere("只有全國與整區頻道底下可以開文字頻道")
    if not can_manage(user, parent):
        raise Forbidden("只有這一區的主管與 IT 可以開文字頻道" if parent.kind == "region" else "只有 IT 可以在全國開文字頻道")
    cleaned = clean_name(name)
    channel = Channel(kind="topic", unit_id=session.get(Channel, parent.id).unit_id, name=cleaned, created_by=user.id)
    _save(session, channel, cleaned)
    return channels.describe(session, [channel])[0]


def update(
    session: Session, user: AppUser, channel_id: int, *, name: str | None = None, archived: bool | None = None
) -> ChannelInfo:
    """改名、封存或解除封存。已經封存的再封存一次不改時間。呼叫端負責 commit。"""
    info = channels.get_channel(session, user, channel_id)
    if info.kind != "topic":
        raise NotHere("只有文字頻道可以改名或封存")
    if not can_manage(user, info):
        raise Forbidden("只有這一區的主管與 IT 可以管理文字頻道" if info.region_id else "只有 IT 可以管理全國的文字頻道")
    channel = session.get(Channel, info.id)
    cleaned = clean_name(name) if name is not None else channel.name
    channel.name = cleaned
    if archived is True and channel.archived_at is None:
        channel.archived_at = func.now()
    elif archived is False:
        channel.archived_at = None
    _save(session, channel, cleaned)
    session.refresh(channel)
    return channels.describe(session, [channel])[0]
```

- [ ] **Step 4: 即時事件** — `backend/app/realtime.py` 模組 docstring 的事件清單加一行
`- {"type": "channels"}：有人開了、改名或封存文字頻道，手機重新載入頻道列表`，檔案最後加：

```python
def channels_changed() -> None:
    publish({"type": "channels"})
```

`backend/app/api/presence.py` 的 `listen`，在 `elif event.get("type") == "avatars":` 那一段後面加：

```python
            elif event.get("type") == "channels":
                # 不帶內容：收到的人重新載入自己看得到的頻道列表，看不到的頻道不會因此透露
                await self.send({"type": "channels"})
```

- [ ] **Step 5: API** — `backend/app/api/channels.py`

import 加 `channel_topics`：

```python
from app.services import attachment_processing, attachments, channel_ai, channel_memory, channel_topics, channels, presence
```

`ChannelItem` 在 `online` 後面加：

```python
    # 全國、整區：能不能在底下開文字頻道；文字頻道：能不能改名、封存（services/channel_topics.py）
    can_manage: bool
```

`_items` 的 `ChannelItem(...)` 多一個參數 `can_manage=channel_topics.can_manage(user, i),`。

模組 docstring 第一行改成 `"""頻道 API（docs/superpowers/specs/2026-09-28-channels-design.md）：頻道列表、訊息、已讀、客戶討論串，以及文字頻道（2026-10-01-channel-rail-design.md）。`

在 `MessageInput` 前面加兩個輸入模型：

```python
class TopicInput(BaseModel):
    # 開在哪個全國或整區頻道底下
    parent_id: int
    name: str


class TopicChange(BaseModel):
    name: str | None = None
    archived: bool | None = None
```

在 `get_channel` 端點後面加：

```python
def _topic_action(action):
    """開、改文字頻道共用的錯誤對照。"""
    try:
        return action()
    except channels.NotFound:
        raise HTTPException(404, "找不到這個頻道") from None
    except channel_topics.NotHere as exc:
        raise HTTPException(400, str(exc)) from None
    except channel_topics.Forbidden as exc:
        raise HTTPException(403, str(exc)) from None
    except channel_topics.Invalid as exc:
        raise HTTPException(422, str(exc)) from None
    except channel_topics.Duplicate as exc:
        raise HTTPException(409, str(exc)) from None


@router.post("/api/channels", response_model=ChannelItem, status_code=status.HTTP_201_CREATED)
def create_topic(session: SessionDep, user: CurrentUser, body: TopicInput):
    """在全國或整區頻道底下開文字頻道：區的在職主管與 IT，全國只有 IT。"""
    info = _topic_action(lambda: channel_topics.create(session, user, body.parent_id, body.name))
    session.commit()
    realtime.channels_changed()
    return _items(session, user, [info])[0]


@router.patch("/api/channels/{channel_id}", response_model=ChannelItem)
def update_topic(session: SessionDep, user: CurrentUser, channel_id: int, body: TopicChange):
    """文字頻道改名、封存或解除封存。封存了還看得到，只是不能發言。"""
    info = _topic_action(
        lambda: channel_topics.update(session, user, channel_id, name=body.name, archived=body.archived)
    )
    session.commit()
    realtime.channels_changed()
    return _items(session, user, [info])[0]
```

- [ ] **Step 6: 跑測試確認通過**

Run: `TEST_DB_NAME=meddemo_test_rail TEST_REDIS_URL=redis://127.0.0.1:6379/7 uv run --project backend pytest backend/tests/test_channel_topics.py backend/tests/test_channels.py backend/tests/test_presence.py -q`
Expected: PASS

- [ ] **Step 7: 跑全套後端測試**

Run: `TEST_DB_NAME=meddemo_test_rail TEST_REDIS_URL=redis://127.0.0.1:6379/7 uv run --project backend pytest backend/tests -q`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add backend/app/services/channel_topics.py backend/app/api/channels.py backend/app/realtime.py backend/app/api/presence.py backend/tests/test_channel_topics.py
git commit -m "Let region managers and IT open, rename and archive text channels

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 前端的型別、左欄的純邏輯與即時事件

**Files:**
- Modify: `frontend/src/api/channels.ts`
- Create: `frontend/src/lib/channel-rail.ts`
- Create: `frontend/src/lib/channel-rail.test.ts`
- Modify: `frontend/src/lib/channels.ts`（加 `KIND_LABEL`；`groupChannels`、`sortUnreadFirst` 在 Task 4 換掉頁面時才刪）
- Modify: `frontend/src/lib/realtime.ts`、`frontend/src/lib/realtime.test.ts`

**Interfaces:**
- Consumes: Task 2 的 API 欄位 `can_manage`、`kind: "topic"`，端點 `POST /api/channels`、`PATCH /api/channels/{id}`，即時事件 `{"type": "channels"}`。
- Produces（`@/lib/channel-rail`）：
  - `type RailItem = { type: "channel"; channel: Channel; unread: number } | { type: "folder"; key: string; label: string; icon: "places" | "archived"; channels: Channel[]; unread: number } | { type: "divider"; key: string }`
  - `shortName(channel: Channel): string`
  - `topicsOf(channels: Channel[], parentId: number): Channel[]`
  - `railUnread(channels: Channel[], channel: Channel): number`
  - `railItems(channels: Channel[]): RailItem[]`
  - `pickSelected(channels: Channel[], requested: number | null, remembered: number | null, role: Role): Channel | null`
  - `railPath(channel: Pick<Channel, "id" | "kind" | "parent_id">): string`
  - `rememberedChannel(): number | null`、`rememberChannel(id: number): void`
- Produces（`@/api/channels`）：`ChannelKind` 多 `"topic"`；`Channel.can_manage: boolean`；`createTopic(parentId: number, name: string): Promise<Channel>`；`updateTopic(id: number, changes: { name?: string; archived?: boolean }): Promise<Channel>`。
- Produces（`@/lib/channels`）：`KIND_LABEL: Record<ChannelKind, string>`。
- Produces（`@/lib/realtime`）：`RealtimeEvent` 多 `{ type: "channels" }`。

- [ ] **Step 1: 寫失敗的測試** — 新檔 `frontend/src/lib/channel-rail.test.ts`：

```ts
import { describe, expect, it } from "vitest"

import type { Channel } from "@/api/channels"
import { pickSelected, railItems, railPath, railUnread, shortName, topicsOf } from "@/lib/channel-rail"

const channel = (id: number, kind: Channel["kind"], name: string, extra: Partial<Channel> = {}) =>
  ({ id, kind, name, region_id: null, parent_id: null, unread: 0, archived: false, can_manage: false, ...extra }) as Channel

// 北區業務看得到的頻道，順序跟後端 GET /api/channels 一樣
const national = channel(1, "national", "全國")
const notice = channel(20, "topic", "公司公告", { parent_id: 1, unread: 1 })
const north = channel(2, "region", "北區", { region_id: "TW.N", parent_id: 1, unread: 2 })
const news = channel(21, "topic", "新品上市", { region_id: "TW.N", parent_id: 2, unread: 3 })
const old = channel(22, "topic", "舊活動", { region_id: "TW.N", parent_id: 2, unread: 5, archived: true })
const team = channel(5, "team", "陳建宏小組", { region_id: "TW.N", parent_id: 2 })
const daan = channel(9, "place", "台北市・大安區", { region_id: "TW.N", parent_id: 2, unread: 4 })
const xinbei = channel(10, "place", "新北市", { region_id: "TW.N", parent_id: 2, unread: 1 })
const rep = [national, notice, north, news, old, team, daan, xinbei]

describe("shortName", () => {
  it("小組取主管名字的最後兩個字，地點取行政區或縣市，全國與整區照名稱", () => {
    expect(shortName(team)).toBe("建宏")
    expect(shortName(daan)).toBe("大安")
    expect(shortName(xinbei)).toBe("新北")
    expect(shortName(channel(11, "place", "彰化縣"))).toBe("彰化")
    expect(shortName(north)).toBe("北區")
    expect(shortName(national)).toBe("全國")
  })

  it("英文名字的主管跟頭像一樣取縮寫", () => {
    expect(shortName(channel(12, "team", "James Su小組"))).toBe("JS")
  })
})

describe("topicsOf / railUnread", () => {
  it("文字頻道依上層挑出來，照後端的順序（封存的在後面）", () => {
    expect(topicsOf(rep, 2).map((c) => c.name)).toEqual(["新品上市", "舊活動"])
    expect(topicsOf(rep, 1).map((c) => c.name)).toEqual(["公司公告"])
  })

  it("整區與全國的數字加上底下沒封存的文字頻道", () => {
    expect(railUnread(rep, north)).toBe(2 + 3)
    expect(railUnread(rep, national)).toBe(1)
    expect(railUnread(rep, daan)).toBe(4)
  })
})

describe("railItems", () => {
  it("全國 → 每一區（整區、小組、地點資料夾）；文字頻道不在左欄", () => {
    const items = railItems(rep)
    expect(items.map((item) => (item.type === "channel" ? item.channel.name : item.type === "folder" ? item.label : "—"))).toEqual([
      "全國",
      "—",
      "北區",
      "陳建宏小組",
      "地點",
    ])
    const places = items.at(-1)
    expect(places).toMatchObject({ type: "folder", icon: "places", unread: 5 })
    expect(places?.type === "folder" && places.channels.map((c) => c.name)).toEqual(["台北市・大安區", "新北市"])
  })

  it("IT 看到每一區，封存的小組頻道收在最後的已封存資料夾", () => {
    const south = channel(3, "region", "南區", { region_id: "TW.S", parent_id: 1 })
    const gone = channel(7, "team", "蔡宗翰小組", { archived: true })
    const items = railItems([national, north, team, south, gone])
    expect(items.map((item) => (item.type === "channel" ? item.channel.name : item.type === "folder" ? item.label : "—"))).toEqual([
      "全國",
      "—",
      "北區",
      "陳建宏小組",
      "—",
      "南區",
      "—",
      "已封存",
    ])
  })
})

describe("pickSelected", () => {
  it("網址指定的優先，再來是上次選的", () => {
    expect(pickSelected(rep, 9, 2, "sales")?.name).toBe("台北市・大安區")
    expect(pickSelected(rep, null, 2, "sales")?.name).toBe("北區")
  })

  it("指定的是文字頻道就停在它的上層", () => {
    expect(pickSelected(rep, 21, null, "sales")?.name).toBe("北區")
  })

  it("都不在了：業務與主管停在自己的小組，IT 停在全國", () => {
    expect(pickSelected(rep, 999, 998, "sales")?.name).toBe("陳建宏小組")
    expect(pickSelected(rep, null, null, "manager")?.name).toBe("陳建宏小組")
    expect(pickSelected(rep, null, null, "it")?.name).toBe("全國")
    expect(pickSelected([], null, null, "sales")).toBeNull()
  })
})

describe("railPath", () => {
  it("文字頻道與客戶討論串回上層，其他回自己", () => {
    expect(railPath(news)).toBe("/channels?c=2")
    expect(railPath(channel(30, "customer", "忠孝店", { parent_id: 9 }))).toBe("/channels?c=9")
    expect(railPath(team)).toBe("/channels?c=5")
  })
})
```

`frontend/src/lib/realtime.test.ts` 在「狀態推來就更新 store，新訊息通知轉給訂閱的畫面」那個 `it` 後面加：

```ts
  it("文字頻道開了、改名或封存，轉給訂閱的畫面重新載入列表", () => {
    const { client, ready, latest, events } = setup()
    client.start()
    ready()
    latest().push({ type: "channels" })
    expect(events.at(-1)).toEqual({ type: "channels" })
  })
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm --prefix frontend test -- channel-rail realtime`
Expected: FAIL（找不到 `@/lib/channel-rail`；`channels` 事件沒有轉出）。

- [ ] **Step 3: `frontend/src/api/channels.ts`**

`ChannelKind` 換成：

```ts
// national 全國；region 整區；team 一位主管帶的小組；place 地點（縣市，台北市到行政區）；customer 一家客戶的討論串；
// topic 文字頻道：區的主管與 IT 在整區頻道、IT 在全國頻道底下開的
export type ChannelKind = "national" | "region" | "team" | "place" | "customer" | "topic"
```

`Channel` 的 `archived` 註解改成 `// 不能再發言：主管已經不在的小組頻道（只剩 IT 看得到），或有人封存的文字頻道（照樣看得到）`，`parent_id` 上面加註解 `// 上層頻道；文字頻道是它所在的整區或全國頻道`，並在 `online` 後面加：

```ts
  // 全國、整區：能不能在底下開文字頻道；文字頻道：能不能改名、封存
  can_manage: boolean
```

在 `getChannel` 後面加：

```ts
/** 在全國或整區頻道底下開文字頻道：區的在職主管與 IT，全國只有 IT */
export function createTopic(parentId: number, name: string) {
  return request<Channel>("/api/channels", jsonBody("POST", { parent_id: parentId, name }))
}

/** 文字頻道改名、封存或解除封存 */
export function updateTopic(id: number, changes: { name?: string; archived?: boolean }) {
  return request<Channel>(`/api/channels/${id}`, jsonBody("PATCH", changes))
}
```

- [ ] **Step 4: `frontend/src/lib/channels.ts`** 在 `MESSAGE_PAGE` 後面加（Task 4 的頁面與右欄會用）：

```ts
// 頻道種類的名稱：對話頁的副標題、右欄的頁首
export const KIND_LABEL: Record<ChannelKind, string> = {
  national: "全國頻道",
  region: "整區頻道",
  team: "小組頻道",
  place: "地點頻道",
  customer: "客戶討論串",
  topic: "文字頻道",
}
```

並把第一行 import 改成 `import type { Channel, ChannelKind, ChannelMessage } from "@/api/channels"`。

- [ ] **Step 5: 新檔 `frontend/src/lib/channel-rail.ts`**

```ts
import type { Channel } from "@/api/channels"
import type { Role } from "@/lib/auth"
import { initials } from "@/lib/presence"

// 左欄的一格：一個頻道、一個收著好幾個頻道的資料夾（地點、已封存），或區與區之間的分隔線
export type RailItem =
  | { type: "channel"; channel: Channel; unread: number }
  | { type: "folder"; key: string; label: string; icon: "places" | "archived"; channels: Channel[]; unread: number }
  | { type: "divider"; key: string }

// 上次選了哪個頻道，下次打開頻道頁還停在那裡（只是方便，讀寫失敗就退回預設）
const STORAGE_KEY = "meddemo:channel-rail"

/** 左欄方塊上的兩個字：小組取主管名字的縮寫（跟頭像一樣），地點取「・」後面那段、去掉結尾的區市縣，全國與整區照名稱 */
export function shortName(channel: Channel): string {
  if (channel.kind === "team") return initials(channel.name.replace(/小組$/, ""))
  if (channel.kind === "place") {
    const part = channel.name.split("・").at(-1) ?? channel.name
    const trimmed = part.replace(/[區市縣]$/, "")
    return Array.from(trimmed.length >= 2 ? trimmed : part).slice(0, 2).join("")
  }
  return Array.from(channel.name).slice(0, 2).join("")
}

/** 某個全國或整區頻道底下的文字頻道。後端已經排好：沒封存的照開的先後在前，封存的在後 */
export function topicsOf(channels: Channel[], parentId: number): Channel[] {
  return channels.filter((c) => c.kind === "topic" && c.parent_id === parentId)
}

/** 左欄方塊右下角的數字：自己的未讀，加上底下沒封存的文字頻道 */
export function railUnread(channels: Channel[], channel: Channel): number {
  return topicsOf(channels, channel.id)
    .filter((topic) => !topic.archived)
    .reduce((sum, topic) => sum + topic.unread, channel.unread)
}

function folder(key: string, label: string, icon: "places" | "archived", channels: Channel[]): RailItem {
  return { type: "folder", key, label, icon, channels, unread: channels.reduce((sum, c) => sum + c.unread, 0) }
}

/** 左欄：全國 → 每一區（整區、小組、地點資料夾）→ 已封存資料夾（只有 IT 會有）。
 * 文字頻道與客戶討論串在右欄，不在這裡。後端已經排好順序，這裡只分組 */
export function railItems(channels: Channel[]): RailItem[] {
  const items: RailItem[] = []
  const add = (channel: Channel) => items.push({ type: "channel", channel, unread: railUnread(channels, channel) })
  const national = channels.find((c) => c.kind === "national")
  if (national) add(national)
  for (const region of channels.filter((c) => c.kind === "region")) {
    items.push({ type: "divider", key: `divider-${region.id}` })
    add(region)
    const inRegion = channels.filter((c) => c.region_id === region.region_id && !c.archived)
    for (const team of inRegion.filter((c) => c.kind === "team")) add(team)
    const places = inRegion.filter((c) => c.kind === "place")
    if (places.length) items.push(folder(`places-${region.id}`, "地點", "places", places))
  }
  const archived = channels.filter((c) => c.kind === "team" && c.archived)
  if (archived.length) items.push({ type: "divider", key: "divider-archived" }, folder("archived", "已封存", "archived", archived))
  return items
}

/** 選中哪個頻道：網址的 ?c=，再來是上次選的；指定的是文字頻道就停在它的上層。
 * 都不在了（封存、調區）：業務與主管停在自己的小組，IT 停在全國 */
export function pickSelected(channels: Channel[], requested: number | null, remembered: number | null, role: Role): Channel | null {
  const inRail = channels.filter((c) => c.kind !== "topic" && c.kind !== "customer")
  const resolve = (id: number | null) => {
    const found = id === null ? undefined : channels.find((c) => c.id === id)
    const target = found?.kind === "topic" ? found.parent_id : found?.id
    return inRail.find((c) => c.id === target)
  }
  const national = inRail.find((c) => c.kind === "national")
  const team = inRail.find((c) => c.kind === "team" && !c.archived)
  const fallback = role === "it" ? national : (team ?? national)
  return resolve(requested) ?? resolve(remembered) ?? fallback ?? inRail[0] ?? null
}

/** 從對話頁回到兩欄時停在哪個頻道：文字頻道與客戶討論串回上層，其他回自己 */
export function railPath(channel: Pick<Channel, "id" | "kind" | "parent_id">): string {
  const up = (channel.kind === "topic" || channel.kind === "customer") && channel.parent_id !== null
  return `/channels?c=${up ? channel.parent_id : channel.id}`
}

export function rememberedChannel(): number | null {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY))
    return Number.isInteger(value) && value > 0 ? value : null
  } catch {
    // 私密瀏覽、被擋的網站資料、測試環境沒有 localStorage：當作沒選過
    return null
  }
}

export function rememberChannel(id: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(id))
  } catch {
    // 存不了就算了，下次退回預設
  }
}
```

- [ ] **Step 6: `frontend/src/lib/realtime.ts`**

```ts
// avatars：有人換了或移除大頭貼（lib/avatars.ts 重拿一次網址）；channels：有人開了、改名或封存文字頻道（頻道頁重新載入列表）
export type RealtimeEvent =
  | { type: "message"; channel_id: number }
  | { type: "resync" }
  | { type: "avatars" }
  | { type: "channels" }
```

`ServerEvent` 多一行 `| { type: "channels" }`；`receive` 裡轉出的條件改成：

```ts
    } else if (event.type === "message" || event.type === "avatars" || event.type === "channels") {
      this.emit(event)
    }
```

`grep -rn "event.type" frontend/src` 檢查其他訂閱 `realtime` 的地方：只看 `message` 的（例如 `pages/channel.tsx`、`lib/channel-unread.ts`）不用改；用「`!== "avatars"`」判斷的會順便收到 `channels`，這正是要的。

- [ ] **Step 7: 跑測試、型別檢查**

Run: `npm --prefix frontend test && npm --prefix frontend run typecheck`
Expected: PASS（`typecheck` 可能在用到 `Channel` 物件字面值的地方抱怨少了 `can_manage`，補上 `can_manage: false`）。

- [ ] **Step 8: Commit**

```bash
git add frontend/src/api/channels.ts frontend/src/lib/channel-rail.ts frontend/src/lib/channel-rail.test.ts \
  frontend/src/lib/channels.ts frontend/src/lib/realtime.ts frontend/src/lib/realtime.test.ts
git commit -m "Group channels for a Discord-style rail and hear when text channels change

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 左右兩欄的頻道頁

**Files:**
- Create: `frontend/src/components/channel-rail.tsx`
- Create: `frontend/src/components/channel-panel.tsx`
- Rewrite: `frontend/src/pages/channels.tsx`
- Modify: `frontend/src/components/channel-row.tsx`（匯出 `channelDetail`）
- Modify: `frontend/src/components/user-avatar.tsx`（匯出 `AVATAR_TONES`）
- Modify: `frontend/src/pages/channel.tsx`（`ChannelLocationState`、返回路徑、`tab`、`KIND_LABEL`、封存文字）
- Modify: `frontend/src/pages/channel-search.tsx:30`
- Modify: `frontend/src/lib/channels.ts`、`frontend/src/lib/channels.test.ts`（刪 `groupChannels`、`sortUnreadFirst`）

**Interfaces:**
- Consumes: Task 3 的 `railItems`、`shortName`、`topicsOf`、`pickSelected`、`railPath`、`rememberedChannel`、`rememberChannel`、`KIND_LABEL`、`listThreads`。
- Produces:
  - `ChannelRail({ channels, selectedId, onSelect }: { channels: Channel[]; selectedId: number | null; onSelect: (channel: Channel) => void })`
  - `ChannelPanel({ channel, channels, selfId, refreshKey, onChanged }: { channel: Channel; channels: Channel[]; selfId: string; refreshKey: number; onChanged: () => void })`（`onChanged` 給 Task 5 的對話框用；這個任務先接好，面板裡還沒有呼叫它的地方）
  - `ChannelLocationState = { backTo?: string; jumpTo?: number; tab?: "chat" | "board" }`
  - `channelDetail(channel: Channel): string[]`（`channel-row.tsx`）
  - `AVATAR_TONES: string[]`（`user-avatar.tsx`）

元件不寫單元測試（`vite.config.ts` 只跑 `src/**/*.test.ts` 的純邏輯），靠 typecheck、lint、build 與 Task 6 的實機走查。

- [ ] **Step 1: `user-avatar.tsx` 匯出底色**：`const TONES = [` 改成 `export const AVATAR_TONES = [`，檔案裡其他用到 `TONES` 的地方一起改名。註解補一句「頻道左欄的方塊也用這一組（components/channel-rail.tsx）」。

- [ ] **Step 2: `channel-row.tsx` 匯出副標**

```tsx
/** 頻道一列的副標：最近一則的時間、除了自己幾人在線 */
export function channelDetail(channel: Channel): string[] {
  return [
    channel.last_message_at && `最近 ${formatDateTime(channel.last_message_at)}`,
    channel.online > 0 && `${channel.online} 人在線`,
  ].filter((part): part is string => Boolean(part))
}
```

`ChannelRow` 裡的 `const detail = [...]` 換成 `const detail = channelDetail(channel)`。

- [ ] **Step 3: 新檔 `frontend/src/components/channel-rail.tsx`**

```tsx
import { useState } from "react"
import { Archive, MapPin } from "lucide-react"

import type { Channel } from "@/api/channels"
import { UnreadDot } from "@/components/channels-link"
import { AVATAR_TONES } from "@/components/user-avatar"
import { railItems, shortName } from "@/lib/channel-rail"
import { cn } from "@/lib/utils"

/** 頻道頁的左欄：全國、各區、各小組，地點與已封存收在資料夾裡，跟 Discord 手機版的伺服器列一樣。
 * 選中的那一塊左邊有一條指示條；沒選中但有未讀的，左邊一個小點、右下角紅色數字 */
export function ChannelRail({
  channels,
  selectedId,
  onSelect,
}: {
  channels: Channel[]
  selectedId: number | null
  onSelect: (channel: Channel) => void
}) {
  // 自己打開的資料夾；裡面有選中的頻道時一律展開
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <nav aria-label="頻道" className="flex w-[4.5rem] shrink-0 flex-col items-center gap-2 overflow-y-auto border-r bg-muted/40 pt-3 pb-24">
      {railItems(channels).map((item) => {
        if (item.type === "divider") return <hr key={item.key} className="w-8 shrink-0 border-t-2" />
        if (item.type === "channel") {
          return (
            <RailButton
              key={item.channel.id}
              channel={item.channel}
              unread={item.unread}
              selected={item.channel.id === selectedId}
              onSelect={onSelect}
            />
          )
        }
        const expanded = open.has(item.key) || item.channels.some((c) => c.id === selectedId)
        const Icon = item.icon === "places" ? MapPin : Archive
        return (
          <div key={item.key} className="flex w-full shrink-0 flex-col items-center gap-2">
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={`${item.label}（${item.channels.length}）`}
              onClick={() => toggle(item.key)}
              className="relative flex size-12 flex-col items-center justify-center gap-0.5 rounded-2xl border-2 bg-card text-muted-foreground shadow-lip"
            >
              <Icon className="size-4" />
              <span className="text-[0.625rem] leading-none">{item.label}</span>
              {!expanded && item.unread > 0 && <UnreadDot count={item.unread} className="absolute -right-1.5 -bottom-1.5" />}
            </button>
            {expanded && (
              <div className="flex w-14 flex-col items-center gap-2 rounded-2xl bg-muted py-2">
                {item.channels.map((channel) => (
                  <RailButton
                    key={channel.id}
                    channel={channel}
                    unread={channel.unread}
                    selected={channel.id === selectedId}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}

function RailButton({
  channel,
  unread,
  selected,
  onSelect,
}: {
  channel: Channel
  unread: number
  selected: boolean
  onSelect: (channel: Channel) => void
}) {
  return (
    <div className="relative flex w-full shrink-0 justify-center">
      <span
        aria-hidden
        className={cn(
          "absolute top-1/2 left-0 w-1 -translate-y-1/2 rounded-r-full bg-foreground transition-[height]",
          selected ? "h-8" : unread > 0 ? "h-2" : "h-0"
        )}
      />
      <button
        type="button"
        aria-label={unread > 0 ? `${channel.name}，${unread} 則未讀` : channel.name}
        aria-current={selected ? "page" : undefined}
        onClick={() => onSelect(channel)}
        className={cn(
          "relative flex size-12 items-center justify-center rounded-2xl text-sm font-semibold transition-[border-radius]",
          AVATAR_TONES[channel.id % AVATAR_TONES.length],
          selected ? "rounded-xl ring-2 ring-primary ring-offset-2 ring-offset-background" : "hover:rounded-xl"
        )}
      >
        {shortName(channel)}
        {unread > 0 && <UnreadDot count={unread} className="absolute -right-1.5 -bottom-1.5" />}
      </button>
    </div>
  )
}
```

- [ ] **Step 4: 新檔 `frontend/src/components/channel-panel.tsx`**

```tsx
import { useEffect, useState } from "react"
import { ChevronDown, ChevronRight, Hash, Images, MessagesSquare, NotebookText, type LucideIcon } from "lucide-react"
import { Link } from "react-router"

import { listThreads, type Channel } from "@/api/channels"
import { ChannelMembers } from "@/components/channel-members"
import { ChannelRow, channelDetail } from "@/components/channel-row"
import { UnreadDot } from "@/components/channels-link"
import { Notice } from "@/components/notice"
import { railPath, topicsOf } from "@/lib/channel-rail"
import { KIND_LABEL } from "@/lib/channels"
import { cn } from "@/lib/utils"
import type { ChannelLocationState } from "@/pages/channel"

/** 頻道頁的右欄：選中那個頻道的對話、記憶看板、照片與檔案，
 * 加上底下的文字頻道（全國、整區）或有人發過言的客戶討論串（地點）。
 * refreshKey 每次重新載入頻道列表就換一次，客戶討論串跟著重拿 */
export function ChannelPanel({
  channel,
  channels,
  selfId,
  refreshKey,
}: {
  channel: Channel
  channels: Channel[]
  selfId: string
  refreshKey: number
  onChanged: () => void
}) {
  const back = railPath(channel)
  return (
    <section aria-label={channel.name} className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <header className="flex items-start gap-1 border-b py-2 pr-1 pl-4">
        <div className="min-w-0 flex-1 py-1">
          <h2 className="truncate text-lg font-semibold">{channel.name}</h2>
          <p className="text-xs text-muted-foreground">
            {KIND_LABEL[channel.kind]}・{channel.audience}
            {channel.online > 0 && `・${channel.online} 人在線`}
          </p>
        </div>
        {!channel.archived && <ChannelMembers channelId={channel.id} selfId={selfId} />}
      </header>
      <div className="flex flex-col gap-5 px-4 pt-4 pb-24">
        {channel.archived && <Notice text="這個頻道已封存，只能看。" />}
        <div className="overflow-hidden rounded-2xl border-2 bg-card shadow-lip">
          <PanelLink to={`/channels/${channel.id}`} state={{ backTo: back }} icon={MessagesSquare} label="對話" unread={channel.unread} />
          <PanelLink to={`/channels/${channel.id}`} state={{ backTo: back, tab: "board" }} icon={NotebookText} label="記憶看板" />
          <PanelLink to={`/channels/search?channel=${channel.id}`} state={{ backTo: back }} icon={Images} label="照片與檔案" />
        </div>
        {(channel.kind === "national" || channel.kind === "region") && (
          <TopicSection topics={topicsOf(channels, channel.id)} back={back} />
        )}
        {channel.kind === "place" && <ThreadSection place={channel} back={back} refreshKey={refreshKey} />}
      </div>
    </section>
  )
}

function PanelLink({
  to,
  state,
  icon: Icon,
  label,
  unread = 0,
}: {
  to: string
  state?: ChannelLocationState
  icon: LucideIcon
  label: string
  unread?: number
}) {
  return (
    <Link to={to} state={state} className="flex min-h-12 items-center gap-3 border-t px-4 py-2 first:border-t-0">
      <Icon className="size-5 shrink-0 text-muted-foreground" />
      <span className={cn("flex-1 text-sm", unread > 0 && "font-semibold")}>{label}</span>
      {unread > 0 && <UnreadDot count={unread} />}
    </Link>
  )
}

/** 全國、整區底下的文字頻道：沒封存的照開的先後，封存的收在最下面 */
function TopicSection({ topics, back }: { topics: Channel[]; back: string }) {
  const [showArchived, setShowArchived] = useState(false)
  const active = topics.filter((t) => !t.archived)
  const archived = topics.filter((t) => t.archived)
  return (
    <section className="flex flex-col gap-1">
      <div className="flex min-h-9 items-center justify-between px-1">
        <h3 className="text-xs font-semibold text-muted-foreground">文字頻道</h3>
      </div>
      {topics.length === 0 ? (
        <p className="rounded-2xl border-2 border-dashed px-4 py-3 text-sm text-muted-foreground">還沒有文字頻道</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border-2 bg-card shadow-lip">
          {active.map((topic) => (
            <TopicRow key={topic.id} topic={topic} back={back} />
          ))}
          {archived.length > 0 && (
            <button
              type="button"
              aria-expanded={showArchived}
              onClick={() => setShowArchived((v) => !v)}
              className="flex min-h-12 w-full items-center gap-2 border-t px-4 text-left text-sm text-muted-foreground first:border-t-0"
            >
              {showArchived ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              已封存（{archived.length}）
            </button>
          )}
          {showArchived && archived.map((topic) => <TopicRow key={topic.id} topic={topic} back={back} />)}
        </div>
      )}
    </section>
  )
}

function TopicRow({ topic, back }: { topic: Channel; back: string }) {
  const detail = channelDetail(topic)
  return (
    <div className="flex min-h-12 items-center border-t first:border-t-0">
      <Link to={`/channels/${topic.id}`} state={{ backTo: back }} className="flex min-w-0 flex-1 items-center gap-3 py-2 pr-2 pl-4">
        <Hash className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className={cn("flex items-center gap-2 text-sm", topic.unread > 0 && !topic.archived && "font-semibold", topic.archived && "text-muted-foreground")}>
            <span className="truncate">{topic.name}</span>
            {topic.archived && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[0.625rem]">已封存</span>}
          </p>
          {detail.length > 0 && <p className="text-[0.6875rem] text-muted-foreground">{detail.join(" · ")}</p>}
        </div>
        {topic.unread > 0 && !topic.archived && <UnreadDot count={topic.unread} />}
      </Link>
    </div>
  )
}

type ThreadState = { status: "loading" } | { status: "error" } | { status: "ready"; threads: Channel[] }

/** 地點底下有人發過言的客戶討論串。沒發過言的從客戶檔案的「討論串」按鈕開 */
function ThreadSection({ place, back, refreshKey }: { place: Channel; back: string; refreshKey: number }) {
  const [state, setState] = useState<ThreadState>({ status: "loading" })

  useEffect(() => {
    const controller = new AbortController()
    listThreads(place.id, controller.signal)
      .then((threads) => setState({ status: "ready", threads }))
      .catch(() => {
        // 已經有清單就留著，重新載入失敗不必把畫面清掉
        if (!controller.signal.aborted) setState((s) => (s.status === "ready" ? s : { status: "error" }))
      })
    return () => controller.abort()
  }, [place.id, refreshKey])

  return (
    <section className="flex flex-col gap-1">
      <h3 className="px-1 text-xs font-semibold text-muted-foreground">客戶討論串</h3>
      {state.status === "loading" && <p className="py-4 text-center text-sm text-muted-foreground">載入中…</p>}
      {state.status === "error" && <Notice text="連不上伺服器，討論串沒有載入。" />}
      {state.status === "ready" && state.threads.length === 0 && (
        <Notice text="這裡的客戶還沒有人開討論串。要開一個，從客戶檔案右上角的「討論串」進去。" />
      )}
      {state.status === "ready" && state.threads.length > 0 && (
        <div className="overflow-hidden rounded-2xl border-2 bg-card shadow-lip">
          {state.threads.map((thread) => (
            <ChannelRow key={thread.id} channel={thread} backTo={back} />
          ))}
        </div>
      )}
    </section>
  )
}
```

（`onChanged` 參數這個任務先收下不用；eslint 若抱怨未使用，在解構時不要列出它，只留在型別裡。）

- [ ] **Step 5: 重寫 `frontend/src/pages/channels.tsx`**

```tsx
import { Link, useSearchParams } from "react-router"
import { useEffect, useState } from "react"
import { Search } from "lucide-react"

import { listChannels, type Channel } from "@/api/channels"
import { BottomNav } from "@/components/bottom-nav"
import { ChannelPanel } from "@/components/channel-panel"
import { ChannelRail } from "@/components/channel-rail"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { homePath, useAuth } from "@/lib/auth"
import { pickSelected, rememberChannel, rememberedChannel } from "@/lib/channel-rail"
import { presence } from "@/lib/presence"
import { realtime } from "@/lib/realtime"

// 有新訊息、有人狀態變了或文字頻道有變動，等這麼久再重新載入一次，一連串的變化併成一次
const RELOAD_DELAY_MS = 3_000

type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; channels: Channel[]; loadedAt: number }

/** 頻道頁，跟 Discord 手機版一樣分左右兩欄：左邊是全國、各區、各小組與地點，
 * 右邊是選中那個頻道的對話、記憶看板、照片與檔案，以及底下的文字頻道或客戶討論串。
 * 選中哪個放在網址的 ?c=，也記在這支手機上，下次打開還停在那裡 */
export function ChannelsPage() {
  const user = useAuth()?.user
  const [params, setParams] = useSearchParams()
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const load = () =>
      listChannels(controller.signal)
        .then((channels) => setState({ status: "ready", channels, loadedAt: Date.now() }))
        .catch(() => {
          if (!controller.signal.aborted) setState((s) => (s.status === "ready" ? s : { status: "error" }))
        })
    void load()
    // 從頻道回來、手機切回前景時更新未讀數
    const onVisible = () => document.visibilityState === "visible" && void load()
    document.addEventListener("visibilitychange", onVisible)
    // 未讀數、「N 人在線」與文字頻道跟著 WebSocket 的通知更新
    let timer: ReturnType<typeof setTimeout> | undefined
    const soon = () => {
      timer ??= setTimeout(() => {
        timer = undefined
        void load()
      }, RELOAD_DELAY_MS)
    }
    const offRealtime = realtime.subscribe((event) => event.type !== "avatars" && soon())
    const offPresence = presence.subscribe(soon)
    return () => {
      controller.abort()
      document.removeEventListener("visibilitychange", onVisible)
      clearTimeout(timer)
      offRealtime()
      offPresence()
    }
  }, [attempt])

  const requested = Number(params.get("c")) || null
  const selected =
    state.status === "ready" && user ? pickSelected(state.channels, requested, rememberedChannel(), user.role) : null
  const selectedId = selected?.id ?? null

  useEffect(() => {
    if (selectedId !== null) rememberChannel(selectedId)
  }, [selectedId])

  const sales = user?.role === "sales"
  return (
    <div className="flex h-svh flex-col">
      <PageHeader
        title="頻道"
        backTo={sales || !user ? undefined : homePath(user.role)}
        trailing={
          <Link to="/channels/search" aria-label="找照片與檔案" className="flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted">
            <Search className="size-5" />
          </Link>
        }
      />
      {state.status === "loading" && <p className="py-10 text-center text-sm text-muted-foreground">載入頻道中…</p>}
      {state.status === "error" && (
        <main className="p-4">
          <Notice text="連不上伺服器，頻道沒有載入。" action={{ label: "重新載入", onClick: () => setAttempt((n) => n + 1) }} />
        </main>
      )}
      {state.status === "ready" && user && (
        <div className="flex min-h-0 flex-1">
          <ChannelRail
            channels={state.channels}
            selectedId={selectedId}
            onSelect={(channel) => setParams({ c: String(channel.id) }, { replace: true })}
          />
          {selected ? (
            <ChannelPanel
              key={selected.id}
              channel={selected}
              channels={state.channels}
              selfId={user.id}
              refreshKey={state.loadedAt}
              onChanged={() => setAttempt((n) => n + 1)}
            />
          ) : (
            <main className="flex-1 p-4">
              <Notice text="還沒有看得到的頻道。" />
            </main>
          )}
        </div>
      )}
      {sales && <BottomNav />}
    </div>
  )
}
```

- [ ] **Step 6: 對話頁** — `frontend/src/pages/channel.tsx`

1. 刪掉檔案裡的 `KIND_LABEL` 常數，改從 `@/lib/channels` import（加進既有的 `import { awaitingMascot, MESSAGE_PAGE, ... } from "@/lib/channels"`）；加 `import { railPath } from "@/lib/channel-rail"`。
2. `ChannelLocationState` 換成：

```ts
// jumpTo：從搜尋頁、問答的出處點進來，打開後捲到那一則並標亮；tab：從右欄的「記憶看板」進來，直接打開看板
export type ChannelLocationState = { backTo?: string; jumpTo?: number; tab?: "chat" | "board" }
```

3. `ChannelView` 開頭：

```ts
  const { backTo: backState, jumpTo: jumpTarget, tab: initialTab } = (useLocation().state as ChannelLocationState | null) ?? {}
```

`const [tab, setTab] = useState<"chat" | "board">("chat")` 改成 `useState<"chat" | "board">(initialTab ?? "chat")`。
在 `if (state.status !== "ready")` 那一段之前加：

```ts
  // 沒帶返回位置（從通知、手打網址進來）：回到兩欄，停在這個頻道（文字頻道與客戶討論串停在上層）
  const backTo = backState ?? (state.status === "ready" ? railPath(state.channel) : "/channels")
```

（`ChannelView` 裡原本用 `backTo` 的地方都不用改；確認沒有別的地方在這行之前用到 `backTo`。）

4. 封存的頁尾文字改成 `這個頻道已封存，不能再發言。`。

- [ ] **Step 7: 搜尋頁的返回鍵** — `frontend/src/pages/channel-search.tsx`：import 加 `useLocation`，第 30 行改成：

```ts
  // 從頻道頁的右欄進來會帶返回位置；從對話頁進來回那個頻道，從頻道頁標頭的放大鏡進來回頻道頁
  const backState = (useLocation().state as { backTo?: string } | null)?.backTo
  const backTo = backState ?? (fromChannel ? `/channels/${fromChannel}` : "/channels")
```

- [ ] **Step 8: 刪掉用不到的分組** — `frontend/src/lib/channels.ts` 刪 `ChannelSection`、`groupChannels`、`sortUnreadFirst`；`frontend/src/lib/channels.test.ts` 刪對應的兩個 `describe` 與 import 裡的名字（`channel` 這個測試輔助函式如果沒有別人用也一起刪）。

- [ ] **Step 9: 檢查**

Run: `npm --prefix frontend test && npm --prefix frontend run typecheck && npm --prefix frontend run lint && npm --prefix frontend run build`
Expected: 全部成功、沒有 lint 警告。

- [ ] **Step 10: Commit**

```bash
git add frontend/src
git commit -m "Show channels as a Discord-style rail with the selected channel's panel beside it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 新增與管理文字頻道的對話框

**Files:**
- Create: `frontend/src/components/topic-dialogs.tsx`
- Modify: `frontend/src/components/channel-panel.tsx`（`TopicSection`、`TopicRow`、`ChannelPanel`）

**Interfaces:**
- Consumes: Task 3 的 `createTopic`、`updateTopic`、`railPath`；Task 4 的 `ChannelPanel` props（`onChanged`）。
- Produces: `CreateTopicDialog({ parent, onClose })`、`ManageTopicDialog({ topic, onClose, onDone })`。

- [ ] **Step 1: 新檔 `frontend/src/components/topic-dialogs.tsx`**

```tsx
import { useState, type FormEvent } from "react"
import { useNavigate } from "react-router"

import { createTopic, updateTopic, type Channel } from "@/api/channels"
import { ApiError } from "@/api/client"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { railPath } from "@/lib/channel-rail"

// 跟後端一樣（models.TOPIC_NAME_MAX）
const TOPIC_NAME_MAX = 20

/** 後端說得出原因的（重名、名稱不對）照它的說；其他的給一句通用的 */
function reason(error: unknown, fallback: string) {
  return error instanceof ApiError && (error.status === 409 || error.status === 422) ? error.message : fallback
}

/** 在全國或整區頻道底下開文字頻道。開好直接進新頻道的對話頁，返回時停在上層 */
export function CreateTopicDialog({ parent, onClose }: { parent: Channel; onClose: () => void }) {
  const navigate = useNavigate()
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const topic = await createTopic(parent.id, name.trim())
      navigate(`/channels/${topic.id}`, { state: { backTo: railPath(topic) } })
    } catch (err) {
      setError(reason(err, "沒有建立，請再試一次"))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>新增文字頻道</DialogTitle>
            <DialogDescription>{parent.audience}，大家都能發言。</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="topic-name">頻道名稱</Label>
            <Input
              id="topic-name"
              value={name}
              maxLength={TOPIC_NAME_MAX}
              placeholder="例如：新品上市"
              autoFocus
              className="h-11"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={onClose}>
              取消
            </Button>
            <Button type="submit" className="h-11" disabled={busy || !name.trim()}>
              {busy ? "建立中…" : "建立"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** 文字頻道改名、封存或解除封存。改好呼叫 onDone 讓頻道頁馬上重新載入，不必等即時通知 */
export function ManageTopicDialog({ topic, onClose, onDone }: { topic: Channel; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(topic.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trimmed = name.trim()

  async function run(changes: { name?: string; archived?: boolean }) {
    setBusy(true)
    setError(null)
    try {
      await updateTopic(topic.id, changes)
      onDone()
      onClose()
    } catch (err) {
      setError(reason(err, "沒有改到，請再試一次"))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>管理「{topic.name}」</DialogTitle>
          <DialogDescription>{topic.audience}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            void run({ name: trimmed })
          }}
        >
          <Label htmlFor="topic-rename">頻道名稱</Label>
          <div className="flex gap-2">
            <Input
              id="topic-rename"
              value={name}
              maxLength={TOPIC_NAME_MAX}
              className="h-11 flex-1"
              onChange={(event) => setName(event.target.value)}
            />
            <Button type="submit" className="h-11" disabled={busy || !trimmed || trimmed === topic.name}>
              儲存
            </Button>
          </div>
        </form>
        <div className="flex flex-col gap-2 border-t pt-4">
          <p className="text-sm text-muted-foreground">
            {topic.archived ? "解除封存後大家又能在這裡發言。" : "封存後大家還看得到，但不能再發言。"}
          </p>
          <Button
            variant={topic.archived ? "outline" : "destructive"}
            className="h-11"
            disabled={busy}
            onClick={() => void run({ archived: !topic.archived })}
          >
            {topic.archived ? "解除封存" : "封存這個頻道"}
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: 接進右欄** — `frontend/src/components/channel-panel.tsx`

import 加 `EllipsisVertical, Plus`（lucide）、`Button`（`@/components/ui/button`）、`CreateTopicDialog, ManageTopicDialog`（`@/components/topic-dialogs`）。

`ChannelPanel` 解構加上 `onChanged`，函式開頭加：

```tsx
  const [creating, setCreating] = useState(false)
  const [managing, setManaging] = useState<Channel | null>(null)
```

`TopicSection` 的呼叫改成：

```tsx
          <TopicSection
            topics={topicsOf(channels, channel.id)}
            back={back}
            canCreate={channel.can_manage}
            onCreate={() => setCreating(true)}
            onManage={setManaging}
          />
```

`</section>` 結尾前（`</div>` 後面）加：

```tsx
      {creating && <CreateTopicDialog parent={channel} onClose={() => setCreating(false)} />}
      {managing && <ManageTopicDialog topic={managing} onClose={() => setManaging(null)} onDone={onChanged} />}
```

`TopicSection` 換成：

```tsx
/** 全國、整區底下的文字頻道：沒封存的照開的先後，封存的收在最下面。能管的人有「新增頻道」與每一列的「管理」 */
function TopicSection({
  topics,
  back,
  canCreate,
  onCreate,
  onManage,
}: {
  topics: Channel[]
  back: string
  canCreate: boolean
  onCreate: () => void
  onManage: (topic: Channel) => void
}) {
  const [showArchived, setShowArchived] = useState(false)
  const active = topics.filter((t) => !t.archived)
  const archived = topics.filter((t) => t.archived)
  return (
    <section className="flex flex-col gap-1">
      <div className="flex min-h-9 items-center justify-between px-1">
        <h3 className="text-xs font-semibold text-muted-foreground">文字頻道</h3>
        {canCreate && (
          <Button variant="ghost" size="sm" className="h-9 gap-1 px-2 text-xs text-primary" onClick={onCreate}>
            <Plus className="size-4" />
            新增頻道
          </Button>
        )}
      </div>
      {topics.length === 0 ? (
        <p className="rounded-2xl border-2 border-dashed px-4 py-3 text-sm text-muted-foreground">
          {canCreate ? "還沒有文字頻道，按「新增頻道」開一個" : "還沒有文字頻道"}
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border-2 bg-card shadow-lip">
          {active.map((topic) => (
            <TopicRow key={topic.id} topic={topic} back={back} onManage={onManage} />
          ))}
          {archived.length > 0 && (
            <button
              type="button"
              aria-expanded={showArchived}
              onClick={() => setShowArchived((v) => !v)}
              className="flex min-h-12 w-full items-center gap-2 border-t px-4 text-left text-sm text-muted-foreground first:border-t-0"
            >
              {showArchived ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              已封存（{archived.length}）
            </button>
          )}
          {showArchived && archived.map((topic) => <TopicRow key={topic.id} topic={topic} back={back} onManage={onManage} />)}
        </div>
      )}
    </section>
  )
}
```

`TopicRow` 加 `onManage` 參數，在 `</Link>` 後面加：

```tsx
      {topic.can_manage && (
        <button
          type="button"
          aria-label={`管理「${topic.name}」`}
          onClick={() => onManage(topic)}
          className="mr-1 flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
        >
          <EllipsisVertical className="size-4" />
        </button>
      )}
```

型別改成 `{ topic: Channel; back: string; onManage: (topic: Channel) => void }`。

- [ ] **Step 3: 檢查**

Run: `npm --prefix frontend test && npm --prefix frontend run typecheck && npm --prefix frontend run lint && npm --prefix frontend run build`
Expected: 全部成功。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/topic-dialogs.tsx frontend/src/components/channel-panel.tsx
git commit -m "Let managers open, rename and archive text channels from the channel panel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 本機壓力測試、實機走查與 README

**Files:**
- Create: `backend/scripts/stress_channels.py`
- Modify: `README.md`（頻道段落）
- 走查用的 CDP 腳本放 scratchpad，不進 git。

**Interfaces:**
- Consumes: Task 1～5 的全部端點與畫面。

- [ ] **Step 1: 新檔 `backend/scripts/stress_channels.py`**

```python
"""頻道的壓力測試（docs/superpowers/specs/2026-10-01-channel-rail-design.md「測試」）：
demo 當天幾十個人同時在同一個文字頻道收發訊息，WebSocket 與發言不能出錯。

    DATABASE_URL=… REDIS_URL=… uv run --project backend python backend/scripts/stress_channels.py \
        --base-url http://127.0.0.1:8011

只打本機（--base-url 不是 localhost 就拒絕），不會在正式站留下測試訊息。
帳號直接寫進 DATABASE_URL 那個資料庫（註冊 API 每個來源每小時只能開 20 個）；重跑會沿用同一批帳號。
發言每天全系統最多 1,000 則（app/usage.py），一次 50 人 × 3 則 = 150 則，一天大約能跑六次。

通過條件：沒有 5xx、每則發言都 201、每個人輪詢都拿齊這一輪的全部訊息、
每條 WebSocket 都收到新訊息通知、發言的 p95 在 1 秒內。不通過時 exit code 1。
"""

import argparse
import asyncio
import json
import statistics
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

# macOS 上 .venv 會被標成隱藏，Python 就略過可編輯安裝的 .pth、找不到 app；直接把 backend 加進搜尋路徑
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402
import websockets  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.api.auth import _new_sales_account  # noqa: E402
from app.db import session_factory  # noqa: E402
from app.models import AppUser  # noqa: E402
from app.services import auth  # noqa: E402

TOPIC = "壓力測試"
P95_LIMIT_SECONDS = 1.0


def accounts(count: int) -> list[str]:
    """準備 count 個自建帳號（代理示範業務，看得到北區），回傳 token。沿用上次建的。"""
    tokens = []
    with session_factory()() as session:
        for n in range(1, count + 1):
            email = f"stress-{n:02d}@stress.local"
            user = session.scalar(select(AppUser).where(AppUser.email == email))
            if user is None:
                user = _new_sales_account(session, f"壓測{n:02d}", email=email, password_hash=None)
            tokens.append(auth.create_token(user))
        it = session.get(AppUser, "A01")
        it_token = auth.create_token(it)
        session.commit()
    return [it_token, *tokens]


def topic_id(client: httpx.Client, it_token: str) -> int:
    """北區的「壓力測試」文字頻道，沒有就由 IT 開一個（順便測開頻道的端點）。"""
    headers = {"Authorization": f"Bearer {it_token}"}
    listed = client.get("/api/channels", headers=headers).json()
    found = next((c for c in listed if c["kind"] == "topic" and c["name"] == TOPIC), None)
    if found:
        return found["id"]
    north = next(c for c in listed if c["kind"] == "region" and c["name"] == "北區")
    created = client.post("/api/channels", json={"parent_id": north["id"], "name": TOPIC}, headers=headers)
    created.raise_for_status()
    return created.json()["id"]


async def listen(ws_url: str, token: str, channel: int, ready: asyncio.Event, counts: list[int], index: int, stop: asyncio.Event):
    async with websockets.connect(ws_url) as ws:
        await ws.send(json.dumps({"type": "auth", "token": token, "active": True}))
        while json.loads(await ws.recv())["type"] != "ready":
            pass
        ready.set()
        while not stop.is_set():
            try:
                event = json.loads(await asyncio.wait_for(ws.recv(), timeout=0.5))
            except TimeoutError:
                continue
            if event.get("type") == "message" and event.get("channel_id") == channel:
                counts[index] += 1


async def run(base_url: str, users: int, per_user: int) -> bool:
    tokens = accounts(users)
    it_token, user_tokens = tokens[0], tokens[1:]
    with httpx.Client(base_url=base_url, timeout=30) as client:
        channel = topic_id(client, it_token)
        before = client.get(f"/api/channels/{channel}/messages", headers={"Authorization": f"Bearer {it_token}"}).json()
    start_after = before[-1]["id"] if before else 0

    ws_url = base_url.replace("http", "ws", 1) + "/api/ws"
    counts = [0] * users
    stop = asyncio.Event()
    readies = [asyncio.Event() for _ in range(users)]
    listeners = [
        asyncio.create_task(listen(ws_url, token, channel, readies[i], counts, i, stop)) for i, token in enumerate(user_tokens)
    ]
    await asyncio.wait_for(asyncio.gather(*(r.wait() for r in readies)), timeout=30)
    print(f"{users} 條 WebSocket 都連上了，開始發言")

    latencies: list[float] = []
    failures: list[str] = []
    async with httpx.AsyncClient(base_url=base_url, timeout=30) as client:

        async def speak(i: int, token: str):
            for k in range(per_user):
                started = time.perf_counter()
                response = await client.post(
                    f"/api/channels/{channel}/messages",
                    json={"body": f"壓測{i + 1:02d} 第 {k + 1} 則"},
                    headers={"Authorization": f"Bearer {token}"},
                )
                latencies.append(time.perf_counter() - started)
                if response.status_code != 201:
                    failures.append(f"壓測{i + 1:02d} 第 {k + 1} 則：{response.status_code} {response.text[:120]}")

        await asyncio.gather(*(speak(i, token) for i, token in enumerate(user_tokens)))
        expected = users * per_user - len(failures)

        async def fetch_all(token: str) -> int:
            got, after = 0, start_after
            while True:
                page = (await client.get(
                    f"/api/channels/{channel}/messages", params={"after": after},
                    headers={"Authorization": f"Bearer {token}"},
                )).json()
                if not page:
                    return got
                got += len(page)
                after = page[-1]["id"]

        await asyncio.sleep(1)  # 讓最後幾則通知送到
        fetched = await asyncio.gather(*(fetch_all(token) for token in user_tokens))

    stop.set()
    await asyncio.gather(*listeners, return_exceptions=True)

    p95 = statistics.quantiles(latencies, n=20)[18] if len(latencies) >= 20 else max(latencies)
    print(f"發言 {len(latencies)} 則，失敗 {len(failures)} 則")
    print(f"發言時間：p50 {statistics.median(latencies):.3f}s、p95 {p95:.3f}s、最慢 {max(latencies):.3f}s")
    print(f"輪詢拿到：最少 {min(fetched)}、最多 {max(fetched)}（應該是 {expected}）")
    print(f"WebSocket 通知：最少 {min(counts)}、最多 {max(counts)}")
    for line in failures[:10]:
        print("  ", line)

    ok = not failures and all(n == expected for n in fetched) and min(counts) > 0 and p95 <= P95_LIMIT_SECONDS
    print("通過" if ok else "沒有通過")
    return ok


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--base-url", default="http://127.0.0.1:8011")
    parser.add_argument("--users", type=int, default=50)
    parser.add_argument("--messages", type=int, default=3, help="每個人發幾則")
    args = parser.parse_args()
    if urlparse(args.base_url).hostname not in ("127.0.0.1", "localhost"):
        sys.exit("只打本機：--base-url 要是 localhost 或 127.0.0.1")
    sys.exit(0 if asyncio.run(run(args.base_url.rstrip("/"), args.users, args.messages)) else 1)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 起本機的 API 並跑壓力測試**（照記憶「Run the stack from a worktree」）

1. 把主目錄的 `backend/.env` 複製到 worktree 的 `backend/.env`（gitignored，跑完刪掉）。
2. 建一個獨立的開發資料庫並灌資料：`createdb` 不一定有，用 `docker compose exec db psql -U meddemo -c "CREATE DATABASE meddemo_rail_dev"`，再
   `uv run --project backend python data/seed/seed.py --database-url postgresql+psycopg://meddemo:meddemo@127.0.0.1:5433/meddemo_rail_dev`
   （`--database-url` 的確切格式看 `data/seed/seed.py` 的 `main()`）。
3. 起 API（背景跑）：`DATABASE_URL=postgresql+psycopg://meddemo:meddemo@127.0.0.1:5433/meddemo_rail_dev REDIS_URL=redis://127.0.0.1:6379/11 uv run --project backend uvicorn app.main:app --app-dir backend --port 8011`
4. 跑：`DATABASE_URL=…/meddemo_rail_dev REDIS_URL=redis://127.0.0.1:6379/11 uv run --project backend python backend/scripts/stress_channels.py --base-url http://127.0.0.1:8011`

Expected: 最後一行「通過」。沒過的話把輸出原文記下來，用 superpowers:systematic-debugging 找原因，不要調鬆通過條件。

- [ ] **Step 3: 實機走查**（照記憶「Headless Chrome quits after 30 s」）：用 CDP 腳本分段（每段 20 秒內、各自開新的 Chrome），`window.fetch` 對 `/api/*` 回假資料，localStorage 先放 `meddemo:token`、`meddemo:user`、`meddemo:onboarded`。對前端 build 出來的 `frontend/dist`（`npx vite preview --port 4181` 或同等的靜態伺服器）走：
   1. M01 打開 `/channels`：左欄有全國、北區、建宏、地點資料夾；預設停在建宏（小組）。截圖。
   2. 點北區：右欄有對話、記憶看板、照片與檔案、文字頻道（新品上市、補貨問題）與「新增頻道」。截圖。
   3. 點「新增頻道」，輸入「測試頻道」，按建立：網址變成 `/channels/<新 id>`（假 API 回一個 topic）。
   4. 在對話頁按返回：回到 `/channels?c=<北區 id>`，右欄還是北區。
   5. U01 打開北區：沒有「新增頻道」、文字頻道列沒有「管理」按鈕。
   6. 深色模式（localStorage `meddemo:skin`）各截一張北區的圖。
   截圖存 scratchpad，逐張看過：沒有表情符號、左欄沒有橫向捲動、文字沒有被切掉。

- [ ] **Step 4: README** — 找到頻道的段落（`grep -n "頻道" README.md`），把「頻道列表」的說明改成左右兩欄：左欄全國、各區、各小組與地點資料夾；右欄對話、記憶看板、照片與檔案、文字頻道（全國與整區）或客戶討論串（地點）。加一小段「文字頻道」：誰能開（區的在職主管與 IT，全國只有 IT）、整區都看得到、可以改名與封存不能刪；以及壓力測試的跑法（`backend/scripts/stress_channels.py` 的 docstring 那三行指令）。

- [ ] **Step 5: 清理與 Commit**：刪掉 worktree 的 `backend/.env`、停掉背景的 uvicorn。

```bash
git add backend/scripts/stress_channels.py README.md
git commit -m "Stress-test a busy text channel locally and describe the channel rail in the README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
