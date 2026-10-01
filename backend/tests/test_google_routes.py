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
