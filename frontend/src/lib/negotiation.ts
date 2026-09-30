/** 0.6759 → 67.6%（毛利率留一位）；0.95 → 95%（供貨價、通路獎勵這種整數成數不留小數） */
export function formatRate(rate: number, digits = 0) {
  return `${(rate * 100).toFixed(digits)}%`
}

/** 2027-02-06 → 2027/2/6。節慶與申請期限常跨年，只寫月日會看不出是哪一年 */
export function formatFullDate(iso: string) {
  const [year, month, day] = iso.split("-")
  return `${year}/${Number(month)}/${Number(day)}`
}

/** 節日當天還算這一個節慶（後端也是這樣挑的） */
export function festivalCountdown(days: number) {
  return days === 0 ? "就是今天" : `還有 ${days} 天`
}

/** 檔期申請期限當天還來得及送 */
export function applyCountdown(days: number) {
  return days === 0 ? "今天是最後一天" : `還有 ${days} 天`
}

/** 申請期限已過的節慶：["雙 11"] → 雙 11 的檔期來不及申請了。名稱結尾是英數字時跟中文之間空一格 */
export function missedText(missed: string[]) {
  const names = missed.join("、")
  return `${names}${/[A-Za-z0-9]$/.test(names) ? " " : ""}的檔期來不及申請了`
}
