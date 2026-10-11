"""台語錄音的實際轉檔、切段、錯誤處理與供應商選擇；廠商 API 用 HTTP 替身。"""

import array
import io
import math
import wave
from types import SimpleNamespace

import av
import httpx
import pytest

from app.config import NotConfigured
from app.services import speech_audio, taigi_transcription, transcription
from app.services.taigi_transcription import TaigiTranscriber


@pytest.fixture(autouse=True)
def no_rate_limit_wait(monkeypatch):
    monkeypatch.setattr(taigi_transcription, "MIN_REQUEST_INTERVAL_SECONDS", 0)


def pcm(seconds, rate=16_000, channels=1):
    samples = array.array("h", (int(3000 * math.sin(2 * math.pi * 440 * i / rate)) for i in range(int(seconds * rate))))
    if channels == 2:
        samples = array.array("h", (value for sample in samples for value in (sample, sample)))
    return samples.tobytes()


def wav_audio(seconds=0.5, rate=16_000, channels=1):
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(pcm(seconds, rate, channels))
    return output.getvalue()


def taigi(handler):
    return TaigiTranscriber(" test-key ", "https://taigi.test/", httpx.Client(transport=httpx.MockTransport(handler)))


def test_audio_is_sent_as_mono_16khz_wav_and_the_taiwanese_original_is_kept():
    sent = []

    def handler(request):
        sent.append(request)
        return httpx.Response(200, json={"best": " 店長講欲閣訂魚油兩口，拜五送到。 "})

    result = taigi(handler).transcribe(wav_audio(rate=48_000, channels=2), "audio/wav", ["魚油"])
    assert result.text == "店長講欲閣訂魚油兩口，拜五送到。"
    assert result.duration_seconds == pytest.approx(0.5)
    request = sent[0]
    assert str(request.url) == "https://taigi.test/taigiSTT/stt_best_billing"
    assert request.headers["x-api-key"] == "test-key"
    assert b'name="voiceFile"' in request.content and b'filename="audio.wav"' in request.content
    start = request.content.index(b"RIFF")
    with wave.open(io.BytesIO(request.content[start:]), "rb") as wav:
        assert (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) == (1, 2, 16_000)
        assert wav.getnframes() == 8_000


@pytest.mark.parametrize("format,codec", [("webm", "libopus"), ("mp4", "aac")])
def test_browser_webm_and_iphone_m4a_are_decoded(format, codec):
    output = io.BytesIO()
    with av.open(output, "w", format=format) as container:
        stream = container.add_stream(codec, rate=48_000)
        stream.layout = "stereo"
        frame = av.AudioFrame(format="s16", layout="stereo", samples=24_000)
        frame.sample_rate = 48_000
        frame.planes[0].update(pcm(0.5, 48_000, 2))
        for packet in stream.encode(frame):
            container.mux(packet)
        for packet in stream.encode(None):
            container.mux(packet)
    decoded = speech_audio.decode_recording(output.getvalue())
    # AAC 有編碼器 padding；兩種格式都要能解碼並轉成台語 STT 的取樣率。
    assert 0.45 <= len(decoded) / 32_000 <= 0.6
    assert any(decoded)


def test_long_audio_is_cut_at_a_pause_without_losing_samples():
    audio = pcm(20) + bytes(16_000) + pcm(35)
    chunks = speech_audio.split_on_pauses(audio)
    assert b"".join(chunks) == audio
    assert all(0 < len(chunk) <= 25 * 32_000 for chunk in chunks)
    assert 20 <= len(chunks[0]) / 32_000 <= 20.5


def test_recordings_over_three_minutes_are_rejected_before_api_calls():
    with pytest.raises(ValueError, match="三分鐘"):
        taigi(lambda request: pytest.fail("過長錄音不能送到 API")).transcribe(wav_audio(181.1), "audio/wav", [])


def test_auto_stop_and_encoder_padding_do_not_reject_a_three_minute_recording():
    assert len(speech_audio.decode_recording(wav_audio(180.2))) == len(pcm(180.2))


def test_multiple_chunks_stay_in_order_and_empty_silent_chunks_are_skipped():
    responses = iter([{"best": "魚油兩口。"}, {"best": None}, {"best": "拜五送到。"}])
    audio = speech_audio.as_wav(pcm(20) + bytes(16_000) + pcm(19.5) + bytes(16_000) + pcm(14.5))
    result = taigi(lambda request: httpx.Response(200, json=next(responses))).transcribe(audio, "audio/wav", [])
    assert result.text == "魚油兩口。拜五送到。"


