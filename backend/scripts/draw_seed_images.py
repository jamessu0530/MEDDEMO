"""畫頻道示範對話用的假照片與假 PDF，寫到 data/seed/attachments/（產出 commit 進 repo）。

    uv run --project backend python backend/scripts/draw_seed_images.py

灌資料只讀這些檔案，不需要中文字型，Docker 映像裡也不必裝；要改圖才在 Mac 上重跑這支。
內容延續 catalog.CONVERSATIONS 的情境，名稱全為虛構：御松田搶陳列位與買十送一、忠孝店補貨延遲與外盒破損、
左營店陳列位被換掉、台南診所的血糖試紙報價、杏林診所的慢箋。每張的說明寫在 catalog.SEED_ATTACHMENTS。

畫成「拍到的照片」的樣子：東西擺在背景上、稍微歪一點、加一點雜訊；固定亂數種子，重跑結果一樣。
"""

import glob
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).resolve().parents[2] / "data" / "seed" / "attachments"
FONT_CANDIDATES = [
    *glob.glob("/System/Library/AssetsV2/com_apple_MobileAsset_Font*/*/AssetData/PingFang.ttc"),
    "/System/Library/Fonts/STHeiti Medium.ttc",
]
# PingFang.ttc 裡繁體中文（TC）的 Regular、Medium、Semibold 在第 2、6、10 個
PINGFANG_TC = {"regular": 2, "medium": 6, "bold": 10}
# 直的東西（海報、報價單、DM）用直拍的尺寸
PORTRAIT = (1200, 1600)


def font(size: int, weight: str = "regular") -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        try:
            index = PINGFANG_TC[weight] if "PingFang" in path else 0
            return ImageFont.truetype(path, size, index=index)
        except OSError:
            continue
    raise SystemExit("找不到中文字型（蘋方或華文黑體），這支要在 Mac 上跑")


