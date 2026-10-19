import { createElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { CustomerInquiry } from "@/api/customer-inquiries"
vi.mock("@vis.gl/react-google-maps", () => ({
  APIProvider: ({ children }: { children: ReactNode }) => children,
  Map: ({ children }: { children: ReactNode }) =>
    createElement("div", { "aria-label": "Google 底圖" }, children),
  AdvancedMarker: ({
    children,
    title,
  }: {
    children: ReactNode
    title: string
  }) => createElement("button", { title }, children),
  InfoWindow: ({
    children,
    headerContent,
  }: {
    children: ReactNode
    headerContent: ReactNode
  }) => createElement("aside", null, headerContent, children),
  ColorScheme: { LIGHT: "light", DARK: "dark" },
  useMap: () => null,
}))
vi.mock("@/components/map-load-watch", () => ({ LoadWatch: () => null }))
vi.mock("@/lib/skin", () => ({ useSkin: () => "light" }))
import InquiryMap from "@/components/manager/inquiry-map"
const inquiry: CustomerInquiry = {
  id: "ask-1",
  rep: { id: "U01", name: "林昱辰", region: "北區" },
  customers: [],
  question: "這家有什麼促銷？",
  kind: "data",
  status: "answered",
  created_at: "2026-10-20T08:00:00Z",
  location: {
    lat: 25.03,
    lng: 121.56,
    accuracy_m: 12,
    captured_at: "2026-10-20T08:00:00Z",
    place_name: "康泰附近",
  },
}
const render = (selectedId: string | null) =>
  renderToStaticMarkup(
    createElement(InquiryMap, {
      config: { browser_key: "test", map_id: "test" },
      items: [inquiry],
      selectedId,
      onSelect: () => {},
      onFail: () => {},
      className: "h-80",
    })
  )
describe("提問地圖", () => {
  it("標記屬於提問地點，選取後顯示該問題、業務與定位時間", () => {
    expect(render(null)).toContain("康泰附近 · 1 則提問")
    const html = render("ask-1")
    for (const text of [
      inquiry.question,
      "林昱辰",
      "10/20 16:00",
      "定位誤差約 12 公尺",
    ])
      expect(html).toContain(text)
    expect(html).not.toContain("目前位置")
    expect(html).not.toContain("第 1 站")
  })
})
