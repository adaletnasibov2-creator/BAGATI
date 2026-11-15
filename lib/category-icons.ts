/**
 * Curated category icon allowlist: iconKey -> lucide-react component (named imports, tree-shaken).
 *
 * Only keys in this list are accepted by the server (admin API). Rendering an unknown or missing key returns
 * null (no icon), never an error. The DB also restricts the key format (Category_iconKey_format_check).
 * Labels are Azerbaijani search words for the admin icon picker.
 */
import {
  Anchor, Apple, Archive, Armchair, Baby, Backpack, Bath, Bed, BedDouble, Bike, Bird, Bone, BookOpen, Box,
  Briefcase, Brush, Bus, Cable, Camera, Candy, Car, Cat, Coffee, Cog, Cookie, CookingPot, Crown, Disc3, Dog,
  Drill, Droplet, Dumbbell, Feather, Fish, Flower, Flower2, Footprints, Frame, Fuel, Gamepad2, Gauge, Gem, Gift,
  Glasses, Hammer, Hand, Headphones, Heart, House, Keyboard, Lamp, Laptop, Lightbulb, Medal, Microwave, Milk,
  Monitor, Mountain, Music, Package, Paintbrush, Palette, PartyPopper, PawPrint, Pill, Plug, Printer, Puzzle,
  Rabbit, Refrigerator, Ribbon, Scissors, Shapes, Shirt, ShoppingBag, ShoppingBasket, Shovel, Smartphone, Sofa,
  Soup, Sparkles, Speaker, SprayCan, Sprout, Star, Tablet, Tag, Tent, Trees, Trophy, Truck, Tv, UtensilsCrossed,
  Volleyball, Wallet, WashingMachine, Watch, Wine, Wrench, Zap, type LucideIcon,
} from "lucide-react";

type IconEntry = { Icon: LucideIcon; label: string };

