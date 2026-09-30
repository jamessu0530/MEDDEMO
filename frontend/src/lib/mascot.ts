/** 熊熊滾的七個狀態（components/mascot.tsx 照這個畫，動畫在 components/mascot.css） */
export type MascotState = "idle" | "hi" | "listen" | "think" | "talk" | "wait" | "yay"

/** 語音會話裡熊熊滾該是哪個狀態：AI 在講話就是回答，有查詢在跑是思考，其餘在聽 */
export function voiceMascotState(status: "listening" | "speaking", pending: number): MascotState {
  if (status === "speaking") return "talk"
  return pending > 0 ? "think" : "listen"
}
