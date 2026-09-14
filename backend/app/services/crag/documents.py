"""檢索結果的一段內容。欄位名稱跟 LangChain 的 Document 相同，照搬 CARE 的程式時不必改寫取值方式。"""

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Document:
    page_content: str
    metadata: dict[str, Any] = field(default_factory=dict)
