-- Scale-audit fixtures, part 2: active products sp<from>..sp<to> (psql vars: from, to).
-- Deterministic pseudo-random spread over 10 stores and all 79 subcategories (plus ~5% on top-levels),
-- varied names, 30% discounted, every 7th product with 2 variants, stock incl. low and zero, real image paths.
\set ON_ERROR_STOP 1
SET search_path = scale_audit;
BEGIN;
CREATE TEMP TABLE cat_pool ON COMMIT DROP AS
  SELECT array_agg(id ORDER BY slug) AS subs, (SELECT array_agg(id ORDER BY slug) FROM "Category" WHERE "parentId" IS NULL) AS tops
  FROM "Category" WHERE "parentId" IS NOT NULL;
INSERT INTO "Product" (id, "storeId", "categoryId", name, slug, sku, description, price, "discountPrice", status, images, "createdAt", "updatedAt")
SELECT 'sp' || g,
       'st' || (1 + (g * 7919) % 10),
       CASE WHEN (g * 31) % 20 = 0 THEN c.tops[1 + (g * 13) % array_length(c.tops, 1)] ELSE c.subs[1 + (g * 2654435761 % 1000003) % array_length(c.subs, 1)] END,
       (ARRAY['Smartfon','Qulaqlıq','Noutbuk','Köynək','Ayaqqabı','Çanta','Saat','Ətir','Krem','Divan','Lampa','Qazan','Oyuncaq','Top','Velosiped','Kitab','Çay dəsti','Bal','Xalça','Təkər','Planşet','Kofta','Gözlük','Şampun'])[1 + g % 24]
         || ' ' || (ARRAY['Pro','Mini','Max','Klassik','Premium','Eko','Lüks','Sadə','Smart','Plus','Air','Nova'])[1 + (g / 24) % 12]
         || ' ' || (ARRAY['qara','ağ','qırmızı','mavi','yaşıl','boz','qəhvəyi','bej'])[1 + (g / 7) % 8]
         || ' ' || (100 + g % 900),
       'scale-' || g,
       'SKU-' || g,
       'Keyfiyyətli məhsul, model ' || g || '. Çatdırılma Qazax və Bakı üzrə. ' || repeat('Təsvir mətni. ', 1 + g % 6),
       (5 + (g * 37) % 2000)::numeric(12, 2),
       CASE WHEN g % 10 < 3 THEN ((5 + (g * 37) % 2000) * 0.85)::numeric(12, 2) ELSE NULL END,
       'ACTIVE',
       ARRAY['/images/categories/' || (ARRAY['electronics','clothing','home','beauty','market','sports','children','automotive','books','accessories','entertainment','pets','other'])[1 + g % 13] || '.webp'],
       now() - (g % 400) * interval '6 hours' - (g % 59) * interval '1 minute',
       now()
FROM generate_series(:from, :to) g, cat_pool c;
-- Every 7th product has 2 active variants with their own stock; the rest have a base stock row.
INSERT INTO "ProductVariant" (id, "productId", name, options, sku, "isActive", "updatedAt")
SELECT 'pv' || g || '-' || v, 'sp' || g, CASE WHEN v = 1 THEN 'Qara' ELSE 'Ağ' END, jsonb_build_object('Rəng', CASE WHEN v = 1 THEN 'Qara' ELSE 'Ağ' END), 'SKU-' || g || '-' || v, true, now()
FROM generate_series(:from, :to) g, generate_series(1, 2) v WHERE g % 7 = 0;
INSERT INTO "Inventory" (id, "productId", "variantId", quantity, reserved, "lowStockThreshold", "updatedAt")
SELECT 'iv' || g || '-' || v, 'sp' || g, 'pv' || g || '-' || v, (g * v) % 25, 0, 5, now()
FROM generate_series(:from, :to) g, generate_series(1, 2) v WHERE g % 7 = 0;
INSERT INTO "Inventory" (id, "productId", "variantId", quantity, reserved, "lowStockThreshold", "updatedAt")
SELECT 'iv' || g, 'sp' || g, NULL, CASE WHEN g % 17 = 0 THEN 0 ELSE (g * 11) % 60 END, 0, 5, now()
FROM generate_series(:from, :to) g WHERE g % 7 <> 0;
COMMIT;
ANALYZE "Product"; ANALYZE "ProductVariant"; ANALYZE "Inventory";
SELECT count(*) AS active_products FROM "Product" WHERE status = 'ACTIVE';
