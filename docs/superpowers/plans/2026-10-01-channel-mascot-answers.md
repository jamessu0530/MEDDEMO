# 在頻道裡 @熊熊滾 回答 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在頻道裡 @熊熊滾，它讀這個頻道最近的對話回答；要查公司文件的題目走跟問答頁同一條 CRAG。

**Architecture:** 發言時判斷有沒有叫熊熊滾、存在 `channel_message.mentions_ai`，commit 後排進新的 `channels` RQ 佇列。
背景工作 `services/channel_ai.py` 先用一次模型判斷題目（`chat` 直接回答、`documents` 改寫成單獨的問題交給 `knowledge.answer_knowledge`），
再以 `kind = ai`、`reply_to_id` 指向提問寫回頻道。所有寫訊息的地方走 `channels._write`，先 `FOR NO KEY UPDATE` 鎖住頻道那一列，編號順序等於寫入完成順序。

**Tech Stack:** FastAPI、SQLAlchemy 2、Postgres、RQ／Redis、Gemini（`app.llm.LLM`）、React 19 + Vite、vitest、pytest。

**Spec:** `docs/superpowers/specs/2026-10-01-channel-mascot-answers-design.md`

## Global Constraints

- 叫熊熊滾：`@熊熊滾`、`@熊熊`、`@AI`；英文不分大小寫，全形 `＠`、`ＡＩ` 也算；`@` 前面不能緊接英文字母、數字或 email 用的符號（`x@ai.com` 不算），`AI` 後面不能緊接英文字母或數字（`@AIDS` 不算），接中文可以（`@AI請問`、`請@熊熊滾回答`）。
- 道歉文案一字不差：`我暫時答不出來，請稍後再 @ 我一次。`
- 給模型最近 **50** 則（含提問），只取編號不大於提問的；客戶討論串加客戶基本資料（名稱、類型、連鎖體系、縣市、地點、等級、負責人），**不給合約到期日、銷售數字、拜訪紀錄**。
- 一次 @ 算一次「提問」（`usage.LIMITS["ask"]`），超過回 429、訊息不留。
- 「熊熊滾正在想」最多顯示 **3 分鐘**。
- 熊熊滾訊息的標籤是「熊熊滾」；輸入框提示字「回報一件事，或 @熊熊滾 問問題…」。
- worker 指令 `rq worker visits channels`，不加 `--with-scheduler`。
- 程式註解、文案用繁體中文，跟周圍的程式一樣的密度與口吻。

## 檔案

| 檔案 | 改什麼 |
|---|---|
| `backend/app/models.py` | `ChannelMessage` 加 `mentions_ai`、`reply_to_id` |
| `backend/app/services/channels.py` | `MENTION`、`mentions_mascot`、`_write`（上鎖）、`post` 改走 `_write`、新 `post_mascot` |
| `backend/app/services/channel_ai.py`（新） | 判斷題目、呼叫 CRAG、組出處、失敗道歉；RQ 進入點 `run` |
| `backend/app/tasks.py` | `channel_queue()` |
| `backend/app/usage.py` | `take(bucket, request)`：在 API 裡另外扣一次 |
| `backend/app/api/channels.py` | `MessageItem` 加欄位；發言時扣「提問」、排工作、排不進去就道歉 |
| `backend/tests/test_channels.py` | 判斷 @、上鎖 |
| `backend/tests/test_channel_ai.py`（新） | 回答、失敗、封存、API、用量、背景工作 |
| `frontend/src/api/channels.ts` | `ChannelMessage` 加欄位 |
| `frontend/src/lib/channels.ts`、`channels.test.ts` | `awaitingMascot`、`withMascotMention` |
| `frontend/src/pages/channel.tsx` | 標籤、回覆誰、@熊熊滾 按鈕、正在想 |
| `frontend/src/pages/privacy.tsx` | 第三方服務補 @熊熊滾 |
| `deploy/helm/meddemo/templates/worker.yaml`、`README.md` | worker 指令、用量說明 |

---

### Task 1: 判斷 @、寫訊息上鎖、熊熊滾的寫入函式

**Files:**
- Modify: `backend/app/models.py`（`class ChannelMessage`，約 694–711 行）
- Modify: `backend/app/services/channels.py`
- Modify: `backend/app/api/channels.py`（`MessageItem`、`_message`）
- Modify: `docs/superpowers/specs/2026-10-01-channel-mascot-answers-design.md`（@ 前面的規則）
- Test: `backend/tests/test_channels.py`

**Interfaces:**
- Produces:
  - `channels.mentions_mascot(body: str) -> bool`
  - `channels.post(session, user, info, body) -> ChannelMessage`（不變，但會設 `mentions_ai`）
  - `channels.post_mascot(session: Session, channel_id: int, body: str, reply_to_id: int) -> ChannelMessage`
  - `ChannelMessage.mentions_ai: bool`、`ChannelMessage.reply_to_id: int | None`
  - API `MessageItem` 多 `mentions_ai: bool`、`reply_to_id: int | None`

- [ ] **Step 1: 寫失敗的測試**（加在 `backend/tests/test_channels.py` 最後；檔頭 import 補 `threading`、`AppUser`、`ChannelMessage`、`ChannelRead`、`delete`）

