-- 建完資料表之後執行（app.db.reset_schema），資料表本身定義在 app/models.py。

-- 展示用的「今天」。假資料以這一天為基準往前產生；View 一律用 app_today() 而不用
-- CURRENT_DATE，評測題庫的答案才不會隨真實日期漂移。
-- SECURITY DEFINER：唯讀角色查 View 時不需要另外開 app_setting 的讀取權限。
CREATE FUNCTION app_today() RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT value::date FROM app_setting WHERE key = 'as_of_date'), CURRENT_DATE)
$$;

-- 語意層：數字查詢代理只能讀這幾個 View，不碰底層表（SDD 議題 3）。
-- 欄位註解會一併交給產生 SQL 的模型，單位與陷阱要寫在註解裡。

-- 資料權限（backend/app/services/scope.py）：組織是一棵樹，每個人有一條路徑，
-- 例如業務 U01 是 TW.N.M01.U01、他的主管 M01 是 TW.N.M01。
-- sql_executor 在每次查詢的交易裡設定查詢者的路徑，每個 View 宣告自己的共享深度。
--
-- 可見範圍 = 把查詢者的路徑截到該 View 的深度，再問「這是不是對方路徑的祖先」（@>）。
-- least() 是關鍵：主管的路徑比較短，截不動，所以他在任何深度都涵蓋自己底下的人——
-- 「主管看得到屬下」不是另一條規則，是同一個式子的結果。
--
-- 深度：1=全國 TW，2=區 TW.N，3=團隊 TW.N.M01，4=個人 TW.N.M01.U01。
-- 沒設定就不過濾（評測、背景排程）。current_setting(..., true) 在沒設過時回 NULL，不會報錯
CREATE FUNCTION app_in_scope(owner_path ltree, share_depth int) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE
    WHEN COALESCE(current_setting('app.scope_path', true), '') = '' THEN true
    ELSE subpath(current_setting('app.scope_path', true)::ltree, 0,
                 least(share_depth, nlevel(current_setting('app.scope_path', true)::ltree)))
         @> owner_path
  END
$$;

CREATE VIEW v_monthly_sales AS
SELECT date_trunc('month', t.date)::date AS month,
       c.id                               AS customer_id,
       c.name                             AS customer_name,
       c.type                             AS customer_type,
       c.chain_group,
       c.region,
       c.grade,
       c.owner_user_id,
       p.category,
       p.sku,
       p.name                             AS product_name,
       sum(t.qty)::integer                AS qty,
       sum(t.amount)                      AS amount,
       sum(t.cost)                        AS cost,
       sum(t.listing_fee + t.channel_reward) AS channel_fee,
       count(DISTINCT t.order_no)::integer AS order_count
FROM sales_transaction t
JOIN customer c ON c.id = t.customer_id
JOIN product p ON p.sku = t.sku
JOIN app_user owner ON owner.id = c.owner_user_id
WHERE app_in_scope(owner.org_path, 2)   -- 銷售數字：同一區看得到
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11;

COMMENT ON VIEW v_monthly_sales IS '每月 × 客戶 × 品項的銷售彙總。金額單位為新台幣元。';
COMMENT ON COLUMN v_monthly_sales.month IS '該月第一天';
COMMENT ON COLUMN v_monthly_sales.customer_type IS 'chain=連鎖藥局, independent=獨立藥局, clinic=診所';
COMMENT ON COLUMN v_monthly_sales.region IS '北區／中區／南區';
COMMENT ON COLUMN v_monthly_sales.category IS '保健品／慢性處方／一般用藥／醫材';
COMMENT ON COLUMN v_monthly_sales.channel_fee IS '上架費＋通路獎勵';
COMMENT ON COLUMN v_monthly_sales.order_count IS '該月含此品項的進貨次數；跨品項加總會重複計算同一張訂單';

