import { describe, expect, it } from "vitest"
import type { CustomerInquiry } from "@/api/customer-inquiries"
import { groupInquiryLocations, inquiryPlaceLabel } from "@/lib/inquiry-map"
const inquiry = (id: string, lat = 25.03, lng = 121.56): CustomerInquiry => ({
  id,
  rep: { id: "U01", name: "林昱辰", region: "北區" },
  customers: [],
  question: id,
  kind: "data",
  status: "answered",
  created_at: "2026-10-20T08:00:00Z",
  location: {
    lat,
    lng,
    accuracy_m: 12,
    captured_at: "2026-10-20T08:00:00Z",
    place_name: null,
  },
})
describe("提問地圖的固定標記", () => {
  it("同地點多則問題合併標記，不把提問順序組成路線", () => {
    const groups = groupInquiryLocations([
      inquiry("one"),
      inquiry("two"),
      inquiry("three", 24.5),
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0].inquiries.map((item) => item.id)).toEqual(["one", "two"])
    expect(groups[1].inquiries[0].id).toBe("three")
    expect(groups[0]).not.toHaveProperty("path")
  })
  it("沒定位的提問與無效座標不畫點，也不拿關聯客戶代替地點", () => {
    expect(
      groupInquiryLocations([
        {
          ...inquiry("old"),
          location: null,
          customers: [{ id: "C1", name: "康泰" }],
        },
        inquiry("bad", NaN),
      ])
    ).toEqual([])
    expect(inquiryPlaceLabel(inquiry("pin").location!)).toBe(
      "25.03000, 121.56000"
    )
  })
})
