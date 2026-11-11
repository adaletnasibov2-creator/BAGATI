"use client";

import { Search } from "lucide-react";
import { useSearchParams } from "next/navigation";

type SearchCategory = { id: string; name: string; slug: string };

export function SearchForm({ mobile = false, categories = [] }: { mobile?: boolean; categories?: SearchCategory[] }) {
  const params = useSearchParams();
  const city = params.get("city");
  const label = mobile ? "Məhsul və ya mağaza axtar" : "Məhsul, mağaza və ya kateqoriya axtar";

  return (
    <form
      action="/products"
      role="search"
      className={`flex w-full items-center gap-2 rounded-full border border-bagati-border bg-[#F3F6F3] text-bagati-text transition focus-within:border-bagati-muted focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgba(47,111,104,.11)] ${mobile ? "h-11 px-2" : "h-[52px] px-3"}`}
    >
      {city && <input type="hidden" name="city" value={city} />}
      {categories.length > 0 && (
        <label className={`shrink-0 border-r border-bagati-border pr-2 ${mobile ? "hidden max-w-[108px] min-[420px]:block" : "max-w-[158px] px-2"}`}>
          <span className="sr-only">Kateqoriya seç</span>
          <select
            name="category"
            defaultValue={params.get("category") ?? ""}
            aria-label="Kateqoriya seç"
            className={`w-full cursor-pointer truncate bg-transparent font-medium text-bagati-text outline-none ${mobile ? "text-[.68rem]" : "text-xs"}`}
          >
            <option value="">Bütün bölmələr</option>
            {categories.map((category) => <option key={category.id} value={category.slug}>{category.name}</option>)}
          </select>
        </label>
      )}
      <label className="flex min-w-0 flex-1 items-center gap-2">
        <Search aria-hidden="true" size={18} className="shrink-0 text-bagati-muted" />
        <span className="sr-only">{label}</span>
        <input
          name="q"
          defaultValue={params.get("q") ?? ""}
          placeholder={mobile ? "Axtar" : label}
          className="min-w-0 w-full bg-transparent text-sm text-bagati-deep outline-none placeholder:text-[#8B9690]"
          aria-label={label}
        />
      </label>
      <button type="submit" aria-label="Axtar" className={`grid shrink-0 place-items-center rounded-full bg-bagati-primary text-white transition hover:bg-bagati-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bagati-gold ${mobile ? "h-8 w-8" : "h-9 w-9"}`}>
        <Search aria-hidden="true" size={16} />
      </button>
    </form>
  );
}
