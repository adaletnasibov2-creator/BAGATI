CREATE TABLE "SiteSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "siteName" TEXT NOT NULL DEFAULT 'BAGATI Marketplace',
    "logoUrl" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "instagramUrl" TEXT,
    "facebookUrl" TEXT,
    "tiktokUrl" TEXT,
    "deliveryInfo" TEXT NOT NULL DEFAULT '',
    "returnsInfo" TEXT NOT NULL DEFAULT '',
    "homeIntroTitle" TEXT NOT NULL DEFAULT 'Mağazaları və məhsulları bir məkanda kəşf et.',
    "homeIntroDescription" TEXT NOT NULL DEFAULT 'Kataloqa nəzər sal, mağazaları araşdır və sənə uyğun seçimi et.',
    "homeIntroLinkLabel" TEXT NOT NULL DEFAULT 'Kataloqa bax',
    "homeIntroLinkUrl" TEXT NOT NULL DEFAULT '/categories',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HomeBanner" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "buttonLabel" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeBanner_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HomepageFeaturedProduct" (
    "productId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HomepageFeaturedProduct_pkey" PRIMARY KEY ("productId")
);

CREATE TABLE "HomepageFeaturedStore" (
    "storeId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HomepageFeaturedStore_pkey" PRIMARY KEY ("storeId")
);

CREATE INDEX "HomeBanner_isActive_startsAt_endsAt_sortOrder_idx"
    ON "HomeBanner"("isActive", "startsAt", "endsAt", "sortOrder");

CREATE UNIQUE INDEX "HomepageFeaturedProduct_position_key"
    ON "HomepageFeaturedProduct"("position");

CREATE UNIQUE INDEX "HomepageFeaturedStore_position_key"
    ON "HomepageFeaturedStore"("position");

ALTER TABLE "HomepageFeaturedProduct"
    ADD CONSTRAINT "HomepageFeaturedProduct_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HomepageFeaturedStore"
    ADD CONSTRAINT "HomepageFeaturedStore_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
