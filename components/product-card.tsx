import Link from "next/link";
import { FavoriteToggle } from "@/components/favorite-toggle";
import ProductCardImage from "@/components/product-card-image";
import { QuickAddToCart } from "@/components/quick-add-to-cart";

type ProductCardProps = { id: string; name: string; price: string; store: string; storeHref?: string; storeIsPro?: boolean; campaignName?: string | null; discountLabel?: string | null; image?: string | null; originalPrice?: string | null; badge?: "Yeni" | null; stock?: number; lowStockThreshold?: number; variantCount?: number };

export function ProductCard({ id, name, price, originalPrice, store, storeHref, storeIsPro, campaignName, discountLabel, image, badge, stock, lowStockThreshold, variantCount }: ProductCardProps) {
  const discounted = Boolean(originalPrice && Number(price) > 0 && Number(price) < Number(originalPrice));
  return <article className="group flex min-w-0 flex-col overflow-hidden rounded-[18px] border border-[#E4E8E4] bg-white shadow-[0_8px_22px_rgba(23,58,58,.04)] transition duration-200 hover:-translate-y-0.5 hover:border-[#C9D8D1] hover:shadow-[0_16px_32px_rgba(23,58,58,.1)]">
    <div className="relative">
      <Link href={`/products/${id}`} aria-label={`${name} məhsuluna bax`} className="relative flex aspect-square items-center justify-center overflow-hidden bg-[#F3F6F4] p-3 text-xs text-[#697875] sm:p-4">
        <ProductCardImage src={image} alt={name} sizes="(max-width: 640px) 46vw, (max-width: 1024px) 30vw, 280px"/>
      </Link>
      {(discounted || badge || campaignName) && <span className={`absolute left-2 top-2 rounded-full px-2.5 py-1 text-[.62rem] font-bold shadow-sm sm:left-3 sm:top-3 ${discounted || campaignName ? "bg-[#E8D7B7] text-[#503D24]" : "bg-white/95 text-[#315A51]"}`}>{campaignName ? (discountLabel || "Kampaniya") : discounted ? "Endirim" : badge}</span>}
      <div className="absolute right-2 top-2"><FavoriteToggle productId={id}/></div>
    </div>
    <div className="flex flex-1 flex-col p-3 sm:p-3.5">
      {campaignName && <p className="mb-1 truncate text-[.62rem] font-semibold text-[#8A6A37]">Kampaniya · {campaignName}</p>}
      {storeHref ? <Link href={storeHref} className="block truncate text-[.68rem] font-medium text-[#75817F] hover:text-[#2F6F68] sm:text-xs">{store}</Link> : <p className="truncate text-[.68rem] font-medium text-[#75817F] sm:text-xs">{store}</p>}
      {storeIsPro&&<span className="mt-1 inline-flex w-fit rounded-full bg-[#EFF4F1] px-2 py-0.5 text-[.55rem] font-bold tracking-wide text-[#42645C]">PRO mağaza</span>}
      <Link href={`/products/${id}`} className="mt-1.5 block min-h-10 line-clamp-2 text-[.82rem] font-semibold leading-5 text-[#233432] hover:text-[#2F6F68] sm:text-[.94rem]">{name}</Link>
      {variantCount !== undefined && variantCount > 0 && <p className="mt-1 text-[.63rem] text-[#75817F]">{variantCount} variant mövcuddur</p>}
      <div className="mt-auto flex min-h-8 flex-wrap items-baseline gap-x-2 gap-y-0.5 pt-3"><p className="text-base font-semibold tracking-tight text-[#173A3A]">{price} ₼</p>{discounted && <p className="text-[.68rem] text-[#75817F] line-through">{originalPrice} ₼</p>}</div>
      {stock !== undefined && <p className={`mb-1 mt-1 inline-flex items-center gap-1.5 text-[.64rem] font-medium ${stock <= 0 ? "text-[#b42318]" : lowStockThreshold !== undefined && stock <= lowStockThreshold ? "text-[#8A6A37]" : "text-[#2F6F68]"}`}><span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${stock <= 0 ? "bg-[#b42318]" : lowStockThreshold !== undefined && stock <= lowStockThreshold ? "bg-[#c79a52]" : "bg-[#2F6F68]"}`}/>{stock <= 0 ? "Stokda yoxdur" : lowStockThreshold !== undefined && stock <= lowStockThreshold ? "Az sayda qalıb" : "Mövcuddur"}</p>}
      <div className="mt-2"><QuickAddToCart productId={id} stock={stock}/></div>
    </div>
  </article>;
}
