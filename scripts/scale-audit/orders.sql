-- Scale-audit fixtures, part 3: 5,000 orders (1 store each, 1-3 items), 60% DELIVERED, spread over 300 days.
-- Uses products sp1..sp3000 (present at every size).
\set ON_ERROR_STOP 1
SET search_path = scale_audit;
BEGIN;
INSERT INTO "Order" (id, "userId", status, subtotal, "deliveryFee", total, "addressSnapshot", "createdAt", "updatedAt")
SELECT 'so' || o, 'cu' || (1 + (o * 7) % 20000),
       (CASE WHEN o % 10 < 6 THEN 'DELIVERED' WHEN o % 10 = 6 THEN 'CANCELLED' WHEN o % 10 = 7 THEN 'SHIPPED' ELSE 'CONFIRMED' END)::"OrderStatus",
       0, 0, 0, '{"line1":"Ünvan","city":"Qazax"}'::jsonb, now() - (o % 300) * interval '1 day', now()
FROM generate_series(1, 5000) o;
INSERT INTO "StoreOrder" (id, "orderId", "storeId", status, subtotal, "createdAt")
SELECT 'sso' || o, 'so' || o, 'st' || (1 + (o * 3) % 10),
       (CASE WHEN o % 10 < 6 THEN 'DELIVERED' WHEN o % 10 = 6 THEN 'CANCELLED' WHEN o % 10 = 7 THEN 'SHIPPED' ELSE 'CONFIRMED' END)::"OrderStatus",
       0, now() - (o % 300) * interval '1 day'
FROM generate_series(1, 5000) o;
-- Items: 1-3 products of the order's own store (from the first 3,000 products, present at every size).
CREATE TEMP TABLE store_products ON COMMIT DROP AS
  SELECT "storeId", array_agg(id ORDER BY id) AS ids FROM "Product" WHERE id IN (SELECT 'sp' || g FROM generate_series(1, 3000) g) GROUP BY "storeId";
INSERT INTO "OrderItem" (id, "storeOrderId", "productId", "productName", "unitPrice", quantity, "lineTotal")
SELECT 'soi' || o || '-' || i, 'sso' || o, p.id, p.name, p.price, 1 + (o + i) % 3, p.price * (1 + (o + i) % 3)
FROM generate_series(1, 5000) o
CROSS JOIN LATERAL generate_series(1, 1 + o % 3) i
JOIN store_products sp ON sp."storeId" = 'st' || (1 + (o * 3) % 10)
JOIN "Product" p ON p.id = sp.ids[1 + (o * 131 + i * 17) % array_length(sp.ids, 1)];
UPDATE "StoreOrder" so SET subtotal = t.s FROM (SELECT "storeOrderId", sum("lineTotal") s FROM "OrderItem" GROUP BY 1) t WHERE t."storeOrderId" = so.id;
UPDATE "Order" o SET subtotal = so.subtotal, total = so.subtotal FROM "StoreOrder" so WHERE so."orderId" = o.id;
COMMIT;
ANALYZE "Order"; ANALYZE "StoreOrder"; ANALYZE "OrderItem";
SELECT (SELECT count(*) FROM "Order") AS orders, (SELECT count(*) FROM "OrderItem") AS items, (SELECT count(*) FROM "StoreOrder" WHERE status = 'DELIVERED') AS delivered;
