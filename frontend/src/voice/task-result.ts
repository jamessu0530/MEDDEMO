import type { Entry } from "@/ask/conversation"

/** Read the task planner's real clarification or receipt back to the voice model. */
export function taskToolResult(entries: Entry[]) {
  const messages = entries.flatMap((entry) => entry.kind === "model" && entry.text.trim() ? [entry.text.trim()] : [])
  return { output: {
    status: "已更新工作安排",
    answer: messages.join("\n") || "工作正在處理，執行結果或待補資料會顯示在工作清單。",
    instruction: "照 answer 轉述；如果是追問就等待使用者補充。尚未完成的工作只能說正在處理，不得宣稱已完成。開單只有收到已儲存草稿與單號的結果，才可說草稿已建立；不可說已正式送出。",
  } }
}
