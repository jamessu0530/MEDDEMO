"""華語／台語自動辨識：比較整句、來源失敗、長錄音與並行等待。"""

import threading

import pytest

from app.config import NotConfigured
from app.services import speech_audio, transcription
from app.services.auto_transcription import AutoTranscriber, choose_transcript
from app.services.transcription import Transcript


@pytest.mark.parametrize(("mandarin", "taiwanese", "chosen"), [
    ("我忘記早上有沒有吃藥。", "我忘記早上有無食藥。", "mandarin"),
    ("我頭暈想吐，要叫救護車嗎？", "我頭暈想吐，要叫救護車嗎", "mandarin"),
    ("百盟金卡沒塞開時間", "後禮拜的門診敢會使改時間？", "taiwanese"),
    ("今天去公園拍照。", "今仔日去藥局，毋愛十盒，欲二十盒。", "taiwanese"),
    (None, "今仔日欲閣訂魚油二十盒。", "taiwanese"),
    ("今天要補貨。", None, "mandarin"),
    (None, "野野，離近仔日，鐵藥了無有", None),
    (None, None, None),
])
def test_care_comparison_does_not_use_taiwanese_words_alone(mandarin, taiwanese, chosen):
    candidates = {"mandarin": Transcript(mandarin) if mandarin else None, "taiwanese": Transcript(taiwanese) if taiwanese else None}
    selected = choose_transcript(candidates["mandarin"], candidates["taiwanese"])
    assert selected is (candidates[chosen] if chosen else None)


def test_repeated_words_in_long_visit_notes_are_not_discarded_as_junk():
    mandarin = Transcript("今天店長需要魚油二十盒。" * 40)
    taiwanese = Transcript("今天店長是需要魚油二十盒。" * 40)
    assert choose_transcript(mandarin, taiwanese) is mandarin


class Recognizer:
    def __init__(self, text=None, error=None, barrier=None):
        self.text, self.error, self.barrier = text, error, barrier
        self.called = False

    def transcribe(self, audio, mime_type, hotwords):
        self.called = True
        assert audio.startswith(b"RIFF") and mime_type == "audio/wav"
        if self.barrier:
            self.barrier.wait(timeout=3)
        if self.error:
            raise self.error
        return Transcript(self.text or "")


def recording(seconds=0.1):
    return speech_audio.as_wav(b"\0\0" * int(speech_audio.SAMPLE_RATE * seconds))


def test_two_ai_sources_listen_in_parallel_and_preserve_taiwanese_original():
    barrier = threading.Barrier(2)
    mandarin = Recognizer("今天去公園拍照。", barrier=barrier)
    taiwanese = Recognizer("今仔日去藥局，毋愛十盒，欲二十盒。", barrier=barrier)
    result = AutoTranscriber(mandarin, taiwanese).transcribe(recording(), "audio/wav", ["魚油"])
    assert result.text == taiwanese.text and result.review_note is None
    assert result.duration_seconds == pytest.approx(0.1)
    assert mandarin.called and taiwanese.called


def test_taiwanese_outage_keeps_mandarin_text_and_discloses_missing_comparison():
    result = AutoTranscriber(Recognizer("今天要補貨。"), Recognizer(error=RuntimeError("busy"))).transcribe(recording(), "audio/wav", [])
    assert result.text == "今天要補貨。"
    assert "台語辨識暫時無法使用" in result.review_note


def test_mandarin_outage_keeps_recognizable_taiwanese_with_review_notice():
    result = AutoTranscriber(None, Recognizer("今仔日欲閣訂魚油二十盒。")).transcribe(recording(), "audio/wav", [])
    assert result.text == "今仔日欲閣訂魚油二十盒。"
    assert "華語辨識暫時無法使用" in result.review_note


def test_only_unrecognizable_taiwanese_output_does_not_create_a_wrong_visit():
    with pytest.raises(RuntimeError, match="無法確認錄音內容"):
        AutoTranscriber(None, Recognizer("野野，離近仔日，鐵藥了無有")).transcribe(recording(), "audio/wav", [])


def test_three_minute_limit_is_checked_before_either_service_is_called():
    mandarin, taiwanese = Recognizer("今天補貨"), Recognizer("今仔日補貨")
    with pytest.raises(ValueError, match="錄音每段最多三分鐘"):
        AutoTranscriber(mandarin, taiwanese).transcribe(recording(182), "audio/wav", [])
    assert not mandarin.called and not taiwanese.called


def test_auto_factory_requires_at_least_one_configured_recognizer(monkeypatch):
    def missing():
        raise NotConfigured("missing")
    monkeypatch.setattr(transcription, "get_transcriber", missing)
    monkeypatch.setattr(transcription, "get_taiwanese_transcriber", missing)
    with pytest.raises(NotConfigured, match="手動輸入逐字稿"):
        transcription.get_auto_transcriber()
