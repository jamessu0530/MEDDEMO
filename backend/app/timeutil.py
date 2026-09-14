import datetime as dt
from zoneinfo import ZoneInfo

TAIPEI = ZoneInfo("Asia/Taipei")


def local_date(moment: dt.datetime) -> dt.date:
    """資料庫存的是含時區的時間；拜訪日、提醒日一律以台灣日期為準。"""
    return moment.astimezone(TAIPEI).date()
