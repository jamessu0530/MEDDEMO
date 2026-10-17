"""主管端：團隊今天的行程與客戶策略。"""

import dataclasses
import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.auth import ManagerUser
from app.api.customer_priority import router as priority_router
from app.api.featured_products import router as featured_router
from app.db import get_session
from app.services import customer_profile
from app.services.auth import role_data_user
from app.services import team_itineraries as team
from app.timeutil import TAIPEI

router = APIRouter(prefix="/api/manager", tags=["manager"])
router.include_router(priority_router)
router.include_router(featured_router)
SessionDep = Annotated[Session, Depends(get_session)]
# 團隊今天的行程：只能看、只看今天。業務今天還沒打開首頁時，主管一讀就照第一次讀取的規則建好，所以讀完要 commit


class TeamRep(BaseModel):
    id: str
    name: str
    region: str


class LatLng(BaseModel):
    lat: float
    lng: float


class TeamStop(BaseModel):
    number: int
    customer_id: str
    customer_name: str
    area: str
    lat: float
    lng: float
    status: str
    planned_time: str
    duration_minutes: int
    late_minutes: int
    source: str
    signal: str
    reason: str
    window_kind: str | None
    window_time: str | None
    travel_mode: str  # 到這一站那一段實際用的交通方式
    travel_minutes: int | None
    travel_km: float | None
    travel_estimated: bool
    city: str
    arrived_at: dt.datetime | None
    visit_id: str | None


class TeamLegStep(BaseModel):
    walk: bool  # 大眾運輸的走路（虛線）；不是走路就是搭車
    polyline: str


class TeamLeg(BaseModel):
    polyline: str | None
    done: bool
    steps: list[TeamLegStep]


class TeamRemovedStop(BaseModel):
    customer_id: str
    customer_name: str
    area: str
    lat: float
    lng: float
    label: str
    reason: str


class SeenLocation(BaseModel):
    # 主管看到的那一行（services/locations.describe）
    text: str
    # 地圖上頭像畫在哪；沒有（下班、今天還沒有位置）就不畫
    lat: float | None
    lng: float | None
    at: dt.datetime | None
    # 分享中而且 5 分鐘內有更新；暫停、沒權限、太久沒更新的頭像是灰的
    live: bool


class RepRoute(BaseModel):
    rep: TeamRep
    version: int
    done: int
    total: int
    travel_minutes: int
    travel_km: float
    finish_time: str | None
    estimated: bool
    travel_mode: str  # 這位業務的交通方式：drive、scooter、transit
    start_city: str | None
    office_start: bool
    origin: LatLng | None
    stops: list[TeamStop]
    legs: list[TeamLeg]
    removed: list[TeamRemovedStop]
    added: list[str]
    moved: list[str]
    untouched: bool
    location: SeenLocation


class TeamRoutes(BaseModel):
    date: dt.date
    updated_at: str  # 台北的真實時間 HH:MM
    scope: str  # 主管是自己那一區（「北區」），IT 是「全公司」
    reps: list[RepRoute]


def _route_out(route: team.RepRoute) -> RepRoute:
    view = route.view
    return RepRoute(
        rep=TeamRep(id=route.rep.id, name=route.rep.name, region=route.rep.region),
        version=view.version, done=view.done, total=view.total, travel_minutes=view.travel_minutes,
        travel_km=view.travel_km, finish_time=view.finish_time, estimated=view.estimated,
        travel_mode=view.travel_mode,
        start_city=view.start_city, office_start=view.office_start,
        origin=LatLng(lat=route.origin[0], lng=route.origin[1]) if route.origin else None,
        stops=[TeamStop(**dataclasses.asdict(stop)) for stop in route.stops],
        legs=[TeamLeg(**dataclasses.asdict(leg)) for leg in route.legs],
        removed=[TeamRemovedStop(**dataclasses.asdict(stop)) for stop in route.removed],
        added=route.added, moved=route.moved, untouched=route.untouched,
        location=SeenLocation(**dataclasses.asdict(route.location)),
    )


@router.get("/itineraries", response_model=TeamRoutes)
def team_itineraries(session: SessionDep, manager: ManagerUser):
    """團隊今天的行程：每位業務的路線、進度，以及跟系統早上的建議比改了什麼。"""
    routes = team.routes(session, team.reps(session, manager))
    result = TeamRoutes(
        date=customer_profile.app_today(session),
        updated_at=dt.datetime.now(TAIPEI).strftime("%H:%M"),
        scope="全公司" if manager.role == "it" else role_data_user(manager).region,
        reps=[_route_out(route) for route in routes],
    )
    session.commit()
    return result


@router.get("/itineraries/{user_id}", response_model=RepRoute)
def rep_itinerary(session: SessionDep, user_id: str, manager: ManagerUser):
    """一位業務今天的行程。看不到的人跟不存在一樣回 404，不透露有沒有這個帳號。"""
    rep = team.find_rep(session, manager, user_id)
    if rep is None:
        raise HTTPException(404, "找不到這位業務")
    result = _route_out(team.route(session, rep))
    session.commit()
    return result


class TeamLocations(BaseModel):
    updated_at: str  # 台北的真實時間 HH:MM
    locations: dict[str, SeenLocation]


@router.get("/locations", response_model=TeamLocations)
def team_locations(session: SessionDep, manager: ManagerUser):
    """看得到的業務現在在哪。主管頁收到位置事件時只重拿這個：不重算行程、不問 Google。"""
    found = team.locations_now(session, manager)
    return TeamLocations(
        updated_at=dt.datetime.now(TAIPEI).strftime("%H:%M"),
        locations={rep_id: SeenLocation(**dataclasses.asdict(seen)) for rep_id, seen in found.items()},
    )
