import Link from "next/link";

/** Customer auth switch. Keeps the sanitized `next` destination when moving between the two pages. */
export function authTabHref(path: "/login" | "/register", nextPath: string) {
  return nextPath && nextPath !== "/account" ? `${path}?next=${encodeURIComponent(nextPath)}` : path;
}

export function AuthTabs({ active, nextPath }: { active: "login" | "register"; nextPath: string }) {
  const tab = (key: "login" | "register", path: "/login" | "/register", label: string) => {
    const current = active === key;
    return <Link
      href={authTabHref(path, nextPath)}
      aria-current={current ? "page" : undefined}
      className={`rounded-full px-4 py-2.5 text-center transition ${current ? "bg-white text-[#0B1726] shadow-[0_2px_8px_rgba(11,23,38,.08)]" : "text-[#667085] hover:text-[#0B1726]"}`}
    >{label}</Link>;
  };
  return <nav aria-label="Daxil ol və ya qeydiyyatdan keç" className="mt-6 grid grid-cols-2 gap-1 rounded-full border border-[#E6E9EC] bg-[#F4F4F1] p-1 text-sm font-semibold">
    {tab("login", "/login", "Daxil ol")}
    {tab("register", "/register", "Qeydiyyat")}
  </nav>;
}
