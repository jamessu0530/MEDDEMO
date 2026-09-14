"""第二週出場條件：十句測試語料的語音辨識字錯率與五個欄位的抽取正確率。

    uv run --project backend python backend/scripts/eval_voice.py

有錄音（data/eval/audio/<id>.*）就先轉文字再抽欄位；沒有錄音就直接拿語料原文抽欄位，只評抽取。
會真的呼叫設定好的語音辨識與 AI 模型，費用照用量計。
"""

import json
import re
import sys
from datetime import date
from pathlib import Path

# macOS 上 .venv 會被標成隱藏，Python 就略過可編輯安裝的 .pth、找不到 app；直接把 backend 加進搜尋路徑
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import NotConfigured  # noqa: E402
from app.db import session_factory
from app.services.extraction import FIELD_KEYS, get_extractor, product_hints
from app.services.transcription import get_transcriber, load_hotwords

ROOT = Path(__file__).resolve().parents[2]
CORPUS = ROOT / "data" / "eval" / "voice_corpus.json"
AUDIO_DIR = ROOT / "data" / "eval" / "audio"
MIME = {".m4a": "audio/mp4", ".wav": "audio/wav", ".webm": "audio/webm", ".mp3": "audio/mpeg"}
PUNCTUATION = re.compile(r"[\s，。、,.!?！？：:；;「」（）()]")


def edit_distance(a: str, b: str) -> int:
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        current = [i]
        for j, cb in enumerate(b, start=1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ca != cb)))
        previous = current
    return previous[-1]


def char_error_rate(reference: str, hypothesis: str) -> float:
    ref, hyp = PUNCTUATION.sub("", reference), PUNCTUATION.sub("", hypothesis)
    return edit_distance(ref, hyp) / max(len(ref), 1)


def is_correct(field: str, expected, actual) -> bool:
    """標準答案沒提到的欄位，系統也必須留白；有提到的比關鍵資訊，不比措辭。"""
    if expected is None or actual is None:
        return expected is None and actual is None
    if field == "competitor":
        return sorted(expected) == sorted(c["name"] for c in actual)
    if field == "intent":
        return sorted(map(tuple, expected)) == sorted((i.get("sku"), i.get("qty")) for i in actual)
    if field == "complaint":
        return expected in actual
    if field == "commitment":
        return actual["by"] == expected["by"] and actual["due"] == expected["due"] and expected["keyword"] in actual["text"]
    return expected == actual  # follow_up_date


def main() -> int:
    items = json.loads(CORPUS.read_text(encoding="utf-8"))["items"]
    visit_date = date(2026, 10, 20)
    try:
        extractor = get_extractor()
    except NotConfigured as exc:
        print(f"沒辦法評測：{exc}。請先在 backend/.env 設定 LLM_PROVIDER 與 LLM_API_KEY。")
        return 1

    with session_factory()() as session:
        products, hotwords = product_hints(session), load_hotwords(session)

    correct = dict.fromkeys(FIELD_KEYS, 0)
    rates: list[float] = []
    for item in items:
        audio = next(AUDIO_DIR.glob(f"{item['id']}.*"), None)
        transcript = item["text"]
        if audio is not None:
            transcript = get_transcriber().transcribe(audio.read_bytes(), MIME.get(audio.suffix, "application/octet-stream"), hotwords).text
            rates.append(char_error_rate(item["text"], transcript))
        fields = extractor.extract(transcript, visit_date, products).fields
        misses = [key for key in FIELD_KEYS if not is_correct(key, item["expected"][key], fields.get(key))]
        for key in FIELD_KEYS:
            correct[key] += key not in misses
        cer = f"字錯率 {rates[-1]:.0%}" if audio is not None else "無錄音"
        print(f"{item['id']}  {cer:10}  {'全對' if not misses else '錯：' + '、'.join(misses)}")

    total = len(items)
    print("\n欄位正確率：" + "　".join(f"{key} {correct[key]}/{total}" for key in FIELD_KEYS))
    print(f"五欄合計：{sum(correct.values())}/{total * len(FIELD_KEYS)}")
    if rates:
        print(f"平均字錯率（{len(rates)} 句有錄音）：{sum(rates) / len(rates):.1%}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
