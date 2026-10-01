# 行程第四階段：Google 道路車程與地圖金鑰 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 設了 `GOOGLE_MAPS_SERVER_KEY` 時，行程的車程改用 Google Routes API 的道路車程；沒設金鑰、Google 回錯或逾時（5 秒）時照舊用直線估算並標 `estimated`。另外加上 `GET /api/maps/config` 給主管頁的地圖拿瀏覽器金鑰，兩把金鑰由部署流程放進 Helm 用的 Secret。

**Architecture:** 新的 `services/google_routes.py` 是整個專案唯一知道 Google 格式的地方（`computeRouteMatrix`、`computeRoutes`，回秒數、公尺與編碼折線，失敗一律丟 `RoutesError`）。`services/travel.py` 決定什麼時候問 Google、什麼時候退回估算。`api/maps.py` 給前端瀏覽器金鑰。測試一律不連 Google：conftest 清空金鑰，Google 的回應用 `httpx.MockTransport` 或 monkeypatch 假造。

**Tech Stack:** FastAPI、httpx、pytest。

**設計文件：** `docs/superpowers/specs/2026-10-01-itinerary-planning-design.md`（本計畫是〈分階段做〉的第 4 階段）。

## Global Constraints

- 一律用繁體中文寫註解與畫面文字，註解密度與口吻照周圍的程式。
- 只有 `backend/app/services/google_routes.py` 知道 Google 的網址、欄位與 JSON 格式；其他地方只拿秒數、公尺與折線。
- 只用 Essentials 的功能：`travelMode: "DRIVE"`、`routingPreference: "TRAFFIC_UNAWARE"`、不送出發時間；`computeRoutes` 一次最多 10 個中間點（`google_routes.MAX_INTERMEDIATES = 10`），超過就拆成好幾次送。
- 等 Google 最多 5 秒（`google_routes.TIMEOUT_SECONDS = 5`）。
- Google 的車程只算開車，跟估算一樣再加 5 分鐘停車（`travel.PARKING_MINUTES`）；同一點 0 分鐘、0 公里。
- 退回估算時 `Matrix.estimated` 是 `True`；只要有一格不是 Google 給的，整份就是 `True`。
- 測試永遠不呼叫真的 Google：conftest 把 `GOOGLE_MAPS_SERVER_KEY`、`GOOGLE_MAPS_BROWSER_KEY`、`GOOGLE_MAPS_MAP_ID` 清成空字串；要測 Google 那條路就在測試裡用 `env` fixture 設假金鑰，同時假造 Google 的回應。
- `GET /api/maps/config`：有瀏覽器金鑰回 `{"browser_key": "...", "map_id": "..."}`，沒有回 `null`；只有主管與 IT 打得到（403「這個頁面只有主管看得到」）。
- 測試在隔離的資料庫與 Redis 跑：`TEST_DB_NAME=meddemo_test_maps TEST_REDIS_URL=redis://127.0.0.1:6379/7`。
- 跟 Track A（第 2、3 階段，另一個 worktree）共用的檔案（`backend/app/main.py`、`README.md`、設計文件、`backend/app/services/itinerary.py`）只做局部、加新的一段，不重排、不改別人的行。
- 每個 commit 訊息最後空一行再加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。

## 查到的價格與規定（2026-10-01）

**價格**（2025 年 3 月起每個 SKU 各有每月免費額度，沒有以前的 $200 贈金）：

| SKU | 怎麼算一次 | 每月免費 | 之後（每 1,000 次） |
|---|---|---|---|
| Dynamic Maps（Maps JavaScript API） | 每載入一次地圖（`new google.maps.Map`）；拖、縮放不另外算 | 10,000 | $7 |
| Routes: Compute Routes Essentials | 每個請求 | 10,000 | $5 |
| Routes: Compute Routes Pro | 每個請求；11–25 個中間點、看即時路況、`optimizeWaypointOrder` | 5,000 | $10 |
| Routes: Compute Route Matrix Essentials | 每一格（起點數 × 終點數） | 10,000 | $5 |
| Routes: Compute Route Matrix Pro | 每一格；看即時路況 | 5,000 | $10 |

- 一次 9 點（辦公室加 8 站）的矩陣是 81 格，超過免費額度後約 $0.4。
- `computeRouteMatrix` 不看路況時一次最多 625 格。

來源：<https://developers.google.com/maps/billing-and-pricing/pricing>、<https://developers.google.com/maps/billing-and-pricing/sku-details>、<https://developers.google.com/maps/documentation/routes/usage-and-billing>

**快取與顯示的規定：**

- Google Maps Platform Terms of Service 3.2.3(b)「No Caching. Customer will not cache Google Maps Content except as expressly permitted under the Maps Service Specific Terms.」
- Service Specific Terms 第 19 條（Routes API）：19.1 沒有地圖也可以用 Routes API 的結果（業務首頁只顯示車程、不畫地圖，可以）；19.2 不能跟非 Google 的地圖一起用（主管頁用 Google 地圖，可以）；19.3「Customer may temporarily cache latitude (lat) and longitude (lng) values from the Routes API for up to 30 consecutive calendar days, after which Customer must delete the cached latitude and longitude values.」另外 place ID 可以留。
- 所以：沿路的折線（就是一串經緯度）快取一天可以；車程的分鐘數與公里數條款沒有允許快取。

來源：<https://cloud.google.com/maps-platform/terms>（3.2.3）、<https://cloud.google.com/maps-platform/terms/maps-service-terms>（19. Routes API）、<https://developers.google.com/maps/documentation/routes/policies>

**怎麼做（依設計「實作前查 Google Maps Platform 的快取規定，必要時縮短」）：** 車程的分鐘數與公里數不快取。
讀行程（首頁、主管頁、之後調整清單的 preview）只需要照順序相鄰兩站的車程，改用 `computeRoutes`（按請求計價，一個請求拿到全部路段）——
`travel.along(points)`；只有真的要排順序時（每天第一次建、加一站、排順路）才用 `computeRouteMatrix`——`travel.matrix(points)`。
主管頁的沿路折線（經緯度，條款允許）照 `(itinerary_id, version)` 快取到當天結束，在第 5 階段做。
已經用訊息問過 main 要不要改回「照設計快取一天」（較省、但不符條款字面）；改的話只是在 `travel.matrix` 外面加一層 Redis，呼叫端不用動。

