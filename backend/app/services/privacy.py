"""個資保護（NFR-8）：逐字稿去識別化，以及錄音、逐字稿、沒送出紀錄的保存期限。

保存期限（James 2026-09-14 定）：
- 錄音：確認送出後 60 天刪除。涵蓋每月對帳的異議期：《發票與對帳》規定每月 5 日寄出上個月的對帳單，
  客戶收到後 14 天內可提異議、業務 5 個工作天內查明，月初的拜訪最晚約 56 天後還可能要回頭聽原音。
- 逐字稿：確認送出時先去識別，6 個月後整段刪除。系統最長只回頭看 6 個月（客戶檔案的進貨間隔圖、
  主要品項看 180 天），留更久沒有用途；個資法第 11 條要求蒐集的目的消失就刪除。
- 一直沒送出的紀錄（處理中、轉文字失敗、待確認）：建立 60 天後整筆刪除，跟錄音同一個期限。

五個欄位寫進 CRM／SAP／OA 之後是那三套系統的紀錄，由它們負責保存（NFR-9 不改既有系統的流程），這裡不刪。
"""

import datetime as dt
import re
from collections.abc import Iterable
from dataclasses import dataclass

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.models import AppUser, Customer, Product, Visit, VisitAudio
from app.services.transcription import hotword_terms

AUDIO_RETENTION = dt.timedelta(days=60)
# 6 個月取 184 天：連續 6 個月最長是 184 天（7 月到 12 月），任何時候刪掉的都已經滿 6 個月
TRANSCRIPT_RETENTION = dt.timedelta(days=184)
UNCONFIRMED_STATUSES = ("processing", "failed", "draft")
CONFIRMED_STATUSES = ("confirmed", "synced")

MASK = "○"
PHONE_TAG = "［電話］"
ID_TAG = "［身分證字號］"
EMAIL_TAG = "［email］"

EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
# 身分證字號：英文字母＋1 或 2＋8 位數字；新式居留證的第二碼是 8 或 9
NATIONAL_ID = re.compile(r"(?<![A-Za-z0-9])[A-Za-z][1289]\d{8}(?!\d)")
# 手機 09xx-xxx-xxx（可以帶 +886）與市話 0x-xxxx-xxxx，數字之間可以有連字號或空白
PHONE = re.compile(
    r"(?<!\d)(?:(?:\+886[-\s]?|0)9\d{2}[-\s]?\d{3}[-\s]?\d{3}|\(?0[2-8]\d?\)?[-\s]?\d{3,4}[-\s]?\d{4})(?!\d)"
)

# 台灣常見的姓（約前一百名）。「方」「連」不列：「對方店長」「連鎖店長」在拜訪口述裡太常見，列了會誤遮
SURNAMES = (
    "陳林黃張李王吳劉蔡楊許鄭謝郭洪曾邱廖賴周徐蘇葉莊呂江何蕭羅高簡朱鍾施游詹沈彭胡余盧潘顏梁趙柯翁魏"
    "孫戴范宋鄧杜侯曹薛傅丁溫紀蔣歐藍唐馬董石卓程姚康馮古姜湯汪白田涂鄒巫尤鐘龔嚴韓黎阮袁童陸金錢邵"
)
COMPOUND_SURNAMES = ("張簡", "歐陽", "范姜", "司馬", "諸葛")
# 「先生、小姐、女士」前面常帶名字（王小明先生）；職稱前面通常只有姓（王店長），所以只認「姓＋職稱」，
# 免得把「近效期藥師」這類說法當成人名
FORMAL_TITLES = ("先生", "小姐", "女士")
ROLE_TITLES = (
    "老闆娘", "護理師", "藥師", "醫師", "醫生", "店長", "老闆", "經理", "副理", "主任", "課長", "組長", "專員", "太太", "阿姨",
)
TITLES = sorted(FORMAL_TITLES + ROLE_TITLES, key=len, reverse=True)
_SURNAME = "(?:" + "|".join(COMPOUND_SURNAMES) + f"|[{SURNAMES}])"
PERSON = re.compile(
    rf"{_SURNAME}(?:[一-鿿]{{1,2}})??(?:{'|'.join(FORMAL_TITLES)})"
    rf"|{_SURNAME}(?:{'|'.join(sorted(ROLE_TITLES, key=len, reverse=True))})"
)


