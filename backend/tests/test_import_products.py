"""Salesforce 產品清單轉真實型錄（data/seed/import_products.py）。"""

import catalog
import generate
import import_products as ip

# 照 Salesforce 清單整頁複製下來的樣子：欄位標題一段一段，接著每一筆一段。
# 有的沒有產品中文名稱、有的多一行狀態；最後一筆後面接著 2000 筆上限的提示
COPIED = """

排序
產品名稱

排序
料號

排序
產品系列


2026歐姆龍低週波陳列架
000000000000020272
管量不管價
組、件
HVF311展示架
376
Check

腰部中等仿生骨曲線護具 BP61 L
F762718
代理品
組、件
468
Check

虎讚 Zan tab.5MG 28T/PTP
C490191
成品
盒
虎讚 Zan tab.5MG 28T/PTP
0
Check

中衛口罩-丹寧牛仔/30入.停產(有庫存)
M475589
代理品
盒
中衛口罩-丹寧牛仔/30入
0
Warning
停產(有庫存)

中化健康360海藻鈣鎂錠 10顆/盒
F763142
代理品
盒
120
Check

中化健康360海藻鈣鎂錠 10顆/盒
F763142-30
代理品
盒
3
Check

限制成品(預算專用)
F999992
成品
盒
0
Check

獅美露康德目耀PURE 15ML/BTL
F762488
代理品
瓶
獅美露康德目耀PURE 15ML/BTL
0
Check
我們目前暫不支援檢視清單中超過 2000 筆的記錄
"""


def test_each_copied_block_keeps_its_first_four_fields_and_the_header_blocks_are_skipped():
    records, truncated = ip.parse(COPIED)
    assert [r.sku for r in records] == [
        "000000000000020272", "F762718", "C490191", "M475589", "F763142", "F763142-30", "F999992", "F762488",
    ]
    assert records[1] == ip.Record("腰部中等仿生骨曲線護具 BP61 L", "F762718", "代理品", "組、件")
    # 清單被切在 2000 筆：要倒序再複製一份
    assert truncated
    assert ip.parse(COPIED.replace("我們目前暫不支援檢視清單中超過 2000 筆的記錄", ""))[1] is False


def test_only_sellable_products_go_in_with_clean_unique_names():
    records, _ = ip.parse(COPIED)
    # 促銷方案已經有 PURE 眼藥水（F762488）：不重複加
    rows = {row["料號"]: row for row in ip.build(records, [], {"F762488"}, set())}
    # 陳列架（管量不管價）與預算專用的不是商品
    assert set(rows) == {"F762718", "C490191", "M475589", "F763142", "F763142-30"}
    # 狀態的尾巴拿掉；同名不同料號的，品名後面加料號
    assert rows["M475589"]["品名"] == "中衛口罩-丹寧牛仔/30入"
    assert rows["F763142"]["品名"] == "中化健康360海藻鈣鎂錠 10顆/盒（F763142）"
    assert rows["F763142-30"]["品名"] == "中化健康360海藻鈣鎂錠 10顆/盒（F763142-30）"
    assert rows["F762718"]["單位"] == "組" and rows["M475589"]["單位"] == "盒"
    assert {sku: row["類別"] for sku, row in rows.items()} == {
        "F762718": "醫材", "C490191": "慢性處方", "M475589": "醫材", "F763142": "保健品", "F763142-30": "保健品",
    }


def test_categories_follow_the_name_before_the_series():
    def category(name, sku="M000001", series="代理品"):
        return ip.category_of(ip.Record(name, sku, series, "個"))

    # 寵物益生菌、除菌酒精濕巾的品名裡也有保健品、醫材的字，日用品先比
    assert category("毛毛好室雙效益生菌-泌尿好守護 1.5GX2包") == "日用品"
    assert category("日本大王家庭清潔除菌酒精濕巾 補充包70抽*2包") == "日用品"
    assert category("獅王Charmy Magica濃縮洗潔精-柑橙 220ML") == "日用品"
    assert category("歐姆龍MC-F300紅外線額溫槍", "F765625") == "醫材"
    assert category("獅美露雪漾Whiteye 15ml/Box", "F749634") == "一般用藥"
    # 代理的處方藥看英文劑型；D 開頭的成品不是藥，照品名推
    assert category("ABIRATRED Film-Coated Tab 250mg 120T/BT", "F760297") == "慢性處方"
    assert category("綠的乾洗手75%60ml", "M474399", "成品") == "日用品"
    assert category("中化360海藻鈣錠 60錠", "F762505") == "保健品"
    assert category("ANTI-A 500ML", "D140503", "成品") == "醫材"


def test_rerunning_keeps_the_rows_already_in_the_tsv():
    records, _ = ip.parse(COPIED)
    # 業務改過類別與價錢的那一列，重跑不會被蓋回去；只加新的料號
    edited = {"料號": "F762718", "品名": "BP61 護腰 L", "類別": "保健品", "單位": "組", "出貨價": "777"}
    rows = ip.build(records, [edited], {"F762488"}, set())
    assert edited in rows
    assert len(rows) == 5 and [row["料號"] for row in rows] == sorted(row["料號"] for row in rows)
    # 名稱跟已經有的撞到，新的那一列加料號
    taken = ip.build(records, [], {"F762488"}, {"中衛口罩-丹寧牛仔/30入"})
    assert {row["料號"]: row["品名"] for row in taken}["M475589"] == "中衛口罩-丹寧牛仔/30入（M475589）"


def test_the_made_up_price_is_stable_and_sits_in_its_band():
    price = ip.price_of("F762718", "醫材", "腰部中等仿生骨曲線護具 BP61 L")
    assert price == ip.price_of("F762718", "醫材", "腰部中等仿生骨曲線護具 BP61 L")
    assert 350 <= price <= 900 and price % 10 == 0
    low, high = ip.CATEGORY_PRICE["日用品"]
    assert all(low <= ip.price_of(f"M{n:06d}", "日用品", "牙刷") <= high for n in range(200))


def test_the_committed_catalog_has_unique_skus_and_names_and_known_categories():
    rows = generate.read_real_products()
    skus = [row["料號"] for row in rows]
    names = [row["品名"] for row in rows] + [p[1] for p in catalog.PRODUCTS] + [p[1] for p in catalog.PROMO_PRODUCTS]
    assert len(set(skus)) == len(skus) and len(set(names)) == len(names)
    # 促銷品項與虛構品項的料號不重複出現在型錄裡
    assert not set(skus) & ({p[0] for p in catalog.PRODUCTS} | {p[0] for p in catalog.PROMO_PRODUCTS})
    assert {row["類別"] for row in rows} == set(ip.CATEGORY_PRICE)
    assert all(int(row["出貨價"]) > 0 for row in rows)
    # 常用品項都在型錄裡
    assert set(catalog.COMMON_REAL_PRODUCTS) <= set(skus)
