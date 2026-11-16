-- Scale-audit fixtures, part 4 (schema scale_audit on the verify cluster only): 8 active store campaigns,
-- one each for stores st1..st8, with 50 of that store's own products (lowest ids), 10 % off, running for 60 days.
-- Used to measure the homepage campaign query. Re-runnable: removes its own rows first.
\set ON_ERROR_STOP 1
SET search_path = scale_audit;
BEGIN;
DELETE FROM "Promotion" WHERE id LIKE 'scale-promo-%';
INSERT INTO "Promotion" (id, "storeId", name, "startsAt", "endsAt", "isActive", "discountType", "discountValue", "updatedAt")
SELECT 'scale-promo-' || g, 'st' || g, 'Kampaniya ' || g, now() - interval '1 day', now() + interval '60 days', true, 'PERCENT', 10, now()
FROM generate_series(1, 8) g;
INSERT INTO "PromotionProduct" (id, "promotionId", "productId")
SELECT 'scale-pp-' || p.id, 'scale-promo-' || substr(p."storeId", 3), p.id
FROM (
  SELECT id, "storeId", row_number() OVER (PARTITION BY "storeId" ORDER BY id) AS n
  FROM "Product" WHERE status = 'ACTIVE' AND "storeId" IN ('st1','st2','st3','st4','st5','st6','st7','st8')
) p
WHERE p.n <= 50;
COMMIT;
SELECT (SELECT count(*) FROM "Promotion" WHERE id LIKE 'scale-promo-%') AS promotions,
       (SELECT count(*) FROM "PromotionProduct" WHERE id LIKE 'scale-pp-%') AS links;
