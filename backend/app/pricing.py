"""標準供貨價：建議售價（product.unit_price）乘上客戶類型的折數。

SAP 報價一律以標準供貨價為基準（data/documents/04-報價權限.md）；假資料的交易金額與歷史報價也用同一份折數。
"""

SUPPLY_PRICE_FACTOR = {"chain": 0.90, "independent": 0.95, "clinic": 1.00}


def supply_price(list_price, customer_type: str) -> int:
    return round(float(list_price) * SUPPLY_PRICE_FACTOR[customer_type])
