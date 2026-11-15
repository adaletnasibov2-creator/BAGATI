-- Scale-audit fixtures, part 1 (schema scale_audit on the verify cluster only). psql vars: pwhash (bcrypt).
\set ON_ERROR_STOP 1
SET search_path = scale_audit;
BEGIN;
-- 10 vendors and eligible stores (admin-managed, legal info approved), 5 in Qazax, 5 in Bakı.
INSERT INTO "User" (id, email, "passwordHash", role, "updatedAt", "emailVerifiedAt")
SELECT 'sv' || g, 'scale-vendor' || g || '@verify.invalid', 'x', 'VENDOR', now(), now() FROM generate_series(1, 10) g;
INSERT INTO "VendorProfile" (id, "userId", "displayName", "sellerType", "legalName", voen, "legalAddress")
SELECT 'vp' || g, 'sv' || g, 'Satıcı ' || g, 'INDIVIDUAL_ENTREPRENEUR', 'Satıcı ' || g, '1' || lpad(g::text, 8, '0') || '1', 'Ünvan ' || g FROM generate_series(1, 10) g;
INSERT INTO "Store" (id, "vendorId", "cityId", name, slug, status, "isActive", "legalInfoApproved", "adminManaged", "updatedAt", "createdAt")
SELECT 'st' || g, 'vp' || g, (SELECT id FROM "City" WHERE slug = CASE WHEN g <= 5 THEN 'qazax' ELSE 'baki' END),
       (ARRAY['Qazax Elektronika','Ev Dünyası','Moda Nizam','Gözəllik Evi','Market Plus','İdman Mərkəzi','Uşaq Aləmi','Avto Hissə','Kitab Evi','Hədiyyə Dükanı'])[g],
       'scale-store-' || g, 'ACTIVE', true, true, true, now(), now() - interval '200 days'
FROM generate_series(1, 10) g;
UPDATE "City" SET "isActive" = true WHERE slug IN ('qazax', 'baki');
-- 20,000 customers.
INSERT INTO "User" (id, email, "passwordHash", role, "updatedAt", "emailVerifiedAt", "createdAt")
SELECT 'cu' || g, 'customer' || g || '@verify.invalid', 'x', 'CUSTOMER', now(), now(), now() - (g % 365) * interval '1 day' FROM generate_series(1, 20000) g;
-- Test accounts for the measured flows (password in a scratch file, never printed).
INSERT INTO "User" (id, email, "passwordHash", role, "updatedAt", "emailVerifiedAt", "passwordAuthEnabled")
VALUES ('scale-customer', 'scale-customer@verify.invalid', :'pwhash', 'CUSTOMER', now(), now(), true),
       ('scale-admin', 'scale-admin@verify.invalid', :'pwhash', 'ADMIN', now(), now(), true);
INSERT INTO "Address" (id, "userId", "cityId", "recipientName", phone, line1)
VALUES ('scale-address', 'scale-customer', (SELECT id FROM "City" WHERE slug = 'qazax'), 'Test Alıcı', '+994501234567', 'Qazax, Mərkəz küç. 1');
COMMIT;
SELECT (SELECT count(*) FROM "User") AS users, (SELECT count(*) FROM "Store") AS stores;
