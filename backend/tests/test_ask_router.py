"""問答自動分流：Jev 有把握就直接決定，沒把握或沒回答就請業務自己選。Jev 一律用假的。"""

import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import ask_router


def jev(choice: str, probabilities: dict[str, float], confidence: float, seen: list | None = None) -> httpx.Client:
    """回一個寫好答案的 Jev；seen 記下送出去的請求內容。"""

    def handle(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(json.loads(request.content))
        answer = {"choice": choice, "probabilities": probabilities, "confidence": confidence}
        return httpx.Response(200, json={"answers": {"source": answer}, "model": ask_router.JEV_MODEL})

    return httpx.Client(transport=httpx.MockTransport(handle))


def failing(error: Exception | None = None, status: int = 500) -> httpx.Client:
    def handle(request: httpx.Request) -> httpx.Response:
        if error:
            raise error
        return httpx.Response(status, json={"detail": "boom"})

    return httpx.Client(transport=httpx.MockTransport(handle))


@pytest.fixture(autouse=True)
def key(env):
    env(TYPESAFE_API_KEY="test-key")


def test_a_confident_answer_picks_the_kind():
    seen: list = []
    routed = ask_router.route("北區還有哪些待辦沒做完？", client=jev("memory", {"data": 0.0, "knowledge": 0.0, "memory": 1.0}, 1.0, seen))
    assert routed == ask_router.Routed(kind="memory", choices=[], confidence=1.0)
    sent = seen[0]
    assert sent["model"] == "jev-1.13.0" and sent["state"] == {"question": "北區還有哪些待辦沒做完？"}
    assert list(sent["questions"]["source"]["criteria"]) == ["data", "knowledge", "memory"]


def test_an_unsure_answer_offers_the_two_likeliest():
    client = jev("data", {"data": 0.50, "knowledge": 0.06, "memory": 0.44}, 0.25)
    routed = ask_router.route("康泰忠孝店最近怎麼樣？", client=client)
    assert routed == ask_router.Routed(kind=None, choices=["data", "memory"], confidence=0.25)


def test_the_threshold_is_inclusive():
    client = jev("knowledge", {"data": 0.1, "knowledge": 0.8, "memory": 0.1}, ask_router.CONFIDENT)
    assert ask_router.route("缺貨多久補得到？", client=client).kind == "knowledge"


def test_an_attached_file_is_mentioned_in_the_state():
    seen: list = []
    ask_router.route("這個賣得怎樣？", has_file=True, client=jev("data", {"data": 1.0, "knowledge": 0.0, "memory": 0.0}, 1.0, seen))
    assert seen[0]["state"]["question"] == "這個賣得怎樣？" and "photo or PDF" in seen[0]["state"]["attachment"]


@pytest.mark.parametrize(
    "client",
    [failing(status=500), failing(status=429), failing(httpx.ReadTimeout("slow")), failing(httpx.ConnectError("down"))],
)
def test_when_jev_does_not_answer_the_rep_picks_from_all_three(client):
    assert ask_router.route("北區為什麼掉？", client=client) == ask_router.Routed(
        kind=None, choices=["data", "knowledge", "memory"], confidence=None
    )


def test_a_malformed_answer_counts_as_no_answer():
    def handle(request):
        return httpx.Response(200, json={"answers": {}})

    client = httpx.Client(transport=httpx.MockTransport(handle))
    assert ask_router.route("北區為什麼掉？", client=client).choices == ["data", "knowledge", "memory"]


def test_without_a_key_jev_is_not_called(env):
    env(TYPESAFE_API_KEY="")
    seen: list = []
    routed = ask_router.route("北區為什麼掉？", client=jev("data", {"data": 1.0, "knowledge": 0.0, "memory": 0.0}, 1.0, seen))
    assert routed.kind is None and routed.choices == ["data", "knowledge", "memory"] and seen == []


def test_the_route_api(auth, monkeypatch):
    calls = []

    def fake(question, has_file=False):
        calls.append((question, has_file))
        return ask_router.Routed(kind=None, choices=["data", "memory"], confidence=0.3)

    monkeypatch.setattr(ask_router, "route", fake)
    client = TestClient(app)
    response = client.post("/api/asks/route", json={"question": "  康泰最近怎樣？ ", "has_file": True}, headers=auth())
    assert response.status_code == 200
    assert response.json() == {"kind": None, "choices": ["data", "memory"], "confidence": 0.3}
    assert calls == [("康泰最近怎樣？", True)]
    assert client.post("/api/asks/route", json={"question": "康泰最近怎樣？"}).status_code == 401
    assert client.post("/api/asks/route", json={"question": ""}, headers=auth()).status_code == 422
