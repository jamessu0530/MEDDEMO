import { describe, expect, it } from "vitest"

import { addDraftFiles, fitWithin, MAX_FILE_BYTES, removeDraftFile, type DraftFile } from "@/lib/attachments"

function file(name: string, type: string, size = 1000) {
  return { name, type, size } as File
}

function draft(name: string, type = "image/jpeg"): DraftFile {
  return { key: name, file: file(name, type), kind: type === "application/pdf" ? "pdf" : "image" }
}

describe("fitWithin", () => {
  it("shrinks the long edge to the limit and keeps the shape", () => {
    expect(fitWithin(4032, 3024, 2048)).toEqual({ width: 2048, height: 1536 })
    expect(fitWithin(3024, 4032, 2048)).toEqual({ width: 1536, height: 2048 })
  })

  it("never enlarges a small photo", () => {
    expect(fitWithin(640, 480, 2048)).toEqual({ width: 640, height: 480 })
    expect(fitWithin(2048, 100, 2048)).toEqual({ width: 2048, height: 100 })
  })

  it("rounds and keeps at least one pixel", () => {
    expect(fitWithin(10000, 3, 2048)).toEqual({ width: 2048, height: 1 })
  })
})

describe("addDraftFiles", () => {
  it("adds photos and PDFs up to the limit and says what was left out", () => {
    const result = addDraftFiles([draft("a.jpg")], [file("b.png", "image/png"), file("c.pdf", "application/pdf")], 4)
    expect(result.files.map((f) => [f.file.name, f.kind])).toEqual([
      ["a.jpg", "image"],
      ["b.png", "image"],
      ["c.pdf", "pdf"],
    ])
    expect(result.error).toBeNull()

    const over = addDraftFiles(result.files, [file("d.jpg", "image/jpeg"), file("e.jpg", "image/jpeg")], 4)
    expect(over.files.map((f) => f.file.name)).toEqual(["a.jpg", "b.png", "c.pdf", "d.jpg"])
    expect(over.error).toBe("最多附 4 個檔案")
  })

  it("refuses other kinds of files and files over the size limit", () => {
    const result = addDraftFiles(
      [],
      [file("a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), file("big.pdf", "application/pdf", MAX_FILE_BYTES + 1)],
      4
    )
    expect(result.files).toEqual([])
    expect(result.error).toBe("只能附照片或 PDF；單一檔案最大 15MB")
  })

  it("accepts HEIC photos so the server can say what is wrong with them", () => {
    // 桌機 Chrome 解不開 HEIC 就原檔送，由後端回「請改用 JPEG 或 PNG」
    expect(addDraftFiles([], [file("IMG_0001.HEIC", "image/heic")], 4).files).toHaveLength(1)
  })

  it("gives every file its own key even when names repeat", () => {
    const { files } = addDraftFiles([], [file("image.jpg", "image/jpeg"), file("image.jpg", "image/jpeg")], 4)
    expect(new Set(files.map((f) => f.key)).size).toBe(2)
  })
})

describe("removeDraftFile", () => {
  it("drops only the chosen file", () => {
    const files = [draft("a.jpg"), draft("b.jpg")]
    expect(removeDraftFile(files, "a.jpg").map((f) => f.key)).toEqual(["b.jpg"])
  })
})
