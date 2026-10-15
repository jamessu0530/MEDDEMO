import fs from "node:fs"
import path from "node:path"
import { build } from "vite"

process.env.NODE_ENV = "production"
const root = path.resolve(import.meta.dirname, "..")
const out = path.resolve(root, "../docs/superpowers/specs/assets/2026-10-14-mascot-wardrobe.html")
const bundle = await build({ root, logLevel: "error", define: { "process.env.NODE_ENV": JSON.stringify("production") }, build: { write: false, minify: true, lib: { entry: path.join(root, "src/preview/mascot-wardrobe.tsx"), formats: ["iife"], name: "MascotWardrobePreview" } } })
const outputs = Array.isArray(bundle) ? bundle.flatMap((item) => item.output) : bundle.output
const js = outputs.find((item) => item.type === "chunk").code.replace(/<\/script/gi, "<\\/script")
const css = outputs.filter((item) => item.type === "asset" && item.fileName.endsWith(".css")).map((item) => item.source).join("\n")
fs.writeFileSync(out, `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>熊熊滾收藏與換裝</title><style>${css}
*{box-sizing:border-box}body{margin:0;background:#f7f4fa;font-family:-apple-system,BlinkMacSystemFont,'PingFang TC',sans-serif}#app{max-width:1080px;margin:auto;padding:28px}.preview-toolbar{background:#fff;border:1px dashed #d8c7e7;border-radius:18px;padding:14px 16px;margin-bottom:28px;color:#7a6a88;font-size:11px;line-height:1.8}.preview-toolbar b{color:#8950bf;margin-right:10px}.preview-toolbar div{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.preview-toolbar button{font:inherit;border:1px solid #e9dff2;background:#faf7fd;border-radius:8px;padding:7px 9px;color:#705582;cursor:pointer}.preview-toolbar button:focus-visible{outline:3px solid #9b51e0;outline-offset:2px}@media(max-width:760px){#app{padding:18px}}
</style></head><body><main id="app"></main><script>${js}</script></body></html>`)
console.log(`寫好了：${path.relative(path.resolve(root, ".."), out)}`)