CREATE VIEW v_customer_summary AS
WITH orders AS (
  SELECT customer_id, order_no, min(date) AS date, sum(amount) AS amount
  FROM sales_transaction
  GROUP BY customer_id, order_no
), gaps AS (
  SELECT customer_id, date, amount,
         date - lag(date) OVER (PARTITION BY customer_id ORDER BY date) AS gap_days
  FROM orders
), order_stats AS (
  SELECT customer_id,
         max(date) AS last_order_date,
         sum(amount) FILTER (WHERE date > app_today() - 90) AS amount_last_90d,
         sum(amount) FILTER (WHERE date > app_today() - 180 AND date <= app_today() - 90) AS amount_prev_90d,
         avg(amount) FILTER (WHERE date > app_today() - 90) AS avg_order_amount_last_90d,
         avg(amount) FILTER (WHERE date <= app_today() - 90) AS avg_order_amount_before,
         avg(gap_days) FILTER (WHERE date > app_today() - 90) AS interval_last_90d,
         avg(gap_days) FILTER (WHERE date <= app_today() - 90) AS interval_before
  FROM gaps
  GROUP BY customer_id
), ar AS (
  SELECT customer_id,
         sum(amount) FILTER (WHERE paid_date IS NULL) AS ar_outstanding,
         max(app_today() - invoice_date) FILTER (WHERE paid_date IS NULL) AS ar_max_age_days
  FROM receivable
  GROUP BY customer_id
), visits AS (
  SELECT customer_id, max(visited_at)::date AS last_visit_date, count(*)::integer AS visit_count
  FROM visit
  WHERE status <> 'draft'
  GROUP BY customer_id
)
SELECT c.id   AS customer_id,
       c.name AS customer_name,
       c.type AS customer_type,
       c.chain_group,
       c.region,
       c.city,
       c.grade,
       c.contract_end_date,
       c.owner_user_id,
       u.name AS owner_name,
       o.last_order_date,
       COALESCE(o.amount_last_90d, 0) AS amount_last_90d,
       COALESCE(o.amount_prev_90d, 0) AS amount_prev_90d,
       round(o.avg_order_amount_last_90d) AS avg_order_amount_last_90d,
       round(o.avg_order_amount_before)   AS avg_order_amount_before,
       round(o.interval_last_90d, 1)      AS interval_last_90d,
       round(o.interval_before, 1)        AS interval_before,
       COALESCE(a.ar_outstanding, 0)      AS ar_outstanding,
       a.ar_max_age_days,
       vi.last_visit_date,
       COALESCE(vi.visit_count, 0)        AS visit_count
FROM customer c
JOIN app_user u ON u.id = c.owner_user_id
LEFT JOIN order_stats o ON o.customer_id = c.id
LEFT JOIN ar a ON a.customer_id = c.id
LEFT JOIN visits vi ON vi.customer_id = c.id
WHERE app_in_scope(u.org_path, 2);   -- 進貨金額與帳齡也是業績數字：同一區

COMMENT ON VIEW v_customer_summary IS '每家客戶一列的現況摘要，時間窗以系統日 app_today() 為準。金額單位為新台幣元。';
COMMENT ON COLUMN v_customer_summary.amount_last_90d IS '近 90 天進貨金額';
COMMENT ON COLUMN v_customer_summary.amount_prev_90d IS '再往前 90 天（91〜180 天前）的進貨金額';
COMMENT ON COLUMN v_customer_summary.avg_order_amount_last_90d IS '近 90 天平均單次進貨金額';
COMMENT ON COLUMN v_customer_summary.avg_order_amount_before IS '90 天以前的平均單次進貨金額';
COMMENT ON COLUMN v_customer_summary.interval_last_90d IS '近 90 天平均進貨間隔（天）';
COMMENT ON COLUMN v_customer_summary.interval_before IS '90 天以前的平均進貨間隔（天）';
COMMENT ON COLUMN v_customer_summary.ar_max_age_days IS '未收帳款中最舊一張的帳齡（天）';

