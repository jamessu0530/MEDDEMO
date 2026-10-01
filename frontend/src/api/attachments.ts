// 頻道訊息與提問附的照片、PDF（docs/superpowers/specs/2026-10-01-attachments-design.md）
export type Attachment = {
  id: number
  kind: "image" | "pdf"
  filename: string
  width: number | null
  height: number | null
  page_count: number | null
  // 簽過名的網址（一到兩小時有效），<img> 直接用；PDF 沒有縮圖
  url: string
  thumb_url: string | null
}