def test_a_failed_chunk_does_not_return_a_partial_transcript():
    responses = iter([httpx.Response(200, json={"best": "魚油兩口。"}), httpx.Response(429)])
    with pytest.raises(RuntimeError, match="忙碌"):
        taigi(lambda request: next(responses)).transcribe(wav_audio(30), "audio/wav", [])


def test_temporary_server_error_is_retried_but_429_is_not(monkeypatch):
    monkeypatch.setattr(taigi_transcription.time, "sleep", lambda seconds: None)
    sent = []

    def handler(request):
        sent.append(request)
        return httpx.Response(503) if len(sent) == 1 else httpx.Response(200, json={"best": "魚油兩口。"})

    assert taigi(handler).transcribe(wav_audio(), "audio/wav", []).text == "魚油兩口。"
    assert len(sent) == 2
    sent.clear()

    def busy(request):
        sent.append(request)
        return httpx.Response(429, json={"error": "private-provider-response"})

    with pytest.raises(RuntimeError, match="忙碌") as error:
        taigi(busy).transcribe(wav_audio(), "audio/wav", [])
    assert len(sent) == 1
    assert "private-provider-response" not in str(error.value)


def test_chunking_and_server_retries_do_not_burst_requests(monkeypatch):
    clock = [0.0]
    sent_at = []

    def sleep(seconds):
        clock[0] += seconds

    monkeypatch.setattr(taigi_transcription, "time", SimpleNamespace(monotonic=lambda: clock[0], sleep=sleep))
    monkeypatch.setattr(taigi_transcription, "MIN_REQUEST_INTERVAL_SECONDS", 6)

    def handler(request):
        sent_at.append(clock[0])
        return httpx.Response(503) if len(sent_at) == 1 else httpx.Response(200, json={"best": "魚油兩口。"})

    audio = speech_audio.as_wav(pcm(20) + bytes(16_000) + pcm(19.5) + bytes(16_000) + pcm(14.5))
    assert taigi(handler).transcribe(audio, "audio/wav", []).text
    assert sent_at == [0, 6, 12, 18]


@pytest.mark.parametrize("payload", [{}, [], {"best": 42}, {"best": {"text": "魚油"}}])
def test_invalid_success_responses_are_not_used_as_transcripts(payload):
    with pytest.raises(RuntimeError, match="格式不符"):
        taigi(lambda request: httpx.Response(200, json=payload)).transcribe(wav_audio(), "audio/wav", [])


def test_non_json_response_and_silence_are_actionable_errors():
    with pytest.raises(RuntimeError, match="無法讀取"):
        taigi(lambda request: httpx.Response(200, text="not json")).transcribe(wav_audio(), "audio/wav", [])
    with pytest.raises(RuntimeError, match="沒有辨識到"):
        taigi(lambda request: httpx.Response(200, json={"best": None})).transcribe(wav_audio(), "audio/wav", [])


def test_network_failure_and_expired_budget_do_not_start_another_recognizer(monkeypatch):
    def offline(request):
        raise httpx.ConnectError("disconnected")

    with pytest.raises(RuntimeError, match="連不上"):
        taigi(offline).transcribe(wav_audio(), "audio/wav", [])
    monkeypatch.setattr(taigi_transcription, "TOTAL_BUDGET_SECONDS", 0)
    with pytest.raises(RuntimeError, match="等待過久"):
        taigi(lambda request: pytest.fail("預算已用完不能再送 API")).transcribe(wav_audio(), "audio/wav", [])


def test_taiwanese_uses_its_own_key_and_is_not_a_mandarin_fallback(env):
    env(TAIGI_API_KEY=" ", ASR_API_KEY="mandarin-key", ASR_PROVIDER="gemini")
    with pytest.raises(NotConfigured, match="台語"):
        transcription.get_taiwanese_transcriber()
    env(TAIGI_API_KEY="taiwanese-key", TAIGI_BASE_URL="https://taigi.test/")
    chosen = transcription.get_taiwanese_transcriber()
    assert isinstance(chosen, TaigiTranscriber)
    assert chosen.api_key == "taiwanese-key" and chosen.base_url == "https://taigi.test"
