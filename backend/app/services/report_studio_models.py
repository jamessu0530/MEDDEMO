"""報表設計物件與互動設定；僅宣告可用操作，不接受腳本或任意 SQL。"""

import base64
import io
from typing import Literal

from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.services.report_datasets import DatasetChart

SLUG = r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$"
Dimension = Literal["year", "quarter", "month", "customer", "product", "owner", "customer_type"]


class StudioModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ObjectRect(StudioModel):
    x: float = Field(default=0, ge=0, le=24, allow_inf_nan=False)
    y: float = Field(default=0, ge=0, le=400, allow_inf_nan=False)
    w: float = Field(default=8, ge=4, le=24, allow_inf_nan=False)
    h: float = Field(default=10, ge=8, le=60, allow_inf_nan=False)

    @model_validator(mode="after")
    def within_canvas(self):
        if self.x + self.w > 24:
            raise ValueError("物件超出畫布寬度")
        return self


class ObjectMobileRect(StudioModel):
    order: int = Field(ge=0, le=123, strict=True)
    width: Literal["half", "full"] = "full"
    height: int = Field(default=10, ge=8, le=60, strict=True)
    hidden: bool = False


class StudioAction(StudioModel):
    kind: Literal["page", "bookmark", "back", "reset", "toggle"] = "page"
    target: str | None = Field(default=None, max_length=48, pattern=SLUG)


class CanvasSlicer(StudioModel):
    dimension: Dimension = "customer"
    style: Literal["list", "dropdown"] = "list"
    sync_group: str | None = Field(default=None, max_length=48, pattern=SLUG)
    pages: list[str] = Field(default_factory=list, max_length=5)
    cards: list[str] = Field(default_factory=list, max_length=24)


class StudioObject(StudioModel):
    id: str = Field(pattern=SLUG)
    page_id: str = Field(default="overview", pattern=SLUG)
    kind: Literal["text", "image", "shape", "button", "slicer", "dataset"]
    title: str = Field(default="設計物件", min_length=1, max_length=80)
    text: str = Field(default="", max_length=4000)
    image: str = Field(default="", max_length=300_000)
    shape: Literal["rectangle", "ellipse", "line"] = "rectangle"
    color: str = Field(default="#6455c7", pattern=r"^#[a-fA-F0-9]{6}$")
    background: str = Field(default="#ffffff", pattern=r"^#[a-fA-F0-9]{6}$")
    font_size: int = Field(default=18, ge=10, le=72)
    desktop_layout: ObjectRect = Field(default_factory=ObjectRect)
    mobile_layout: ObjectMobileRect | None = None
    layer: int = Field(default=0, ge=0, le=999, strict=True)
    hidden: bool = False
    locked: bool = False
    group_id: str | None = Field(default=None, pattern=SLUG)
    action: StudioAction | None = None
    slicer: CanvasSlicer | None = None
    dataset_id: str | None = Field(default=None, pattern=SLUG)
    dataset_chart: DatasetChart | None = None

    @field_validator("image")
    @classmethod
    def safe_image(cls, value):
        if not value:
            return value
        prefix, _, content = value.partition(",")
        if prefix not in {"data:image/png;base64", "data:image/jpeg;base64", "data:image/webp;base64"}:
            raise ValueError("圖片只接受上傳的 PNG、JPEG 或 WebP")
        try:
            raw = base64.b64decode(content, validate=True)
            image = Image.open(io.BytesIO(raw))
            if image.format not in {"PNG", "JPEG", "WEBP"} or max(image.size) > 4096:
                raise ValueError("圖片格式或尺寸不符合限制")
            image.verify()
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
            raise ValueError("無法讀取這張圖片，請重新上傳") from None
        return value

    @model_validator(mode="after")
    def valid_object(self):
        if self.kind == "button" and self.action is None:
            raise ValueError("操作按鈕需要指定動作")
        if self.kind == "slicer" and self.slicer is None:
            raise ValueError("畫布切片器需要指定欄位")
        if self.kind == "dataset" and (self.dataset_id is None or self.dataset_chart is None):
            raise ValueError("匯入圖表需要指定資料來源與欄位")
        return self


class ReportAnalytics(StudioModel):
    trend_line: bool = False
    forecast_periods: int = Field(default=0, ge=0, le=12, strict=True)


class CanvasSlicerSelection(StudioModel):
    object_id: str = Field(pattern=SLUG)
    keys: list[str] = Field(default_factory=list, max_length=500)

    @field_validator("keys")
    @classmethod
    def safe_keys(cls, keys):
        if any(not key or len(key) > 100 for key in keys) or len(keys) != len(set(keys)):
            raise ValueError("切片器選取包含空白、重複或過長的值")
        return keys
