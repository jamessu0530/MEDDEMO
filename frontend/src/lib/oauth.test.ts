import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  inspectGitHubReturn,
  inspectGoogleReturn,
  readOAuthPending,
  startOAuthRedirect,
  type OAuthPending,
} from "@/lib/oauth"

// Google 帶回來的 ID token：只有中間那段（base64url 的 JSON）前端會讀，簽章交給後端驗
function idToken(payload: object) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `eyJhbGciOiJSUzI1NiJ9.${body}.signature`
}

const google: OAuthPending = {
  state: "state-1",
  mode: "login",
  redirectUri: "https://meddemo.example.com/auth/google/callback",
  nonce: "nonce-1",
}

describe("inspectGoogleReturn", () => {
  it("state、nonce 都對得上，就拿 ID token 去登入", () => {
    // ~~~>>> 讓 base64 出現 + 與 /，base64url 會換成 - 與 _，要換回來才讀得出來
    const token = idToken({ sub: "1", nonce: "nonce-1", pad: "~~~>>>" })
    expect(token).toMatch(/[-_]/)
    expect(inspectGoogleReturn(`#state=state-1&id_token=${token}`, google)).toEqual({
      ok: true,
      credential: { provider: "google", body: { credential: token } },
      pending: google,
    })
  })

  it("nonce 不一樣（別處拿來的 token）擋下", () => {
    const result = inspectGoogleReturn(`#state=state-1&id_token=${idToken({ nonce: "other" })}`, google)
    expect(result).toEqual({ ok: false, message: expect.stringContaining("安全檢查沒有通過") })
  })

  it("state 不一樣擋下；token 壞掉讀不出 nonce 也擋下", () => {
    const token = idToken({ nonce: "nonce-1" })
    expect(inspectGoogleReturn(`#state=evil&id_token=${token}`, google).ok).toBe(false)
    expect(inspectGoogleReturn("#state=state-1&id_token=not-a-jwt", google).ok).toBe(false)
  })

  it("在 Google 按取消、找不到出發前的紀錄，各有說明", () => {
    expect(inspectGoogleReturn("#error=access_denied&state=state-1", google)).toEqual({
      ok: false,
      message: "你在 Google 取消了授權，這次沒有完成。",
    })
    expect(inspectGoogleReturn(`#state=state-1&id_token=${idToken({ nonce: "nonce-1" })}`, null)).toEqual({
      ok: false,
      message: expect.stringContaining("找不到這次登入的紀錄"),
    })
  })
})

describe("inspectGitHubReturn", () => {
  const github: OAuthPending = { state: "s", mode: "link", redirectUri: "https://meddemo.example.com/auth/github/callback" }

  it("code 連同出發時的 redirect_uri 一起送去後端", () => {
    expect(inspectGitHubReturn("?code=abc&state=s", github)).toEqual({
      ok: true,
      credential: { provider: "github", body: { code: "abc", redirect_uri: github.redirectUri } },
      pending: github,
    })
  })

  it("沒帶 code、state 不對都擋下", () => {
    expect(inspectGitHubReturn("?state=s", github)).toEqual({ ok: false, message: expect.stringContaining("授權碼") })
    expect(inspectGitHubReturn("?code=abc&state=x", github).ok).toBe(false)
  })
})

describe("startOAuthRedirect", () => {
  let stored: Record<string, string>
  let assigned: string | null

  beforeEach(() => {
    stored = {}
    assigned = null
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => stored[key] ?? null,
      setItem: (key: string, value: string) => void (stored[key] = value),
      removeItem: (key: string) => void delete stored[key],
    })
    vi.stubGlobal("location", {
      origin: "https://meddemo.example.com",
      assign: (url: string) => void (assigned = url),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("Google：整頁導去授權，要 ID token，記下的 state、nonce 跟網址上的一樣", () => {
    startOAuthRedirect("google", "client-1", "login", "/channels/5")
    const url = new URL(assigned!)
    expect(`${url.origin}${url.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth")
    expect(url.searchParams.get("response_type")).toBe("id_token")
    expect(url.searchParams.get("redirect_uri")).toBe("https://meddemo.example.com/auth/google/callback")
    expect(url.searchParams.get("scope")).toBe("openid email profile")
    expect(assigned).toContain("scope=openid%20email%20profile")

    const pending = readOAuthPending("google")
    expect(pending).toMatchObject({ mode: "login", from: "/channels/5" })
    expect(url.searchParams.get("state")).toBe(pending!.state)
    expect(url.searchParams.get("nonce")).toBe(pending!.nonce)
  })

  it("GitHub 不帶 nonce；記下的要回去的頁面只收站內路徑", () => {
    startOAuthRedirect("github", "client-2", "login", "//evil.example.com")
    expect(new URL(assigned!).origin).toBe("https://github.com")
    expect(readOAuthPending("github")).toMatchObject({ nonce: undefined, from: undefined })
  })

  it("sessionStorage 存不進去就不導走，說明原因", () => {
    vi.stubGlobal("sessionStorage", {
      setItem: () => {
        throw new Error("QuotaExceededError")
      },
    })
    expect(() => startOAuthRedirect("google", "client-1", "login")).toThrow("無痕模式")
    expect(assigned).toBeNull()
  })
})
