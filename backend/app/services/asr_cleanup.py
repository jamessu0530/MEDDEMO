"""整理 CARE 語音辨識（faster-whisper）的輸出：簡體轉台灣正體，再用熱詞修正同音錯字。

CARE 的服務沒有熱詞參數，專有名詞常錯成同音字（9/14、9/15 用合成口述實測：「連鎖藥局」→「联所邀局」、
「御松田」→「玉松田」、「魚油」→「于游」）。這裡補上：把逐字稿和熱詞都轉成拼音，對得上就換成熱詞的寫法。
- 三個字以上的詞不比聲調，捲舌與不捲舌（zh／z、ch／c、sh／s）、前後鼻音（in／ing、en／eng）也當成一樣：
  台灣口音本來就常混，辨識也常錯在這裡（「信義」→「興意」、「近效期」→「敬孝其」）。
  熱詞裡的多音字每種念法都算（「康普樂」的樂念 yuè，才對得上「康普越」）。
- 四個字以上的詞，錯一個音節也換（「綜合維他命」→「縱合為他們」）：其他音節都對上，很少是巧合。
- 兩個字的詞連聲調都要一樣：只比音節的話「推貨」會被換成「退貨」，意思整個反過來。
  輕聲不算不一樣：pypinyin 把「男子」的子念成輕聲，它對得上「楠梓」。
- 一個字不換，同音字太多。
"""

import itertools
import re

from opencc import OpenCC
from pypinyin import Style, lazy_pinyin, pinyin

CJK = "一-鿿"
CJK_RUN = re.compile(f"[{CJK}]+")
# 簡體轉台灣正體，連用語一起換（例如「软件」→「軟體」）
_TO_TAIWAN = OpenCC("s2twp")
# faster-whisper 在中文句子裡用半形標點；換成全形，跟 Gemini 與手動輸入的逐字稿一致
FULL_WIDTH = {",": "，", "?": "？", "!": "！", ":": "：", ";": "；"}
RETROFLEX = {"zh": "z", "ch": "c", "sh": "s"}
# 熱詞的多音字最多展開幾種念法：一般的詞兩三個多音字就夠，擋掉異常長的詞組合暴增
MAX_READINGS = 16


def to_taiwan(text: str) -> str:
    text = _TO_TAIWAN.convert(text)
    text = re.sub(f"(?<=[{CJK}])[,?!:;]", lambda m: FULL_WIDTH[m.group()], text)
    # 句點只換中文字後面、而且不是小數點的
    return re.sub(f"(?<=[{CJK}])\\.(?!\\d)", "。", text)


def _sounds(text: str, style: Style) -> list[str]:
    sounds = lazy_pinyin(text, style=style)
    # 字典裡查不到的字，pypinyin 會把連在一起的幾個字併成一項；那就逐字查，保持一字一音
    return sounds if len(sounds) == len(text) else [lazy_pinyin(char, style=style)[0] for char in text]


def _loose(syllable: str) -> str:
    """捲舌與不捲舌、前後鼻音當成同一個音。"""
    for retroflex, flat in RETROFLEX.items():
        if syllable.startswith(retroflex):
            syllable = flat + syllable[2:]
            break
    return syllable[:-1] if syllable.endswith(("ing", "eng")) else syllable


def _same_tone(a: str, b: str) -> bool:
    """同一個音節的兩種念法，聲調一樣、或其中一個是輕聲（沒有聲調數字）。"""
    return a == b or not a[-1].isdigit() or not b[-1].isdigit()


def _readings(word: str) -> list[tuple[str, ...]]:
    """熱詞每一種可能的念法（多音字展開），已經換成寬鬆的音。"""
    options = pinyin(word, style=Style.NORMAL, heteronym=True)
    if len(options) != len(word):
        options = [pinyin(char, style=Style.NORMAL, heteronym=True)[0] for char in word]
    options = [list(dict.fromkeys(_loose(s) for s in choices)) for choices in options]
    return list(itertools.islice(itertools.product(*options), MAX_READINGS))


class HomophoneFixer:
    """把逐字稿裡跟熱詞同音的詞，換成熱詞的寫法。"""

    def __init__(self, hotwords: list[str]):
        self.long: dict[tuple[str, ...], str] = {}
        # 兩個字的詞：用不帶聲調的音找，再逐字比聲調
        self.short: dict[tuple[str, ...], list[tuple[tuple[str, ...], str]]] = {}
        for word in hotwords:
            for part in CJK_RUN.findall(word):
                if len(part) >= 3:
                    for reading in _readings(part):
                        self.long.setdefault(reading, part)
                elif len(part) == 2:
                    toned = tuple(_sounds(part, Style.TONE3))
                    self.short.setdefault(tuple(s.rstrip("12345") for s in toned), []).append((toned, part))
        self.by_length: dict[int, list[tuple[tuple[str, ...], str]]] = {}
        for key, word in self.long.items():
            self.by_length.setdefault(len(key), []).append((key, word))
        self.lengths = sorted(set(self.by_length) | ({2} if self.short else set()), reverse=True)

    def fix(self, text: str) -> str:
        return CJK_RUN.sub(lambda m: self._fix_run(m.group()), text)

    def _fix_run(self, run: str) -> str:
        loose = [_loose(s) for s in _sounds(run, Style.NORMAL)]
        toned = _sounds(run, Style.TONE3)
        out: list[str] = []
        i = 0
        while i < len(run):
            for length in self.lengths:
                if i + length > len(run):
                    continue
                if length == 2:
                    word = self._short_word(tuple(toned[i : i + 2]))
                else:
                    word = self._long_word(tuple(loose[i : i + length]))
                if word:
                    out.append(word)
                    i += length
                    break
            else:
                out.append(run[i])
                i += 1
        return "".join(out)

    def _short_word(self, toned: tuple[str, ...]) -> str | None:
        candidates = self.short.get(tuple(s.rstrip("12345") for s in toned), ())
        return next((word for key, word in candidates if all(map(_same_tone, key, toned))), None)

    def _long_word(self, sounds: tuple[str, ...]) -> str | None:
        word = self.long.get(sounds)
        if word or len(sounds) < 4:
            return word
        # 四個音節以上：錯一個也算
        return next((w for key, w in self.by_length.get(len(sounds), ()) if sum(a != b for a, b in zip(key, sounds)) <= 1), None)