```python
@pytest.mark.parametrize("body", [
    "@熊熊滾 近效期退貨運費誰付？", "請問 @熊熊 一下", "請@熊熊滾回答", "＠熊熊滾 在嗎",
    "@AI 幫我整理", "@ai請問", "＠ＡＩ 請問", "第一行\n@熊熊滾 第二行",
])
def test_these_call_the_mascot(body):
    assert channels.mentions_mascot(body)


@pytest.mark.parametrize("body", ["寄到 x@ai.com", "@AIDS 衛教單張", "熊熊滾好可愛", "@熊 在嗎"])
def test_these_do_not_call_the_mascot(body):
    assert not channels.mentions_mascot(body)


def visible(session, user_id: str, name: str):
    user = session.get(AppUser, user_id)
    return user, next(i for i in channels.visible_channels(session, user) if i.name == name)


def test_a_message_remembers_whether_it_called_the_mascot_and_the_mascot_replies_to_it(tx, client, auth):
    user, team = visible(tx, "U01", "陳建宏小組")
    asked = channels.post(tx, user, team, "@熊熊滾 在嗎")
    reply = channels.post_mascot(tx, team.id, "在喔", asked.id)
    assert asked.mentions_ai is True and asked.reply_to_id is None
    assert (reply.kind, reply.author_id, reply.reply_to_id, reply.mentions_ai) == ("ai", None, asked.id, False)
    assert reply.id > asked.id
    # 一般發言 mentions_ai 是 false；API 都帶這兩欄
    plain = post(client, auth("U01"), team.id, "忠孝店的檔期資料我週三前給").json()
    assert (plain["mentions_ai"], plain["reply_to_id"]) == (False, None)
    latest = history(client, auth("U02"), team.id)[-3:]
    assert [(m["kind"], m["reply_to_id"]) for m in latest] == [("user", None), ("ai", asked.id), ("user", None)]


def test_writes_to_one_channel_queue_up_so_ids_follow_commit_order(engine):
    """兩條連線同時在同一個頻道寫：後到的要等先拿到鎖的那一則 commit，編號一定比較大。
    沒有鎖的話，後寫的可能先 commit，輪詢「這則之後」的人就會永遠漏掉先寫、晚 commit 的那一則。
    資料真的 commit 了，測完刪掉；用台北市・信義區，地點頻道不算進紅點，也沒有灌資料的對話。"""
    result = {}
    with Session(engine) as first:
        user, place = visible(first, "U01", "台北市・信義區")
        held = channels.post(first, user, place, "測試：先拿到鎖")

        def write_second():
            with Session(engine) as second:
                message = channels.post(second, second.get(AppUser, "U02"), place, "測試：後到")
                second.commit()
                result["id"] = message.id

        worker = threading.Thread(target=write_second)
        worker.start()
        worker.join(timeout=0.5)
        try:
            assert worker.is_alive(), "後到的那一則沒有等鎖"
        finally:
            first.commit()
            held_id = held.id
            worker.join(timeout=5)
            with engine.begin() as conn:
                conn.execute(delete(ChannelMessage).where(ChannelMessage.channel_id == place.id))
                conn.execute(delete(ChannelRead).where(ChannelRead.channel_id == place.id))
    assert result["id"] > held_id
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `uv run --project backend pytest backend/tests/test_channels.py -q`
Expected: FAIL（`AttributeError: module 'app.services.channels' has no attribute 'mentions_mascot'`）

- [ ] **Step 3: 模型加欄位**（`backend/app/models.py`，`ChannelMessage` 的 `body` 之後）

```python
    body: Mapped[str] = mapped_column(Text)
    # 有沒有叫熊熊滾（services/channels.mentions_mascot）。寫入時判斷就存起來，之後改了判斷規則，舊訊息不會被重新解讀
    mentions_ai: Mapped[bool] = mapped_column(server_default=text("false"))
    # 熊熊滾回答的是哪一則。那一則不在了（自建帳號刪除時一起刪）就留 NULL，回答本身留著
    reply_to_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("channel_message.id", ondelete="SET NULL"))
```

同一個 class 的 docstring 後面接一句：「熊熊滾的回答（`kind = ai`）用 `reply_to_id` 指向提問那一則。」

- [ ] **Step 4: 服務層**（`backend/app/services/channels.py`）

檔頭 import 加 `import re`。`MESSAGE_PAGE` 之後加：

```python
# 叫熊熊滾：@熊熊滾、@熊熊、@AI。中文輸入法常打出全形的 ＠ 與 ＡＩ，一起算；英文不分大小寫。
# @ 前面不能緊接英數字或 email 用的符號（x@ai.com 不算），接中文可以（請@熊熊滾回答）；
# AI 後面不能緊接英數字（@AIDS 不算），接中文可以（@AI請問）。畫面上的按鈕用同一條規則（frontend/src/lib/channels.ts）
MENTION = re.compile(
    r"(?<![0-9a-z０-９ａ-ｚ._%+-])[@＠](?:熊熊|(?:ai|ａｉ)(?![0-9a-z０-９ａ-ｚ]))", re.IGNORECASE
)
```

`post` 換成下面三個函式（`post` 的行為不變，只是改走 `_write`、多設 `mentions_ai`）：

```python
def mentions_mascot(body: str) -> bool:
    return MENTION.search(body) is not None


def _write(session: Session, channel_id: int, **fields) -> ChannelMessage:
    """寫一則訊息。所有寫訊息的地方都走這裡：先鎖住頻道那一列，同一個頻道的寫入排隊進行，
    編號的先後就等於寫入完成的先後。輪詢靠「這則之後的新訊息」，熊熊滾在背景寫回答時才不會漏掉。
    用 FOR NO KEY UPDATE：寫訊息、記已讀時外鍵檢查拿的是 KEY SHARE，跟它不衝突，別人記已讀不必排隊。"""
    session.execute(select(Channel.id).where(Channel.id == channel_id).with_for_update(key_share=True))
    message = ChannelMessage(channel_id=channel_id, **fields)
    session.add(message)
    session.flush()
    return message


def post(session: Session, user: AppUser, info: ChannelInfo, body: str) -> ChannelMessage:
    """發言。記在實際登入的帳號上（自建帳號用自己的名字，不是代理的示範業務）；自己發的就算讀過了。"""
    if info.archived:
        raise Archived
    message = _write(session, info.id, author_id=user.id, kind="user", body=body, mentions_ai=mentions_mascot(body))
    mark_read(session, user, info.id, message.id)
    session.refresh(message)
    return message


def post_mascot(session: Session, channel_id: int, body: str, reply_to_id: int) -> ChannelMessage:
    """熊熊滾回答 reply_to_id 那一則（services/channel_ai.py）。不判斷 @，熊熊滾不會自己叫自己。"""
    message = _write(session, channel_id, kind="ai", body=body, reply_to_id=reply_to_id)
    session.refresh(message)
    return message
```

確認 `with_for_update(key_share=True)` 編出來是 `FOR NO KEY UPDATE`：

Run: `uv run --project backend python -c "from sqlalchemy import select; from sqlalchemy.dialects import postgresql; from app.models import Channel; print(select(Channel.id).with_for_update(key_share=True).compile(dialect=postgresql.dialect()))"`（工作目錄 `backend`）
Expected: 結尾是 `FOR NO KEY UPDATE`

- [ ] **Step 5: API 帶兩個新欄位**（`backend/app/api/channels.py`）

```python
class MessageItem(BaseModel):
    id: int
    kind: str
    author_id: str | None
    author_name: str | None
    body: str
    created_at: dt.datetime
    # 是不是登入者自己發的（自建帳號看的是示範業務的頻道，但發言記在自己名下）
    mine: bool
    # 有沒有叫熊熊滾；畫面靠它和 reply_to_id 判斷熊熊滾是不是還在想
    mentions_ai: bool
    # 熊熊滾的回答指向提問那一則
    reply_to_id: int | None