-- 沒提到的欄位存成 JSON null，用 -> 取出來是 jsonb 'null' 而不是 SQL NULL，
-- 展開陣列前要先 NULLIF，否則 jsonb_array_elements 會報錯
CREATE VIEW v_visit_signal AS
SELECT v.id                   AS visit_id,
       v.customer_id,
       c.name                 AS customer_name,
       c.type                 AS customer_type,
       c.chain_group,
       c.region,
       v.user_id              AS rep_id,
       u.name                 AS rep_name,
       (v.visited_at AT TIME ZONE 'Asia/Taipei')::date AS visit_date,
       (SELECT string_agg(e->>'name', '、')
          FROM jsonb_array_elements(COALESCE(NULLIF(v.fields_final->'competitor', 'null'), '[]')) e) AS competitor_names,
       (SELECT string_agg(e->>'detail', '；')
          FROM jsonb_array_elements(COALESCE(NULLIF(v.fields_final->'competitor', 'null'), '[]')) e) AS competitor_detail,
       v.fields_final->>'complaint' AS complaint,
       (SELECT string_agg(concat(e->>'product_text', ' × ', e->>'qty', e->>'unit'), '、')
          FROM jsonb_array_elements(COALESCE(NULLIF(v.fields_final->'intent', 'null'), '[]')) e) AS intent_summary,
       v.fields_final->'commitment'->>'by'   AS commitment_by,
       v.fields_final->'commitment'->>'text' AS commitment_text,
       (v.fields_final->'commitment'->>'due')::date AS commitment_due,
       (v.fields_final->>'follow_up_date')::date    AS follow_up_date,
       v.transcript
FROM visit v
JOIN customer c ON c.id = v.customer_id
JOIN app_user u ON u.id = v.user_id
-- 只收已確認的拜訪：處理中、轉文字失敗、待確認的紀錄還沒整理好，逐字稿也還沒去識別（NFR-8）
WHERE v.status IN ('confirmed', 'synced')
  AND app_in_scope(u.org_path, 3);   -- 拜訪紀錄與逐字稿：直屬團隊。依做拜訪的業務，不是客戶負責人

COMMENT ON VIEW v_visit_signal IS '已確認的拜訪紀錄，一次拜訪一列，五個欄位已攤平。';
COMMENT ON COLUMN v_visit_signal.competitor_names IS '本次提到的競品，多家以頓號分隔；沒提到為 NULL';
COMMENT ON COLUMN v_visit_signal.commitment_by IS 'us=我方答應客戶, customer=客戶答應我方';
COMMENT ON COLUMN v_visit_signal.transcript IS '口述逐字稿，確認送出時已去識別（人名遮成 ○、電話等換成［電話］這類標記）；送出滿 6 個月後刪除，變成空字串';

CREATE VIEW v_margin_breakdown AS
SELECT date_trunc('month', t.date)::date AS month,
       c.id   AS customer_id,
       c.name AS customer_name,
       c.type AS customer_type,
       c.chain_group,
       c.region,
       p.category,
       sum(t.amount)         AS revenue,
       sum(t.cost)           AS cost,
       sum(t.amount - t.cost) AS gross_margin,
       sum(t.listing_fee)    AS listing_fee,
       sum(t.channel_reward) AS channel_reward,
       sum(t.amount - t.cost - t.listing_fee - t.channel_reward) AS net_margin
FROM sales_transaction t
JOIN customer c ON c.id = t.customer_id
JOIN product p ON p.sku = t.sku
JOIN app_user owner ON owner.id = c.owner_user_id
WHERE app_in_scope(owner.org_path, 2)   -- 毛利結構：同一區
GROUP BY 1, 2, 3, 4, 5, 6, 7;

COMMENT ON VIEW v_margin_breakdown IS '每月 × 客戶 × 品類的毛利結構。金額單位為新台幣元。';
COMMENT ON COLUMN v_margin_breakdown.gross_margin IS '毛利＝營收－成本';
COMMENT ON COLUMN v_margin_breakdown.net_margin IS '淨毛利＝毛利－上架費－通路獎勵；毛利率請用 sum(net_margin)/sum(revenue) 計算，不要平均各列的比率';

-- 促銷方案不分客戶，全公司都看得到，所以這兩個 View 不用 app_in_scope() 過濾。
-- 狀態不存在表裡，跟 app_today() 比出來，換展示日才不會對不上
CREATE VIEW v_promotion AS
SELECT pr.name AS promotion_name,
       pr.type AS promotion_type,
       pr.department,
       pr.start_date,
       pr.end_date,
       CASE WHEN app_today() < pr.start_date THEN '未開始'
            WHEN app_today() > pr.end_date   THEN '已結束'
            ELSE '進行中' END AS status,
       pr.pm_note
FROM promotion pr;

COMMENT ON VIEW v_promotion IS '促銷方案，一期一列，每月一期。品項與搭贈在 v_promotion_item';
COMMENT ON COLUMN v_promotion.status IS '未開始／進行中／已結束，以系統日 app_today() 判斷';
COMMENT ON COLUMN v_promotion.department IS '銷售部門';
COMMENT ON COLUMN v_promotion.pm_note IS 'PM 提醒原文。滿額贈、滿額回贈禮券、組合加碼、實銷活動這類看整張訂單的規則只寫在這裡，沒有拆成欄位';