**示範規模的估計**（5 位業務、主管頁一次讀 2–5 位的行程、一個月）：地圖載入約 1,000–2,000 次（免費）；`computeRoutes` 數千次（免費額度內）；`computeRouteMatrix` 照現在的做法每次排順序 81 格（若改回快取一天，每天每位業務約 100 格），一個月 1–3 萬格，超過免費的部分 $0–100。只要不是「每讀一次就問一次矩陣」（那樣主管總覽一次就 405 格，一個月數百到上千美元），都在每月幾十美元以內。建議在 Google Cloud 設預算警示與 Routes API 的每日配額上限。

**使用者要建的東西：** Google Cloud 專案並綁帳單；啟用 Maps JavaScript API 與 Routes API；伺服器金鑰（只開 Routes API、限伺服器 IP）；瀏覽器金鑰（只開 Maps JavaScript API、限 `https://meddemo.jamessu2016.com/*`）；選配一個 Map ID；兩把金鑰放 GitHub Secrets `GOOGLE_MAPS_SERVER_KEY`、`GOOGLE_MAPS_BROWSER_KEY`，部署流程寫進 `meddemo-ai` Secret。

## 執行環境

在 worktree 裡做，不動主目錄（其他對話也在改 main，Track A 在 `.worktrees/itinerary`）：

```bash
cd /Users/jamessu/Desktop/computersciencehomework/MEDDEMO
git worktree add .worktrees/itinerary-maps -b itinerary-maps itinerary
cp backend/.env .worktrees/itinerary-maps/backend/.env
cd .worktrees/itinerary-maps/frontend && npm ci
```

之後所有指令都在 `/Users/jamessu/Desktop/computersciencehomework/MEDDEMO/.worktrees/itinerary-maps` 下跑。後端測試：

```bash
TEST_DB_NAME=meddemo_test_maps TEST_REDIS_URL=redis://127.0.0.1:6379/7 uv run --project backend pytest backend/tests/<file> -q
```

`backend/.env` 是 gitignore 的，最後刪掉複製進來的那份。

## 檔案

| 檔案 | 動作 | 職責 |
|---|---|---|
| `backend/app/services/google_routes.py` | 新 | Routes API 的兩種呼叫：`route_matrix`（computeRouteMatrix）、`route_legs`（computeRoutes） |
| `backend/app/services/travel.py` | 改 | 有金鑰就問 Google，失敗退回估算 |
| `backend/app/config.py` | 改 | `google_maps_server_key`、`google_maps_browser_key`、`google_maps_map_id` |
| `backend/app/api/maps.py` | 新 | `GET /api/maps/config` |
| `backend/app/main.py` | 改 | 掛 maps 的 router（另起一行 import，不動原本那一長行） |
| `backend/tests/conftest.py` | 改 | 三個 Google 地圖設定清空 |
| `backend/tests/test_google_routes.py` | 新 | 假的 Google（`httpx.MockTransport`） |
| `backend/tests/test_travel.py` | 改 | Google 那條路與退回估算 |
| `backend/tests/test_maps_api.py` | 新 | |
| `.github/workflows/ci-cd.yml` | 改 | 兩把金鑰從 GitHub Secrets 寫進 `meddemo-ai` Secret |
| `deploy/helm/meddemo/values.yaml` | 改 | `secrets.ai` 的註解多列兩把金鑰 |
| `README.md` | 改 | 今日路線那一節加一點車程的來源；部署的選填金鑰 |

---

### Task 1: Routes API 的呼叫

**Files:**
- Create: `backend/app/services/google_routes.py`
- Test: `backend/tests/test_google_routes.py`

**Interfaces:**
- Produces: `google_routes.Point = tuple[float, float]`；`google_routes.RoutesError(Exception)`；`google_routes.Cell(seconds: int, meters: int)`；`google_routes.Leg(seconds: int, meters: int, polyline: str)`；`google_routes.route_matrix(key: str, origins: list[Point], destinations: list[Point], http: httpx.Client | None = None) -> dict[tuple[int, int], Cell]`（開不到的格子不在結果裡）；`google_routes.route_legs(key: str, points: list[Point], http: httpx.Client | None = None) -> list[Leg]`（`len(points) - 1` 段）；常數 `MATRIX_URL`、`ROUTES_URL`、`TIMEOUT_SECONDS = 5`、`MAX_INTERMEDIATES = 10`、`MAX_ELEMENTS = 625`。

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_google_routes.py`：

```python
"""Google Routes API 的呼叫：送出去的格式、回來的解讀、失敗一律 RoutesError。全部用假的 Google，不連網路。"""

import json

import httpx
import pytest

from app.services import google_routes
from app.services.google_routes import Cell, Leg, RoutesError

TAIPEI_MAIN = (25.0478, 121.517)
TAIPEI_101 = (25.034, 121.5645)
SONGSHAN = (25.0597, 121.5577)


def waypoint(point):
    return {"location": {"latLng": {"latitude": point[0], "longitude": point[1]}}}