def centered(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], text: str, size: int, fill, weight="bold"):
    f = font(size, weight)
    left, top, right, bottom = draw.multiline_textbbox((0, 0), text, font=f, spacing=size // 4, align="center")
    x = box[0] + (box[2] - box[0] - (right - left)) / 2 - left
    y = box[1] + (box[3] - box[1] - (bottom - top)) / 2 - top
    draw.multiline_text((x, y), text, font=f, fill=fill, spacing=size // 4, align="center")


def as_photo(subject: Image.Image, background: tuple[int, int, int], size=(1600, 1200), angle=2.5, seed=0) -> Image.Image:
    """把畫好的東西擺到背景上、轉一點角度、加陰影與雜訊，看起來像手機拍的。"""
    rng = random.Random(seed)
    canvas = Image.new("RGB", size, background)
    # 背景的明暗：中間亮、四角暗
    shade = Image.radial_gradient("L").resize(size).point(lambda v: 255 - v // 3)
    canvas = Image.composite(canvas, Image.new("RGB", size, tuple(c // 2 for c in background)), shade)
    rotated = subject.convert("RGBA").rotate(angle, expand=True, resample=Image.Resampling.BICUBIC)
    shadow = Image.new("RGBA", rotated.size, (0, 0, 0, 0))
    shadow.paste((0, 0, 0, 90), mask=rotated.getchannel("A"))
    shadow = shadow.filter(ImageFilter.GaussianBlur(14))
    x = (size[0] - rotated.width) // 2
    y = (size[1] - rotated.height) // 2
    canvas.paste(shadow, (x + 18, y + 22), shadow)
    canvas.paste(rotated, (x, y), rotated)
    noise = Image.effect_noise(size, 18).convert("RGB")
    canvas = Image.blend(canvas, noise, 0.05)
    canvas = canvas.filter(ImageFilter.GaussianBlur(0.6 + rng.random() * 0.3))
    return canvas


def poster() -> Image.Image:
    """御松田的促銷海報（競品）：買十送一、通路獎勵加碼。"""
    w, h = 900, 1200
    image = Image.new("RGB", (w, h), (196, 30, 42))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, w, 210), fill=(140, 12, 24))
    centered(draw, (0, 20, w, 200), "御松田", 120, (255, 220, 120))
    centered(draw, (0, 230, w, 340), "深海魚油 Omega-3", 64, "white")
    draw.rounded_rectangle((110, 380, 790, 640), radius=40, fill=(255, 220, 120))
    centered(draw, (110, 380, 790, 640), "買十送一", 150, (160, 10, 20))
    # 魚油瓶
    draw.rounded_rectangle((330, 690, 570, 1010), radius=30, fill=(250, 245, 230))
    draw.rectangle((380, 650, 520, 700), fill=(230, 180, 40))
    centered(draw, (330, 770, 570, 930), "御松田\n魚油", 46, (160, 10, 20))
    centered(draw, (0, 1030, w, 1100), "限時檔期 10/1–10/31", 48, "white", "medium")
    centered(draw, (0, 1100, w, 1180), "通路獎勵加碼・洽御松田業務", 38, (255, 220, 120), "medium")
    return as_photo(image, (150, 140, 125), size=PORTRAIT, angle=-3, seed=1)


def shelf() -> Image.Image:
    """康泰忠孝店的貨架：我們的魚油那一格空了，黃金層擺的是御松田。"""
    w, h = 1500, 1100
    image = Image.new("RGB", (w, h), (235, 232, 225))
    draw = ImageDraw.Draw(image)
    rows = [(60, 360), (380, 680), (700, 1000)]
    for top, bottom in rows:
        draw.rectangle((40, bottom, w - 40, bottom + 30), fill=(120, 110, 100))
    boxes = [
        # 第一層（黃金層）：御松田
        [(f"御松田\n魚油", (196, 30, 42)), ("御松田\n魚油", (196, 30, 42)), ("御松田\n魚油", (196, 30, 42)),
         ("御松田\n葉黃素", (210, 120, 30)), ("御松田\n葉黃素", (210, 120, 30))],
        # 第二層：我們的魚油那一格空著，旁邊是益生菌
        [None, None, ("益生菌\n30 包", (40, 120, 90)), ("益生菌\n30 包", (40, 120, 90)), ("鈣片\n60 入", (60, 90, 160))],
        [("B 群\n60 入", (230, 170, 40)), ("B 群\n60 入", (230, 170, 40)), ("維他命 C", (240, 140, 40)),
         ("Q10", (150, 60, 120)), ("鋅錠", (90, 90, 90))],
    ]
    slot = (w - 80) // 5
    for (top, bottom), row in zip(rows, boxes, strict=True):
        for i, item in enumerate(row):
            x0 = 40 + i * slot + 18
            x1 = x0 + slot - 36
            if item is None:
                continue
            label, color = item
            draw.rounded_rectangle((x0, top + 40, x1, bottom), radius=10, fill=color)
            centered(draw, (x0, top + 40, x1, bottom), label, 44, "white")
    # 價格標籤
    for (top, bottom), row in zip(rows, boxes, strict=True):
        for i, _ in enumerate(row):
            x0 = 40 + i * slot + 60
            draw.rectangle((x0, bottom + 2, x0 + 170, bottom + 28), fill="white")
    second_bottom = rows[1][1]
    draw.rectangle((40 + 60, second_bottom + 2, 40 + 60 + 170, second_bottom + 28), fill=(255, 245, 160))
    draw.text((40 + 70, second_bottom + 2), "魚油 30 入 $450", font=font(22, "medium"), fill="black")
    draw.rectangle((40 + slot + 60, second_bottom + 2, 40 + slot + 60 + 170, second_bottom + 28), fill=(255, 245, 160))
    draw.text((40 + slot + 70, second_bottom + 2), "魚油 30 入 $450", font=font(22, "medium"), fill="black")
    draw.rounded_rectangle((90, rows[1][0] + 120, 40 + 2 * slot - 30, rows[1][0] + 200), radius=12, fill="white", outline=(196, 30, 42), width=5)
    centered(draw, (90, rows[1][0] + 120, 40 + 2 * slot - 30, rows[1][0] + 200), "暫時缺貨", 48, (196, 30, 42))
    return as_photo(image, (90, 85, 80), angle=1.5, seed=2)


def damaged_box() -> Image.Image:
    """自家的魚油 30 入，外盒一角壓壞（忠孝店到貨時破損）。"""
    w, h = 1000, 760
    image = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.polygon([(40, 60), (960, 60), (960, 700), (180, 700), (40, 560)], fill=(20, 80, 150))
    draw.polygon([(40, 560), (180, 700), (120, 590)], fill=(10, 50, 100))
    draw.line([(60, 520), (200, 690)], fill=(200, 210, 230), width=4)
    draw.line([(100, 600), (150, 640)], fill=(200, 210, 230), width=3)
    draw.rectangle((40, 60, 960, 160), fill=(240, 240, 235))
    centered(draw, (40, 60, 960, 160), "中化裕民", 64, (20, 80, 150))
    centered(draw, (200, 200, 960, 420), "魚油 30 入", 120, "white")
    centered(draw, (200, 420, 960, 520), "Omega-3｜30 粒／盒", 52, (200, 225, 255), "medium")
    centered(draw, (200, 560, 960, 640), "HS-FO30", 44, (200, 225, 255), "medium")
    return as_photo(image, (170, 160, 150), angle=-6, seed=3)


def quote() -> Image.Image:
    """康普樂開給台南診所的血糖試紙報價單（競品）。報價不能往上傳：只拿來示範 AI 只傳文字。"""
    w, h = 1000, 1300
    image = Image.new("RGB", (w, h), (252, 252, 248))
    draw = ImageDraw.Draw(image)
    centered(draw, (0, 40, w, 140), "康普樂醫材 報價單", 64, (30, 30, 30))
    draw.text((70, 170), "致：台南市 福田內科診所", font=font(36, "medium"), fill="black")
    draw.text((70, 225), "日期：2026/09/29　有效期限：30 天", font=font(30), fill=(60, 60, 60))
    top = 300
    cols = [70, 470, 640, 800, 930]
    draw.rectangle((70, top, 930, top + 70), fill=(225, 230, 240))
    for x, label in zip(cols[:-1], ["品項", "數量", "單價", "小計"], strict=True):
        draw.text((x + 14, top + 16), label, font=font(32, "bold"), fill="black")
    rows = [
        ("血糖試紙 50 片", "20 盒", "$520", "$10,400"),
        ("血糖試紙 100 片", "10 盒", "$980", "$9,800"),
        ("採血針 100 支", "10 盒", "$120", "$1,200"),
    ]
    for i, row in enumerate(rows):
        y = top + 70 + i * 80
        draw.line((70, y + 80, 930, y + 80), fill=(200, 200, 200), width=2)
        for x, value in zip(cols[:-1], row, strict=True):
            draw.text((x + 14, y + 20), value, font=font(32), fill="black")
    draw.text((560, top + 340), "合計　$21,400", font=font(40, "bold"), fill="black")
    draw.text((70, top + 430), "※ 試紙一次訂 20 盒以上，再折 5%", font=font(32, "medium"), fill=(170, 20, 20))
    draw.text((70, top + 490), "※ 搭配血糖機免費租借", font=font(32, "medium"), fill=(170, 20, 20))
    draw.ellipse((700, 1000, 900, 1200), outline=(200, 40, 40), width=8)
    centered(draw, (700, 1000, 900, 1200), "康普樂\n業務章", 34, (200, 40, 40))
    return as_photo(image, (120, 100, 80), size=PORTRAIT, angle=2, seed=4)


def leaflet_dm() -> Image.Image:
    """瑞得生技的益生菌 DM（競品），左營店櫃檯旁的陳列位換成它。"""
    w, h = 900, 1250
    image = Image.new("RGB", (w, h), (250, 248, 240))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, w, 300), fill=(40, 150, 110))
    centered(draw, (0, 30, w, 150), "瑞得生技", 80, "white")
    centered(draw, (0, 150, w, 280), "好菌益生菌 30 包", 64, (230, 255, 240))
    draw.rounded_rectangle((120, 360, 780, 560), radius=36, fill=(255, 200, 60))
    centered(draw, (120, 360, 780, 560), "買二送一", 120, (40, 100, 70))
    centered(draw, (60, 600, 840, 820), "每包 100 億活菌\n添加膳食纖維", 52, (40, 40, 40), "medium")
    draw.rounded_rectangle((120, 870, 780, 1010), radius=24, fill=(40, 150, 110))
    centered(draw, (120, 870, 780, 1010), "櫃檯旁限定陳列", 56, "white")
    centered(draw, (0, 1060, w, 1200), "活動期間 10/1–11/15\n各大連鎖藥局", 40, (90, 90, 90), "medium")
    return as_photo(image, (110, 125, 140), size=PORTRAIT, angle=-2, seed=5)


def health_pdf() -> list[Image.Image]:
    """慢性病用藥衛教單張，兩頁（A4、150dpi）。杏林診所的慢箋病人用。"""
    pages = []
    contents = [
        ("慢性病用藥小叮嚀（一）高血壓", [
            "1. 每天固定時間吃藥，不要自己停藥或減量。",
            "2. 早上起床、晚上睡前各量一次血壓，記在本子上。",
            "3. 起身時動作放慢，頭暈時先坐下休息。",
            "4. 少鹽、少喝酒，規律運動。",
            "5. 忘記吃藥：想起來就補吃；快到下一次就跳過，",
            "    不要一次吃兩倍。",
        ]),
        ("慢性病用藥小叮嚀（二）糖尿病", [
            "1. 降血糖藥照醫師指示的時間吃，跟三餐配合。",
            "2. 定期量血糖並記錄，回診時帶給醫師看。",
            "3. 出現冒冷汗、發抖、心悸，可能是低血糖：",
            "    先吃 15 公克的糖（例如半杯果汁）。",
            "4. 慢性處方箋可以在藥局領第二、三次的藥。",
            "5. 有任何用藥問題，請詢問醫師或藥師。",
        ]),
    ]
    for title, lines in contents:
        page = Image.new("RGB", (1240, 1754), "white")
        draw = ImageDraw.Draw(page)
        draw.rectangle((0, 0, 1240, 220), fill=(30, 110, 170))
        centered(draw, (0, 0, 1240, 220), title, 56, "white")
        for i, line in enumerate(lines):
            draw.text((110, 320 + i * 110), line, font=font(44, "medium"), fill=(30, 30, 30))
        draw.line((110, 1540, 1130, 1540), fill=(200, 200, 200), width=3)
        draw.text((110, 1570), "杏林診所　關心您的健康　｜　本單張僅供參考，用藥請遵照醫囑", font=font(30), fill=(110, 110, 110))
        pages.append(page)
    return pages


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    photos = {
        "yushotian-poster.jpg": poster(),
        "zhongxiao-shelf.jpg": shelf(),
        "fish-oil-box-damaged.jpg": damaged_box(),
        "kangpule-quote.jpg": quote(),
        "ruide-probiotics-dm.jpg": leaflet_dm(),
    }
    for name, image in photos.items():
        image.save(OUT / name, "JPEG", quality=85, optimize=True)
    first, *rest = health_pdf()
    first.save(OUT / "chronic-medication-leaflet.pdf", "PDF", resolution=150, save_all=True, append_images=rest)
    for path in sorted(OUT.iterdir()):
        print(f"{path.name}\t{path.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
