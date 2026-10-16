// npm --prefix frontend run mascot-sheet：直接用 App 的熊熊滾元件與 CSS 產生獨立預覽。
import fs from "node:fs"
import path from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { build, createServer } from "vite"

const root = path.resolve(import.meta.dirname, "..")
const out = path.resolve(root, "../docs/superpowers/specs/assets/2026-10-14-mascot-motions.html")
// SSR 和瀏覽器 bundle 用同一個 JSX runtime，避免先開 SSR server 把 JSX 轉成 development 版本。
process.env.NODE_ENV = "production"
const motions = [
  { state: "blink", name: "眨眨眼", hint: "眨兩下，偷偷看著你", description: "輕輕點頭、連眨兩下眼睛，再張開眼睛看著你。" },
  { state: "roll", name: "翻滾", hint: "縮一下，咕嚕轉一圈", description: "先縮一下蓄力，咕嚕轉一整圈，落地時軟軟地回彈。" },
  { state: "sleep", name: "打盹", hint: "閉上眼睛，慢慢呼吸", description: "耳朵放鬆，身體縮成軟軟的一團，睡眠符號輕輕往上飄。" },
  { state: "stretch", name: "伸懶腰", hint: "拉高身體，打個哈欠", description: "閉著眼睛把身體拉長，耳朵向外張開，再慢慢放鬆。" },
  { state: "shy", name: "害羞", hint: "縮小一點，低下小臉", description: "耳朵收起來，臉輕輕低下，最後小心地回到站姿。" },
]

