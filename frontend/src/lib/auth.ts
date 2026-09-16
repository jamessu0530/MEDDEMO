import { useSyncExternalStore } from "react"

// 登入後的身分。角色只有兩種：業務跑今日路線，主管多一個主管端（/manager）
export type AuthUser = {
  id: string
  name: string
  role: "sales" | "manager"
  region: string
  email: string
  // 綁定的第三方登入方式；這支手機存的舊身分可能還沒有這個欄位，/api/auth/me 回來就會補上
  linked?: LinkedAccount[]
}

export type LinkedAccount = {
  provider: "google" | "github" | "facebook"
  email: string | null
  linked_at: string
}

export type Session = { token: string; user: AuthUser }

/*
 * 登入狀態存在這支手機裡：token 是後端簽的 JWT，每個請求都帶（api/client.ts）；
 * user 一起存著，是為了一打開就知道要顯示誰、要進哪一頁，真正的權限每次都由後端看 token 決定。
 * 這次不做 refresh token：token 過期或被別的裝置頂掉，後端回 401，畫面就導回登入頁重登。
 */
const TOKEN_KEY = "meddemo:token"
const USER_KEY = "meddemo:user"
const listeners = new Set<() => void>()

function read(): Session | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY)
    const raw = localStorage.getItem(USER_KEY)
    if (!token || !raw) return null
    return { token, user: JSON.parse(raw) as AuthUser }
  } catch {
    return null // 讀不到（無痕模式、存的格式壞了）就當作沒登入，畫面會導回登入頁
  }
}

let current = read()
// 被登出的原因（登入已過期、帳號在其他裝置登入），登入頁顯示給業務看；下次登入成功就清掉
let signedOutReason: string | null = null

function emit() {
  listeners.forEach((listener) => listener())
}

function save(session: Session | null) {
  try {
    if (session) {
      localStorage.setItem(TOKEN_KEY, session.token)
      localStorage.setItem(USER_KEY, JSON.stringify(session.user))
    } else {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(USER_KEY)
    }
  } catch {
    // 存不進去：這次打開還是照登入的身分用，關掉網頁後要再登入一次
  }
}

/** 登入成功（api/auth.ts 的 login 回來之後） */
export function signIn(session: Session) {
  current = session
  signedOutReason = null
  save(session)
  emit()
}

/**
 * 清掉這支手機的登入狀態。reason 是後端回的 401 訊息（登入已過期、帳號已在其他裝置登入），
 * 登入頁會直接顯示；自己按登出的話不必給。
 */
export function signOut(reason?: string) {
  if (!current && !reason) return
  current = null
  signedOutReason = reason ?? null
  save(null)
  emit()
}

/** /api/auth/me 回來的最新身分（改過姓名、調過區域）；內容一樣就不動，免得畫面白重畫一次 */
export function refreshUser(user: AuthUser) {
  if (!current || JSON.stringify(current.user) === JSON.stringify(user)) return
  current = { token: current.token, user }
  save(current)
  emit()
}

/** 畫面外（api/client.ts 每個請求的 Authorization）要用的 token */
export function readToken() {
  return current?.token ?? null
}

/** 畫面外（例如回寫完成頁）要用的身分 */
export function readUser() {
  return current?.user ?? null
}

/** 被踢回登入頁的原因，登入頁顯示用 */
export function readSignedOutReason() {
  return signedOutReason
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useAuth() {
  return useSyncExternalStore(subscribe, () => current)
}