export const CATEGORY_ICONS = {
  Smartphone: { Icon: Smartphone, label: "Telefon" },
  Tablet: { Icon: Tablet, label: "Planşet" },
  Laptop: { Icon: Laptop, label: "Noutbuk" },
  Monitor: { Icon: Monitor, label: "Monitor kompüter" },
  Keyboard: { Icon: Keyboard, label: "Klaviatura" },
  Printer: { Icon: Printer, label: "Printer" },
  Tv: { Icon: Tv, label: "Televizor" },
  Headphones: { Icon: Headphones, label: "Qulaqlıq" },
  Speaker: { Icon: Speaker, label: "Dinamik səs" },
  Watch: { Icon: Watch, label: "Saat" },
  Cable: { Icon: Cable, label: "Kabel adapter" },
  Plug: { Icon: Plug, label: "Elektrik fiş" },
  Camera: { Icon: Camera, label: "Foto kamera" },
  Disc3: { Icon: Disc3, label: "Disk musiqi" },
  Shirt: { Icon: Shirt, label: "Geyim köynək" },
  Footprints: { Icon: Footprints, label: "Ayaqqabı" },
  Glasses: { Icon: Glasses, label: "Gözlük" },
  Briefcase: { Icon: Briefcase, label: "Çanta portfel" },
  Backpack: { Icon: Backpack, label: "Bel çantası" },
  ShoppingBag: { Icon: ShoppingBag, label: "Alış-veriş çanta" },
  Wallet: { Icon: Wallet, label: "Pul kisəsi" },
  Gem: { Icon: Gem, label: "Zərgərlik daş" },
  Crown: { Icon: Crown, label: "Tac" },
  Ribbon: { Icon: Ribbon, label: "Lent" },
  Sofa: { Icon: Sofa, label: "Divan mebel" },
  Armchair: { Icon: Armchair, label: "Kreslo" },
  Bed: { Icon: Bed, label: "Çarpayı" },
  BedDouble: { Icon: BedDouble, label: "Yataq tekstil" },
  Lamp: { Icon: Lamp, label: "Lampa" },
  Lightbulb: { Icon: Lightbulb, label: "İşıqlandırma" },
  Frame: { Icon: Frame, label: "Dekor çərçivə" },
  House: { Icon: House, label: "Ev" },
  CookingPot: { Icon: CookingPot, label: "Qazan mətbəx" },
  UtensilsCrossed: { Icon: UtensilsCrossed, label: "Mətbəx əşyaları" },
  Microwave: { Icon: Microwave, label: "Mikrodalğalı soba" },
  Refrigerator: { Icon: Refrigerator, label: "Soyuducu" },
  WashingMachine: { Icon: WashingMachine, label: "Paltaryuyan" },
  Archive: { Icon: Archive, label: "Saxlama" },
  Box: { Icon: Box, label: "Qutu" },
  Package: { Icon: Package, label: "Bağlama" },
  SprayCan: { Icon: SprayCan, label: "Təmizlik sprey" },
  Bath: { Icon: Bath, label: "Vanna" },
  Sparkles: { Icon: Sparkles, label: "Gözəllik parıltı" },
  Brush: { Icon: Brush, label: "Fırça" },
  Scissors: { Icon: Scissors, label: "Qayçı saç" },
  Droplet: { Icon: Droplet, label: "Damcı ətir" },
  Hand: { Icon: Hand, label: "Əl manikür" },
  Pill: { Icon: Pill, label: "Sağlamlıq" },
  Flower: { Icon: Flower, label: "Gül" },
  Flower2: { Icon: Flower2, label: "Çiçək" },
  ShoppingBasket: { Icon: ShoppingBasket, label: "Səbət supermarket" },
  Apple: { Icon: Apple, label: "Meyvə" },
  Coffee: { Icon: Coffee, label: "Çay qəhvə" },
  Candy: { Icon: Candy, label: "Şirniyyat" },
  Cookie: { Icon: Cookie, label: "Peçenye" },
  Milk: { Icon: Milk, label: "Süd" },
  Soup: { Icon: Soup, label: "Konserv yemək" },
  Wine: { Icon: Wine, label: "İçki" },
  Baby: { Icon: Baby, label: "Uşaq körpə" },
  Puzzle: { Icon: Puzzle, label: "Tapmaca oyuncaq" },
  Dumbbell: { Icon: Dumbbell, label: "İdman fitnes" },
  Bike: { Icon: Bike, label: "Velosiped" },
  Tent: { Icon: Tent, label: "Düşərgə" },
  Mountain: { Icon: Mountain, label: "Turizm dağ" },
  Fish: { Icon: Fish, label: "Balıq" },
  Volleyball: { Icon: Volleyball, label: "Top komanda idmanı" },
  Trophy: { Icon: Trophy, label: "Kubok" },
  Medal: { Icon: Medal, label: "Medal" },
  Gamepad2: { Icon: Gamepad2, label: "Oyun əyləncə" },
  BookOpen: { Icon: BookOpen, label: "Kitab" },
  Music: { Icon: Music, label: "Musiqi" },
  Palette: { Icon: Palette, label: "Rəsm palitra" },
  Paintbrush: { Icon: Paintbrush, label: "Boya fırça" },
  Feather: { Icon: Feather, label: "Lələk" },
  Star: { Icon: Star, label: "Ulduz kolleksiya" },
  Car: { Icon: Car, label: "Avtomobil" },
  Truck: { Icon: Truck, label: "Yük maşını" },
  Bus: { Icon: Bus, label: "Avtobus" },
  Fuel: { Icon: Fuel, label: "Yanacaq yağ" },
  Gauge: { Icon: Gauge, label: "Cihaz paneli" },
  Cog: { Icon: Cog, label: "Ehtiyat hissə" },
  Wrench: { Icon: Wrench, label: "Açar alət" },
  Hammer: { Icon: Hammer, label: "Çəkic tikinti" },
  Drill: { Icon: Drill, label: "Drel" },
  Zap: { Icon: Zap, label: "Elektrik" },
  Shovel: { Icon: Shovel, label: "Bel bağ" },
  Sprout: { Icon: Sprout, label: "Bitki" },
  Trees: { Icon: Trees, label: "Bağ həyət" },
  Anchor: { Icon: Anchor, label: "Lövbər dəniz" },
  PawPrint: { Icon: PawPrint, label: "Ev heyvanı" },
  Cat: { Icon: Cat, label: "Pişik" },
  Dog: { Icon: Dog, label: "İt" },
  Bird: { Icon: Bird, label: "Quş" },
  Rabbit: { Icon: Rabbit, label: "Dovşan" },
  Bone: { Icon: Bone, label: "Sümük" },
  Gift: { Icon: Gift, label: "Hədiyyə" },
  PartyPopper: { Icon: PartyPopper, label: "Bayram" },
  Heart: { Icon: Heart, label: "Ürək" },
  Tag: { Icon: Tag, label: "Etiket" },
  Shapes: { Icon: Shapes, label: "Digər fiqurlar" },
} satisfies Record<string, IconEntry>;

export type CategoryIconKey = keyof typeof CATEGORY_ICONS;

export const CATEGORY_ICON_KEYS = Object.keys(CATEGORY_ICONS) as CategoryIconKey[];

export function isCategoryIconKey(value: unknown): value is CategoryIconKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CATEGORY_ICONS, value);
}

/** The component for a key, or null for a missing/unknown key (never throws). */
export function categoryIconComponent(key: string | null | undefined): LucideIcon | null {
  return isCategoryIconKey(key) ? CATEGORY_ICONS[key].Icon : null;
}

/** A subcategory without its own icon uses its parent's. */
export function effectiveIconKey(category: { iconKey: string | null }, parent?: { iconKey: string | null } | null): CategoryIconKey | null {
  if (isCategoryIconKey(category.iconKey)) return category.iconKey;
  if (parent && isCategoryIconKey(parent.iconKey)) return parent.iconKey;
  return null;
}

/** Admin picker search: by key or Azerbaijani label, case-insensitive. */
export function searchCategoryIcons(query: string): CategoryIconKey[] {
  const needle = query.trim().toLocaleLowerCase("az-AZ");
  if (!needle) return CATEGORY_ICON_KEYS;
  return CATEGORY_ICON_KEYS.filter((key) => key.toLocaleLowerCase("az-AZ").includes(needle) || CATEGORY_ICONS[key].label.toLocaleLowerCase("az-AZ").includes(needle));
}
