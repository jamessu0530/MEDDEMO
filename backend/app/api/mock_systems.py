"""模擬的 CRM／SAP／OA 系統狀態。展示部分失敗時，把其中一套設成停機（SDD 5.3）。"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.models import WRITEBACK_TARGETS
from app.services.writeback import TARGET_LABEL, is_mock_down, set_mock_down

router = APIRouter(prefix="/api/mock-systems", tags=["mock-systems"])


class MockSystem(BaseModel):
    target: str
    label: str
    down: bool


class MockSystemInput(BaseModel):
    down: bool


@router.get("", response_model=list[MockSystem])
def list_mock_systems():
    return [MockSystem(target=t, label=TARGET_LABEL[t], down=is_mock_down(t)) for t in WRITEBACK_TARGETS]


@router.put("/{target}", response_model=MockSystem)
def update_mock_system(target: str, body: MockSystemInput):
    if target not in WRITEBACK_TARGETS:
        raise HTTPException(404, "沒有這個目標系統")
    set_mock_down(target, body.down)
    return MockSystem(target=target, label=TARGET_LABEL[target], down=body.down)
