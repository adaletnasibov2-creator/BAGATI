"use client";

import { Search } from "lucide-react";
import { useSearchParams } from "next/navigation";

type SearchCategory = { id: string; name: string; slug: string; children?: { id: string; name: string; slug: string }[] };

export function SearchForm({ mobile = false, categories = [] }: { mobile?: boolean; categories?: SearchCategory[] }) {
  const params = useSearchParams();
  const city = params.get("city");
  const label = mobile ? "Məhsul və ya mağaza axtar" : "Məhsul, mağaza və ya kateqoriya axtar";

  return (
    <form
      action="/products"
      role="search"
      className={`flex w-full items-center gap-2 rounded-full border border-line-strong bg-white text-fg-body shadow-subtle transition-[border-color,box-shadow] focus-within:border-primary focus-within:shadow-[0_0_0_3px_var(--bagati-brand-100)] motion-reduce:transition-none ${mobile ? "h-12 pl-3 pr-0.5" : "h-[52px] pl-3 pr-1"}`}
    >
      {city && <input type="hidden" name="city" value={city} />}
      {categories.length > 0 && (
        <label className={`shrink-0 border-r border-line pr-2 ${mobile ? "hidden max-w-[108px] min-[420px]:block" : "hidden max-w-[158px] px-2 xl:block"}`}>
          <span className="sr-only">Kateqoriya seç</span>
          <select
            name="category"
            defaultValue={params.get("category") ?? ""}
            aria-label="Kateqoriya seç"
            className={`min-h-11 w-full cursor-pointer truncate bg-transparent font-medium text-fg-body outline-none ${mobile ? "text-xs" : "text-sm"}`}
          >
            <option value="">Bütün bölmələr</option>
            {categories.flatMap((category) => [
              <option key={category.id} value={category.slug}>{category.name}</option>,
              ...(category.children ?? []).map((child) => <option key={child.id} value={child.slug}>{"  " + child.name}</option>),
            ])}
          </select>
        </label>
      )}
      <label className="flex min-w-0 flex-1 items-center gap-2">
        <Search aria-hidden="true" size={18} className="shrink-0 text-fg-muted" />
        <span className="sr-only">{label}</span>
        <input
          name="q"
          defaultValue={params.get("q") ?? ""}
          placeholder={mobile ? "Axtar" : label}
          className="min-h-11 min-w-0 w-full bg-transparent text-sm text-fg outline-none placeholder:text-fg-muted"
          aria-label={label}
        />
      </label>
      <button type="submit" aria-label="Axtar" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary text-white transition-colors hover:bg-primary-hover active:bg-primary-active focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none">
        <Search aria-hidden="true" size={16} />
      </button>
    </form>
  );
}