def deidentify(text: str, names: Iterable[str] = (), protected: Iterable[str] = ()) -> str:
    """遮掉逐字稿裡的個資：email、身分證字號、電話、系統裡的業務與主管姓名，以及「姓＋稱謂」的人名。

    protected 是客戶名稱、品項、競品這些詞，不當成人名遮（例如「御松田店長」裡的「田店長」）。
    同一段文字處理兩次結果不變，所以規則改了，可以對舊的逐字稿再跑一次。
    """
    text = EMAIL.sub(EMAIL_TAG, text)
    text = NATIONAL_ID.sub(ID_TAG, text)
    text = PHONE.sub(PHONE_TAG, text)
    for name in sorted({n for n in names if len(n) >= 2}, key=len, reverse=True):
        text = text.replace(name, MASK * len(name))
    keep = _positions(text, protected)
    return PERSON.sub(lambda m: m.group() if keep.intersection(range(*m.span())) else _mask_person(m.group()), text)


def _mask_person(match: str) -> str:
    title = next(t for t in TITLES if match.endswith(t))
    return MASK * (len(match) - len(title)) + title


def _positions(text: str, terms: Iterable[str]) -> set[int]:
    positions: set[int] = set()
    for term in {t for t in terms if len(t) >= 2}:
        start = text.find(term)
        while start != -1:
            positions.update(range(start, start + len(term)))
            start = text.find(term, start + 1)
    return positions


def vocabulary(session: Session) -> tuple[list[str], list[str]]:
    """（要遮的人名, 不能當成人名遮的詞）。人名是系統裡的業務與主管；不能遮的是客戶名稱、品項與別名、熱詞表。"""
    names = list(session.scalars(select(AppUser.name)))
    protected = hotword_terms()
    for name in session.scalars(select(Customer.name)):
        protected += [name, *name.split(" · ")]
    for name, aliases in session.execute(select(Product.name, Product.aliases)):
        protected += [name, *aliases]
    return names, protected


def _apply(visit: Visit, names: list[str], protected: list[str]) -> bool:
    # 逐字稿和欄位的原文片段一起遮，片段才對得回逐字稿（FR-5.4 的來源標示）
    transcript = deidentify(visit.transcript, names, protected)
    sources = {key: deidentify(value, names, protected) for key, value in (visit.field_sources or {}).items()}
    if transcript == visit.transcript and sources == (visit.field_sources or {}):
        return False
    visit.transcript = transcript
    if visit.field_sources is not None:
        visit.field_sources = sources
    return True


def deidentify_visit(session: Session, visit: Visit) -> bool:
    """確認送出時呼叫：之後的用途（AI 查詢、客戶檔案）都算後續利用。有改到內容就回傳 True。"""
    return _apply(visit, *vocabulary(session))


@dataclass
class PurgeResult:
    unconfirmed_deleted: int
    audio_deleted: int
    transcripts_deleted: int
    transcripts_deidentified: int


def purge(session: Session, now: dt.datetime | None = None) -> PurgeResult:
    """刪掉到期的錄音、逐字稿與沒送出的紀錄；已送出但還沒去識別的逐字稿順便補做（例如遮罩規則更新後）。"""
    now = now or dt.datetime.now(dt.UTC)
    audio_cutoff = now - AUDIO_RETENTION
    # 沒送出的紀錄整筆刪；錄音在 visit_audio，設了 ON DELETE CASCADE 會跟著刪
    unconfirmed = session.execute(
        delete(Visit).where(Visit.status.in_(UNCONFIRMED_STATUSES), Visit.created_at < audio_cutoff)
    ).rowcount
    audio = session.execute(
        delete(VisitAudio).where(VisitAudio.visit_id.in_(select(Visit.id).where(Visit.confirmed_at < audio_cutoff)))
    ).rowcount
    transcripts = session.execute(
        update(Visit)
        .where(Visit.confirmed_at < now - TRANSCRIPT_RETENTION, Visit.transcript != "")
        .values(transcript="", field_sources=None)
    ).rowcount
    names, protected = vocabulary(session)
    confirmed = session.scalars(select(Visit).where(Visit.status.in_(CONFIRMED_STATUSES), Visit.transcript != ""))
    deidentified = sum(_apply(visit, names, protected) for visit in confirmed)
    return PurgeResult(unconfirmed, audio, transcripts, deidentified)