def fake(handler):
    """假的 Google：handler 收到 httpx.Request，回 (狀態碼, JSON)。送出去的請求都記在 sent。"""
    sent = []

    def respond(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        status, body = handler(request)
        return httpx.Response(status, json=body)

    return httpx.Client(transport=httpx.MockTransport(respond)), sent


def test_matrix_asks_for_driving_without_traffic_and_reads_every_cell():
    elements = [
        # 數字是 0 的欄位 Google 會省略：第 0 個起點、第 0 個終點都沒有 index
        {"destinationIndex": 1, "duration": "600s", "distanceMeters": 4200, "condition": "ROUTE_EXISTS", "status": {}},
        {"originIndex": 1, "destinationIndex": 0, "duration": "630.4s", "distanceMeters": 4400,
         "condition": "ROUTE_EXISTS", "status": {}},
        {"originIndex": 1, "destinationIndex": 1, "duration": "0s", "condition": "ROUTE_EXISTS", "status": {}},
        {"condition": "ROUTE_EXISTS", "status": {}},
    ]
    http, sent = fake(lambda request: (200, elements))
    cells = google_routes.route_matrix("server-key", [TAIPEI_MAIN, TAIPEI_101], [TAIPEI_MAIN, TAIPEI_101], http=http)
    assert cells == {(0, 1): Cell(600, 4200), (1, 0): Cell(630, 4400), (1, 1): Cell(0, 0), (0, 0): Cell(0, 0)}

    request = sent[0]
    assert str(request.url) == google_routes.MATRIX_URL
    assert request.headers["X-Goog-Api-Key"] == "server-key"
    assert set(request.headers["X-Goog-FieldMask"].split(",")) >= {
        "originIndex", "destinationIndex", "duration", "distanceMeters", "status", "condition",
    }
    body = json.loads(request.content)
    assert body["travelMode"] == "DRIVE" and body["routingPreference"] == "TRAFFIC_UNAWARE"
    assert "departureTime" not in body
    assert body["origins"] == [{"waypoint": waypoint(TAIPEI_MAIN)}, {"waypoint": waypoint(TAIPEI_101)}]
    assert body["destinations"] == body["origins"]


def test_matrix_leaves_out_cells_google_cannot_route():
    elements = [
        {"destinationIndex": 1, "condition": "ROUTE_NOT_FOUND", "status": {}},
        {"originIndex": 1, "status": {"code": 5, "message": "找不到"}},
        {"originIndex": 1, "destinationIndex": 1, "duration": "0s", "condition": "ROUTE_EXISTS", "status": {}},
    ]
    http, _ = fake(lambda request: (200, elements))
    cells = google_routes.route_matrix("k", [TAIPEI_MAIN, TAIPEI_101], [TAIPEI_MAIN, TAIPEI_101], http=http)
    assert cells == {(1, 1): Cell(0, 0)}


@pytest.mark.parametrize(
    ("status", "body"),
    [(403, {"error": {"message": "API key not valid"}}), (500, {}), (200, {"unexpected": True}),
     (200, [{"originIndex": "x", "condition": "ROUTE_EXISTS"}])],
)
def test_matrix_errors_and_odd_answers_raise(status, body):
    http, _ = fake(lambda request: (status, body))
    with pytest.raises(RoutesError):
        google_routes.route_matrix("k", [TAIPEI_MAIN], [TAIPEI_101], http=http)


def test_timeouts_raise_for_both_calls():
    def slow(request):
        raise httpx.ReadTimeout("Google 太慢", request=request)

    http = httpx.Client(transport=httpx.MockTransport(slow))
    with pytest.raises(RoutesError):
        google_routes.route_matrix("k", [TAIPEI_MAIN], [TAIPEI_101], http=http)
    with pytest.raises(RoutesError):
        google_routes.route_legs("k", [TAIPEI_MAIN, TAIPEI_101], http=http)


def test_a_matrix_too_big_for_one_request_is_refused_without_calling_google():
    points = [(25.0 + i / 1000, 121.5) for i in range(26)]  # 26 × 26 = 676 格，超過 625
    http, sent = fake(lambda request: (200, []))
    with pytest.raises(RoutesError):
        google_routes.route_matrix("k", points, points, http=http)
    assert sent == []


def test_legs_follow_the_given_order_with_a_polyline_each():
    answer = {"routes": [{"legs": [
        {"duration": "300s", "distanceMeters": 2000, "polyline": {"encodedPolyline": "abc"}},
        {"duration": "420s", "distanceMeters": 3100, "polyline": {"encodedPolyline": "def"}},
    ]}]}
    http, sent = fake(lambda request: (200, answer))
    legs = google_routes.route_legs("server-key", [TAIPEI_MAIN, TAIPEI_101, SONGSHAN], http=http)
    assert legs == [Leg(300, 2000, "abc"), Leg(420, 3100, "def")]

    request = sent[0]
    assert str(request.url) == google_routes.ROUTES_URL
    assert request.headers["X-Goog-Api-Key"] == "server-key"
    assert set(request.headers["X-Goog-FieldMask"].split(",")) >= {
        "routes.legs.duration", "routes.legs.distanceMeters", "routes.legs.polyline.encodedPolyline",
    }
    body = json.loads(request.content)
    assert body["origin"] == waypoint(TAIPEI_MAIN)
    assert body["intermediates"] == [waypoint(TAIPEI_101)]
    assert body["destination"] == waypoint(SONGSHAN)
    assert body["travelMode"] == "DRIVE" and body["routingPreference"] == "TRAFFIC_UNAWARE"


def test_more_than_ten_intermediates_are_split_to_stay_in_essentials():
    points = [(25.0 + i / 100, 121.5) for i in range(14)]  # 13 段

    def respond(request):
        body = json.loads(request.content)
        legs = len(body.get("intermediates", [])) + 1
        return 200, {"routes": [{"legs": [
            {"duration": "60s", "distanceMeters": 500, "polyline": {"encodedPolyline": "x"}}
        ] * legs}]}

    http, sent = fake(respond)
    assert len(google_routes.route_legs("k", points, http=http)) == 13
    bodies = [json.loads(request.content) for request in sent]
    assert [len(body.get("intermediates", [])) for body in bodies] == [10, 1]
    # 第二次從第一次的終點出發，中間不會少一段
    assert bodies[1]["origin"] == bodies[0]["destination"] == waypoint(points[11])


@pytest.mark.parametrize("answer", [{"routes": []}, {}, {"routes": [{"legs": [{"duration": "60s"}]}]}])
def test_no_route_or_the_wrong_number_of_legs_raise(answer):
    http, _ = fake(lambda request: (200, answer))
    with pytest.raises(RoutesError):
        google_routes.route_legs("k", [TAIPEI_MAIN, TAIPEI_101, SONGSHAN], http=http)


def test_one_point_needs_no_request():
    http, sent = fake(lambda request: (200, {}))
    assert google_routes.route_legs("k", [TAIPEI_MAIN], http=http) == []
    assert sent == []
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `TEST_DB_NAME=meddemo_test_maps TEST_REDIS_URL=redis://127.0.0.1:6379/7 uv run --project backend pytest backend/tests/test_google_routes.py -q`
Expected: FAIL（`ImportError: cannot import name 'google_routes'`）

- [ ] **Step 3: 實作**

`backend/app/services/google_routes.py`：

```python
"""Google Routes API 的呼叫（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈車程與地圖〉）。

整個專案只有這支知道 Google 的格式：網址、要哪些欄位、回來的 JSON 長什麼樣、怎樣算失敗。
其他地方拿到的是秒數、公尺與編碼過的折線；Google 連不上、逾時、回錯或格式不對一律丟 RoutesError，
由呼叫端退回直線估算。

只用 Essentials 計價的功能（價格與規定見 docs/superpowers/plans/2026-10-01-itinerary-stage4.md）：
開車、不看即時路況、不送出發時間；computeRoutes 一次最多 10 個中間點，超過就拆成好幾次送——
多一個中間點就整個請求算 Pro，貴一倍。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

Point = tuple[float, float]  # (緯度, 經度)

MATRIX_URL = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix"
ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes"
# 等 Google 最多 5 秒，超過就退回估算：首頁不能因為 Google 慢就一直轉圈
TIMEOUT_SECONDS = 5
# computeRoutes 一次最多幾個中間點還算 Essentials
MAX_INTERMEDIATES = 10
# computeRouteMatrix 一次最多幾格（起點數 × 終點數；不看路況時的上限）
MAX_ELEMENTS = 625

MATRIX_FIELDS = "originIndex,destinationIndex,duration,distanceMeters,status,condition"
ROUTE_FIELDS = "routes.legs.duration,routes.legs.distanceMeters,routes.legs.polyline.encodedPolyline"
DRIVING = {"travelMode": "DRIVE", "routingPreference": "TRAFFIC_UNAWARE"}


class RoutesError(Exception):
    """Google 連不上、逾時、回錯或格式不對。"""


@dataclass(frozen=True)
class Cell:
    seconds: int
    meters: int


@dataclass(frozen=True)
class Leg:
    seconds: int
    meters: int
    polyline: str  # Google 的編碼折線（Encoded Polyline Algorithm Format）


def route_matrix(
    key: str, origins: list[Point], destinations: list[Point], http: httpx.Client | None = None
) -> dict[tuple[int, int], Cell]:
    """每個起點開到每個終點的時間與距離，鍵是 (起點第幾個, 終點第幾個)。開不到的格子不在結果裡。"""
    if len(origins) * len(destinations) > MAX_ELEMENTS:
        raise RoutesError(f"一次最多 {MAX_ELEMENTS} 格，這次要 {len(origins) * len(destinations)} 格")
    data = _post(key, MATRIX_URL, MATRIX_FIELDS, {
        "origins": [{"waypoint": _waypoint(p)} for p in origins],
        "destinations": [{"waypoint": _waypoint(p)} for p in destinations],
        **DRIVING,
    }, http)
    if not isinstance(data, list):
        raise RoutesError("路線矩陣的回應不是一串格子")
    try:
        cells = {}
        for element in data:
            if element.get("status", {}).get("code") or element.get("condition") != "ROUTE_EXISTS":
                continue
            # 數字是 0 的欄位 Google 會省略：第 0 個起點沒有 originIndex、同一點沒有 distanceMeters
            index = (int(element.get("originIndex", 0)), int(element.get("destinationIndex", 0)))
            cells[index] = Cell(_seconds(element.get("duration")), int(element.get("distanceMeters", 0)))
        return cells
    except (AttributeError, TypeError, ValueError) as exc:
        raise RoutesError(f"看不懂路線矩陣的回應：{exc}") from exc


def route_legs(key: str, points: list[Point], http: httpx.Client | None = None) -> list[Leg]:
    """照給的順序開過這幾點，每一段的時間、距離與沿路的折線（共 len(points) - 1 段）。
    中間點超過 Essentials 的上限就拆成好幾次送，下一次從上一次的終點出發。"""
    legs: list[Leg] = []
    step = MAX_INTERMEDIATES + 1  # 一次最多幾段
    for start in range(0, len(points) - 1, step):
        legs += _legs(key, points[start:start + step + 1], http)
    return legs


def _legs(key: str, points: list[Point], http: httpx.Client | None) -> list[Leg]:
    origin, *middle, destination = points
    body: dict[str, Any] = {"origin": _waypoint(origin), "destination": _waypoint(destination), **DRIVING}
    if middle:
        body["intermediates"] = [_waypoint(p) for p in middle]
    data = _post(key, ROUTES_URL, ROUTE_FIELDS, body, http)
    try:
        routes = data.get("routes") or []
        legs = routes[0].get("legs", []) if routes else []
        if len(legs) != len(points) - 1:
            raise RoutesError(f"要 {len(points) - 1} 段路線，Google 回了 {len(legs)} 段")
        return [
            Leg(_seconds(leg.get("duration")), int(leg.get("distanceMeters", 0)),
                leg.get("polyline", {}).get("encodedPolyline", ""))
            for leg in legs
        ]
    except (AttributeError, TypeError, ValueError) as exc:
        raise RoutesError(f"看不懂路線的回應：{exc}") from exc


def _post(key: str, url: str, fields: str, body: dict, http: httpx.Client | None) -> Any:
    client = http or httpx.Client(timeout=TIMEOUT_SECONDS)
    try:
        response = client.post(url, json=body, headers={"X-Goog-Api-Key": key, "X-Goog-FieldMask": fields})
        response.raise_for_status()
        return response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise RoutesError(f"Google Routes API 沒有回應或回錯：{exc}") from exc
    finally:
        if http is None:
            client.close()


def _waypoint(point: Point) -> dict:
    return {"location": {"latLng": {"latitude": point[0], "longitude": point[1]}}}


def _seconds(duration: str | None) -> int:
    """Google 的時間長度是 "123s"、"630.4s" 這種字串；0 秒時整個欄位可能省略。"""
    return round(float(duration.removesuffix("s"))) if duration else 0
```

- [ ] **Step 4: 跑測試確認通過**

Run: `TEST_DB_NAME=meddemo_test_maps TEST_REDIS_URL=redis://127.0.0.1:6379/7 uv run --project backend pytest backend/tests/test_google_routes.py -q`
Expected: 全部通過（15 passed 左右，參數化的各算一個）

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/google_routes.py backend/tests/test_google_routes.py
git commit -m "Call the Google Routes API for road times and route lines, and raise one error for every failure

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 2: 車程矩陣改問 Google，失敗退回估算

**Files:**
- Modify: `backend/app/config.py`（`cohere_api_key` 那一行後面）
- Modify: `backend/tests/conftest.py`（清空金鑰的那一串）
- Modify: `backend/app/services/travel.py`
- Test: `backend/tests/test_travel.py`

**Interfaces:**
- Consumes: `google_routes.route_matrix`、`google_routes.Cell`、`google_routes.RoutesError`（Task 1）。
- Produces: `Settings.google_maps_server_key: str = ""`；`travel.matrix(points)` 的簽章與 `Matrix` 不變，設了金鑰時是 Google 的道路車程（`estimated=False`）；`travel.road(cell: google_routes.Cell) -> tuple[int, float]`（Google 的一格換成 (分鐘, 公里)，加停車時間）；`travel.fill(points, road_cells: dict[tuple[int, int], tuple[int, float]], google: bool) -> Matrix`（Google 給的格子之外用估算補）。

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_travel.py` 開頭的 import 改成：

```python
"""車程：直線估算，以及設了金鑰時改問 Google（假的，不連網路）。"""

import pytest

from app.services import google_routes, travel
```

檔案最後加：

```python
POINTS = [(25.0, 121.5), (25.1, 121.5), (25.0, 121.6)]


def fake_matrix(calls, skip=()):
    """假的 Google 路線矩陣：第 i 點到第 j 點開 (i + j) × 10 分鐘、(i + j) 公里；skip 裡的格子當作開不到。"""

    def route_matrix(key, origins, destinations, http=None):
        calls.append((key, origins, destinations))
        return {
            (i, j): google_routes.Cell(seconds=600 * (i + j), meters=1000 * (i + j))
            for i in range(len(origins)) for j in range(len(destinations))
            if i != j and (i, j) not in skip
        }

    return route_matrix


@pytest.fixture
def google(monkeypatch, env):
    """設一把假的伺服器金鑰，Google 換成假的；回傳每次問了什麼。"""
    env(GOOGLE_MAPS_SERVER_KEY="server-key")
    calls = []
    monkeypatch.setattr(google_routes, "route_matrix", fake_matrix(calls))
    return calls


def test_a_google_cell_becomes_minutes_plus_parking_and_kilometres():
    assert travel.road(google_routes.Cell(seconds=650, meters=4249)) == (16, 4.2)


def test_with_a_server_key_the_matrix_uses_google_road_times(google):
    result = travel.matrix(POINTS)
    assert result.estimated is False
    # 第 0 點到第 1 點：600 秒是 10 分鐘，再加 5 分鐘停車；1000 公尺是 1.0 公里
    assert result.minutes[0][1] == 15 and result.km[0][1] == 1.0
    assert result.minutes[1][2] == 35 and result.km[2][1] == 3.0
    assert [result.minutes[i][i] for i in range(3)] == [0, 0, 0]
    assert google == [("server-key", POINTS, POINTS)]


def test_without_a_key_google_is_never_asked(google, env):
    env(GOOGLE_MAPS_SERVER_KEY="")
    result = travel.matrix(POINTS)
    assert result.estimated is True and result.minutes[0][1] == 36
    assert google == []


def test_google_failing_or_timing_out_falls_back_to_the_estimate(monkeypatch, env):
    env(GOOGLE_MAPS_SERVER_KEY="server-key")

    def broken(*args, **kwargs):
        raise google_routes.RoutesError("逾時")

    monkeypatch.setattr(google_routes, "route_matrix", broken)
    result = travel.matrix(POINTS)
    assert result.estimated is True
    assert result.minutes[0][1] == 36 and result.km[0][1] == 15.6


def test_cells_google_cannot_route_use_the_estimate_and_mark_the_matrix(monkeypatch, env):
    env(GOOGLE_MAPS_SERVER_KEY="server-key")
    monkeypatch.setattr(google_routes, "route_matrix", fake_matrix([], skip={(0, 2)}))
    result = travel.matrix(POINTS)
    assert result.estimated is True
    assert result.minutes[0][2] == travel.estimate(POINTS[0], POINTS[2])[0]
    assert result.minutes[0][1] == 15


def test_a_single_point_needs_no_google(google):
    result = travel.matrix([POINTS[0]])
    assert result.minutes == [[0]] and result.km == [[0.0]] and result.estimated is False
    assert google == []
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `TEST_DB_NAME=meddemo_test_maps TEST_REDIS_URL=redis://127.0.0.1:6379/7 uv run --project backend pytest backend/tests/test_travel.py -q`
Expected: FAIL（`travel` 沒有 `road`；設了金鑰 `estimated` 還是 `True`）

- [ ] **Step 3: 設定與清空**

`backend/app/config.py`，在 `cohere_api_key: str = ""` 後面加：

```python

    # Google Routes API：行程的道路車程與主管頁的沿路路線。留空就用直線估算，畫面註明「估計」。
    # 只在後端用；在 Google Cloud 限制只開 Routes API（docs/superpowers/plans/2026-10-01-itinerary-stage4.md）
    google_maps_server_key: str = ""
```

`backend/tests/conftest.py` 清空金鑰的那一串（`"COHERE_API_KEY",` 後面）加：

```python
    "GOOGLE_MAPS_SERVER_KEY",
```

上面那段註解「供應商設定強制清空：就算 backend/.env 放了金鑰，跑測試也不會真的呼叫外部服務、花到錢。」不用改，Google 地圖一樣適用。

- [ ] **Step 4: 實作**

`backend/app/services/travel.py`：

1. 模組說明的第二段換成：
   ```python
   """兩點之間開車要多久（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈車程與地圖〉）。

   設了 GOOGLE_MAPS_SERVER_KEY 就問 Google Routes API 的道路車程（services/google_routes.py，不看即時路況）；
   沒設、Google 回錯或逾時（5 秒）就用直線估算，Matrix.estimated 是 True，畫面註明「估計」。開發與測試一律走估算。
   """
   ```
2. import 改成：
   ```python
   import logging
   import math
   from dataclasses import dataclass

   from app.config import settings
   from app.services import google_routes

   log = logging.getLogger(__name__)
   ```
3. `matrix` 整個換成下面這幾個函式（`straight_km`、`estimate` 不動）：

```python
def matrix(points: list[Point]) -> Matrix:
    """每兩點之間開車要多久。設了伺服器金鑰就問 Google；沒設或 Google 失敗就整份用直線估算。"""
    key = settings().google_maps_server_key
    if not key:
        return fill(points, {}, google=False)
    if len(points) < 2:
        return fill(points, {}, google=True)
    try:
        cells = google_routes.route_matrix(key, points, points)
    except google_routes.RoutesError:
        log.warning("Google 路線矩陣沒有拿到，改用直線估算", exc_info=True)
        return fill(points, {}, google=False)
    return fill(points, {index: road(cell) for index, cell in cells.items()}, google=True)


def road(cell: google_routes.Cell) -> tuple[int, float]:
    """Google 的一格換成 (分鐘, 公里)。Google 只算開車，跟估算一樣再加找車位的時間。"""
    return round(cell.seconds / 60) + PARKING_MINUTES, round(cell.meters / 1000, 1)


def fill(points: list[Point], road_cells: dict[tuple[int, int], tuple[int, float]], google: bool) -> Matrix:
    """組成矩陣：同一點是 0；Google 給了的格子用 Google 的，其他用估算。
    只要有一格是估算的（沒問 Google，或 Google 開不到那一格），整份就標成估計。"""
    estimated = not google
    minutes: list[list[int]] = []
    km: list[list[float]] = []
    for i, a in enumerate(points):
        row_minutes, row_km = [], []
        for j, b in enumerate(points):
            if a == b:
                cell = (0, 0.0)
            elif (i, j) in road_cells:
                cell = road_cells[(i, j)]
            else:
                cell = estimate(a, b)
                estimated = True
            row_minutes.append(cell[0])
            row_km.append(cell[1])
        minutes.append(row_minutes)
        km.append(row_km)
    return Matrix(minutes=minutes, km=km, estimated=estimated)
```

`Matrix` 的 `estimated` 註解改成 `# 有任何一格是直線估算的就是 True，畫面要註明「估計」`。

- [ ] **Step 5: 跑測試確認通過**

Run: `TEST_DB_NAME=meddemo_test_maps TEST_REDIS_URL=redis://127.0.0.1:6379/7 uv run --project backend pytest backend/tests/test_travel.py backend/tests/test_itinerary.py backend/tests/test_itinerary_api.py -q`
Expected: 全部通過（沒有金鑰時行程照舊是估算，`estimated` 還是 `True`）

- [ ] **Step 6: Commit**

```bash
git add backend/app/config.py backend/tests/conftest.py backend/app/services/travel.py backend/tests/test_travel.py
git commit -m "Use Google road times for the itinerary when a server key is set, and fall back to the estimate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 3: 地圖金鑰的設定與部署

**Files:**
- Modify: `backend/app/config.py`（`google_maps_server_key` 那一行後面）
- Modify: `backend/tests/conftest.py`（清空金鑰的那一串）
- Create: `backend/app/api/maps.py`
- Modify: `backend/app/main.py`（另起一行 import 與 include_router，放在最後一個 `app.include_router(...)` 後面）
- Create: `backend/tests/test_maps_api.py`
- Modify: `backend/.env.example`（最後）
- Modify: `.github/workflows/ci-cd.yml`（開頭的註解、「更新密鑰並用 Helm 部署」那一步）
- Modify: `deploy/helm/meddemo/values.yaml`（`config` 最後、`secrets.ai` 的註解）
- Modify: `README.md`（〈金鑰與供應商〉的表格最後一列後面、部署表格 `COHERE_API_KEY` 那一列後面、〈今日路線〉「客戶沒有真的地址」那一點）

**Interfaces:**
- Consumes: `settings().google_maps_server_key`（Task 2）。
- Produces: `Settings.google_maps_browser_key: str = ""`、`Settings.google_maps_map_id: str = ""`；`GET /api/maps/config` → `{"browser_key": str, "map_id": str}` 或 `null`；`api.maps.DEMO_MAP_ID = "DEMO_MAP_ID"`。第 5 階段的主管頁用這支拿金鑰。

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_maps_api.py`：

```python
"""主管頁的地圖金鑰：有設才給、只給主管端，不寫進前端的建置。"""

from fastapi.testclient import TestClient

from app.main import app


def config(auth, user_id="M01"):
    return TestClient(app).get("/api/maps/config", headers=auth(user_id))


def test_no_browser_key_means_no_map(auth):
    response = config(auth)
    assert response.status_code == 200 and response.json() is None


def test_the_browser_key_and_map_id_come_from_settings(auth, env):
    env(GOOGLE_MAPS_BROWSER_KEY="browser-key", GOOGLE_MAPS_MAP_ID="map-1")
    assert config(auth).json() == {"browser_key": "browser-key", "map_id": "map-1"}


def test_without_a_map_id_the_map_uses_googles_demo_id(auth, env):
    env(GOOGLE_MAPS_BROWSER_KEY="browser-key")
    assert config(auth, "A01").json() == {"browser_key": "browser-key", "map_id": "DEMO_MAP_ID"}


def test_only_the_manager_side_gets_it(auth, env):
    env(GOOGLE_MAPS_BROWSER_KEY="browser-key")
    denied = config(auth, "U01")
    assert denied.status_code == 403 and denied.json()["detail"] == "這個頁面只有主管看得到"
    assert TestClient(app).get("/api/maps/config").status_code == 401
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `TEST_DB_NAME=meddemo_test_maps TEST_REDIS_URL=redis://127.0.0.1:6379/7 uv run --project backend pytest backend/tests/test_maps_api.py -q`
Expected: FAIL（404，還沒有這支 API）

- [ ] **Step 3: 設定與清空**

`backend/app/config.py`，在 Task 2 加的 `google_maps_server_key: str = ""` 那一行後面加：

```python
    # 主管頁的地圖（Maps JavaScript API）。會出現在網頁上，安全靠 Google Cloud 的限制：只開 Maps JavaScript API、
    # 只認我們的網域。不寫進前端的建置，由 GET /api/maps/config 給，換金鑰不必重建映像檔
    google_maps_browser_key: str = ""
    # 地圖上的頭像與編號圓點用進階標記，要一個 Map ID；留空就用 Google 給測試用的 DEMO_MAP_ID
    google_maps_map_id: str = ""
```

`backend/tests/conftest.py` 清空的那一串（Task 2 已經加了 `"GOOGLE_MAPS_SERVER_KEY"`）後面再加兩個：

```python
    "GOOGLE_MAPS_BROWSER_KEY",
    "GOOGLE_MAPS_MAP_ID",
```

- [ ] **Step 4: API**

`backend/app/api/maps.py`：

```python
"""主管頁的 Google 地圖要的設定（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈地圖〉）。

瀏覽器用的金鑰不寫進前端的建置：換金鑰不必重建映像檔，沒設金鑰的環境（開發、測試）地圖區塊就換成
「地圖暫時載入不了」，下面的清單照常。只有主管頁畫地圖，所以只給主管與 IT。
"""

from fastapi import APIRouter
from pydantic import BaseModel

from app.api.auth import ManagerUser
from app.config import settings

router = APIRouter(prefix="/api/maps", tags=["maps"])

# Google 給測試用的 Map ID：沒在 Cloud Console 建自己的 Map ID 時用它，進階標記照樣畫得出來
DEMO_MAP_ID = "DEMO_MAP_ID"


class MapsConfig(BaseModel):
    browser_key: str
    map_id: str


@router.get("/config", response_model=MapsConfig | None)
def get_config(_: ManagerUser) -> MapsConfig | None:
    """沒設瀏覽器金鑰回 null，畫面就不載入 Google 地圖。"""
    config = settings()
    if not config.google_maps_browser_key:
        return None
    return MapsConfig(browser_key=config.google_maps_browser_key, map_id=config.google_maps_map_id or DEMO_MAP_ID)
```

`backend/app/main.py`：原本那一長行 `from app.api import ...` **不要動**（Track A 也會改它，同一行兩邊都改一定衝突），在它下面另起一行：

```python
from app.api import maps  # 行程第 4 階段：主管頁的地圖金鑰
```

最後一個 `app.include_router(avatars.router)` 後面加：

```python
app.include_router(maps.router)
```

- [ ] **Step 5: 跑測試確認通過**

Run: `TEST_DB_NAME=meddemo_test_maps TEST_REDIS_URL=redis://127.0.0.1:6379/7 uv run --project backend pytest backend/tests/test_maps_api.py -q`
Expected: 4 passed

- [ ] **Step 6: 本機範例、部署流程、Helm**

`backend/.env.example` 最後加：

```bash

# Google 地圖（行程的道路車程與主管頁的地圖）。都沒填也能用：車程改用直線估算、畫面註明「估計」，主管頁的地圖換成一行說明。
# GOOGLE_MAPS_SERVER_KEY：後端呼叫 Routes API，在 Google Cloud 只開 Routes API，應用程式限制填伺服器的對外 IP。
# GOOGLE_MAPS_BROWSER_KEY：主管頁畫地圖，只開 Maps JavaScript API，網站限制填網站網址（本機加 http://localhost:5173/*）。
# GOOGLE_MAPS_MAP_ID：留空就用 Google 給測試用的 DEMO_MAP_ID
GOOGLE_MAPS_SERVER_KEY=
GOOGLE_MAPS_BROWSER_KEY=
GOOGLE_MAPS_MAP_ID=
```

`.github/workflows/ci-cd.yml`：

1. 開頭第 4 行的「選填：」那一串最後加 `、GOOGLE_MAPS_SERVER_KEY、GOOGLE_MAPS_BROWSER_KEY`。
2. 「更新密鑰並用 Helm 部署」的 `env:` 在 `COHERE_API_KEY: ${{ secrets.COHERE_API_KEY }}` 下面加：
   ```yaml
          GOOGLE_MAPS_SERVER_KEY: ${{ secrets.GOOGLE_MAPS_SERVER_KEY }}
          GOOGLE_MAPS_BROWSER_KEY: ${{ secrets.GOOGLE_MAPS_BROWSER_KEY }}
   ```
3. 同一步建 `meddemo-ai` 的那一串，在 `--from-literal=FIRECRAWL_API_KEY=... --from-literal=COHERE_API_KEY="$COHERE_API_KEY" \` 下面加一行：
   ```yaml
            --from-literal=GOOGLE_MAPS_SERVER_KEY="$GOOGLE_MAPS_SERVER_KEY" --from-literal=GOOGLE_MAPS_BROWSER_KEY="$GOOGLE_MAPS_BROWSER_KEY" \
   ```
   上面那段註解「語音辨識、AI 模型、embedding、語音問答的金鑰」改成「語音辨識、AI 模型、embedding、語音問答、Google 地圖的金鑰」。

`deploy/helm/meddemo/values.yaml`：

1. `config:` 最後（`VOICE_MODEL` 那一行後面）加：
   ```yaml
     # 主管頁地圖的 Map ID（Google Cloud Console → Map Management 建一個 JavaScript 的）。留空＝Google 給測試用的 DEMO_MAP_ID
     GOOGLE_MAPS_MAP_ID: ""
   ```
2. `secrets.ai` 上面那行註解改成 `# ASR_API_KEY、LLM_API_KEY、EMBEDDING_API_KEY、VOICE_API_KEY、GOOGLE_MAPS_SERVER_KEY、GOOGLE_MAPS_BROWSER_KEY；還沒建時照樣啟動，沒有金鑰的功能改走手動輸入或估算`。

- [ ] **Step 7: README**

1. 〈金鑰與供應商〉的表格，`| 精排 | ... |` 那一列後面加：
   ```markdown
   | 道路車程、主管頁的地圖 | `GOOGLE_MAPS_SERVER_KEY`（Routes API）、`GOOGLE_MAPS_BROWSER_KEY`（Maps JavaScript API），見下方部署的表格 | — |
   ```
   表格下面「沒設定也能用」那一段最後加一句：「沒設 Google 地圖的金鑰時，車程用直線估算並標明『估計』，主管頁的地圖換成一行說明。」
2. 部署表格 `| \`COHERE_API_KEY\` | ...` 那一列後面加：
   ```markdown
   | `GOOGLE_MAPS_SERVER_KEY` | secret | 選填：行程的道路車程（Google Routes API）。Google Cloud 專案要開帳單；API 限制只開 Routes API，應用程式限制填 VM 的對外 IP。沒填就用直線估算。 |
   | `GOOGLE_MAPS_BROWSER_KEY` | secret | 選填：主管頁的地圖（Maps JavaScript API）。API 限制只開 Maps JavaScript API，網站限制填 `https://網址/*`。沒填主管頁就不畫地圖、只列清單。 |
   ```
3. 〈今日路線〉「客戶沒有真的地址」那一點的「車程用直線距離 × 1.4 ÷ 時速 30 公里再加 5 分鐘停車估算」改成「車程設了 Google 金鑰就用 Google Routes API 的道路車程（不看即時路況，再加 5 分鐘停車），沒設、Google 回錯或 5 秒沒回應就用直線距離 × 1.4 ÷ 時速 30 公里再加 5 分鐘停車估算」。只改這半句，同一點的其他字不動。

- [ ] **Step 8: 全部後端測試**

Run: `TEST_DB_NAME=meddemo_test_maps TEST_REDIS_URL=redis://127.0.0.1:6379/7 uv run --project backend pytest backend/tests -q`
Expected: 全部通過（原本 1008 加上這一階段新增的）

- [ ] **Step 9: Commit**

```bash
git add backend/app/config.py backend/tests/conftest.py backend/app/api/maps.py backend/app/main.py \
  backend/tests/test_maps_api.py backend/.env.example .github/workflows/ci-cd.yml deploy/helm/meddemo/values.yaml README.md
git commit -m "Hand the manager page its Google Maps browser key and put both Maps keys in the deployment secret

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 讀行程只問相鄰兩站的道路車程

**Files:**
- Modify: `backend/app/services/travel.py`（`matrix` 後面加 `along`）
- Modify: `backend/app/services/itinerary.py:112`（`view` 裡那一行 `travel.matrix(` 換成 `travel.along(`，只改這個字）
- Test: `backend/tests/test_travel.py`、`backend/tests/test_itinerary.py`

**Interfaces:**
- Consumes: `google_routes.route_legs`、`google_routes.Leg`、`google_routes.Cell`、`google_routes.RoutesError`（Task 1）；`travel.fill`、`travel.road`（Task 2）。
- Produces: `travel.along(points: list[Point]) -> Matrix`：只有相鄰兩點（`minutes[i][i + 1]`、`km[i][i + 1]`）是 Google 的道路車程，其他格子是估算；只能拿去照同一個順序算時間（`route_planner.schedule`），不能拿去排順序。`estimated` 只看相鄰那幾格。第 2 階段（Track A）的 preview 也要用它。

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_travel.py` 最後加：

```python
def fake_legs(calls):
    """假的 Google 路線：第 n 段開 (n + 1) × 10 分鐘、(n + 1) 公里。"""

    def route_legs(key, points, http=None):
        calls.append((key, points))
        return [
            google_routes.Leg(seconds=600 * (n + 1), meters=1000 * (n + 1), polyline="")
            for n in range(len(points) - 1)
        ]

    return route_legs


def no_matrix(*args, **kwargs):
    raise AssertionError("照順序算時間不該問整份矩陣（按格計價）")


def test_along_asks_google_only_for_the_legs_in_order(monkeypatch, env):
    env(GOOGLE_MAPS_SERVER_KEY="server-key")
    calls = []
    monkeypatch.setattr(google_routes, "route_legs", fake_legs(calls))
    monkeypatch.setattr(google_routes, "route_matrix", no_matrix)
    result = travel.along(POINTS)
    assert result.estimated is False
    # 第 1 段 600 秒：10 分鐘加 5 分鐘停車；第 2 段 1200 秒：20 分鐘加 5 分鐘
    assert result.minutes[0][1] == 15 and result.minutes[1][2] == 25
    assert result.km[0][1] == 1.0 and result.km[1][2] == 2.0
    # 不相鄰的格子是估算的：這份只能照同一個順序算時間，不能拿去排順序
    assert result.minutes[0][2] == travel.estimate(POINTS[0], POINTS[2])[0]
    assert calls == [("server-key", POINTS)]


def test_along_without_a_key_or_when_google_fails_is_the_estimate(monkeypatch, env):
    assert travel.along(POINTS).estimated is True
    env(GOOGLE_MAPS_SERVER_KEY="server-key")

    def broken(*args, **kwargs):
        raise google_routes.RoutesError("逾時")

    monkeypatch.setattr(google_routes, "route_legs", broken)
    result = travel.along(POINTS)
    assert result.estimated is True and result.minutes[0][1] == 36


def test_along_a_single_point_needs_no_google(monkeypatch, env):
    env(GOOGLE_MAPS_SERVER_KEY="server-key")
    calls = []
    monkeypatch.setattr(google_routes, "route_legs", fake_legs(calls))
    result = travel.along([POINTS[0]])
    assert result.minutes == [[0]] and result.estimated is False
    assert calls == []
```

`backend/tests/test_itinerary.py`：import 那一行 `from app.services import route_planner, today_route, travel` 改成 `from app.services import google_routes, route_planner, today_route, travel`，檔案最後加：

```python
def test_reading_the_itinerary_asks_google_for_the_legs_in_order_not_the_whole_matrix(tx, monkeypatch, env):
    # 先在沒有金鑰時建好（建的時候要排順序，會問整份矩陣），再設金鑰讀
    itinerary = service.get_or_create(tx, "U01")
    env(GOOGLE_MAPS_SERVER_KEY="server-key")
    asked = []

    def route_legs(key, points, http=None):
        asked.append(points)
        return [google_routes.Leg(seconds=600, meters=3000, polyline="") for _ in points[1:]]

    def no_matrix(*args, **kwargs):
        raise AssertionError("讀行程不該問整份矩陣")

    monkeypatch.setattr(google_routes, "route_legs", route_legs)
    monkeypatch.setattr(google_routes, "route_matrix", no_matrix)
    view = service.view(tx, itinerary)
    assert view.estimated is False
    # 一次問完：辦公室加每一站，照存著的順序
    assert len(asked) == 1 and len(asked[0]) == len(view.stops) + 1
    # 每段 10 分鐘加 5 分鐘停車、3 公里
    assert all(s.travel_minutes == 15 and s.travel_km == 3.0 for s in view.stops)
    assert view.travel_km == 3.0 * len(view.stops)
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `TEST_DB_NAME=meddemo_test_maps TEST_REDIS_URL=redis://127.0.0.1:6379/7 uv run --project backend pytest backend/tests/test_travel.py backend/tests/test_itinerary.py -q`
Expected: FAIL（`travel` 沒有 `along`；讀行程時問了整份矩陣）

- [ ] **Step 3: 實作**

`backend/app/services/travel.py`：import 區加 `import dataclasses`（照字母順序放在 `import logging` 前面）。模組說明最後加一段：

```python
"""...（前面不動）

車程的分鐘數與公里數不快取：Google 的條款只允許快取經緯度（docs/superpowers/plans/2026-10-01-itinerary-stage4.md）。
所以分兩種問法：要排順序才問整份矩陣（matrix，按格計價）；照存著的順序算時間只要相鄰兩站（along，
computeRoutes 按請求計價，一次拿到全部路段），讀行程、主管頁、調整清單的試算都走這條。
"""
```

`matrix` 後面加：

```python
def along(points: list[Point]) -> Matrix:
    """照這個順序開過去，相鄰兩點（points[i] → points[i + 1]）的車程。設了伺服器金鑰就用 Google 的
    computeRoutes 一次問完；其他格子用直線估算補上，所以這份只能照同一個順序算時間（route_planner.schedule），
    不能拿去排順序。沒設金鑰或 Google 失敗就整份用估算。"""
    key = settings().google_maps_server_key
    if not key:
        return fill(points, {}, google=False)
    if len(points) < 2:
        return fill(points, {}, google=True)
    try:
        legs = google_routes.route_legs(key, points)
    except google_routes.RoutesError:
        log.warning("Google 路線沒有拿到，改用直線估算", exc_info=True)
        return fill(points, {}, google=False)
    cells = {(n, n + 1): road(google_routes.Cell(leg.seconds, leg.meters)) for n, leg in enumerate(legs)}
    # 不相鄰的格子本來就是估算的、也用不到；相鄰的每一段都是 Google 給的，所以不算估計
    return dataclasses.replace(fill(points, cells, google=True), estimated=False)
```

`backend/app/services/itinerary.py`，`view` 裡：

```python
    matrix = travel.matrix([origin or (points[0] if points else (0.0, 0.0)), *points])
```

改成（只換 `matrix` 這個字，這一行其他不動）：

```python
    matrix = travel.along([origin or (points[0] if points else (0.0, 0.0)), *points])
```

`_create` 與 `_cheapest_index` 裡的 `travel.matrix` 不改：那兩處要排順序，需要整份矩陣。

- [ ] **Step 4: 跑測試確認通過**

Run: `TEST_DB_NAME=meddemo_test_maps TEST_REDIS_URL=redis://127.0.0.1:6379/7 uv run --project backend pytest backend/tests -q`
Expected: 全部通過

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/travel.py backend/app/services/itinerary.py backend/tests/test_travel.py backend/tests/test_itinerary.py
git commit -m "Read the itinerary with one Google route request for its legs instead of a full matrix, and cache no driving times

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