def _message(message: ChannelMessage, author_name: str | None, user: AppUser) -> MessageItem:
    return MessageItem(
        id=message.id, kind=message.kind, author_id=message.author_id, author_name=author_name,
        body=message.body, created_at=message.created_at, mine=message.author_id == user.id,
        mentions_ai=message.mentions_ai, reply_to_id=message.reply_to_id,
    )
```

- [ ] **Step 6: 更新 spec 的 @ 規則**

`docs/superpowers/specs/2026-10-01-channel-mascot-answers-design.md`「怎麼叫熊熊滾」第一點的後半改成：
「`@` 前面不能緊接英文字母、數字或 email 用的符號（`x@ai.com` 不算），接中文可以（`請@熊熊滾回答`）；`@AI` 後面不能緊接英文字母或數字（`@AIDS` 不算），接中文可以（`@AI請問`）。」
（原本寫「前面要是訊息開頭或空白」，中文打字常常不空格，會漏掉。）

- [ ] **Step 7: 跑測試確認通過**

Run: `uv run --project backend pytest backend/tests/test_channels.py -q`
Expected: 全部 PASS（模型改了，conftest 每次重建測試資料庫，不必另外處理）

- [ ] **Step 8: Commit**

```bash
git add backend/app/models.py backend/app/services/channels.py backend/app/api/channels.py backend/tests/test_channels.py docs/superpowers/specs/2026-10-01-channel-mascot-answers-design.md
git commit -m "Remember whether a channel message calls 熊熊滾 and lock the channel while writing"
```

---

### Task 2: 熊熊滾的回答（`services/channel_ai.py`）

**Files:**
- Create: `backend/app/services/channel_ai.py`
- Test: `backend/tests/test_channel_ai.py`

**Interfaces:**
- Consumes: `channels.describe`、`channels.post_mascot(session, channel_id, body, reply_to_id)`、`knowledge.answer_knowledge(session, llm, question, on_step, embed_query) -> KnowledgeAnswer`、`app.llm.get_llm`、`app.embeddings.optional_embedder`
- Produces:
  - `channel_ai.SORRY: str`
  - `channel_ai.answer(session: Session, message_id: int) -> ChannelMessage | None`（不 commit）
  - `channel_ai.run(message_id: int) -> None`（RQ 進入點，自己開連線、commit）
  - `channel_ai.with_sources(answer_text: str, sources: list[dict]) -> str`

- [ ] **Step 1: 寫失敗的測試**（新檔 `backend/tests/test_channel_ai.py`）

```python
"""頻道裡 @熊熊滾（services/channel_ai.py）。

AI 模型用照劇本回應的替身；CRAG 換成記下問題、回寫好結果的替身（CRAG 本身在 test_asks、test_crag_* 測過）。
直接呼叫 answer 的測試都跑在 tx fixture 的交易裡，測完回滾。
"""

import datetime as dt

import pytest
from sqlalchemy import func, select

from app.config import NotConfigured
from app.models import AppUser, ChannelMessage, Customer
from app.services import channel_ai, channels, knowledge
from app.services.knowledge import KnowledgeAnswer


class RouteLLM:
    """只會被呼叫一次「判斷題目」：回寫好的結果，記下送了什麼。"""

    def __init__(self, decision=None, error=None):
        self.decision, self.error, self.prompts = decision, error, []

    def json(self, *, system, prompt, schema, **_):
        self.prompts.append(prompt)
        if self.error:
            raise self.error
        return self.decision


@pytest.fixture
def mascot(monkeypatch):
    """換掉模型與 CRAG。use(decision, error=, knowledge=) 設定這次的劇本，回傳 (模型替身, 交給 CRAG 的問題清單)。
    knowledge 給例外就讓 CRAG 丟出來。"""

    def use(decision=None, *, error=None, knowledge=None):
        llm, asked = RouteLLM(decision, error), []

        def fake_knowledge(session, llm_, question, on_step, embed_query=None):
            asked.append(question)
            if isinstance(knowledge, Exception):
                raise knowledge
            return knowledge

        monkeypatch.setattr(channel_ai, "get_llm", lambda: llm)
        monkeypatch.setattr(channel_ai, "answer_knowledge", fake_knowledge)
        return llm, asked

    return use


def chat(answer):
    return {"route": "chat", "question": "", "answer": answer}


def documents(question):
    return {"route": "documents", "question": question, "answer": ""}


def visible(session, name, user_id="U01"):
    user = session.get(AppUser, user_id)
    return next(i for i in channels.visible_channels(session, user) if i.name == name)


def ask(session, info, body, user_id="U01"):
    return channels.post(session, session.get(AppUser, user_id), info, body)


def test_a_chat_question_is_answered_from_the_conversation(tx, mascot):
    _, asked_crag = mascot(chat("剛剛大家在說忠孝店補貨延遲。"))
    team = visible(tx, "陳建宏小組")
    question = ask(tx, team, "@熊熊滾 剛剛在說什麼")
    reply = channel_ai.answer(tx, question.id)
    assert (reply.kind, reply.body, reply.reply_to_id, reply.channel_id) == (
        "ai", "剛剛大家在說忠孝店補貨延遲。", question.id, team.id
    )
    assert asked_crag == []


def test_a_question_about_company_rules_goes_through_the_same_crag_as_the_ask_page(tx, mascot):
    sources = [
        {"kind": "kb", "index": 1, "doc_title": "近效期品項退貨作業規範", "section": "近效期退貨的運費",
         "source_name": "01-近效期退貨.md", "content": "…"},
        {"kind": "web", "index": 2, "doc_title": "食藥署公告", "section": "fda.gov.tw",
         "url": "https://www.fda.gov.tw/x", "source_name": "fda.gov.tw", "content": "…"},
    ]
    _, asked_crag = mascot(
        documents("近效期品項退貨的運費由誰負擔？"),
        knowledge=KnowledgeAnswer("answered", "運費由公司負擔 [1]，另見 [2]。", sources, "kb"),
    )
    reply = channel_ai.answer(tx, ask(tx, visible(tx, "陳建宏小組"), "@熊熊 剛剛說的那個退貨運費誰付？").id)
    assert asked_crag == ["近效期品項退貨的運費由誰負擔？"]
    assert reply.body == (
        "運費由公司負擔 [1]，另見 [2]。\n\n出處：\n"
        "[1] 近效期品項退貨作業規範｜近效期退貨的運費\n"
        "[2] 食藥署公告 https://www.fda.gov.tw/x"
    )


