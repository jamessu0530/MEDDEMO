"""把瀏覽器錄音轉成台語 STT 用的 PCM WAV，並在停頓處切段。

沿用 CARE 驗證過的 16 kHz、單聲道、每段最多 25 秒；PyAV 延遲載入，
只處理華語或執行排程的程序不用常駐 FFmpeg 函式庫。
"""

import array
import io
import sys
import wave

SAMPLE_RATE = 16_000
MAX_CHUNK_SECONDS = 25
MAX_RECORDING_SECONDS = 180
BYTES_PER_SAMPLE = 2


def decode_recording(audio: bytes) -> bytes:
    import av

    pcm = bytearray()
    # 瀏覽器的停止計時與 AAC 編碼器 padding 可能多出不到一秒，保留這些樣本。
    limit = (MAX_RECORDING_SECONDS + 1) * SAMPLE_RATE * BYTES_PER_SAMPLE
    with av.open(io.BytesIO(audio)) as container:
        if not container.streams.audio:
            raise ValueError("錄音檔沒有音訊，請重新錄音")
        stream = container.streams.audio[0]
        resampler = av.AudioResampler(format="s16", layout="mono", rate=SAMPLE_RATE)

        def append(frames):
            for frame in frames:
                pcm.extend(bytes(frame.planes[0])[: frame.samples * BYTES_PER_SAMPLE])
                if len(pcm) > limit:
                    raise ValueError("台語錄音每段最多三分鐘，請分段錄音")

        for frame in container.decode(stream):
            append(resampler.resample(frame))
        append(resampler.resample(None))
    if not pcm:
        raise ValueError("錄音檔沒有音訊，請重新錄音")
    return bytes(pcm)


def split_on_pauses(pcm: bytes) -> list[bytes]:
    samples = array.array("h")
    samples.frombytes(pcm)
    if sys.byteorder == "big":
        samples.byteswap()
    max_samples = MAX_CHUNK_SECONDS * SAMPLE_RATE
    # 在最後十秒內，以 50 ms 視窗找最安靜的位置。
    search = 10 * SAMPLE_RATE
    window = SAMPLE_RATE // 20
    start = 0
    chunks = []
    while len(samples) - start > max_samples:
        lo, hi = start + max_samples - search, start + max_samples - window
        quietest = min(range(lo, hi + 1, window), key=lambda i: sum(map(abs, samples[i : i + window])))
        cut = quietest + window // 2
        chunks.append(pcm[start * BYTES_PER_SAMPLE : cut * BYTES_PER_SAMPLE])
        start = cut
    chunks.append(pcm[start * BYTES_PER_SAMPLE :])
    return chunks


def as_wav(pcm: bytes) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(BYTES_PER_SAMPLE)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(pcm)
    return output.getvalue()
