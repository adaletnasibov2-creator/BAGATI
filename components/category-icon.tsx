import Image from "next/image";

export type CategoryKind =
  | "accessories"
  | "electronics"
  | "home"
  | "entertainment"
  | "clothing"
  | "beauty"
  | "sports"
  | "market"
  | "children"
  | "automotive"
  | "books"
  | "pets"
  | "other";

export type CategoryInfo = { name: string; slug?: string | null };

// Tint shown only while the photograph is decoding.
const categoryStyles: Record<CategoryKind, string> = {
  accessories: "from-[#f3e9d8] to-[#f9f5ee]",
  electronics: "from-[#e6efe9] to-[#f5f7f3]",
  home: "from-[#ece3d6] to-[#f8f2e8]",
  entertainment: "from-[#e9e6f3] to-[#f8f5fb]",
  clothing: "from-[#f0e5dd] to-[#faf3ef]",
  beauty: "from-[#f3e7ea] to-[#faf3f0]",
  sports: "from-[#e6f0ed] to-[#f2f7f1]",
  market: "from-[#efe8d8] to-[#faf6ed]",
  children: "from-[#e8edf4] to-[#f3f7f4]",
  automotive: "from-[#e5ecec] to-[#f4f6f3]",
  books: "from-[#efe7db] to-[#f9f3ea]",
  pets: "from-[#e6efe1] to-[#f4f7ef]",
  other: "from-[#edf1ee] to-[#f6f3ec]",
};

// Every kind has its own local photograph in public/images/categories (sources and licences are
// listed in public/images/categories/README.md). The files are served by this app, so a category
// tile never depends on a third-party image host being reachable. `content` describes what the
// photograph actually shows.
export const categoryPhotoMap: Record<CategoryKind, { src: string; content: string }> = {
  accessories: {
    src: "/images/categories/accessories.webp",
    content: "Dəri pul kisəsi, qol saatı, muncuq bilərzik və gün eynəyi",
  },
  electronics: {
    src: "/images/categories/electronics.webp",
    content: "Noutbuk, qulaqlıq, planşet, smartfon, ağıllı saat və simsiz qulaqcıqlar",
  },
  home: {
    src: "/images/categories/home.webp",
    content: "Divan, jurnal masası və puflar olan qonaq otağı",
  },
  entertainment: {
    src: "/images/categories/entertainment.webp",
    content: "Rəngli fiqurları olan stolüstü oyun",
  },
  clothing: {
    src: "/images/categories/clothing.webp",
    content: "Taxta asılqanlarda geyimlər",
  },
  beauty: {
    src: "/images/categories/beauty.webp",
    content: "Göz kölgəsi palitrası, kompakt pudra, makiyaj fırçası və ətir şüşəsi",
  },
  sports: {
    src: "/images/categories/sports.webp",
    content: "Qantellər, məşq lentləri və masaj topu",
  },
  market: {
    src: "/images/categories/market.webp",
    content: "Konservlər, su, düyü, yerkökü və portağal olan ərzaq qutusu",
  },
  children: {
    src: "/images/categories/children.webp",
    content: "Yumşaq meymun və ayı oyuncaqları, taxta maşın",
  },
  automotive: {
    src: "/images/categories/automotive.webp",
    content: "Boz idman avtomobili",
  },
  books: {
    src: "/images/categories/books.webp",
    content: "Üst-üstə yığılmış kitablar",
  },
  pets: {
    src: "/images/categories/pets.webp",
    content: "Fransız buldoqu balası",
  },
  other: {
    src: "/images/categories/other.webp",
    content: "Ayaqqabı, qulaqlıq, telefon, kosmetika, eynək və zərgərlik — müxtəlif məhsullar",
  },
};

export function categoryKind({ name, slug }: CategoryInfo): CategoryKind {
  const key = `${slug ?? ""} ${name}`.toLocaleLowerCase("az-AZ");
  if (/aksesuar|accessor/.test(key)) return "accessories";
  if (/elektron|electronic|telefon|texnika|kompüter|komputer|gadget|audio/.test(key)) return "electronics";
  if (/heyvan|pet/.test(key)) return "pets";
  if (/uşaq|usaq|child|baby|körpə|korpe|oyuncaq|toy/.test(key)) return "children";
  if (/(^|\s)ev(\s|$)|məişət|mesiet|home|bağ|bag|mebel|mətbəx|metbex/.test(key)) return "home";
  if (/əyləncə|eylence|entertain|oyun|game|media/.test(key)) return "entertainment";
  if (/geyim|clothing|fashion|moda|ayaqqabı|ayaqqabi/.test(key)) return "clothing";
  if (/gözəllik|gozellik|beauty|kosmetik|sağlamlıq|saglamliq|parfüm|parfum/.test(key)) return "beauty";
  if (/idman|sport|fitness|hobbi|velosiped/.test(key)) return "sports";
  if (/supermarket|market|ərzaq|erzaq/.test(key)) return "market";
  if (/avtomobil|avto|auto|car/.test(key)) return "automotive";
  if (/kitab|book|ofis|office/.test(key)) return "books";
  return "other";
}

export function CategoryIcon({
  category,
  size = "medium",
  className = "",
}: {
  category: CategoryInfo;
  size?: "small" | "medium" | "large";
  className?: string;
}) {
  const kind = categoryKind(category);
  const dimensions =
    size === "small" ? "h-11 w-11 rounded-[15px]" : size === "large" ? "h-[76px] w-[76px] rounded-[22px]" : "h-16 w-16 rounded-[19px]";

  // Decorative: the category name is always rendered next to the tile, so the tile is hidden
  // from assistive technology and the image carries an empty alt.
  return (
    <span
      aria-hidden="true"
      data-category-kind={kind}
      className={`group relative block shrink-0 overflow-hidden border border-white/80 bg-gradient-to-br ${categoryStyles[kind]} ${dimensions} shadow-[0_5px_13px_rgba(23,58,58,.09)] transition duration-200 group-hover:-translate-y-0.5 group-hover:shadow-[0_9px_20px_rgba(23,58,58,.14)] motion-reduce:transition-none ${className}`}
    >
      <Image
        src={categoryPhotoMap[kind].src}
        alt=""
        width={320}
        height={320}
        unoptimized
        loading="eager"
        decoding="async"
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.03] motion-reduce:transition-none"
      />
      <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#173A3A]/10 via-transparent to-transparent" />
    </span>
  );
}
