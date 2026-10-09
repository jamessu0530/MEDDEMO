/** 電腦版主管端的左清單、右內容（docs/superpowers/specs/2026-10-09-desktop-layout-design.md〈主管端〉） */

/** 網址上記的那一張還在清單裡就選它，不然選第一張（只是打開，不會改任何東西）；清單是空的就沒有 */
export function pickItem<T extends { id: number }>(items: T[], requested: number | null): T | null {
  return items.find((item) => item.id === requested) ?? items[0] ?? null
}

/** 這一張要從清單拿掉（回覆了、簽完了）：接著選它後面那張，它是最後一張就選前面那張，只剩它就沒有 */
export function nextAfter<T extends { id: number }>(items: T[], id: number): number | null {
  const index = items.findIndex((item) => item.id === id)
  if (index < 0) return null
  return (items[index + 1] ?? items[index - 1])?.id ?? null
}

/** 網址上的 ?item=：不是正整數就當沒選 */
export function itemParam(value: string | null): number | null {
  if (!value) return null
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}
