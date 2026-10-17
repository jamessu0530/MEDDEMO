"""一般行事曆輸入驗證：時區、時間範圍、RFC 5545 重複規則。"""

import datetime as dt
import re
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from dateutil.rrule import rrulestr
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.services.auth import EMAIL_SHAPE


class CalendarInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=80)
    color: str = "#9B51E0"

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value):
        if not value.strip():
            raise ValueError("請填寫日曆名稱")
        return value.strip()

    @field_validator("color")
    @classmethod
    def hex_color(cls, value):
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
            raise ValueError("顏色格式不正確")
        return value.upper()


class EventInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    calendar_id: str
    title: str = Field(min_length=1, max_length=200)
    starts_at: dt.datetime
    ends_at: dt.datetime
    timezone: str = "Asia/Taipei"
    all_day: bool = False
    location: str = Field(default="", max_length=1000)
    description: str = Field(default="", max_length=10000)
    url: str = Field(default="", max_length=2000)
    recurrence: str | None = Field(default=None, max_length=500)
    reminders: list[int] = Field(default_factory=lambda: [15], max_length=5)
    attendees: list[str] = Field(default_factory=list, max_length=50)

    @field_validator("title")
    @classmethod
    def title_not_blank(cls, value):
        if not value.strip():
            raise ValueError("請填寫行程標題")
        return value.strip()

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("找不到這個時區") from None
        return value

    @field_validator("reminders")
    @classmethod
    def valid_reminders(cls, values):
        if any(v < 0 or v > 20160 for v in values):
            raise ValueError("提醒時間須介於開始時與兩週前")
        return sorted(set(values), reverse=True)

    @field_validator("attendees")
    @classmethod
    def valid_emails(cls, values):
        emails = sorted({e.strip().lower() for e in values if e.strip()})
        if any(len(e) > 254 or not EMAIL_SHAPE.fullmatch(e) for e in emails):
            raise ValueError("邀請對象請填有效的電子郵件")
        return emails

    @field_validator("url")
    @classmethod
    def valid_url(cls, value):
        if value and not value.startswith(("https://", "http://")):
            raise ValueError("連結須以 https:// 或 http:// 開頭")
        return value

    @model_validator(mode="after")
    def validate_event(self):
        if self.starts_at.tzinfo is None or self.ends_at.tzinfo is None:
            raise ValueError("開始與結束時間須包含時區")
        if self.ends_at <= self.starts_at:
            raise ValueError("結束時間須晚於開始時間")
        if self.ends_at - self.starts_at > dt.timedelta(days=366):
            raise ValueError("單次行程最長一年")
        if self.all_day:
            zone = ZoneInfo(self.timezone)
            if any(t.astimezone(zone).time() != dt.time() for t in (self.starts_at, self.ends_at)):
                raise ValueError("全天行程須從當地午夜開始，結束於最後一天的隔天午夜")
        if self.recurrence:
            self.recurrence = self.recurrence.removeprefix("RRULE:").upper()
            # 禁止秒／分鐘／小時級重複與多行注入；展開另外有數量上限。
            if not re.fullmatch(r"[A-Z0-9=;,+-]+", self.recurrence):
                raise ValueError("重複規則格式不正確")
            pieces = dict(p.split("=", 1) for p in self.recurrence.split(";") if "=" in p)
            if set(pieces) - {"FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "BYMONTHDAY", "BYMONTH", "BYSETPOS", "WKST"}:
                raise ValueError("不支援此重複規則的欄位")
            if pieces.get("FREQ") not in {"DAILY", "WEEKLY", "MONTHLY", "YEARLY"}:
                raise ValueError("重複頻率須為每天、每週、每月或每年")
            if int(pieces.get("INTERVAL", "1")) not in range(1, 1000):
                raise ValueError("重複間隔須為 1～999")
            if "COUNT" in pieces and not 1 <= int(pieces["COUNT"]) <= 10000:
                raise ValueError("重複次數須為 1～10000")
            if "COUNT" in pieces and "UNTIL" in pieces:
                raise ValueError("重複結束方式請選擇日期或次數其中一種")
            try:
                rrulestr(self.recurrence, dtstart=self.starts_at.astimezone(ZoneInfo(self.timezone)))
            except (ValueError, TypeError, OverflowError):
                raise ValueError("重複規則格式不正確") from None
        return self


class EventChange(EventInput):
    scope: Literal["all", "one", "future"] = "all"
    occurrence: dt.datetime | None = None
    expected_sequence: int = Field(ge=0)


class ConnectionInput(CalendarInput):
    source: Literal["ics", "caldav"]
    url: str = Field(max_length=2000)
    username: str = Field(default="", max_length=254)
    password: str = Field(default="", max_length=1000)


class DiscoverInput(BaseModel):
    url: str = Field(max_length=2000)
    username: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=1000)
