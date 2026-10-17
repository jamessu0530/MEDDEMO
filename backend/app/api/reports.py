"""個人行動報表、資料預覽，以及 AI 版面提案。"""

import logging
import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import StreamingResponse
from urllib.parse import quote
from google.genai import errors
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.api.auth import CurrentAccount
from app.api.report_datasets import router as dataset_router
from app.config import NotConfigured
from app.db import get_session
from app.llm import LLMOutputError
from app.services import reports as service
from app.services import report_details
from app.services import report_library
from app.services import report_exports
from app.services.reports import Adjustment, ReportConfig, ReportData, ReportFilterOptions, ReportOwner, ReportQuery

router = APIRouter(prefix="/api/reports", tags=["reports"])
router.include_router(dataset_router)
SessionDep = Annotated[Session, Depends(get_session)]
log = logging.getLogger(__name__)


class ReportSettings(report_library.LibrarySnapshot):
    templates: dict[str, ReportConfig]
    owners: list[ReportOwner]
    ai_available: bool
    filter_options: ReportFilterOptions | None = None
    as_of: dt.date


class AdjustInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    question: str = Field(min_length=1, max_length=600)
    config: ReportConfig


@router.get("", response_model=ReportSettings)
def get_reports(session: SessionDep, user: CurrentAccount, include_filters: bool = True):
    return ReportSettings(**report_library.snapshot(session, user).model_dump(), templates=service.templates(), owners=service.owners(session, user), ai_available=service.ai_available(), filter_options=service.filter_options(session, user) if include_filters else None, as_of=service.app_today(session))


@router.get("/filter-options", response_model=ReportFilterOptions)
def get_report_filter_options(session: SessionDep, user: CurrentAccount):
    return service.filter_options(session, user)


class CreateReportInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    config: ReportConfig
    source_id: str | None = Field(default=None, min_length=1, max_length=48, pattern=service.SLUG_PATTERN)


class OpenReportInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    report_id: str = Field(min_length=1, max_length=48, pattern=service.SLUG_PATTERN)


class SaveReportInput(CreateReportInput):
    revision: int = Field(ge=1, strict=True)


class BookmarkInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=40)
    state: report_library.BookmarkState


class ShareReportInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    recipient_id: str = Field(min_length=1, max_length=64)
    revision: int = Field(ge=1, strict=True)


def library_action(action):
    try:
        return action()
    except service.OwnerNotAllowed as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from None
    except report_library.LibraryError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from None


@router.post("/library", response_model=report_library.LibrarySnapshot)
def create_named_report(session: SessionDep, user: CurrentAccount, body: CreateReportInput):
    return library_action(lambda: report_library.create(session, user, body.config, body.source_id))


@router.post("/library/open", response_model=report_library.LibrarySnapshot)
def open_named_report(session: SessionDep, user: CurrentAccount, body: OpenReportInput):
    return library_action(lambda: report_library.open_report(session, user, body.report_id))


@router.post("/library/validate", response_model=ReportConfig)
def validate_local_report_draft(session: SessionDep, user: CurrentAccount, body: CreateReportInput):
    return service.visible_config(session, user, body.config)


@router.put("/library/{report_id}", response_model=report_library.LibrarySnapshot)
def save_named_report(session: SessionDep, user: CurrentAccount, report_id: str, body: SaveReportInput):
    return library_action(lambda: report_library.save(session, user, report_id, body.config, body.revision))


@router.post("/library/{report_id}/bookmarks", response_model=report_library.LibrarySnapshot)
def create_filter_bookmark(session: SessionDep, user: CurrentAccount, report_id: str, body: BookmarkInput):
    return library_action(lambda: report_library.bookmark(session, user, report_id, body.name, body.state))


@router.get("/share-recipients", response_model=list[report_library.Recipient])
def report_share_recipients(session: SessionDep, user: CurrentAccount):
    return report_library.recipients(session, user)


@router.post("/library/{report_id}/share")
def share_named_report(session: SessionDep, user: CurrentAccount, report_id: str, body: ShareReportInput):
    return library_action(lambda: report_library.share(session, user, report_id, body.recipient_id, body.revision))


@router.put("/config", response_model=ReportConfig)
def save_report_config(session: SessionDep, user: CurrentAccount, body: ReportConfig):
    return library_action(lambda: service.save_config(session, user, body))


@router.post("/data", response_model=ReportData)
def report_data(session: SessionDep, user: CurrentAccount, body: ReportQuery):
    try:
        return service.data(session, user, body)
    except service.OwnerNotAllowed as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from None


@router.post("/export")
def export_complete_report(session: SessionDep, user: CurrentAccount, body: report_exports.ExportInput):
    try:
        file, filename = report_exports.export_file(session, user, body)
    except service.OwnerNotAllowed as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from None
    except report_details.DetailSortNotAllowed as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    def chunks():
        try:
            while content := file.read(65536):
                yield content
        finally:
            file.close()
    media = {"csv": "text/csv; charset=utf-8", "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "pdf": "application/pdf"}[body.format]
    return StreamingResponse(chunks(), media_type=media, headers={"Content-Disposition": f"attachment; filename=report.{body.format}; filename*=UTF-8''{quote(filename)}", "Cache-Control": "no-store"})


@router.post("/details", response_model=report_details.ReportDetails)
def report_detail_rows(session: SessionDep, user: CurrentAccount, body: report_details.DetailsInput):
    try:
        return report_details.details(session, user, body)
    except service.OwnerNotAllowed as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from None
    except report_details.DetailSortNotAllowed as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None


@router.post("/details/export")
def report_detail_csv(session: SessionDep, user: CurrentAccount, body: report_details.DetailsInput):
    try:
        csv = report_details.export_csv(session, user, body)
        return Response(content=csv, media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="report-details.csv"'})
    except service.OwnerNotAllowed as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from None
    except report_details.DetailSortNotAllowed as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None


@router.post("/adjust", response_model=Adjustment)
def adjust_report(session: SessionDep, user: CurrentAccount, body: AdjustInput):
    try:
        return service.adjust(session, user, body.question, body.config)
    except service.OwnerNotAllowed as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from None
    except NotConfigured:
        raise HTTPException(status_code=503, detail="熊熊滾的 AI 報表調整尚未設定，你可以先手動調整報表。") from None
    except (LLMOutputError, ValueError, errors.APIError):
        log.exception("AI 報表調整失敗")
        raise HTTPException(status_code=502, detail="熊熊滾這次無法完成報表調整，請換個說法或先手動調整。") from None