CREATE VIEW v_promotion_item AS
SELECT pr.name AS promotion_name,
       pr.start_date,
       pr.end_date,
       CASE WHEN app_today() < pr.start_date THEN '未開始'
            WHEN app_today() > pr.end_date   THEN '已結束'
            ELSE '進行中' END AS status,
       i.group_name,
       i.code AS item_code,
       i.name AS item_name,
       i.sku,
       p.name AS product_name,
       p.category,
       p.spec,
       p.unit,
       i.deal,
       i.buy_qty,
       i.free_qty,
       i.deal_price,
       round(i.deal_price / (i.buy_qty + i.free_qty), 2) AS unit_deal_price,
       i.list_price,
       i.ship_price,
       round(1 - i.deal_price / (i.buy_qty + i.free_qty) / i.ship_price, 4) AS discount_rate
FROM promotion_item i
JOIN promotion pr ON pr.id = i.promotion_id
JOIN product p ON p.sku = i.sku;

COMMENT ON VIEW v_promotion_item IS '促銷品項，一個品項的一種口數一列。一「口」是一個購買單位，同一品項常分小口、中口、大口。金額單位為新台幣元。這些品項沒有交易紀錄，v_monthly_sales 查不到';
COMMENT ON COLUMN v_promotion_item.status IS '所屬方案的狀態：未開始／進行中／已結束，以系統日 app_today() 判斷';
COMMENT ON COLUMN v_promotion_item.group_name IS '品牌群組，例如 骨營、黴癒、獅王眼藥水、中化健康360';
COMMENT ON COLUMN v_promotion_item.item_name IS '促銷品項名稱，口數寫在括號裡：(小口)、(中口)、(大口)';
COMMENT ON COLUMN v_promotion_item.deal IS '搭贈說明原文。<11+1> 是買 11 送 1 同品；直走價是不送同品、整口一個價；「+贈…」「加贈…」是另外送的其他品項，不算在 free_qty';
COMMENT ON COLUMN v_promotion_item.unit IS '品項單位，例如 盒、瓶、支';
COMMENT ON COLUMN v_promotion_item.buy_qty IS '一口要買的數量';
COMMENT ON COLUMN v_promotion_item.free_qty IS '一口同品搭贈的數量；直走價為 0';
COMMENT ON COLUMN v_promotion_item.deal_price IS '每口售價：買一口要付的錢';
COMMENT ON COLUMN v_promotion_item.unit_deal_price IS '每 PCS 平均單價＝每口售價 ÷（buy_qty＋free_qty）';
COMMENT ON COLUMN v_promotion_item.list_price IS '原建議售價（消費者零售價）';
COMMENT ON COLUMN v_promotion_item.ship_price IS '原出貨價（大宗價）';
COMMENT ON COLUMN v_promotion_item.discount_rate IS '比原出貨價便宜的比例＝1－每 PCS 平均單價÷原出貨價，0.0833 代表便宜 8.33%。只算同品搭贈與直走價，另外加贈的品項與滿額贈不計';

-- 查詢代理的唯讀角色：只拿得到語意層的 View。角色是整個叢集共用的，重建 schema 時要避免重複建立。
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'semantic_reader') THEN
    CREATE ROLE semantic_reader NOLOGIN;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA public TO semantic_reader;
GRANT SELECT ON v_monthly_sales, v_customer_summary, v_visit_signal, v_margin_breakdown,
                 v_promotion, v_promotion_item TO semantic_reader;
GRANT EXECUTE ON FUNCTION app_in_scope(ltree, int) TO semantic_reader;
-- 資料權限靠交易裡的 app.scope_* 設定過濾，唯讀角色不能自己改：收回所有人呼叫 set_config 的權限，只留給程式本身。
-- sql_executor 另外用文字檢查擋 set_config，但文字檢查擋不住 U&"..." 這類跳脫寫法，這裡才是真的保證
REVOKE EXECUTE ON FUNCTION pg_catalog.set_config(text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pg_catalog.set_config(text, text, boolean) TO CURRENT_USER;
