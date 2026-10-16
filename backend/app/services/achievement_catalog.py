"""成就名稱與條件；品類課程不影響新人五關的 AI 解鎖。"""

PRODUCT_CATEGORIES = {
    "chronic": "慢性處方",
    "otc": "一般用藥",
    "wellness": "保健品",
    "devices": "醫材",
}
LESSON_STEPS = ("品類辨識", "規格核對", "情境練習")
MEDAL_NAMES = {
    "stores": ("初次到訪", "街坊熟客", "藥局巡訪家"),
    "cities": ("城市起點", "跨城探索", "縣市旅行家"),
    "chronic": ("處方品類入門", "處方規格熟手", "處方品項達人"),
    "otc": ("一般用藥入門", "用藥品項熟手", "一般用藥達人"),
    "wellness": ("保健品入門", "保健品辨識員", "保健品達人"),
    "devices": ("醫材入門", "器材辨識員", "醫材達人"),
}


def lesson_id(kind: str, tier: int) -> str:
    return f"product-{kind}-{tier}-v1"


def medal_details(kind: str, tier: int, need: int) -> dict:
    if kind in PRODUCT_CATEGORIES:
        label = PRODUCT_CATEGORIES[kind]
        steps = "、".join(LESSON_STEPS[:tier])
        return {
            "title": MEDAL_NAMES[kind][tier - 1],
            "condition": f"依序通過{label}的{steps}，每關全部答對。",
            "unit": "關",
            "action_path": f"/learning/products/{kind}/{tier}",
        }
    unit = "家" if kind == "stores" else "個縣市"
    target = "家不同藥局" if kind == "stores" else "個不同縣市"
    return {
        "title": MEDAL_NAMES[kind][tier - 1],
        "condition": f"在今日路線點選站點，累積到訪 {need} {target}。",
        "unit": unit,
        "action_path": "/route",
    }
