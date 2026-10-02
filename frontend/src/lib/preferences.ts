import { getMyPreferences, saveMyPreferences, type PreferenceChanges, type Preferences } from "@/api/preferences"
import { changeSkin } from "@/ink/ink"
import { readUser } from "@/lib/auth"
import { realtime } from "@/lib/realtime"
import { readSkin, setSkin, type Skin } from "@/lib/skin"
import { readTextSize, setTextSize, type TextSize } from "@/lib/text-size"

/*
 * 配色與字體大小跟著帳號存在伺服器（docs/superpowers/specs/2026-10-02-cloud-settings-design.md），換一支手機登入也一樣。
 * lib/skin.ts、lib/text-size.ts 照舊在手機裡留一份，下次打開在畫面出來前就先套上；登入後跟伺服器對一次，以伺服器為準。
 *
 * 自己選的先換畫面、再存上去。沒訊號存不上去就記在手機裡（pending），WebSocket 重連、下次打開或再選一次時再送；
 * 送上去之前，伺服器的舊值不會把剛選的蓋回去。
 */

type Values = { skin: Skin; text_size: TextSize }

export type PreferenceEnv = {
  fetch: () => Promise<Preferences>
  save: (changes: PreferenceChanges) => Promise<unknown>
  /** 這支手機現在的設定 */
  local: () => Values
  /** 套上伺服器的設定：直接換，不播噴漆、不再存回去 */
  apply: (changes: PreferenceChanges) => void
  readPending: (userId: string) => PreferenceChanges
  writePending: (userId: string, pending: PreferenceChanges) => void
}

const FIELDS = ["skin", "text_size"] as const

export class PreferenceSync {
  private readonly env: PreferenceEnv
  private userId: string | null = null
  // 選了、還沒存上去的
  private pending: PreferenceChanges = {}
  // 知道伺服器上是什麼：自己剛存上去的，或剛拿到的。伺服器回的跟它一樣就不再套一次——
  // 自己換配色時噴漆還在播，畫面還是舊的顏色，這時候套上去會在墨蓋滿之前就先換掉
  private known: PreferenceChanges = {}
  private saving: Promise<void> | null = null
  // 每次重拿都編一個號；自己又選了也換號：還沒回來的那次是舊的，不要蓋掉剛選的
  private generation = 0

  constructor(env: PreferenceEnv) {
    this.env = env
  }

  /** 登入後、WebSocket 重連、自己在別的裝置改了設定時：先把還沒存上去的送出，再拿伺服器的套上 */
  async load(userId: string) {
    if (userId !== this.userId) {
      this.userId = userId
      this.pending = this.env.readPending(userId)
      this.known = {}
    }
    await this.flush()
    const mine = ++this.generation
    let server: Preferences
    try {
      server = await this.env.fetch()
    } catch {
      return // 拿不到就照手機裡的，下次重連或打開再對
    }
    if (mine !== this.generation || userId !== this.userId) return
    if (server.skin === null && server.text_size === null) {
      // 這個帳號還沒存過：把這支手機現在的設定存上去，換成存伺服器之前選的不會不見
      this.choose(this.env.local())
      return
    }
    const changes: PreferenceChanges = {}
    if (server.skin && this.pending.skin === undefined && server.skin !== this.known.skin) changes.skin = server.skin
    if (server.text_size && this.pending.text_size === undefined && server.text_size !== this.known.text_size)
      changes.text_size = server.text_size
    this.known = { ...this.known, ...changes }
    if (Object.keys(changes).length) this.env.apply(changes)
  }

  /** 自己在畫面上選的（畫面已經換了，或噴漆正在換）：記下來存到伺服器。沒登入（登入頁）就只記在手機裡 */
  choose(changes: PreferenceChanges) {
    const userId = this.userId
    if (!userId) return
    this.generation += 1
    this.pending = { ...this.pending, ...changes }
    this.env.writePending(userId, this.pending)
    void this.flush()
  }

  /** 登出、換人。還沒存上去的留在手機裡，同一個人下次登入再送 */
  clear() {
    this.userId = null
    this.pending = {}
    this.known = {}
    this.generation += 1
  }

  /** 一次只送一個請求；送的期間又選了，送完接著送 */
  private flush() {
    this.saving ??= this.drain().finally(() => {
      this.saving = null
    })
    return this.saving
  }

  private async drain() {
    while (this.userId && FIELDS.some((field) => this.pending[field] !== undefined)) {
      const userId = this.userId
      const sent = this.pending
      try {
        await this.env.save(sent)
      } catch {
        return // 沒訊號：留著，之後再送
      }
      if (userId !== this.userId) return
      this.known = { ...this.known, ...sent }
      // 送出之後沒再改的才算存好了
      const rest = { ...this.pending }
      for (const field of FIELDS) if (rest[field] === sent[field]) delete rest[field]
      this.pending = rest
      this.env.writePending(userId, rest)
    }
  }
}

const PENDING_KEY = "meddemo:preferences-pending:"
const SKINS: Skin[] = ["light", "dark"]
const TEXT_SIZES: TextSize[] = ["standard", "large", "xlarge"]

function readPending(userId: string): PreferenceChanges {
  try {
    const saved = JSON.parse(localStorage.getItem(PENDING_KEY + userId) ?? "{}") as Record<string, unknown>
    const pending: PreferenceChanges = {}
    if (SKINS.includes(saved.skin as Skin)) pending.skin = saved.skin as Skin
    if (TEXT_SIZES.includes(saved.text_size as TextSize)) pending.text_size = saved.text_size as TextSize
    return pending
  } catch {
    return {} // 讀不到或格式壞了：當作沒有
  }
}

function writePending(userId: string, pending: PreferenceChanges) {
  try {
    if (Object.keys(pending).length) localStorage.setItem(PENDING_KEY + userId, JSON.stringify(pending))
    else localStorage.removeItem(PENDING_KEY + userId)
  } catch {
    // 存不進去：這次打開照樣會再送，只是關掉之前沒送成功的話就沒了
  }
}

export const preferences = new PreferenceSync({
  fetch: () => getMyPreferences(),
  save: saveMyPreferences,
  local: () => ({ skin: readSkin(), text_size: readTextSize() }),
  apply: ({ skin, text_size }) => {
    if (skin) setSkin(skin)
    if (text_size) setTextSize(text_size)
  },
  readPending,
  writePending,
})

/** 登入後（App.tsx）、WebSocket 重連、自己在別的裝置改了設定時 */
export function loadPreferences() {
  const user = readUser()
  if (user) void preferences.load(user.id)
}

export function clearPreferences() {
  preferences.clear()
}

/** 設定頁與頁首的深色、淺色按鈕：用噴漆換配色（ink/ink.ts），並存到帳號上 */
export function chooseSkin(next: Skin) {
  changeSkin(next)
  preferences.choose({ skin: next })
}

/** 設定頁的字體大小 */
export function chooseTextSize(next: TextSize) {
  setTextSize(next)
  preferences.choose({ text_size: next })
}

realtime.subscribe((event) => {
  if (event.type === "preferences" || event.type === "resync") loadPreferences()
})
