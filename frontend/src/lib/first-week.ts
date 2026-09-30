/*
 * 新人第一週每件事做了沒有，只記在這支手機裡（localStorage），跟首次使用引導一樣不上伺服器。
 * 存的是打了勾的那幾件事的 id（後端 resources/first_week.json 裡寫的）。
 * key 帶登入的使用者 id，同一支手機換人登入不會看到上一個人的勾選。
 */
const KEY_PREFIX = "meddemo:first-week:"

function storageKey(userId: string) {
  return `${KEY_PREFIX}${userId}`
}

/** 這支手機記著的勾選 */
export function readDone(userId: string): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey(userId)) ?? "[]")
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : []
  } catch {
    return [] // 讀不到（無痕模式、存的格式壞了）就當作還沒勾過，頁面照常用
  }
}

/** 打勾或取消，回傳更新後的勾選給畫面用 */
export function setDone(userId: string, taskId: string, done: boolean): string[] {
  const others = readDone(userId).filter((id) => id !== taskId)
  const next = done ? [...others, taskId] : others
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(next))
  } catch {
    // 存不進去：這次打開畫面上照樣看得到勾選，關掉之後就不記得了
  }
  return next
}

/**
 * 完成幾件。只算現在設定檔裡還有的事：設定檔換了 id 等於新的一件事，舊的勾選不會帶過來，
 * 也不會讓「完成 16／15」這種數字出現。
 */
export function countDone(taskIds: string[], done: string[]): number {
  return taskIds.filter((id) => done.includes(id)).length
}