@pytest.mark.parametrize("result, body", [
    (KnowledgeAnswer("no_evidence", knowledge.MEDICAL_NO_EVIDENCE, [], "kb", reason="medical"), knowledge.MEDICAL_NO_EVIDENCE),
    (KnowledgeAnswer("no_evidence", knowledge.NO_EVIDENCE, [], "web"), knowledge.NO_EVIDENCE),
    (KnowledgeAnswer("failed", None, [], None, "網路搜尋出錯，請稍後再問一次。"), "網路搜尋出錯，請稍後再問一次。"),
])
def test_crag_without_an_answer_says_why_in_its_own_words(tx, mascot, result, body):
    mascot(documents("魚油一天吃幾顆？"), knowledge=result)
    assert channel_ai.answer(tx, ask(tx, visible(tx, "陳建宏小組"), "@AI 魚油一天吃幾顆").id).body == body


def test_the_model_sees_only_this_channel_up_to_the_question(tx, mascot):
    llm, _ = mascot(chat("好"))
    team = visible(tx, "陳建宏小組")
    ask(tx, visible(tx, "全國"), "全國頻道的事")
    question = ask(tx, team, "@熊熊滾 整理一下")
    ask(tx, team, "提問之後才講的")
    channel_ai.answer(tx, question.id)
    prompt = llm.prompts[0]
    assert "頻道：陳建宏小組（小組頻道）" in prompt
    assert "忠孝店店長又在問補貨" in prompt  # 灌資料放的小組對話
    assert prompt.rstrip().endswith("林昱辰：@熊熊滾 整理一下")
    assert "全國頻道的事" not in prompt and "提問之後才講的" not in prompt


def test_a_customer_thread_adds_the_basic_customer_profile_only(tx, mascot):
    llm, _ = mascot(chat("林昱辰負責。"))
    thread = channels.customer_thread(tx, tx.get(AppUser, "U01"), "C001")
    channel_ai.answer(tx, ask(tx, thread, "@熊熊滾 這家誰負責").id)
    prompt = llm.prompts[0]
    customer = tx.get(Customer, "C001")
    assert (
        f"這個討論串的客戶：{customer.name}；類型 連鎖藥局；連鎖體系 {customer.chain_group}；"
        f"縣市 台北市；地點 台北市・大安區；等級 {customer.grade}；負責人 林昱辰"
    ) in prompt
    # 合約到期日不是 customer_basic 的欄位
    assert customer.contract_end_date is None or customer.contract_end_date.isoformat() not in prompt


def test_every_failure_ends_in_an_apology(tx, mascot, monkeypatch):
    team = visible(tx, "陳建宏小組")
    for case in (
        {"error": RuntimeError("模型忙線")},
        {"decision": chat("  ")},
        {"decision": documents("")},
        {"decision": documents("退貨運費誰付？"), "knowledge": RuntimeError("檢索壞了")},
    ):
        mascot(**case)
        assert channel_ai.answer(tx, ask(tx, team, "@熊熊滾 在嗎").id).body == channel_ai.SORRY, case

    def not_configured():
        raise NotConfigured("AI 模型還沒設定")

    monkeypatch.setattr(channel_ai, "get_llm", not_configured)
    assert channel_ai.answer(tx, ask(tx, team, "@熊熊滾 在嗎").id).body == channel_ai.SORRY


def test_no_reply_once_the_team_channel_is_archived(tx, mascot):
    mascot(chat("在喔"))
    question = ask(tx, visible(tx, "陳建宏小組"), "@熊熊滾 在嗎")
    # 排隊期間主管被停用，小組頻道封存
    tx.get(AppUser, "M01").deactivated_at = dt.datetime.now(dt.UTC)
    tx.flush()
    assert channel_ai.answer(tx, question.id) is None
    assert tx.scalar(select(func.count()).select_from(ChannelMessage).where(ChannelMessage.reply_to_id == question.id)) == 0
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `uv run --project backend pytest backend/tests/test_channel_ai.py -q`
Expected: FAIL（`ImportError: cannot import name 'channel_ai'`）

- [ ] **Step 3: 實作**（新檔 `backend/app/services/channel_ai.py`）

