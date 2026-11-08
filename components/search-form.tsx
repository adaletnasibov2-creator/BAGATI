"use client";

import { Search } from "lucide-react";
import { useSearchParams } from "next/navigation";

export function SearchForm({ mobile = false }: { mobile?: boolean }) {
  const params = useSearchParams();
  const city = params.get("city");
  const label = mobile ? "Məhsul və ya mağaza axtar" : "Məhsul, mağaza və ya kateqoriya axtarın";
  return <form action="/products" role="search" className={mobile ? "min-w-0 flex-1 md:hidden" : "hidden min-w-0 flex-1 md:block"}>
    <label className={`flex w-full items-center gap-3 rounded-full border border-[#E0E8E4] bg-[#F3F6F3] px-4 text-[#62736F] transition focus-within:border-[#7DA79D] focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgba(47,111,104,.11)] sm:px-5 ${mobile ? "h-11" : "h-[52px]"}`}>
      <Search aria-hidden="true" size={19} className="shrink-0"/><input name="q" placeholder={mobile ? "Axtar" : label} className="min-w-0 w-full bg-transparent text-[.92rem] text-[#16202C] outline-none placeholder:text-[#8b929d]" aria-label={label}/>{city && <input type="hidden" name="city" value={city}/>}
    </label>
  </form>;
}
