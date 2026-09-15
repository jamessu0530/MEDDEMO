"""中文斷詞與全文檢索設定，建索引與檢索共用。"""

import re

from sqlalchemy import literal_column

CJK_RUN = re.compile(r"[㐀-鿿豈-﫿]+")
WORD = re.compile(r"[A-Za-z0-9]+")
# 文字搜尋設定必須是 regconfig 型別；寫成綁定參數會變成 varchar，Postgres 會找不到對應的函式
SIMPLE = literal_column("'simple'::regconfig")


def keyword_tokens(text: str) -> list[str]:
    """中文切成相鄰兩字（SDD：中文以 n-gram 斷詞），英數字整個字轉小寫。只有一個字的中文詞保留單字。"""
    tokens: list[str] = []
    for run in CJK_RUN.findall(text):
        tokens += [run] if len(run) == 1 else [run[i : i + 2] for i in range(len(run) - 1)]
    tokens += [word.lower() for word in WORD.findall(text)]
    return list(dict.fromkeys(tokens))


def to_tsvector_input(text: str) -> str:
    return " ".join(keyword_tokens(text))