```python
"""頻道裡 @熊熊滾 時的回答（docs/superpowers/specs/2026-10-01-channel-mascot-answers-design.md）。

先讓模型判斷題目：要查公司文件的，參考對話改寫成一句單獨看得懂的問題，交給跟問答頁同一條 CRAG
（knowledge.answer_knowledge）；只看對話就答得出來的，這一次就直接回答。
只給這個頻道的對話與客戶基本資料，不查銷售數字、不讀拜訪紀錄：頻道裡的回答所有成員都看得到，
現有的權限是依個人算的，拿頻道的範圍去查，會讓只給小組看的東西傳到整區。
"""

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import session_factory
from app.embeddings import optional_embedder
from app.llm import LLMOutputError, get_llm
from app.models import AppUser, Channel, ChannelMessage, Customer, Place
from app.services import channels
from app.services.channels import ChannelInfo
from app.services.knowledge import answer_knowledge
from app.timeutil import TAIPEI

log = logging.getLogger(__name__)

SORRY = "我暫時答不出來，請稍後再 @ 我一次。"
# 給模型看最近幾則（含提問那一則）
CONTEXT_MESSAGES = 50
KIND_LABEL = {
    "national": "全國頻道", "region": "整區頻道", "team": "小組頻道", "place": "地點頻道", "customer": "客戶討論串",
}
CUSTOMER_TYPE_LABEL = {"chain": "連鎖藥局", "independent": "獨立藥局", "clinic": "診所"}

SYSTEM = """你是「熊熊滾」，醫藥通路業務團隊頻道裡的 AI 助理。有人在頻道裡 @ 你，請判斷怎麼回答。

route 二選一：
- documents：跟公司規定、產品、作業流程有關，要查公司內部文件才答得出來的題目，例如退貨、報價與折扣權限、
  陳列、檔期活動、付款與帳齡、新客戶建檔、樣品、出差、用藥知識。這類題目一律走 documents，不能憑對話內容或常識自己回答。
  question 填一句不看對話也看得懂的問題（把「這個」「剛剛說的」換成實際指的東西），不要放同事的名字；answer 填空字串。
- chat：只看下面的對話與客戶資料就答得出來的題目（例如整理剛剛大家說了什麼、這家客戶誰負責），或是打招呼、閒聊。
  answer 直接寫回答：繁體中文、口語、簡短；對話與客戶資料裡沒有的事就說不知道，不要猜。question 填空字串。

你看不到銷售數字與拜訪紀錄；有人問這些，走 chat，請他到問答頁查。"""

ROUTE_SCHEMA = {
    "type": "object",
    "properties": {
        "route": {"type": "string", "enum": ["documents", "chat"]},
        "question": {"type": "string"},
        "answer": {"type": "string"},
    },
    "required": ["route", "question", "answer"],
    "additionalProperties": False,
}


def run(message_id: int) -> None:
    """RQ 背景工作的進入點（channels 佇列）：開自己的連線，回答完 commit。"""
    with session_factory()() as session:
        answer(session, message_id)
        session.commit()


def answer(session: Session, message_id: int) -> ChannelMessage | None:
    """回答 message_id 那一則 @，回傳熊熊滾發的訊息；訊息不見了或頻道已經封存就不回，回傳 None。
    出錯一律道歉，提問的人可以再 @ 一次。呼叫端負責 commit。"""
    asked = session.get(ChannelMessage, message_id)
    if asked is None:
        return None
    info = channels.describe(session, [session.get(Channel, asked.channel_id)])[0]
    if info.archived:
        return None
    try:
        body = _reply(session, info, asked)
    except Exception:
        log.exception("熊熊滾回答失敗 message=%s", message_id)
        body = SORRY
    return channels.post_mascot(session, info.id, body, message_id)


def _reply(session: Session, info: ChannelInfo, asked: ChannelMessage) -> str:
    llm = get_llm()
    decision = llm.json(system=SYSTEM, prompt=_prompt(session, info, asked), schema=ROUTE_SCHEMA, effort="low")
    if decision["route"] == "chat":
        if not decision["answer"].strip():
            raise LLMOutputError("判斷只看對話就答得出來，卻沒有寫回答")
        return decision["answer"].strip()
    question = decision["question"].strip()
    if not question:
        raise LLMOutputError("判斷要查文件，卻沒有寫問題")
    embedder = optional_embedder()
    result = answer_knowledge(session, llm, question, _skip_step, embedder.embed_query if embedder else None)
    if result.status == "answered":
        return with_sources(result.answer, result.sources)
    if result.status == "no_evidence":
        return result.answer
    return result.error_message or SORRY


def _skip_step(*_args, **_kwargs) -> None:
    """CRAG 每一步的紀錄（問答頁寫進 query_trace）。頻道沒有地方放，也沒有畫面要看，不記。"""


def with_sources(answer_text: str, sources: list[dict[str, Any]]) -> str:
    """答案後面空一行接出處，一個來源一行，編號跟答案裡的 [n] 對得上：
    內部文件寫「文件標題｜小節」，網頁寫「標題 網址」。"""
    if not sources:
        return answer_text
    lines = [
        f"[{s['index']}] {s['doc_title']} {s['url']}" if s.get("url") else f"[{s['index']}] {s['doc_title']}｜{s['section']}"
        for s in sources
    ]
    return f"{answer_text}\n\n出處：\n" + "\n".join(lines)


def _prompt(session: Session, info: ChannelInfo, asked: ChannelMessage) -> str:
    # 只取到提問那一則：之後才進來的訊息不給，免得答非所問
    rows = session.execute(
        select(ChannelMessage, AppUser.name)
        .outerjoin(AppUser, AppUser.id == ChannelMessage.author_id)
        .where(ChannelMessage.channel_id == info.id, ChannelMessage.id <= asked.id)
        .order_by(ChannelMessage.id.desc())
        .limit(CONTEXT_MESSAGES)
    ).all()[::-1]
    parts = [f"頻道：{info.name}（{KIND_LABEL[info.kind]}）"]
    if info.customer_id:
        parts.append(_customer(session, info.customer_id))
    parts.append("最近的對話（由舊到新，最後一則是 @ 你的那一則）：")
    parts += [_line(message, author_name) for message, author_name in rows]
    return "\n".join(parts)


def _line(message: ChannelMessage, author_name: str | None) -> str:
    who = {"ai": "熊熊滾", "notice": "風險通報"}.get(message.kind, author_name)
    return f"{message.created_at.astimezone(TAIPEI):%m/%d %H:%M} {who}：{message.body}"


def _customer(session: Session, customer_id: str) -> str:
    """客戶基本資料，都是 customer_basic（全公司看得到）的欄位。合約到期日不是，不給。"""
    customer, place, owner = session.execute(
        select(Customer, Place.name, AppUser.name)
        .join(Place, Place.id == Customer.place_id)
        .join(AppUser, AppUser.id == Customer.owner_user_id)
        .where(Customer.id == customer_id)
    ).one()
    chain = f"；連鎖體系 {customer.chain_group}" if customer.chain_group else ""
    return (
        f"這個討論串的客戶：{customer.name}；類型 {CUSTOMER_TYPE_LABEL[customer.type]}{chain}；"
        f"縣市 {customer.city}；地點 {place}；等級 {customer.grade}；負責人 {owner}"
    )
```

- [ ] **Step 4: 跑測試確認通過**

Run: `uv run --project backend pytest backend/tests/test_channel_ai.py -q`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/channel_ai.py backend/tests/test_channel_ai.py
git commit -m "Let 熊熊滾 answer a channel question from the chat or through the same CRAG as the ask page"
```

---

### Task 3: 發言時扣「提問」、排背景工作、部署設定

**Files:**
- Modify: `backend/app/tasks.py`
- Modify: `backend/app/usage.py`
- Modify: `backend/app/api/channels.py`（`post_message`）
- Modify: `deploy/helm/meddemo/templates/worker.yaml`
- Modify: `README.md`（本機指令第 17 行、用量上限那段第 488 行附近）
- Test: `backend/tests/test_channel_ai.py`

**Interfaces:**
- Consumes: `channels.post`、`channels.post_mascot`、`channel_ai.SORRY`、`channel_ai.run`
- Produces:
  - `tasks.channel_queue() -> rq.Queue`（名稱 `channels`）
  - `usage.take(bucket: str, request: Request) -> JSONResponse | None`

- [ ] **Step 1: 寫失敗的測試**（加在 `backend/tests/test_channel_ai.py` 最後；檔頭 import 補下面這些）

```python
from fastapi.testclient import TestClient
from redis.exceptions import ConnectionError as RedisConnectionError
from rq import SimpleWorker
from sqlalchemy import delete

