# 大頭貼與字體大小

2026-10-01

接在〈在線狀態與即時連線〉（2026-10-01-presence-design.md）之後：頭像原本只有名字縮寫，現在可以換成自己的照片；
設定頁另外多一個字體大小。

## 已定案的決定

1. **所有帳號都能換大頭貼**，公司帳號也可以。名字是公司資料、自己不能改；照片不是。
2. **IT 可以移除別人的大頭貼**：自建帳號誰都能開，上傳的照片全公司看得到，跟 IT 刪訊息是同一個理由。
3. **字體大小三段**：標準、大、特大，記在這支手機上，跟配色一樣，跟帳號無關。

## 大頭貼

### 上傳與整理

- 設定頁「大頭貼」一段：換照片（拍照或相簿）、移除照片。前端先從中間裁成正方形、縮到 512px 再傳。
- 後端不信任前端，重新整理一次（`services/avatars.py`）：只收 JPEG、PNG、WebP，依 EXIF 轉正、**清掉 EXIF**
  （拍攝地點、機型）、從中間裁成正方形、縮成 256×256 的 JPEG。透明的地方墊白。單檔上限跟附件一樣 15MB。
  看圖片的程式沿用 `services/attachments.py`。
- 沒有照片、或照片載入失敗時，照舊顯示名字縮寫（`AvatarFallback`）。

### 資料

`user_avatar`，一個帳號最多一列：`user_id`（PK，FK `app_user`，ON DELETE CASCADE）、`content`（bytea，256×256 JPEG，約 20KB）、
`version`（每換一次加一）、`updated_at`。跟附件一樣存在資料庫，API 與背景工作不必共用磁碟。

### 網址與快取

`<img>` 帶不了登入的 token。大頭貼用「知道網址才拿得到」的做法：

- `GET /api/avatars/{user_id}/{version}.jpg?sig=…`，`sig` 是用登入密鑰對（帳號、版本）簽的，沒有期限、不分看的人。
- 換照片或移除，版本就變了，舊網址一律 404；所以內容永遠不變，可以 `Cache-Control: private, max-age=31536000, immutable`。
- 網址只從要登入的 `GET /api/avatars` 拿得到。外面的人猜得到工號，也猜不到簽名。
- 停用的帳號不列、網址也 404。

### 誰的大頭貼

- 所有人都在全國頻道，看得到彼此的名字與狀態，大頭貼也一樣：`GET /api/avatars` 回全部有照片的人
  `{ "U01": "/api/avatars/U01/3.jpg?sig=…" }`。前端登入後拿一次，存在 `lib/avatars.ts`，`UserAvatar` 依帳號查。
- 有人換了或移除照片，發即時事件 `{"type": "avatars"}`（app/realtime.py），每條連線轉給手機，手機重拿一次。
  重連（resync）時也重拿。

### API

| 方法 | 路徑 | 內容 |
|---|---|---|
| GET | `/api/avatars` | 有大頭貼的人與網址 |
| POST | `/api/avatars/me` | 上傳（multipart，欄位 `file`），回 `{url}`；算在用量上限的「換大頭貼」（每小時 20、每天 300） |
| DELETE | `/api/avatars/me` | 移除自己的 |
| DELETE | `/api/avatars/{user_id}` | IT 移除別人的 |
| GET | `/api/avatars/{user_id}/{version}.jpg?sig=` | 圖片本身，不用登入 |

IT 移除的入口在頻道的成員清單：IT 看到每個有照片的人旁邊有「移除照片」。

### 個資

隱私權頁補上：大頭貼全公司的帳號都看得到；上傳時清掉 EXIF；刪帳號時一起刪；IT 可以移除。

## 字體大小

- `lib/text-size.ts`：`standard`／`large`／`xlarge`，存在 `localStorage` 的 `meddemo:text-size`，
  掛在 `<html data-text-size>`；`index.css` 依它把根字級設成 100%／112.5%／125%。`index.html` 在畫面出來前先掛，
  跟配色一樣不會先閃一下標準大小。
- Tailwind 的字級、間距、圓角都是 rem，會一起等比例放大，版面不會跑掉。
- 程式裡寫死像素的字級（`text-[11px]` 等 77 處）換成 rem（`text-[0.6875rem]`），不然那些小字不會跟著放大。
  吉祥物、圖示這類用像素指定大小的圖不放大。
- 設定頁「配色」下面一段「字體大小」，三個按鈕各用自己的大小寫一個「字」。

## 測試

- pytest：上傳後 EXIF 被清掉、裁成 256×256 正方形；不是圖片 415；簽名不對、版本舊了、帳號停用 404；
  換照片版本加一、舊網址失效；`GET /api/avatars` 不含停用的帳號；只有 IT 能移除別人的；刪帳號一起刪。
- vitest：大頭貼 store 的更新；字體大小讀寫（讀不到 localStorage 時是標準）。

## 不在這次範圍

- 用 Google、GitHub 帳號的大頭貼。
- 裁切畫面（自己拖拉選範圍）：一律從中間裁。
- 頁面縮放之外的無障礙設定（高對比、減少動畫）。
