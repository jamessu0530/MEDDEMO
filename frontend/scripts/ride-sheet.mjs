// 產生座騎的定案表：npm run ride-sheet（在 frontend/ 底下跑）。
// 用 Vite 的 SSR 載入跟 App 同一批元件（含 @/ 別名），所以表上畫的就是程式畫的。
import fs from "node:fs"
import path from "node:path"
import { createServer } from "vite"

const root = process.cwd()
const out = path.resolve(root, "../docs/superpowers/specs/assets/2026-10-07-ride-sheet.html")
const server = await createServer({ root, logLevel: "warn", server: { middlewareMode: true, hmr: false }, appType: "custom" })
try {
  const { renderRideSheet } = await server.ssrLoadModule("/src/components/rides/sheet.tsx")
  const vehicles = path.join(root, "src/components/rides/vehicles")
  const cssFiles = [
    path.join(root, "src/components/mascot.css"),
    path.join(root, "src/components/rides/ride.css"),
    ...fs.readdirSync(vehicles).filter((name) => name.endsWith(".css")).sort().map((name) => path.join(vehicles, name)),
  ]
  const css = cssFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n")
  fs.writeFileSync(out, renderRideSheet(css))
  console.log(`寫好了：${path.relative(path.resolve(root, ".."), out)}`)
} finally {
  await server.close()
}
