"""正式選品不顯示舊版虛構商品；既有交易資料仍可查閱。"""

from sqlalchemy import and_
from app.models import Product

# catalog.PRODUCTS 的 40 個虛構料號；真實型錄與真實促銷料號不受影響。
DEMO_PRODUCT_SKUS = (
    "HS-FO30", "HS-FO90", "HS-CA60", "HS-PB30", "HS-LT30", "HS-VB60", "HS-VC100",
    "HS-VD60", "HS-GL60", "HS-CQ30", "HS-ZN60", "HS-FE30", "HS-MV60", "HS-CL30",
    "RX-AML5", "RX-LOS50", "RX-MET500", "RX-GLI2", "RX-ATV10", "RX-ROS10", "RX-CLO75",
    "RX-ASP100", "RX-OME20", "RX-ALL100", "RX-TAM02", "RX-BIS5",
    "OT-AC500", "OT-IB200", "OT-CF10", "OT-CS120", "OT-AL10", "OT-GA12", "OT-EY15",
    "OT-PT10", "OT-LX20", "OT-MW500", "MD-MASK50", "MD-GLU50", "MD-BPM", "MD-THM",
)

# 只排除完整測試標記，避免把照片雜湊或合法料號中間的 e04 誤判成商品。
TEST_SKU_PATTERN = r"^(demo|dummy|fake|test|e04)([-_ :]|$)"
TEST_NAME_PATTERN = r"(^|[^a-z0-9])(e04|demo|dummy|fake)([^a-z0-9]|$)|^(示範|教學|測試商品|測試產品|測試用|虛構|不存在|模擬)"


def visible_catalog_products():
    return and_(
        Product.sku.not_in(DEMO_PRODUCT_SKUS),
        Product.sku.op("!~*")(TEST_SKU_PATTERN),
        Product.name.op("!~*")(TEST_NAME_PATTERN),
    )
