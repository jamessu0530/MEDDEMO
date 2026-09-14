# 音效

- `querying.wav`：語音問答查資料時循環播放的提示音。
  - 來源：[UI SFX](https://github.com/romainsimon/uisfx)，`soft` 音色（圓潤、溫和，適合手機 App）的 `processing` 循環音，原檔是 `packages/uisfx/sounds/soft/processing.ogg`。
  - 格式：用 ffmpeg 轉成 24 kHz 單聲道 WAV。WAV 在各家瀏覽器（含 iPhone）都解得開，循環接縫也不會有 MP3 開頭多出來的空白。
  - 授權：CC0 1.0，公眾領域。可以商用、可以散布，不必註明出處，見 UI SFX 的 [LICENSE-AUDIO](https://github.com/romainsimon/uisfx/blob/main/LICENSE-AUDIO)。
- 想換別種聲音：到 [uisfx.com](https://uisfx.com) 試聽，換掉這個檔就好，程式不用改。
