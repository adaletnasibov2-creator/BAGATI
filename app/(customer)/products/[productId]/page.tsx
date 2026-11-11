import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, MapPin, Store } from "lucide-react";
import { Prisma } from "@prisma/client";
import ProductVariantPurchase from "@/components/product-variant-purchase";
import { prisma } from "@/lib/prisma";
import { getSiteSettings } from "@/lib/site-settings";
import { calculateEffectivePrice, productPromotions, type PromotionPriceInput } from "@/lib/promotion-pricing";
import { calculateVariantEffectivePrice } from "@/lib/product-variants";
import { publicProductVisibilityWhere } from "@/lib/store-visibility";
import { resolvePublicStoreEligibility } from "@/lib/store-eligibility";

export const dynamic = "force-dynamic";

type ProductRecord = {
  id: string;
  sku: string | null;
  name: string;
  price: Prisma.Decimal;
  discountPrice: Prisma.Decimal | null;
  description: string | null;
  images: string[];
  store: {
    id: string;
    name: string;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    mapUrl: string | null;
    deliveryFee: Prisma.Decimal;
    freeDeliveryThreshold: Prisma.Decimal;
    city: { name: string };
  };
  category: { name: string; slug: string } | null;
  inventory: { variantId: string | null; quantity: number; reserved: number }[];
  variants: {
    id: string;
    name: string;
    options: Record<string, unknown>;
    isActive: boolean;
    price: Prisma.Decimal | null;
    discountPrice: Prisma.Decimal | null;
    images: string[];
    inventory: { variantId: string | null; quantity: number; reserved: number }[];
  }[];
  reviews: { id: string; rating: number; comment: string | null; createdAt: Date }[];
  _count: { reviews: number };
};

