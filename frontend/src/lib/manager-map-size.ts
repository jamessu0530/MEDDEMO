export type ManagerMapSize = { widthPercent: number | null; height: number | null }
export type MapSizeLimits = { minWidth: number; maxWidth: number; minHeight: number; maxHeight: number }

const EMPTY_SIZE: ManagerMapSize = { widthPercent: null, height: null }
const storageKey = (accountId: string) => `meddemo:manager-map-size:${accountId}`
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)

/** 寬度以比例記住，換視窗時再限制；高度以 px 記住。不同登入帳號各自保存。 */
export function readManagerMapSize(accountId: string): ManagerMapSize {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey(accountId)) ?? "null")
    if (!saved || typeof saved !== "object") return { ...EMPTY_SIZE }
    const { widthPercent, height } = saved as Record<string, unknown>
    return {
      widthPercent: finite(widthPercent) && widthPercent > 0 && widthPercent < 100 ? widthPercent : null,
      height: finite(height) && height > 0 ? height : null,
    }
  } catch {
    return { ...EMPTY_SIZE }
  }
}

export function saveManagerMapSize(accountId: string, size: ManagerMapSize) {
  try {
    if (size.widthPercent === null && size.height === null) localStorage.removeItem(storageKey(accountId))
    else localStorage.setItem(storageKey(accountId), JSON.stringify(size))
  } catch {
    // 儲存空間被擋時仍可調整目前畫面。
  }
}

/** 兩側盡量保留 18rem；窄桌面或大字體時，至少各保留可用寬度的 40%。 */
export function managerMapLimits(availableWidth: number, fontSize: number, viewportHeight: number, mapTop = 6 * fontSize): MapSizeLimits {
  const sidePercent = availableWidth > 0 ? Math.min((18 * fontSize / availableWidth) * 100, 40) : 40
  const minHeight = 16 * fontSize
  return {
    minWidth: Math.max(25, sidePercent),
    maxWidth: Math.min(80, 100 - sidePercent),
    minHeight,
    maxHeight: Math.max(minHeight, Math.min(48 * fontSize, viewportHeight - mapTop - 4 * fontSize)),
  }
}

export function constrainManagerMapSize(size: ManagerMapSize, limits: MapSizeLimits): ManagerMapSize {
  return {
    widthPercent: size.widthPercent === null ? null : Math.min(limits.maxWidth, Math.max(limits.minWidth, size.widthPercent)),
    height: size.height === null ? null : Math.min(limits.maxHeight, Math.max(limits.minHeight, size.height)),
  }
}
