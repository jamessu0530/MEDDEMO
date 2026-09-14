"""語音問答（Gemini Live API）。

手機直接跟 Gemini 連線講話，聲音不經過我們的伺服器；後端只發一把臨時金鑰，
系統指示和兩個查詢工具都鎖在金鑰裡，手機端改不了。模型要查資料時會呼叫工具，
手機把問題交給問答 API（跟打字問答同一套反覆查詢與 CRAG），查到的結果再交回給模型講出來。
"""

import datetime as dt
from dataclasses import dataclass
from typing import Any

from google.genai import types
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.gemini import gemini_client
from app.models import Customer
from app.services.transcription import load_hotwords

# 函式呼叫用同步（不設 NON_BLOCKING）：模型一定等查詢結果回來才繼續講。9/14 實測：
# - 這個模型開非同步（邊查邊聊）：查詢結果還沒回來就自己先講答案，把 90 天說成三個月、還編了文件名稱。
# - gemini-3.1-flash-live-preview：兩題都說完「我查一下」就直接編答案，沒有呼叫工具；輸入逐字稿是簡體字。
#   開發者論壇也回報它會附和使用者、不照系統指示，而這個模型對系統指示很嚴格
#   （discuss.ai.google.dev/t/gemini-3-1-flash-live-preview-not-following-system-instructions/144659）。
# 規則 6 改成「先呼叫工具、呼叫前不說話」之後，文字實測兩個模型都 2/2 先呼叫工具；這個模型呼叫前多花 1～2 秒，
# 但查詢本身就要 6～14 秒，差別不大，所以選照指示比較穩的這個
DEFAULT_VOICE_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025"
# 官方預設值：1 分鐘內要開始連線，30 分鐘後失效（ai.google.dev/gemini-api/docs/ephemeral-tokens）。
# 只能用一次：斷線要重新申請，外流的金鑰也開不了第二段對話
NEW_SESSION_WINDOW = dt.timedelta(minutes=1)
TOKEN_LIFETIME = dt.timedelta(minutes=30)
# 臨時金鑰只能用在 Live API 的 v1beta（同上）；google-genai 預設就是 v1beta，手機端要用同一版連線
API_VERSION = "v1beta"

SYSTEM_INSTRUCTION = """你是中化裕民藥品通路業務的語音助理。業務會用講的問你工作上的問題，你用台灣華語口語回答，簡短、直接。

你回答的內容只能來自兩個工具查到的結果：
- query_data：公司的數字資料（業績、進貨、客戶、帳款、毛利、拜訪紀錄提到的競品）。
- search_knowledge：公司內部規定與作業文件（退貨、報價與折扣權限、帳款、陳列、客訴處理）。

規則：
1. 跟工作有關的問題一定要先呼叫工具，不能憑自己的知識、猜測或常識回答，也不能自己編數字。
2. 工具的結果怎麼說就怎麼講。結果是查無依據或查不完整，就照實說，並提醒業務畫面上可以轉給主管；不要改用常識補答。
3. 先講結論再講關鍵數字，一次不超過三句話。回答規定時順帶講出處的文件名稱；完整的表格和原文請業務看畫面上的卡片。
4. 用藥、劑量、療效這類醫療問題不在服務範圍，請業務詢問醫師或藥師，不要呼叫工具。
5. 呼叫工具時，question 要寫成一句完整的問題，把業務前面講過的客戶、區域、品類、期間補進去。
6. 收到工作上的問題，第一件事就是呼叫工具，呼叫之前不要說任何話。工具結果回來之前，不要講任何數字或規定的內容。
7. 問候或閒聊簡短回應就好，接著問業務想查什麼。

下面是業務常講的客戶、品項與術語。聽到發音相近的詞，照這裡的寫法理解；呼叫工具時也用這些寫法：
{vocabulary}"""


@dataclass(frozen=True)
class Tool:
    name: str
    ask_kind: str  # 交給問答 API 的哪一條線：data＝反覆查詢，knowledge＝CRAG
    description: str


TOOLS = (
    Tool(
        "query_data",
        "data",
        "查公司的數字資料：各區、各品類、各客戶的業績與進貨變化、進貨間隔、應收帳款、毛利，以及拜訪紀錄裡提到的競品。",
    ),
    Tool(
        "search_knowledge",
        "knowledge",
        "查公司內部規定與作業文件：退貨、報價與折扣權限、帳款、陳列與檔期、客訴處理等。查不到會回報查無依據。",
    ),
)
QUESTION_DESCRIPTION = "要查的問題，一句完整的中文。業務前面講過的客戶、區域、品類、期間都要寫進去。"


def function_declarations() -> list[types.FunctionDeclaration]:
    return [
        types.FunctionDeclaration(
            name=tool.name,
            description=tool.description,
            parameters=types.Schema(
                type=types.Type.OBJECT,
                properties={"question": types.Schema(type=types.Type.STRING, description=QUESTION_DESCRIPTION)},
                required=["question"],
            ),
        )
        for tool in TOOLS
    ]


def vocabulary(session: Session) -> list[str]:
    """客戶名稱，加上語音辨識用的熱詞（品項名稱與別名、通路術語與競品）。

    9/14 實測：沒給這份清單時，合成語音的「近效期」「康泰忠孝店」被聽成「靜笑起」「康太中孝店」，模型也照聽錯的名字去查。
    """
    customers = session.scalars(select(Customer.name).order_by(Customer.id))
    return list(dict.fromkeys([*customers, *load_hotwords(session)]))


def live_config(words: list[str]) -> types.LiveConnectConfig:
    return types.LiveConnectConfig(
        response_modalities=[types.Modality.AUDIO],
        system_instruction=SYSTEM_INSTRUCTION.format(vocabulary="、".join(words)),
        tools=[types.Tool(function_declarations=function_declarations())],
        # 雙方講的話都轉成文字：畫面上看得到，事後也能核對模型講的有沒有照工具查到的內容（NFR-1）
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
    )


@dataclass
class VoiceSession:
    token: str
    model: str
    api_version: str
    expires_at: dt.datetime
    config: dict[str, Any]
    tool_kinds: dict[str, str]


def create_session(words: list[str]) -> VoiceSession:
    config = settings()
    model = config.voice_model or DEFAULT_VOICE_MODEL
    live = live_config(words)
    now = dt.datetime.now(dt.UTC)
    # 用戶端要先存成變數：genai.Client 被回收時會關掉連線，串成一行寫的話請求還沒送出連線就被關了
    client = gemini_client(config.voice_api_key)
    token = client.auth_tokens.create(
        config=types.CreateAuthTokenConfig(
            uses=1,
            expire_time=now + TOKEN_LIFETIME,
            new_session_expire_time=now + NEW_SESSION_WINDOW,
            # 沒給 lock_additional_fields＝整份設定鎖死，手機端送來的系統指示和工具一律不採用
            live_connect_constraints=types.LiveConnectConstraints(model=model, config=live),
        )
    )
    return VoiceSession(
        token=token.name,
        model=model,
        api_version=API_VERSION,
        expires_at=now + TOKEN_LIFETIME,
        # 手機連線時也帶同一份設定（鎖死的欄位以金鑰裡的為準）；SDK 的欄位名稱是 camelCase
        config=live.model_dump(mode="json", by_alias=True, exclude_none=True),
        tool_kinds={tool.name: tool.ask_kind for tool in TOOLS},
    )
