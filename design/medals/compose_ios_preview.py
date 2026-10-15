"""Comparison sheet using the actual renders from the iOS design round."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/"frontend/public/medal-designs"
FONT="/System/Library/Fonts/Supplemental/Arial Unicode.ttf"
def font(size):return ImageFont.truetype(FONT,size)
styles=[
 ("ios-A-orbit","A  活力圓環","Fitness 靈感 · 漸層圓環"),
 ("ios-B-soft","B  柔光方章","連續圓角 · 柔白紫色"),
 ("ios-C-crystal","C  晶透徽章","霧透外殼 · 青藍層次"),
]
im=Image.new("RGB",(1800,1130),"#f5f5f7")
d=ImageDraw.Draw(im)
d.text((65,43),"MEDDEMO  /  DESIGN STUDY 02",font=font(20),fill="#777780")
d.text((65,88),"更簡潔，更接近 iOS。",font=font(51),fill="#1d1d1f")
d.text((68,164),"每款都有金、銀、銅  ·  左：藥局  /  右：縣市",font=font(23),fill="#777780")
small=[]
for i,(stem,title,description) in enumerate(styles):
    x=55+i*575; y=235
    d.rounded_rectangle((x,y,x+540,y+590),radius=28,fill="#ffffff")
    pic=Image.open(OUT/f"{stem}.png").convert("RGBA")
    pic.thumbnail((535,430),Image.Resampling.LANCZOS)
    im.paste(pic,(x+(540-pic.width)//2,y+30),pic)
    d.text((x+31,y+457),title,font=font(30),fill="#1d1d1f")
    d.text((x+31,y+508),description,font=font(22),fill="#777780")
    original=Image.open(OUT/f"{stem}.png").convert("RGBA")
    left=original.crop((0,0,original.width//2,original.height))
    left=left.crop(left.getbbox())
    left.thumbnail((84,84),Image.Resampling.LANCZOS)
    small.append(left)
d.text((67,861),"小尺寸辨識",font=font(24),fill="#1d1d1f")
for i,pic in enumerate(small):
    x=65+i*575
    d.rounded_rectangle((x,916,x+248,1065),radius=20,fill="#ffffff")
    d.rounded_rectangle((x+266,916,x+514,1065),radius=20,fill="#202126")
    for shift in [0,266]:
        im.paste(pic,(x+shift+(248-pic.width)//2,938),pic)
    d.text((x+103,1038),"淺色",font=font(15),fill="#777780")
    d.text((x+369,1038),"深色",font=font(15),fill="#a9a9b0")
im.save(OUT/"ios-comparison.png",optimize=True)
