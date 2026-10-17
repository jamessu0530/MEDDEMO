"""Guard against the old nearest-looking medicine/photo substitutions."""
import importlib.util
from pathlib import Path


script = Path(__file__).resolve().parents[2] / "scripts/match_verified_product_photos.py"
spec = importlib.util.spec_from_file_location("verified_photo_matcher", script)
matcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(matcher)


def product(name, category="慢性處方"):
    return {"sku": "TEST-PHOTO", "name": name, "category": category}


def source(title, english=""):
    return {"title": title, "englishName": english, "pageUrl": "https://www.cenra-pharma.com/tw/product/test", "imageUrl": "https://www.cenra-pharma.com/test.png"}


def test_different_medicine_or_strength_never_matches():
    zan = source("虎讚膜衣錠20毫克", "ZAN Film-Coated Tablets 20mg")
    assert matcher.choose(product("ZAN TAB. 5MG 28T/PTP"), [zan]) is None
    assert matcher.choose(product("OTHER TAB. 20MG 28T/PTP"), [zan]) is None
    match = matcher.choose(product("ZAN TAB. 20MG 4T/PTP"), [zan])
    assert match["kind"] == "series"


def test_same_brand_different_dosage_form_or_volume_never_matches():
    tablets = source("同品牌錠10毫克", "Medicine Tablets 10mg")
    assert matcher.choose(product("Medicine Capsules 10mg 30C/BTL"), [tablets]) is None
    injection = source("亞魯特注射液5000單位/毫升5毫升", "Agglutex Injection 5000U./ml 5ml")
    assert matcher.choose(product("AGGLUTEX INJ. 5000U 10ML*25V"), [injection]) is None
    assert matcher.choose(product("AGGLUTEX INJ. 5000U 5ML*10V"), [injection])["kind"] == "series"


def test_reviewed_photo_only_applies_to_unchanged_catalog_row():
    medicine = product("5-HTP CAP. 100MG 50C/BTL")
    photo = source("5-羥基色氨酸膠囊100公絲", "5-HTP Capsules 100mg")
    photo['reviewedProducts'] = [{**medicine, 'kind': 'series', 'note': '原廠100mg膠囊；未呈現50粒瓶裝'}]
    assert matcher.choose(medicine, [photo])['kind'] == 'series'
    assert matcher.choose({**medicine, 'sku': 'ANOTHER-SKU'}, [photo]) is None
    assert matcher.choose(product("5-HTP CAP. 50MG 50C/BTL"), [photo]) is None
    assert matcher.choose({**medicine, 'category': '日用品'}, [photo]) is None


def test_device_accessory_cannot_use_main_device_photo():
    device = source("低週波治療器 HV-F127")
    assert matcher.choose(product("HV-F127 貼片", "醫材"), [device]) is None


def test_shampoo_conditioner_and_foam_remain_distinct():
    shampoo = source("BOTANIST 植物性洗髮精(滋潤型)")
    assert matcher.choose(product("BOTANIST 植物性潤髮乳(滋潤型)", "日用品"), [shampoo]) is None
    body_wash = source("BOTANIST 植物性沐浴乳(滋潤型)")
    assert matcher.choose(product("BOTANIST 沐浴慕斯(滋潤型)", "日用品"), [body_wash]) is None
    duo = source("BOTANIST 植物性洗髮精／潤髮乳（滋潤型）")
    assert matcher.choose(product("BOTANIST 植物性潤髮乳(滋潤型) 460G", "日用品"), [duo])["kind"] == "series"


def test_child_mask_and_collateral_do_not_use_adult_product_photo():
    adult = source("中衛醫療口罩 成人平面 黑色")
    assert matcher.choose(product("中衛兒童口罩 天空藍", "醫材"), [adult]) is None
    assert matcher.choose(product("中衛成人口罩條碼貼", "醫材"), [adult]) is None
