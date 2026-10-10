/**
 * 同一種請求連送好幾次、回來的順序不一定（首頁連點兩站的 arrive）：只套用比上次套用過的還新的那一個。
 * 送出前拿號碼（next），回來時問要不要套用（take）；舊的晚到就丟掉，不把畫面與快取蓋回比較舊的那一份。
 */
export function inOrder() {
  let sent = 0
  let applied = 0
  return {
    next: () => ++sent,
    take(seq: number) {
      if (seq <= applied) return false
      applied = seq
      return true
    },
  }
}