from app import usage
from app.api import channels as channels_api
from app.main import app
from app.models import ChannelRead
from app.tasks import channel_queue, redis
```

```python
@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def queue():
    """channels 佇列，前後清空。用量計數也清掉：@熊熊滾 會扣「提問」，不受其他測試送過的請求影響。"""
    redis().flushdb()
    yield channel_queue()
    redis().flushdb()


def channel_id(client, auth, name, user_id="U01"):
    return next(c["id"] for c in client.get("/api/channels", headers=auth(user_id)).json() if c["name"] == name)


def post(client, headers, channel, body):
    return client.post(f"/api/channels/{channel}/messages", json={"body": body}, headers=headers)


def history(client, headers, channel, **params):
    return client.get(f"/api/channels/{channel}/messages", params=params, headers=headers).json()


def test_only_a_message_that_calls_the_mascot_queues_an_answer(tx, client, auth, queue):
    team = channel_id(client, auth, "陳建宏小組")
    plain = post(client, auth("U01"), team, "沒有叫熊熊滾").json()
    called = post(client, auth("U01"), team, "@熊熊滾 在嗎").json()
    assert (plain["mentions_ai"], called["mentions_ai"]) == (False, True)
    assert [(job.func_name, job.args) for job in queue.jobs] == [("app.services.channel_ai.run", (called["id"],))]


def test_calling_the_mascot_counts_as_an_ask(tx, client, auth, queue, monkeypatch):
    monkeypatch.setitem(usage.LIMITS, "ask", usage.Limit("提問", per_client_hour=1, per_day=100))
    team = channel_id(client, auth, "陳建宏小組")
    assert post(client, auth("U01"), team, "@熊熊滾 第一次").status_code == 201
    # 沒叫熊熊滾不算提問
    assert post(client, auth("U01"), team, "一般的回報").status_code == 201
    blocked = post(client, auth("U01"), team, "@熊熊滾 第二次")
    assert blocked.status_code == 429
    assert "提問" in blocked.json()["detail"]
    # 被擋的那則沒留下，也沒排工作
    assert "@熊熊滾 第二次" not in [m["body"] for m in history(client, auth("U01"), team)]
    assert len(queue.jobs) == 1
    # 被擋的那次沒有多扣：上限放寬到 2，下一次就過得了
    monkeypatch.setitem(usage.LIMITS, "ask", usage.Limit("提問", per_client_hour=2, per_day=100))
    assert post(client, auth("U01"), team, "@熊熊滾 第三次").status_code == 201


def test_when_the_queue_is_down_the_mascot_apologises_at_once(tx, client, auth, queue, monkeypatch):
    def down():
        raise RedisConnectionError("連不上")

    monkeypatch.setattr(channels_api, "channel_queue", down)
    team = channel_id(client, auth, "陳建宏小組")
    called = post(client, auth("U01"), team, "@熊熊滾 在嗎")
    assert called.status_code == 201
    latest = history(client, auth("U02"), team)[-2:]
    assert [(m["kind"], m["body"], m["reply_to_id"]) for m in latest] == [
        ("user", "@熊熊滾 在嗎", None), ("ai", channel_ai.SORRY, called.json()["id"])
    ]


def test_the_worker_posts_the_answer_where_everyone_polling_sees_it(engine, client, auth, queue, mascot):
    """走真的佇列與背景工作，資料真的 commit，測完刪掉。
    用台北市・信義區：地點頻道不算進紅點，也沒有灌資料的對話。"""
    mascot(chat("在喔，有什麼要問的？"))
    place = channel_id(client, auth, "台北市・信義區")
    try:
        called = post(client, auth("U01"), place, "@熊熊滾 在嗎").json()
        SimpleWorker([queue], connection=redis()).work(burst=True)
        replies = history(client, auth("U02"), place, after=called["id"])
        assert [(m["kind"], m["body"], m["reply_to_id"]) for m in replies] == [("ai", "在喔，有什麼要問的？", called["id"])]
    finally:
        with engine.begin() as conn:
            conn.execute(delete(ChannelMessage).where(ChannelMessage.channel_id == place))
            conn.execute(delete(ChannelRead).where(ChannelRead.channel_id == place))
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `uv run --project backend pytest backend/tests/test_channel_ai.py -q`
Expected: FAIL（`ImportError: cannot import name 'channel_queue'`）

- [ ] **Step 3: 佇列**（`backend/app/tasks.py`，`visit_queue` 之後）

```python
def channel_queue() -> Queue:
    """頻道的背景工作（@熊熊滾 的回答）。worker 先做 visits 再做這裡，錄音轉文字不會被頻道卡住。"""
    return Queue("channels", connection=redis())
```

- [ ] **Step 4: 在 API 裡另外扣用量**（`backend/app/usage.py`，`_too_many` 之後）

```python
def take(bucket: str, request: Request) -> JSONResponse | None:
    """在 API 裡另外扣一次。middleware 只看網址，分不出來的情況用這個（頻道發言有沒有 @熊熊滾）。
    超過上限回 429 的回應；沒超過，或 Redis 連不上（跟 middleware 一樣放行）回 None。"""
    now = dt.datetime.now(dt.UTC)
    items = counters(bucket, client_address(request), now)
    try:
        over = _take(*items)
    except RedisError:
        log.warning("用量計數連不上 Redis，這次放行", exc_info=True)
        return None
    return _too_many(bucket, over, now) if over else None
```

模組 docstring 的「兩層上限」前面補一句：「頻道發言有 @熊熊滾 時，另外算一次提問（`take`，api/channels.py）。」

- [ ] **Step 5: 發言 API**（`backend/app/api/channels.py`）

檔頭補 `import logging`、`from fastapi import ..., Request`、`from app import usage`、`from app.services import channel_ai, channels`、`from app.tasks import channel_queue`，以及 `log = logging.getLogger(__name__)`。模組 docstring 補一句：「訊息裡 @熊熊滾 就排背景工作回答（services/channel_ai.py）。」

