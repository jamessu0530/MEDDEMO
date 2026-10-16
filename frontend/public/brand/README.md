# 中化裕民商標

`cenra-healthcare.png` 是中化製藥官方「關係公司」頁標示為「中化裕民」的 CENRA+ Healthcare 商標，保留下載時的原始 PNG、透明背景、顏色與比例。

- 官方來源頁：https://www.cenra-pharma.com/tw/affiliated-enterprise
- 原始圖檔：https://www.cenra-pharma.com/uploads/images/About/CHC_logo_RGB.png
- 取得日期：2026-10-16
- 原始尺寸：259 × 83 px

商標由原權利人持有；專案中的展示用途不代表取得授權或官方背書。

畫面透過 `src/components/company-logo.tsx` 共用這份本機資產，避免依賴外站圖片連線。商標旁的「中化裕民」或系統名稱是介面文字，並非原始圖檔的一部分。

商標僅在登入頁以 550ms 輕微淡入一次（不透明度 65% 至 100%），其餘頁面維持靜態。沒有掃光、光圈、星芒，也不因滑鼠移入、觸控或鍵盤焦點重播；系統偏好減少動態效果時完全靜態。開發環境可在 `/brand-motion.html` 手動預覽淺色與深色背景。

## MEDDEMO 登入應用程式圖示

`meddemo-app-icon.png` 是網站原有熊熊滾 favicon 的 1024 × 1024 PNG 版本，供 MEDDEMO 的 Meta App 登入授權畫面使用。來源是 `frontend/index.html` 的內嵌 SVG，背景補為相同的淺紫色（`#EADBFD`），沒有使用上方的企業商標。