const server = await createServer({ root, logLevel: "warn", server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom" })
try {
  const { Mascot } = await server.ssrLoadModule("/src/components/mascot.tsx")
  const css = ["mascot.css", "mascot-play.css"].map((name) => fs.readFileSync(path.join(root, "src/components", name), "utf8")).join("\n")
  const bundle = await build({
    root,
    logLevel: "error",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: { write: false, minify: true, lib: { entry: path.join(root, "src/preview/mascot.tsx"), formats: ["iife"], name: "MascotPreview" } },
  })
  const outputs = Array.isArray(bundle) ? bundle.flatMap((item) => item.output) : bundle.output
  const script = outputs.find((item) => item.type === "chunk").code.replace(/<\/script/gi, "<\\/script")
  const bear = (state, bust = false) => renderToStaticMarkup(createElement(Mascot, { state, size: 300, bust }))
  const cards = motions.map(({ state, name, hint, description }, index) => `
    <button class="motion${index === 0 ? " selected" : ""}" type="button" data-state="${state}" data-name="${name}" data-description="${description}" aria-pressed="${index === 0}">
      <span class="motion-bear">${bear(state)}</span>
      <span class="motion-name">${name}</span><span class="motion-hint">${hint}</span>
    </button>`).join("\n")
  const html = `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>熊熊滾・日常小動作</title>
  <style>
${css}
  </style>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #f7f4fa; color: #2b1b47; font-family: -apple-system, BlinkMacSystemFont, "PingFang TC", "Noto Sans TC", sans-serif; }
    button { font: inherit; cursor: pointer; }
    button:focus-visible { outline: 3px solid #9b51e0; outline-offset: 4px; }
    main { max-width: 1120px; margin: 0 auto; padding: 44px 32px; }
    .eyebrow { display: inline-block; font-size: 12px; font-weight: 650; letter-spacing: .14em; color: #8950bf; }
    h1 { margin: 10px 0; font-size: clamp(28px, 4vw, 38px); letter-spacing: -.04em; }
    .intro { margin: 0; color: #7b6c8b; font-size: 15px; line-height: 1.8; }
    .layout { display: grid; grid-template-columns: 1.12fr 1fr; gap: 24px; margin-top: 28px; }
    .stage { background: #fff; border: 1px solid #e9e0f2; border-radius: 28px; padding: 22px; }
    .stage-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .tag { font-size: 12px; color: #8950bf; background: #f3eafb; border-radius: 99px; padding: 7px 12px; }
    .views { display: flex; border-radius: 99px; padding: 3px; background: #f5f1f8; }
    .views button { padding: 7px 13px; border: 0; border-radius: 99px; color: #7b6c8b; background: transparent; font-size: 12px; }
    .views button[aria-pressed="true"] { background: #fff; color: #2b1b47; box-shadow: 0 2px 6px #2b1b4710; }
    .hero { height: 380px; display: flex; align-items: center; justify-content: center; margin-top: 16px; background: #faf7fd; border-radius: 20px; }
    .hero .mascot { width: 300px; height: 300px; }
    .hero.bust .mascot { width: 216px; height: 216px; border-radius: 50%; background: #eadbfd; }
    .caption { padding: 20px 4px 4px; }
    h2 { font-size: 23px; margin: 0 0 8px; }
    .description { font-size: 14px; line-height: 1.8; color: #7b6c8b; margin: 0; min-height: 51px; }
    .controls { display: flex; gap: 10px; margin-top: 20px; }
    .controls button { border: 1px solid #e9e0f2; border-radius: 12px; background: #fff; color: #705582; padding: 10px 16px; font-size: 13px; }
    .controls .primary { background: #9b51e0; color: #fff; border-color: #9b51e0; }
    .choices { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .motion:first-child { grid-column: 1 / -1; }
    .motion { display: flex; flex-direction: column; align-items: center; justify-content: center; border: 2px solid transparent; border-radius: 24px; background: #fff; color: #2b1b47; padding: 16px 10px 20px; transition: border-color .18s, background .18s; }
    .motion:hover { background: #fbf7ff; border-color: #dcc4f3; }
    .motion.selected { border-color: #9b51e0; background: #f5edfc; }
    .motion-bear { display: flex; align-items: center; justify-content: center; width: 100%; height: 168px; }
    .motion-bear .mascot { width: 156px; height: 156px; }
    .motion-name { font-size: 16px; font-weight: 650; margin: 7px 0 5px; }
    .motion-hint { font-size: 12px; line-height: 1.6; color: #897695; }
    .footnote { margin: 22px 4px 0; font-size: 12px; color: #897695; line-height: 1.8; }
    .is-paused .mascot, .is-paused .mascot * { animation-play-state: paused !important; }
    .motion-note { display: none; }
    @media (max-width: 760px) {
      main { padding: 28px 18px; }
      .layout { grid-template-columns: 1fr; gap: 18px; }
      .hero { height: 320px; }
      .hero .mascot { width: 250px; height: 250px; }
      .stage { padding: 18px; }
      .motion-bear { height: 140px; }
      .motion-bear .mascot { width: 130px; height: 130px; }
      .description { min-height: auto; }
    }
    @media (prefers-reduced-motion: reduce) {
      .motion { transition: none; }
      .motion-note { display: block; }
    }
  </style>
</head>
<body>
<main>
  <header><span class="eyebrow">熊熊滾 · 日常小動作</span><h1>熊熊滾，眨眨眼。</h1><p class="intro">點選卡片，看看五種日常小動作。連續戳大熊熊六下，牠還會「噗！」炸成兩隻。</p></header>
  <div class="layout">
    <section class="stage" aria-label="動畫預覽">
      <div class="stage-top"><span class="tag">動作預覽</span><div class="views" role="group" aria-label="檢視方式"><button type="button" data-view="full" aria-pressed="true">全身</button><button type="button" data-view="bust" aria-pressed="false">頭像</button></div></div>
      <div class="hero" id="hero">${bear("blink")}</div>
      <div class="caption" aria-live="polite"><h2 id="name">眨眨眼</h2><p class="description" id="description">${motions[0].description}</p></div>
      <div class="controls"><button class="primary" type="button" id="pause" aria-pressed="false">暫停動畫</button><button type="button" id="replay">重播這個動作</button></div>
      <p class="footnote motion-note">目前依照系統的「減少動態效果」設定，顯示靜態表情。</p>
    </section>
    <section class="choices" aria-label="選擇熊熊滾的動作">${cards}</section>
  </div>
  <p class="footnote">戳戳彩蛋也放在「問熊熊滾」頁；炸開後，按「合回一隻」就可以重新玩。</p>
</main>
<script>${script}</script>
</body>
</html>`
  fs.writeFileSync(out, html)
  console.log(`寫好了：${path.relative(path.resolve(root, ".."), out)}`)
} finally {
  await server.close()
}
