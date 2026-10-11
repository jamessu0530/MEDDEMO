-- 完整商品型錄不分客戶，全公司共用。沒有交易的商品也能查到。
-- 同一份 View 給商品頁與 AI 用；型錄的展示價格、成本與未提供的庫存不在這裡公開。
CREATE OR REPLACE VIEW v_product AS
SELECT sku, name AS product_name, category, spec, unit, aliases, common
FROM product;

COMMENT ON VIEW v_product IS '完整商品型錄，一個料號一列，包含沒有銷售紀錄的商品。查品名、料號、類別、規格、計量單位、口語別名或品項數量時用這個 View，不要用銷售或促銷 View 推斷是否有這個商品。全公司共用。';
COMMENT ON COLUMN v_product.sku IS '唯一料號，計算品項數用 count(*)；同名不同料號是不同品項';
COMMENT ON COLUMN v_product.product_name IS '商品名稱；可用 ILIKE 搭配部分品名或品牌搜尋，英文不分大小寫';
COMMENT ON COLUMN v_product.category IS '保健品／慢性處方／一般用藥／醫材／日用品；只算藥品時包含慢性處方與一般用藥';
COMMENT ON COLUMN v_product.spec IS '規格；空字串代表沒有另外提供，品名本身可能包含規格';
COMMENT ON COLUMN v_product.unit IS '基礎計量單位，例如盒、瓶、支、組';
COMMENT ON COLUMN v_product.aliases IS '業務口語別名的文字陣列，可用 array_to_string(aliases, '' '') ILIKE 搜尋';
COMMENT ON COLUMN v_product.common IS '是否為常用品項；查完整型錄或總數時不要只篩選 common';
GRANT SELECT ON v_product TO semantic_reader;