```python
@router.post("/api/channels/{channel_id}/messages", response_model=MessageItem, status_code=status.HTTP_201_CREATED)
def post_message(request: Request, session: SessionDep, user: CurrentUser, channel_id: int, body: MessageInput):
    info = _visible(session, user, channel_id)
    text = body.body.strip()
    if not text:
        raise HTTPException(422, "訊息不能是空的")
    try:
        message = channels.post(session, user, info, text)
    except channels.Archived:
        raise HTTPException(409, "這個小組頻道已封存，不能再發言") from None
    # @熊熊滾 跑的是跟問答頁一樣的查詢，算一次「提問」。middleware 只看網址分不出有沒有 @，在這裡另外扣；
    # 超過上限就整則不留，輸入框裡的字還在，提問的人看得到為什麼沒送出
    if message.mentions_ai and (blocked := usage.take("ask", request)) is not None:
        session.rollback()
        return blocked
    session.commit()
    if message.mentions_ai:
        _call_mascot(session, message)
    return _message(message, user.name, user)


def _call_mascot(session: Session, message: ChannelMessage) -> None:
    """排熊熊滾的背景工作。排不進去（Redis 連不上）就直接道歉，提問那一則照樣留著，可以再 @ 一次。"""
    try:
        channel_queue().enqueue("app.services.channel_ai.run", message.id)
    except Exception:
        log.exception("排入熊熊滾的背景工作失敗 message=%s", message.id)
        channels.post_mascot(session, message.channel_id, channel_ai.SORRY, message.id)
        session.commit()
```

- [ ] **Step 6: 跑測試確認通過**

Run: `uv run --project backend pytest backend/tests/test_channel_ai.py backend/tests/test_channels.py backend/tests/test_usage.py -q`
Expected: 全部 PASS

- [ ] **Step 7: worker 與 README**

`deploy/helm/meddemo/templates/worker.yaml`：第 1 行註解改成
`# 背景工作：錄音轉文字、整理欄位、問答（visits 佇列），頻道裡 @熊熊滾 的回答（channels 佇列）。跟 API 用同一個映像，只是改跑 RQ worker。`
指令改成 `command: ["rq", "worker", "visits", "channels", "--url", "redis://redis:6379/0"]`。

`README.md` 第 17 行改成（對齊後面的註解欄）：
`uv run --project backend rq worker visits channels --path backend --worker-class rq.SimpleWorker   # 背景工作`

`README.md` 用量上限那段（「建立帳號（見「登入」）與頻道發言這兩項不花 Gemini 的錢…」那一點）後面加一點：
`- 在頻道裡 @熊熊滾 會跑一次跟問答頁一樣的查詢，算一次「提問」，跟問答頁共用額度；超過上限那則訊息不會送出（`app/usage.py` 的 `take`）。`

- [ ] **Step 8: 整套後端測試**

Run: `uv run --project backend pytest backend/tests -q`
Expected: 全部 PASS

- [ ] **Step 9: Commit**

```bash
git add backend/app/tasks.py backend/app/usage.py backend/app/api/channels.py backend/tests/test_channel_ai.py deploy/helm/meddemo/templates/worker.yaml README.md
git commit -m "Queue 熊熊滾's answer when a channel message calls it and count it as an ask"
```

---

### Task 4: 頻道頁：@熊熊滾 按鈕、回覆誰、正在想

**Files:**
- Modify: `frontend/src/api/channels.ts`（`ChannelMessage`）
- Modify: `frontend/src/lib/channels.ts`
- Test: `frontend/src/lib/channels.test.ts`
- Modify: `frontend/src/pages/channel.tsx`
- Modify: `frontend/src/pages/privacy.tsx`（「交給哪些服務處理」）

**Interfaces:**
- Consumes: API `MessageItem.mentions_ai`、`reply_to_id`
- Produces:
  - `MASCOT_WAIT_MS = 180_000`
  - `awaitingMascot(messages: ChannelMessage[], now: number): boolean`
  - `withMascotMention(draft: string): string`

- [ ] **Step 1: 型別**（`frontend/src/api/channels.ts`）

```ts
export type ChannelMessage = {
  id: number
  // user 人發的；ai 熊熊滾；notice 拜訪的風險通報
  kind: "user" | "ai" | "notice"
  author_id: string | null
  author_name: string | null
  body: string
  created_at: string
  mine: boolean
  // 有沒有叫熊熊滾
  mentions_ai: boolean
  // 熊熊滾的回答指向提問那一則
  reply_to_id: number | null
}
```

- [ ] **Step 2: 寫失敗的測試**（`frontend/src/lib/channels.test.ts`：import 補 `awaitingMascot, MASCOT_WAIT_MS, withMascotMention`，檔尾加）

```ts
describe("awaitingMascot", () => {
  const at = Date.parse("2026-10-01T01:00:00Z")
  const msg = (id: number, extra: Partial<ChannelMessage>) =>
    ({ id, kind: "user", mentions_ai: false, reply_to_id: null, created_at: "2026-10-01T01:00:00Z", ...extra }) as ChannelMessage

  it("叫了熊熊滾、還沒回、不到三分鐘：在想", () => {
    expect(awaitingMascot([msg(1, {}), msg(2, { mentions_ai: true })], at + 10_000)).toBe(true)
  })

  it("熊熊滾回了就不想了", () => {
    expect(awaitingMascot([msg(2, { mentions_ai: true }), msg(3, { kind: "ai", reply_to_id: 2 })], at + 10_000)).toBe(false)
  })

  it("超過三分鐘還沒回就不再顯示，背景服務停了也不會一直轉", () => {
    expect(awaitingMascot([msg(2, { mentions_ai: true })], at + MASCOT_WAIT_MS)).toBe(false)
  })

  it("沒有人叫熊熊滾", () => {
    expect(awaitingMascot([msg(1, {})], at)).toBe(false)
  })
})

describe("withMascotMention", () => {
  it("還沒叫熊熊滾就在開頭補上", () => {
    expect(withMascotMention("退貨運費誰付？")).toBe("@熊熊滾 退貨運費誰付？")
    expect(withMascotMention("")).toBe("@熊熊滾 ")
  })

  it("已經叫了就不重複，全形與 @AI 也算", () => {
    for (const draft of ["@熊熊滾 在嗎", "請@熊熊 回答", "＠熊熊滾 在嗎", "@ai 請問", "＠ＡＩ請問"]) {
      expect(withMascotMention(draft)).toBe(draft)
    }
  })

  it("email 與 @AIDS 不算叫了", () => {
    expect(withMascotMention("寄到 x@ai.com")).toBe("@熊熊滾 寄到 x@ai.com")
    expect(withMascotMention("@AIDS 衛教單張")).toBe("@熊熊滾 @AIDS 衛教單張")
  })
})
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `cd frontend && npx vitest run src/lib/channels.test.ts`
Expected: FAIL（`awaitingMascot` 不存在）

- [ ] **Step 4: 實作**（`frontend/src/lib/channels.ts` 檔尾）

```ts
// 送出 @熊熊滾 之後最多顯示「熊熊滾正在想」多久：背景工作的上限是 180 秒，過了還沒回就是不會回了
export const MASCOT_WAIT_MS = 3 * 60_000
// 叫熊熊滾的規則，跟後端 services/channels.MENTION 一樣。不用 lookbehind：iOS 16.4 以前的 Safari 不支援，整支程式會載不起來
const MENTION = /(?:^|[^0-9a-z０-９ａ-ｚ._%+-])[@＠](?:熊熊|(?:ai|ａｉ)(?![0-9a-z０-９ａ-ｚ]))/i

