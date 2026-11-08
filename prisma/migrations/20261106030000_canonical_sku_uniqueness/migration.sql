DO $$
BEGIN
    IF current_setting('server_version_num')::INTEGER < 130000 THEN
        RAISE EXCEPTION 'Canonical SKU uniqueness requires PostgreSQL 13 or newer';
    END IF;
    IF current_setting('server_encoding') <> 'UTF8' THEN
        RAISE EXCEPTION 'Canonical SKU uniqueness requires a UTF8 database';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "Product"
        WHERE "sku" IS NOT NULL
          AND btrim(normalize("sku", NFKC), ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13)) <> ''
        GROUP BY "storeId", (translate(btrim(normalize("sku", NFKC), ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') COLLATE "C")
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Canonical product SKU collisions exist; resolve them per store before applying 20261106030000_canonical_sku_uniqueness';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "ProductVariant"
        WHERE "sku" IS NOT NULL
          AND btrim(normalize("sku", NFKC), ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13)) <> ''
        GROUP BY (translate(btrim(normalize("sku", NFKC), ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') COLLATE "C")
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Canonical variant SKU collisions exist; resolve them globally before applying 20261106030000_canonical_sku_uniqueness';
    END IF;
END $$;

CREATE UNIQUE INDEX "Product_storeId_sku_canonical_key"
ON "Product" (
    "storeId",
    (translate(btrim(normalize("sku", NFKC), ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') COLLATE "C")
)
WHERE "sku" IS NOT NULL
  AND btrim(normalize("sku", NFKC), ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13)) <> '';

CREATE UNIQUE INDEX "ProductVariant_sku_canonical_key"
ON "ProductVariant" (
    (translate(btrim(normalize("sku", NFKC), ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') COLLATE "C")
)
WHERE "sku" IS NOT NULL
  AND btrim(normalize("sku", NFKC), ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13)) <> '';
