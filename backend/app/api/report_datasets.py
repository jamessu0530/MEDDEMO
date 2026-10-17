"""帳號私有的 Excel／CSV／TSV 報表資料工作區。"""

from typing import Annotated
from urllib.parse import quote
import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile
from google.genai import errors
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.auth import CurrentAccount
from app.config import NotConfigured
from app.db import get_session
from app.llm import LLMOutputError
from app.models import AppUser, ReportDataset
from app.services import report_datasets as service
from app.services.reports import ai_available

router = APIRouter(prefix="/datasets", tags=["report-datasets"])
SessionDep = Annotated[Session, Depends(get_session)]
log = logging.getLogger(__name__)


def action(callback):
    try:
        return callback()
    except service.DatasetError as exc:
        raise HTTPException(exc.status, str(exc)) from None


@router.get("")
def list_datasets(session: SessionDep, user: CurrentAccount):
    datasets = session.scalars(select(ReportDataset).where(ReportDataset.user_id == user.id).order_by(ReportDataset.updated_at.desc(), ReportDataset.id))
    return {"datasets": [service.summary(dataset) for dataset in datasets], "ai_available": ai_available()}


@router.post("", status_code=201)
def import_dataset(session: SessionDep, user: CurrentAccount, file: Annotated[UploadFile, File()],
                   sheet: Annotated[str | None, Form(max_length=80)] = None,
                   header_row: Annotated[int, Form(ge=1, le=100)] = 1,
                   encoding: Annotated[str, Form()] = "auto", delimiter: Annotated[str, Form()] = "auto"):
    def run():
        try:
            raw = file.file.read(service.MAX_BYTES + 1)
        finally:
            file.file.close()
        source, origin = service.parse_file(raw, file.filename or "資料.csv", sheet, header_row, encoding, delimiter)
        dataset = service.create(session, user, origin["filename"].rsplit(".", 1)[0] or "匯入資料", source, origin, raw)
        session.commit()
        return service.detail(dataset)
    return action(run)


@router.post("/inspect")
def inspect_dataset(session: SessionDep, user: CurrentAccount, file: Annotated[UploadFile, File()],
                    sheet: Annotated[str | None, Form(max_length=80)] = None,
                    header_row: Annotated[int, Form(ge=1, le=100)] = 1,
                    encoding: Annotated[str, Form()] = "auto", delimiter: Annotated[str, Form()] = "auto"):
    def run():
        try:
            raw = file.file.read(service.MAX_BYTES + 1)
        finally:
            file.file.close()
        return service.inspect_file(raw, file.filename or "資料.csv", sheet, header_row, encoding, delimiter)
    return action(run)


@router.post("/merge", status_code=201)
def merge_datasets(session: SessionDep, user: CurrentAccount, body: service.MergeInput):
    def run():
        dataset = service.merge(session, user, body)
        session.commit()
        return service.detail(dataset)
    return action(run)


@router.get("/{dataset_id}")
def get_dataset(session: SessionDep, user: CurrentAccount, dataset_id: str,
                page: int = Query(default=1, ge=1, le=20_000), page_size: int = Query(default=50, ge=1, le=100)):
    return action(lambda: service.detail(service.owned(session, user, dataset_id), page, page_size))


@router.post("/{dataset_id}/preview")
def preview_cleaning(session: SessionDep, user: CurrentAccount, dataset_id: str, body: service.Recipe):
    def run():
        dataset = service.owned(session, user, dataset_id)
        columns, rows, changes = service.transform(dataset.source, body)
        return service.preview(columns, rows, changes)
    return action(run)


class ReparseInput(service.StrictModel):
    revision: int = Field(ge=1, strict=True)
    sheet: str | None = Field(default=None, max_length=80)
    header_row: int = Field(default=1, ge=1, le=100)
    encoding: str = "auto"
    delimiter: str = "auto"


@router.post("/{dataset_id}/reparse")
def reparse_dataset(session: SessionDep, user: CurrentAccount, dataset_id: str, body: ReparseInput):
    def run():
        dataset = service.owned(session, user, dataset_id, body.revision, lock=True)
        if dataset.content is None:
            raise service.DatasetError("合併資料沒有原始檔案，請在來源資料調整後重新合併。")
        source, origin = service.parse_file(dataset.content, dataset.origin["filename"], body.sheet, body.header_row, body.encoding, body.delimiter)
        recipe = service.default_recipe(source)
        columns, rows, _ = service.transform(source, recipe)
        dataset.source, dataset.origin, dataset.recipe = source, origin, recipe.model_dump()
        dataset.columns, dataset.rows, dataset.row_count, dataset.charts = columns, rows, len(rows), []
        dataset.revision += 1
        import datetime as dt
        dataset.updated_at = dt.datetime.now(dt.UTC)
        session.commit()
        return service.detail(dataset)
    return action(run)


@router.put("/{dataset_id}")
def save_dataset(session: SessionDep, user: CurrentAccount, dataset_id: str, body: service.SaveInput):
    def run():
        dataset = service.save(session, user, dataset_id, body)
        session.commit()
        return service.detail(dataset)
    return action(run)


@router.post("/{dataset_id}/query")
def query_dataset(session: SessionDep, user: CurrentAccount, dataset_id: str, body: service.DatasetChart):
    def run():
        dataset = service.owned(session, user, dataset_id)
        return {**service.aggregate(dataset.columns, dataset.rows, body), "revision": dataset.revision}
    return action(run)


class AnalyzeInput(service.StrictModel):
    question: str = Field(default="請解釋這份檔案的內容、欄位、資料品質與適合的分析方式。", min_length=1, max_length=1000)


@router.post("/{dataset_id}/analyze")
def analyze_dataset(session: SessionDep, user: CurrentAccount, dataset_id: str, body: AnalyzeInput):
    dataset = action(lambda: service.owned(session, user, dataset_id))
    if not ai_available():
        raise HTTPException(503, "AI 尚未設定；你仍可預覽、整理、合併資料及建立圖表。")
    try:
        return service.analyze(dataset, body.question)
    except NotConfigured:
        raise HTTPException(503, "AI 尚未設定，請先在雲端設定完成 AI 服務。") from None
    except (LLMOutputError, errors.APIError):
        log.exception("AI 匯入資料判讀失敗")
        raise HTTPException(502, "AI 這次無法完成檔案判讀，請重試或換個問法。") from None


@router.get("/{dataset_id}/export")
def export_dataset(session: SessionDep, user: CurrentAccount, dataset_id: str):
    dataset = action(lambda: service.owned(session, user, dataset_id))
    return Response(service.export_csv(dataset), media_type="text/csv; charset=utf-8", headers={
        "Content-Disposition": f"attachment; filename=data.csv; filename*=UTF-8''{quote(dataset.name + '.csv')}", "Cache-Control": "no-store"})


@router.delete("/{dataset_id}", status_code=204)
def delete_dataset(session: SessionDep, user: CurrentAccount, dataset_id: str, revision: int = Query(ge=1)):
    def run():
        session.execute(select(AppUser.id).where(AppUser.id == user.id).with_for_update())
        session.delete(service.owned(session, user, dataset_id, revision, lock=True))
        session.commit()
    return action(run)