/** 畫面上有沒有還在等熊熊滾回答的 @：送出不到三分鐘，也還沒有熊熊滾的訊息回覆它 */
export function awaitingMascot(messages: ChannelMessage[], now: number) {
  const answered = new Set(messages.map((m) => m.reply_to_id))
  return messages.some((m) => m.mentions_ai && !answered.has(m.id) && now - Date.parse(m.created_at) < MASCOT_WAIT_MS)
}

/** 按「@熊熊滾」：還沒叫它就在開頭補上，已經叫了就不重複 */
export function withMascotMention(draft: string) {
  return MENTION.test(draft) ? draft : `@熊熊滾 ${draft}`
}
```

- [ ] **Step 5: 跑測試確認通過**

Run: `cd frontend && npx vitest run src/lib/channels.test.ts`
Expected: PASS

- [ ] **Step 6: 頻道頁**（`frontend/src/pages/channel.tsx`）

1. import 補 `awaitingMascot, withMascotMention`（從 `@/lib/channels`）。
2. `ChannelView` 裡加：
   ```tsx
   const textarea = useRef<HTMLTextAreaElement>(null)
   // 「熊熊滾正在想」要跟著時間消失：輪詢每 3 秒更新一次現在時間
   const [now, setNow] = useState(() => Date.now())
   ```
3. 輪詢的 `setInterval` 裡，`if (document.visibilityState === "hidden" || !navigator.onLine) return` 之後加 `setNow(Date.now())`。
4. 加按鈕的處理：
   ```tsx
   function callMascot() {
     setDraft((current) => withMascotMention(current))
     textarea.current?.focus()
   }
   ```
5. 訊息列表改成把被回覆的那則傳進去，最後加「正在想」：
   ```tsx
   {messages.map((message) => (
     <MessageBubble key={message.id} message={message} replyTo={byId.get(message.reply_to_id ?? -1)} />
   ))}
   {awaitingMascot(messages, now) && (
     <div className="flex items-end gap-2" aria-live="polite">
       <Mascot state="think" size={28} bust className="shrink-0 rounded-full bg-accent" />
       <p className="rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">熊熊滾正在想…</p>
     </div>
   )}
   <div ref={bottom} />
   ```
   `byId` 在 `const { channel } = state` 之後算：`const byId = new Map(messages.map((m) => [m.id, m]))`。
6. footer 的 audience 那行換成一列，右邊放按鈕；Textarea 加 `ref={textarea}`，提示字改掉：
   ```tsx
   <div className="flex items-center justify-between gap-2 pb-1">
     <p className="text-[11px] text-muted-foreground">{channel.audience}</p>
     <Button variant="ghost" size="sm" className="h-8 shrink-0 gap-1 px-2 text-xs text-primary" onClick={callMascot}>
       <Mascot size={18} bust />
       @熊熊滾
     </Button>
   </div>
   ```
   ```tsx
   placeholder="回報一件事，或 @熊熊滾 問問題…"
   ```
7. `MessageBubble`：
   ```tsx
   function MessageBubble({ message, replyTo }: { message: ChannelMessage; replyTo?: ChannelMessage }) {
     if (message.kind !== "user") {
       // 熊熊滾與風險通報用同一種樣式；熊熊滾的左邊多一個頭像，標出回覆誰（提問那一則在畫面上才標得出來）
       const replied = replyTo && (replyTo.mine ? " · 回覆你" : ` · 回覆 ${replyTo.author_name}`)
       const bubble = (
         <div className="rounded-xl bg-muted px-3 py-2 text-sm">
           <p className="text-[11px] text-muted-foreground">
             {message.kind === "ai" ? "熊熊滾" : "風險通報"}
             {replied} · {formatDateTime(message.created_at)}
           </p>
           <p className="whitespace-pre-wrap">{message.body}</p>
         </div>
       )
       ...其餘不變
   ```

- [ ] **Step 7: 隱私權頁**（`frontend/src/pages/privacy.tsx`「交給哪些服務處理」）

```tsx
<li>
  <b>Google Gemini</b>：語音辨識、回答提問、語音問答，以及在頻道裡 @熊熊滾 時的回答。錄音、逐字稿與提問會送到 Gemini 處理；
  在頻道裡 @熊熊滾 時，那個頻道最近 50 則對話（含發言人的顯示名稱）也會送過去。
</li>
<li>
  <b>Cohere</b>：排序內部文件的段落，會收到提問（包括頻道裡 @熊熊滾 的問題）與相關文件段落。
</li>
<li>
  <b>Firecrawl</b>：內部文件答不出來時上網搜尋，只會收到從提問（包括頻道裡 @熊熊滾 的問題）改寫出來的搜尋詞。
</li>
```

- [ ] **Step 8: 前端檢查**

Run: `cd frontend && npm run lint && npm run typecheck && npx vitest run && npm run build`
Expected: 全部通過。若 lint 抱怨 `useState(() => Date.now())` 不純，改成在 effect 裡設定初始值的寫法再跑一次。

- [ ] **Step 9: Commit**

```bash
git add frontend/src/api/channels.ts frontend/src/lib/channels.ts frontend/src/lib/channels.test.ts frontend/src/pages/channel.tsx frontend/src/pages/privacy.tsx
git commit -m "Add a 熊熊滾 button to the channel page and show who it replies to and when it is thinking"
```

---

### Task 5: 實機看一次

- [ ] **Step 1:** 本機起 API、worker（`rq worker visits channels`）、前端，用示範帳號進「陳建宏小組」，按「@熊熊滾」送出「@熊熊滾 近效期退貨的運費誰付？」，看得到「熊熊滾正在想…」，接著出現熊熊滾的回答與出處（沒設定 Gemini 時是道歉訊息，也算流程通了）。
- [ ] **Step 2:** 手機寬度截圖確認按鈕不擠壓輸入框、深色模式看得清楚。