export default async function ProductPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const now = new Date();
  const [productResult, siteSettings] = await Promise.all([
    prisma.product.findFirst({
      where: { id: productId, ...publicProductVisibilityWhere() },
      include: {
        store: {
          select: {
            id: true,
            name: true,
            address: true,
            latitude: true,
            longitude: true,
            mapUrl: true,
            deliveryFee: true,
            freeDeliveryThreshold: true,
            city: { select: { name: true } },
          },
        },
        category: { select: { name: true, slug: true } },
        variants: { include: { inventory: true } },
        inventory: true,
        promotionProducts: { include: { promotion: true } },
        reviews: {
          take: 5,
          orderBy: { createdAt: "desc" },
          select: { id: true, rating: true, comment: true, createdAt: true },
        },
        _count: { select: { reviews: true } },
      },
    }),
    getSiteSettings(),
  ]);
  const product = productResult as (ProductRecord & { promotionProducts: { promotion: PromotionPriceInput }[] }) | null;
  if (!product) notFound();

  const eligibleStoreIds = await resolvePublicStoreEligibility([product.store.id], prisma, now);
  if (!eligibleStoreIds.has(product.store.id)) notFound();

  const promotions = productPromotions(product.promotionProducts, product.store.id);
  const effective = calculateEffectivePrice(product.price, product.discountPrice, promotions, now);
  const stock = product.inventory
    .filter(item => item.variantId === null)
    .reduce((sum, item) => sum + Math.max(0, item.quantity - item.reserved), 0);
  const variants = product.variants.map(variant => {
    const price = calculateVariantEffectivePrice({
      productPrice: product.price,
      productDiscountPrice: product.discountPrice,
      variant,
      promotions: product.promotionProducts,
      storeId: product.store.id,
      now,
    });
    const inventory = variant.inventory.find(item => item.variantId === variant.id);
    return {
      id: variant.id,
      name: variant.name,
      options: variant.options,
      isActive: variant.isActive,
      images: variant.images,
      available: inventory ? Math.max(0, inventory.quantity - inventory.reserved) : 0,
      basePrice: price.basePrice.toFixed(2),
      unitPrice: price.unitPrice.toFixed(2),
      campaignName: price.promotion?.name || null,
    };
  });

  return (
    <div className="container py-6 md:py-10">
      <nav aria-label="Breadcrumb" className="mb-6 flex min-w-0 items-center gap-2 text-sm text-muted">
        <Link href="/products" className="shrink-0 hover:text-emerald">Məhsullar</Link>
        {product.category && <>
          <ChevronRight aria-hidden="true" size={14} className="shrink-0"/>
          <Link href={`/categories?category=${product.category.slug}`} className="shrink-0 hover:text-emerald">{product.category.name}</Link>
        </>}
        <ChevronRight aria-hidden="true" size={14} className="shrink-0"/>
        <span aria-current="page" className="min-w-0 truncate text-ink">{product.name}</span>
      </nav>

      <ProductVariantPurchase
        productId={product.id}
        name={product.name}
        productImages={product.images}
        variants={variants}
        hasVariants={product.variants.length > 0}
        stock={stock}
        basePrice={effective.basePrice.toFixed(2)}
        unitPrice={effective.unitPrice.toFixed(2)}
        campaignName={effective.promotion?.name || null}
        store={{
          id: product.store.id,
          name: product.store.name,
          city: product.store.city.name,
          deliveryFee: product.store.deliveryFee.toFixed(2),
          freeDeliveryThreshold: product.store.freeDeliveryThreshold.toFixed(2),
        }}
        category={product.category ? {
          name: product.category.name,
          href: `/categories?category=${product.category.slug}`,
        } : null}
        sku={product.sku}
      />

      <div className="mt-10 grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,.65fr)]">
        <section className="rounded-3xl border border-[#E5EAE6] bg-white p-5 sm:p-7" aria-labelledby="product-description-title">
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-[#967844]">Məhsul haqqında</p>
          <h2 id="product-description-title" className="mt-2 text-xl font-semibold text-[#233432]">Təsvir və məlumat</h2>
          <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-muted">
            {product.description || "Satıcı bu məhsul üçün əlavə təsvir təqdim etməyib."}
          </p>
          {product.category && <p className="mt-5 border-t border-line pt-4 text-sm text-muted">
            Kateqoriya: <Link href={`/categories?category=${product.category.slug}`} className="font-medium text-ink hover:text-emerald">{product.category.name}</Link>
          </p>}
        </section>

        <section className="rounded-3xl border border-[#E5EAE6] bg-white p-5 sm:p-7" aria-labelledby="product-store-title">
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-[#967844]">Satıcı mağazası</p>
          <Link id="product-store-title" href={`/stores/${product.store.id}`} className="mt-2 inline-flex items-center gap-2 text-lg font-semibold text-[#233432] hover:text-emerald">
            <Store aria-hidden="true" size={18}/>{product.store.name}
          </Link>
          <p className="mt-2 flex items-start gap-2 text-sm text-muted">
            <MapPin aria-hidden="true" size={16} className="mt-0.5 shrink-0"/>
            <span>{product.store.city.name}{product.store.address ? ` · ${product.store.address}` : ""}</span>
          </p>
          {product.store.latitude !== null && product.store.longitude !== null ? (
            <iframe
              title={`${product.store.name} xəritə mövqeyi`}
              loading="lazy"
              className="mt-5 h-48 w-full rounded-2xl border-0"
              src={`https://www.openstreetmap.org/export/embed.html?bbox=${product.store.longitude - 0.01}%2C${product.store.latitude - 0.01}%2C${product.store.longitude + 0.01}%2C${product.store.latitude + 0.01}&layer=mapnik&marker=${product.store.latitude}%2C${product.store.longitude}`}
            />
          ) : <p className="mt-5 rounded-xl bg-[#F4F7F4] p-3 text-xs text-muted">Mağaza xəritə mövqeyini hələ əlavə etməyib.</p>}
          {product.store.mapUrl && <a href={product.store.mapUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block min-h-11 text-sm font-medium leading-11 text-emerald">Mağaza xəritəsinə bax →</a>}
        </section>
      </div>

      <section className="mt-5 grid gap-5 md:grid-cols-2" aria-label="Çatdırılma və qaytarılma məlumatı">
        <article className="rounded-2xl border border-[#E5EAE6] bg-[#F7F8F6] p-5">
          <h2 className="font-semibold text-[#233432]">Çatdırılma məlumatı</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted">{siteSettings.deliveryInfo || "Çatdırılma şərtləri sifariş və mağazaya görə göstərilir."}</p>
          <Link href="/delivery-returns" className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-emerald">Ətraflı məlumat →</Link>
        </article>
        <article className="rounded-2xl border border-[#E5EAE6] bg-[#F7F8F6] p-5">
          <h2 className="font-semibold text-[#233432]">Qaytarılma məlumatı</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted">{siteSettings.returnsInfo || "Qaytarılma barədə məlumat mövcud deyil."}</p>
          <Link href="/delivery-returns" className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-emerald">Ətraflı məlumat →</Link>
        </article>
      </section>

      <section className="mt-8 rounded-3xl border border-[#E5EAE6] bg-white p-5 sm:p-7" aria-labelledby="product-reviews-title">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-[#967844]">Alıcı rəyləri</p>
          <h2 id="product-reviews-title" className="mt-2 text-xl font-semibold text-[#233432]">
            Rəylər <span className="text-sm font-normal text-muted">({product._count.reviews})</span>
          </h2>
        </div>
        {product.reviews.length ? (
          <div className="mt-5 divide-y divide-line">
            {product.reviews.map(review => (
              <article key={review.id} className="py-4 first:pt-0">
                <p className="text-sm tracking-widest text-[#9a783d]" aria-label={`${review.rating} / 5`}>
                  {"★".repeat(review.rating)}<span className="text-[#d8d5cd]">{"★".repeat(Math.max(0, 5 - review.rating))}</span>
                </p>
                <p className="mt-2 text-sm leading-6 text-[#344254]">{review.comment || "Mətnsiz rəy"}</p>
                <time className="mt-2 block text-xs text-muted" dateTime={review.createdAt.toISOString()}>{review.createdAt.toLocaleDateString("az-AZ")}</time>
              </article>
            ))}
          </div>
        ) : <p className="mt-4 rounded-xl bg-[#F4F7F4] p-4 text-sm text-muted">Bu məhsul üçün hələ rəy yoxdur.</p>}
      </section>
    </div>
  );
}
