# 個人主頁：公司打卡與工作目標

入口為 `/me`，業務、主管與 IT 都可使用。桌機點側邊欄姓名進入，手機可從帳號設定的「個人主頁 · 打卡與目標」進入，主管頁另有個人主頁圖示。

直接按「進公司打卡」或「離開公司」，由伺服器記錄當下時間。依台灣當日最近一筆打卡顯示「在公司／已離開公司」，沒有當日紀錄顯示「尚無打卡紀錄」，不推斷曠職。只有進出公司紀錄，不讀取 GPS、線上狀態，也沒有遲到判定與簽核。重送同一操作編號與同方向連點不重複記錄。隔日重新開始顯示當日紀錄；歷史紀錄保留於資料庫。

個人目標可新增、編輯、刪除，包含名稱、說明、完成日及 0～100% 進度。打卡與目標歸真正登入者所有，不借用示範業務的資料。主管只看到自己團隊的打卡狀態，IT 可看公司帳號；任何角色都不能讀取其他人的個人目標。

畫面每 30 秒及回到分頁時重新取得資料。讀取失敗會標示保留的舊資料，待重新整理成功後再提供打卡操作。桌機採 Workday 首頁的左寬右窄配置：左欄顯示打卡、目標與團隊，右欄顯示快速操作、目標完成日與既有個人功能；手機改為直向卡片及抽屜選單。

## Workday 視覺語言

個人主頁使用完整的 Workday 式外框：白色全域搜尋列、租戶商標、細線選單、橫幅插畫、Soap 灰底、白色低陰影卡片、Blueberry 藍色操作，以及膠囊形按鈕。字體依 Canvas 的 Roboto／Helvetica／Arial 字體組合並補上繁體中文系統字型。搜尋列支援目前角色的功能搜尋與 ⌘K／Ctrl+K；帳號設定與示範身分移入個人帳號選單，工作助理由頁首開啟。抽屜與個人選單獨立處理 Tailwind 的 translate 屬性，避免手機面板偏移。

此外框只套用於 `/me`，既有其他頁面保留原導覽。外框保留穩定的子樹位置，避免切到個人主頁時重新掛載保留中的報表工作區。

設計參考為 [Workday 官方產品首頁截圖](https://www.workday.com/content/dam/web/uk/documents/are-you-maximising-your-full-user-potential-wdlive-london-uk.pdf)、[Canvas Kit](https://github.com/Workday/canvas-kit) 與 [Canvas 字體／色彩說明](https://github.com/Workday/canvas-kit/blob/master/modules/react/tokens/README.md)。橫幅使用專案內的 SVG，頁首保留中化裕民商標。

## 本機啟用

使用後端環境執行 `python backend/scripts/create_workplace_tables.py`，只新增缺少的 `attendance_event` 與 `work_goal` 資料表，不修改既有資料或 schema_version；重新啟動後端載入路由。正式部署沿用 `upgrade_schema.py` 的保留資料升級路徑。

## API

| 方法 | 路徑 | 用途 |
| --- | --- | --- |
| GET | `/api/workplace` | 本人今日紀錄、可見團隊狀態及本人目標 |
| POST | `/api/workplace/punch` | `{direction: "in" 或 "out", request_id: UUID}`；不接受指定其他人 |
| POST | `/api/workplace/goals` | 新增本人目標 |
| PUT / DELETE | `/api/workplace/goals/{id}` | 更新／刪除本人目標 |
| POST | `/api/workplace/events` | IT 接收既有打卡來源；以 source 與 external_id 去重 |

外部來源僅應傳入進出公司的打卡，事件包含 `external_id`、`user_id`、`direction` 與附時區的 `occurred_at`。相同時間的進出事件以離開公司為準；同一編號若內容不同，整批不寫入。

視覺參考 [Workday Time Tracking](https://www.workday.com/en-us/products/workforce-management/time.html)，沿用現有系統品牌與導覽。

驗證使用隔離 PostgreSQL 資料庫及虛構帳號，涵蓋重送、進出公司、台灣午夜、團隊範圍、本人資料歸屬、目標操作、來源匯入與保留資料升級；另完成前端型別檢查、正式建置、導覽測試及手機／桌機實際操作。
