"""CRAG 失敗代碼（照搬 CARE rag/fail_messages.py 的 RagFailCode，最後三個是 MEDDEMO 加的）。MEDDEMO 不回錯誤字串，代碼只用來決定狀態與寫進查詢過程。"""

from enum import StrEnum


class FailCode(StrEnum):
    KB_EMPTY = "KB_EMPTY"  # 知識庫沒有可用段落，而且不能上網
    WEB_EMPTY = "WEB_EMPTY"  # 知識庫不足，網搜也沒有可用內容
    WEB_ERROR = "WEB_ERROR"  # 網搜出錯
    MODEL_REFUSE = "MODEL_REFUSE"  # 有資料但模型寫了拒答標記
    TIMEOUT = "TIMEOUT"  # 整條流程超過總逾時
    NO_CITATION = "NO_CITATION"  # 知識庫答案沒有任何對得上的出處編號（FR-8.3：當作查無依據）
    MEDICAL = "MEDICAL"  # 用藥、劑量、療效這類醫療問題：知識庫答不出來時不上網
    INTERNAL = "INTERNAL"  # 只有公司內部才有答案的問題（公司的規定、報價、人事、交易條件等）：知識庫答不出來時不上網
