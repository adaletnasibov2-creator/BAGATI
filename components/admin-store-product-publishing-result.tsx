import Link from "next/link";
import type { ProductPublicationResult } from "@/lib/admin-store-product-publishing";

export default function AdminStoreProductPublishingResult({ result }: { result: ProductPublicationResult | null }) {
  if (!result) return null;
  if (!result.totalDrafts) {
    return <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Yoxlanacaq qaralama məhsul yoxdur.</p>;
  }
  return <section className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm" aria-label="Qaralama məhsulların yayımlanma nəticəsi">
    <p className="font-medium">
      Yoxlanıldı: {result.totalDrafts} · yayımlandı: {result.published.length} · qaralama qaldı: {result.skipped.length}
    </p>
    {result.published.length > 0 && <div className="mt-2">
      <p className="font-medium text-emerald-800">Yayımlanan məhsullar</p>
      <ul className="mt-1 list-inside list-disc text-slate-700">
        {result.published.map((product) => <li key={product.id}>
          <Link className="underline" href={`/admin/products/${encodeURIComponent(product.id)}`}>{product.name}</Link>
        </li>)}
      </ul>
    </div>}
    {result.skipped.length > 0 && <div className="mt-3">
      <p className="font-medium text-amber-900">Qaralama qalan məhsullar və səbəblər</p>
      <ul className="mt-1 space-y-2">
        {result.skipped.map((product) => <li key={product.id}>
          <Link className="font-medium underline" href={`/admin/products/${encodeURIComponent(product.id)}`}>{product.name}</Link>
          <ul className="ml-4 list-disc text-slate-700">
            {product.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </li>)}
      </ul>
    </div>}
  </section>;
}
