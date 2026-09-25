// Gemini 的語音逐字稿常在中文字之間夾空白（實測：「近效期 品項 退貨 作業 規範」），顯示前把中文字旁邊的空白拿掉；
// 英文字之間的空白保留
const CJK = "\\u3000-\\u9fff\\uff00-\\uffef"
const SPACE_NEAR_CJK = new RegExp(`(?<=[${CJK}])\\s+|\\s+(?=[${CJK}])`, "g")

export function tidyTranscript(text: string) {
  return text.replace(SPACE_NEAR_CJK, "")
}
