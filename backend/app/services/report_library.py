"""個人命名報表與明確保存的固定篩選書籤；不保存查詢結果或暫時聯動。"""

import datetime as dt
import uuid
from typing import Self, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import AppUser, UserReportConfig
from app.services import reports
from app.services.scope import Scope, SHARING_LEVEL

KEY = "_report_library_v1"
DEFAULT_ID = "report-default"


class LibraryError(ValueError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


class FixedFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")
    filters: list[reports.ReportFilter] = Field(default_factory=list, max_length=8)
    slicers: list[reports.ReportSlicer] = Field(default_factory=list, max_length=7)
    date_range: reports.ReportDateRange | None = None

    @model_validator(mode="after")
    def valid_filters(self) -> Self:
        reports.validate_filters(self.filters)
        reports.validate_slicers(self.slicers)
        return self


class NamedFilters(FixedFilters):
    id: str = Field(min_length=1, max_length=48, pattern=reports.SLUG_PATTERN)


class DrillStep(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dimension: Literal["year", "quarter", "month"]
    point: reports.ReportSelectionPoint


class DrillState(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dimension: Literal["year", "quarter", "month"]
    steps: list[DrillStep] = Field(default_factory=list, max_length=3)


class Exploration(BaseModel):
    model_config = ConfigDict(extra="forbid")
    selections: list[reports.ReportSelectionGroup] = Field(default_factory=list, max_length=24)
    drills: dict[str, DrillState] = Field(default_factory=dict, max_length=24)
    matrix_views: dict[str, reports.MatrixView] = Field(default_factory=dict, max_length=24)
    canvas_values: dict[str, list[str]] = Field(default_factory=dict, max_length=100)
    hidden: dict[str, bool] = Field(default_factory=dict, max_length=124)
    navigation_page: str | None = Field(default=None, max_length=48, pattern=reports.SLUG_PATTERN)
    navigation_filters: list[reports.ReportFilter] = Field(default_factory=list, max_length=8)

    @model_validator(mode="after")
    def valid_values(self) -> Self:
        if any(len(keys) > 500 or len(set(keys)) != len(keys) or any(not key or len(key) > 160 for key in keys) for keys in self.canvas_values.values()):
            raise ValueError("切片器書籤選取過多或重複")
        reports.validate_filters(self.navigation_filters)
        return self


class BookmarkState(FixedFilters):
    exploration: Exploration | None = None
    period: reports.Period
    owner_id: str | None = Field(default=None, min_length=1, max_length=64)
    customer_type: reports.CustomerType | None = None
    page_id: str = Field(default="overview", max_length=48, pattern=reports.SLUG_PATTERN)
    pages: list[NamedFilters] = Field(default_factory=list, max_length=5)
    cards: list[NamedFilters] = Field(default_factory=list, max_length=24)

    @model_validator(mode="after")
    def valid_state(self) -> Self:
        if self.period == "custom" and self.date_range is None:
            raise ValueError("自訂期間需要起訖日期")
        if len({item.id for item in self.pages}) != len(self.pages) or len({item.id for item in self.cards}) != len(self.cards):
            raise ValueError("書籤中的分頁及圖表編號不能重複")
        return self


class Bookmark(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    id: str = Field(max_length=48, pattern=reports.SLUG_PATTERN)
    name: str = Field(min_length=1, max_length=40)
    state: BookmarkState
    updated_at: dt.datetime


class SharedSource(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: str
    name: str
    report_id: str
    revision: int
    shared_at: dt.datetime


class SavedReport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(max_length=48, pattern=reports.SLUG_PATTERN)
    config: reports.ReportConfig
    revision: int = Field(default=1, ge=1, strict=True)
    updated_at: dt.datetime
    bookmarks: list[Bookmark] = Field(default_factory=list, max_length=20)
    shared_from: SharedSource | None = None


class Library(BaseModel):
    model_config = ConfigDict(extra="forbid")
    active_id: str
    documents: list[SavedReport] = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def valid_documents(self) -> Self:
        ids = {item.id for item in self.documents}
        if len(ids) != len(self.documents) or self.active_id not in ids:
            raise ValueError("報表編號重複或啟用報表不存在")
        return self


class ReportSummary(BaseModel):
    id: str
    name: str
    revision: int
    updated_at: dt.datetime
    readonly: bool = False


class LibrarySnapshot(BaseModel):
    config: reports.ReportConfig
    account_id: str
    active_report_id: str
    revision: int
    documents: list[ReportSummary]
    bookmarks: list[Bookmark]
    readonly: bool = False
    shared_from: SharedSource | None = None


def now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def parse(payload: dict) -> Library:
    return Library.model_validate(payload[KEY])


def active_config(payload: dict) -> reports.ReportConfig:
    library = parse(payload)
    return next(item.config for item in library.documents if item.id == library.active_id)


def update_active_payload(payload: dict, config: reports.ReportConfig) -> dict:
    library = parse(payload)
    document = next(item for item in library.documents if item.id == library.active_id)
    editable(document)
    document.config = config
    document.revision += 1
    document.updated_at = now()
    return {KEY: library.model_dump(mode="json")}


def load(session: Session, user: AppUser, *, lock: bool = False) -> Library:
    if lock:
        # 先建立既有單份設定再取列鎖，避免首次同時建立兩份報表覆蓋彼此。
        initial = reports.get_config(session, user)
        session.execute(insert(UserReportConfig).values(user_id=user.id, config=initial.model_dump(mode="json")).on_conflict_do_nothing(index_elements=[UserReportConfig.user_id]))
    row = session.get(UserReportConfig, user.id, with_for_update=lock, populate_existing=True)
    if row and KEY in row.config:
        return parse(row.config)
    config = reports.get_config(session, user)
    return Library(active_id=DEFAULT_ID, documents=[SavedReport(id=DEFAULT_ID, config=config, updated_at=row.updated_at if row else now())])


def document(library: Library, report_id: str) -> SavedReport:
    found = next((item for item in library.documents if item.id == report_id), None)
    if found is None:
        raise LibraryError("這份報表不存在或不屬於你的帳號。", 404)
    return found


def editable(found: SavedReport):
    if found.shared_from:
        raise LibraryError("這是唯讀共享報表，請另存新報表後編輯。", 403)


def snapshot(session: Session, user: AppUser, library: Library | None = None, report_id: str | None = None) -> LibrarySnapshot:
    library = library or load(session, user)
    active = document(library, report_id or library.active_id)
    return LibrarySnapshot(config=reports.visible_config(session, user, active.config), account_id=user.id,
        active_report_id=active.id, revision=active.revision,
        documents=[ReportSummary(id=item.id, name=item.config.name, revision=item.revision, updated_at=item.updated_at, readonly=item.shared_from is not None) for item in library.documents],
        bookmarks=active.bookmarks, readonly=active.shared_from is not None, shared_from=active.shared_from)


def store(session: Session, user: AppUser, library: Library, report_id: str | None = None) -> LibrarySnapshot:
    row = session.get(UserReportConfig, user.id)
    assert row is not None
    row.config = {KEY: library.model_dump(mode="json")}
    row.updated_at = func.now()
    session.commit()
    return snapshot(session, user, library, report_id)


def create(session: Session, user: AppUser, config: reports.ReportConfig, source_id: str | None = None) -> LibrarySnapshot:
    reports.validate_owner(session, user, config)
    library = load(session, user, lock=True)
    if len(library.documents) >= 20:
        raise LibraryError("每個帳號最多可保存 20 份報表。")
    source_bookmarks = document(library, source_id).bookmarks if source_id else []
    ids = {item.id: f"bookmark-{uuid.uuid4().hex}" for item in source_bookmarks}
    copied = [item.model_copy(deep=True, update={"id": ids[item.id]}) for item in source_bookmarks]
    config = config.model_copy(deep=True)
    for obj in config.objects:
        if obj.action and obj.action.kind == "bookmark" and obj.action.target in ids:
            obj.action = obj.action.model_copy(update={"target": ids[obj.action.target]})
    new = SavedReport(id=f"report-{uuid.uuid4().hex}", config=config, updated_at=now(), bookmarks=copied)
    library.documents.append(new)
    library.active_id = new.id
    return store(session, user, library)


def open_report(session: Session, user: AppUser, report_id: str) -> LibrarySnapshot:
    library = load(session, user, lock=True)
    document(library, report_id)
    library.active_id = report_id
    return store(session, user, library)


def save(session: Session, user: AppUser, report_id: str, config: reports.ReportConfig, revision: int) -> LibrarySnapshot:
    reports.validate_owner(session, user, config)
    library = load(session, user, lock=True)
    found = document(library, report_id)
    editable(found)
    if found.revision != revision:
        raise LibraryError("這份報表已有較新版本。請重新載入後比較，或將目前草稿另存為新報表。", 409)
    found.config = config
    found.revision += 1
    found.updated_at = now()
    return store(session, user, library, report_id)


def validate_bookmark(session: Session, user: AppUser, state: BookmarkState, config: reports.ReportConfig | None = None):
    allowed = {owner.id for owner in reports.owners(session, user)}
    required = {state.owner_id} if state.owner_id else set()
    for scoped in [state, *state.pages, *state.cards]:
        required.update(item.key for item in scoped.filters if item.dimension == "owner")
        required.update(key for item in scoped.slicers if item.dimension == "owner" for key in item.keys)
    if state.exploration:
        exploration = state.exploration
        filters = [*exploration.navigation_filters, *(f for group in exploration.selections for point in group.points for f in point.filters), *(f for drill in exploration.drills.values() for step in drill.steps for f in step.point.filters)]
        required.update(item.key for item in filters if item.dimension == "owner")
        if config:
            objects = {item.id: item for item in config.objects}
            cards = {item.id: item for item in config.cards}
            if not set(exploration.hidden) <= set(objects) | set(cards):
                raise LibraryError("書籤顯示狀態包含不存在的物件")
            payload = config.model_dump()
            for id, drill in exploration.drills.items():
                if id not in cards or cards[id].dimension not in reports.DATE_DIMENSIONS:
                    raise LibraryError("書籤下鑽來源不存在或不是日期圖表")
                expected = drill.steps[0].dimension if drill.steps else drill.dimension
                for step in drill.steps:
                    if step.dimension != expected or not any(f.dimension == expected for f in step.point.filters):
                        raise LibraryError("書籤下鑽階層不連續")
                    expected = {"year": "quarter", "quarter": "month"}.get(expected)
                if drill.steps and drill.dimension != expected:
                    raise LibraryError("書籤下鑽層級不正確")
                for card in payload["cards"]:
                    if card["id"] == id:
                        card["dimension"] = drill.dimension
            payload.update(selection_groups=[item.model_dump() for item in exploration.selections], matrix_views={id: view.model_dump() for id, view in exploration.matrix_views.items()}, canvas_selections=[{"object_id": id, "keys": keys} for id, keys in exploration.canvas_values.items() if keys], navigation_page=exploration.navigation_page, navigation_filters=[f.model_dump() for f in exploration.navigation_filters])
            query = reports.ReportQuery.model_validate(payload)
            reports.validate_owner(session, user, query)
    if not required <= allowed:
        raise reports.OwnerNotAllowed("書籤包含不在你可以查看範圍內的業務。")


def bookmark(session: Session, user: AppUser, report_id: str, name: str, state: BookmarkState) -> LibrarySnapshot:
    library = load(session, user, lock=True)
    found = document(library, report_id)
    editable(found)
    validate_bookmark(session, user, state, found.config)
    existing = next((item for item in found.bookmarks if item.name.casefold() == name.casefold()), None)
    if existing:
        existing.name, existing.state, existing.updated_at = name, state, now()
        return store(session, user, library, report_id)
    if len(found.bookmarks) >= 20:
        raise LibraryError("每份報表最多可保存 20 個篩選書籤。")
    found.bookmarks.append(Bookmark(id=f"bookmark-{uuid.uuid4().hex}", name=name, state=state, updated_at=now()))
    # 書籤不修改報表內容，獨立增加書籤不使其他頁籤的報表版本失效。
    return store(session, user, library, report_id)


class Recipient(BaseModel):
    id: str
    name: str


def recipients(session: Session, user: AppUser) -> list[Recipient]:
    # 實際帳號操作共享；示範代理帳號不借用被代理者的組織寫入其他帳號。
    if user.acts_as_user_id or not user.org_path:
        return []
    return [Recipient(id=key, name=name) for key, name in session.execute(
        select(AppUser.id, AppUser.name).where(AppUser.id != user.id,
            AppUser.acts_as_user_id.is_(None), AppUser.org_path.is_not(None),
            Scope.for_user(user).includes(SHARING_LEVEL["report_share"], AppUser.id)).order_by(AppUser.name, AppUser.id))]


def share(session: Session, user: AppUser, report_id: str, recipient_id: str, revision: int) -> dict:
    allowed = {item.id: item for item in recipients(session, user)}
    if recipient_id not in allowed:
        raise LibraryError("只能共享給清單中的既有帳號。", 403)
    recipient = session.get(AppUser, recipient_id)
    # 同時雙向共享時以帳號編號排序鎖定，避免 A→B 與 B→A 互鎖。
    libraries = {key: load(session, session.get(AppUser, key), lock=True) for key in sorted([user.id, recipient_id])}
    source = document(libraries[user.id], report_id)
    editable(source)
    if source.revision != revision:
        raise LibraryError("報表版本已變更，請重新開啟後再共享。", 409)
    target = libraries[recipient_id]
    existing = next((item for item in target.documents if item.shared_from and item.shared_from.user_id == user.id and item.shared_from.report_id == report_id), None)
    if existing is None and len(target.documents) >= 20:
        raise LibraryError("接收者的報表已達 20 份上限。")
    found = existing or SavedReport(id=f"report-{uuid.uuid4().hex}", config=source.config.model_copy(deep=True), updated_at=now())
    # 只傳固定設定快照，不複製任何查詢結果、草稿、聯動、下鑽或書籤。
    found.config = reports.visible_config(session, recipient, source.config.model_copy(deep=True))
    found.shared_from = SharedSource(user_id=user.id, name=user.name, report_id=report_id, revision=source.revision, shared_at=now())
    found.updated_at = now()
    if existing: found.revision += 1
    else: target.documents.append(found)
    store(session, recipient, target)
    return {"recipient_name": allowed[recipient_id].name, "report_name": found.config.name,
        "shared_report_id": found.id, "updated": existing is not None}
