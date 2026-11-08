import {
  Baby,
  BookOpen,
  Car,
  Dumbbell,
  Gamepad2,
  Gem,
  Grid2X2,
  House,
  PawPrint,
  Shirt,
  ShoppingBasket,
  Smartphone,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

type CategoryKind = "accessories" | "electronics" | "home" | "entertainment" | "clothing" | "beauty" | "sports" | "market" | "children" | "automotive" | "books" | "pets" | "other";
type CategoryInfo = { name: string; slug?: string | null };

const visuals: Record<CategoryKind, { Icon: LucideIcon; surface: string; color: string }> = {
  accessories: { Icon: Gem, surface: "bg-[#f7f0df]", color: "text-[#765719]" },
  electronics: { Icon: Smartphone, surface: "bg-[#e9f0f2]", color: "text-[#315568]" },
  home: { Icon: House, surface: "bg-[#edf1ed]", color: "text-[#41685e]" },
  entertainment: { Icon: Gamepad2, surface: "bg-[#f0ecf4]", color: "text-[#65547b]" },
  clothing: { Icon: Shirt, surface: "bg-[#f4ece8]", color: "text-[#825d4d]" },
  beauty: { Icon: Sparkles, surface: "bg-[#f4edf0]", color: "text-[#835b70]" },
  sports: { Icon: Dumbbell, surface: "bg-[#eaf1ed]", color: "text-[#356b5b]" },
  market: { Icon: ShoppingBasket, surface: "bg-[#f3efe5]", color: "text-[#796336]" },
  children: { Icon: Baby, surface: "bg-[#edf0f5]", color: "text-[#586b8a]" },
  automotive: { Icon: Car, surface: "bg-[#edf0f2]", color: "text-[#4b6071]" },
  books: { Icon: BookOpen, surface: "bg-[#f2eee7]", color: "text-[#796344]" },
  pets: { Icon: PawPrint, surface: "bg-[#edf1e9]", color: "text-[#587047]" },
  other: { Icon: Grid2X2, surface: "bg-[#eeefed]", color: "text-[#526273]" },
};

export function categoryKind({ name, slug }: CategoryInfo): CategoryKind {
  const key = `${slug ?? ""} ${name}`.toLocaleLowerCase("az-AZ");
  if (/aksesuar|accessor/.test(key)) return "accessories";
  if (/elektron|electronic|telefon|texnika/.test(key)) return "electronics";
  if (/(^|\s)ev(\s|$)|məişət|mesiet|home|bağ|bag/.test(key)) return "home";
  if (/əyləncə|eylence|entertain|oyun|game|media/.test(key)) return "entertainment";
  if (/geyim|clothing|fashion|ayaqqabı|ayaqqabi/.test(key)) return "clothing";
  if (/gözəllik|gozellik|beauty|kosmetik|sağlamlıq|saglamliq/.test(key)) return "beauty";
  if (/idman|sport|fitness/.test(key)) return "sports";
  if (/supermarket|market|ərzaq|erzaq/.test(key)) return "market";
  if (/uşaq|usaq|child|baby|körpə|korpe/.test(key)) return "children";
  if (/avtomobil|auto|car/.test(key)) return "automotive";
  if (/kitab|book|ofis|office/.test(key)) return "books";
  if (/heyvan|pet/.test(key)) return "pets";
  return "other";
}

export function CategoryIcon({ category, size = "medium", className = "" }: { category: CategoryInfo; size?: "small" | "medium" | "large"; className?: string }) {
  const visual = visuals[categoryKind(category)];
  const dimensions = size === "small" ? "h-10 w-10 rounded-xl" : size === "large" ? "h-[68px] w-[68px] rounded-2xl" : "h-14 w-14 rounded-2xl";
  const iconSize = size === "small" ? 18 : size === "large" ? 26 : 22;
  return <span aria-hidden="true" className={`grid shrink-0 place-items-center ${dimensions} ${visual.surface} ${visual.color} transition duration-200 group-hover:-translate-y-0.5 group-hover:shadow-sm ${className}`}>
    <visual.Icon aria-hidden="true" size={iconSize} strokeWidth={1.7} />
  </span>;
}
