import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  // 本機開發時把 API 請求轉給 uvicorn；正式環境由 Nginx 轉（nginx.conf）
  server: {
    proxy: {
      // WebSocket（在線狀態與新訊息通知）要寫在 /api 前面，不然被 /api 那條先接走、不會升級連線
      "/api/ws": { target: "ws://127.0.0.1:8000", ws: true },
      "/api": "http://127.0.0.1:8000",
      "/health": "http://127.0.0.1:8000",
    },
  },
  // 只測純邏輯模組（src/ask 的對話 store、src/lib 的促銷整理）：元件與 Live 連線靠 build 與實際操作驗
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
})
