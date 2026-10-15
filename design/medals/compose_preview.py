"""Compose the four Blender renders into a labeled comparison sheet."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/"frontend/public/medal-designs"
FONT="/System/Library/Fonts/Supplemental/Arial Unicode.ttf"
def font(size): return ImageFont.truetype(FONT,size)
styles=[
    ("A-laurel","A  月桂典藏","深藍琺瑯 · 月桂浮雕 · 典雅榮譽"),
    ("B-hexagon","B  六角科技","青綠電路 · 六角切面 · 俐落專業"),
    ("C-compass","C  旅行羅盤","象牙錶盤 · 方位刻度 · 跑點探索"),
    ("D-paw","D  療癒熊掌","柔和花邊 · 立體熊掌 · 親切收藏"),
]
canvas=Image.new("RGB",(2000,1660),"#f4f0e9")
d=ImageDraw.Draw(canvas)
d.text((80,46),"MEDDEMO / MEDAL COLLECTION",fill="#84745d",font=font(22))
d.text((80,94),"四款獎牌設計提案",fill="#342e29",font=font(53))
d.text((82,172),"Blender 3D 建模  /  每款提供金、銀、銅  /  左：藥局  ·  右：縣市",fill="#928572",font=font(23))
for i,(stem,title,sub) in enumerate(styles):
    x=65+(i%2)*960
    y=238+(i//2)*686
    d.rounded_rectangle((x,y,x+910,y+650),radius=22,fill="#fbf8f2")
    picture=Image.open(OUT/f"{stem}.png").convert("RGBA")
    picture.thumbnail((860,545),Image.Resampling.LANCZOS)
    canvas.paste(picture,(x+(910-picture.width)//2,y+20),picture)
    d.text((x+36,y+558),title,fill="#3a322c",font=font(32))
    d.text((x+36,y+605),sub,fill="#91816c",font=font(22))
d.text((80,1620),"ACTUAL BLENDER RENDERS  ·  2026.10",fill="#a09587",font=font(16))
canvas.save(OUT/"comparison.png",optimize=True)
