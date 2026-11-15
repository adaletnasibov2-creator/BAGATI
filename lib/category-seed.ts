/**
 * Reviewed category tree (owner brief + decisions of 2026-11-15). Single source for:
 * - scripts/generate-category-seed-sql.ts -> release-output/prod-categories-seed.sql (production, idempotent)
 * - prisma/seed.ts (development)
 *
 * Existing top-levels (`existing: true`) are matched by slug and only get iconKey/sortOrder; their name, slug and
 * photo never change. Everything else is inserted with ON CONFLICT (slug) DO NOTHING. Admins can edit all of it
 * later. Slugs come from categorySlug() (the project transliteration), except "İt" -> "itler" (owner decision).
 */
import { categorySlug } from "@/lib/category-tree";
import type { CategoryIconKey } from "@/lib/category-icons";

export type SeedChild = { name: string; slug: string; sortOrder: number };
export type SeedTop = { name: string; slug: string; iconKey: CategoryIconKey; sortOrder: number; existing: boolean; children: SeedChild[] };

const SLUG_OVERRIDES: Record<string, string> = { "İt": "itler" };

function children(names: string[]): SeedChild[] {
  return names.map((name, index) => ({ name, slug: SLUG_OVERRIDES[name] ?? categorySlug(name), sortOrder: (index + 1) * 10 }));
}

function top(name: string, slug: string, iconKey: CategoryIconKey, sortOrder: number, existing: boolean, names: string[]): SeedTop {
  return { name, slug, iconKey, sortOrder, existing, children: children(names) };
}

/** Existing order (alphabetical as shown today) 10..90, new top-levels 100..140, Digər 1000 (always last). */
export const CATEGORY_SEED: SeedTop[] = [
  top("Aksesuarlar", "aksesuarlar", "Watch", 10, true, ["Çantalar", "Pul kisələri və kəmərlər", "Saatlar", "Gözlüklər", "Zərgərlik və bijuteriya", "Papaq və şərf"]),
  top("Elektronika", "elektronika", "Smartphone", 20, true, ["Telefonlar", "Planşetlər", "Noutbuk və kompüterlər", "Televizorlar", "Qulaqlıq və səs", "Ağıllı saatlar", "Kabel və adapterlər", "Foto və video"]),
  top("Ev və məişət", "ev-ve-mesiet", "Sofa", 30, true, ["Mebel", "Mətbəx əşyaları", "Ev tekstili", "Dekor", "İşıqlandırma", "Saxlama və təmizlik", "Məişət texnikası"]),
  top("Geyim", "geyim", "Shirt", 40, true, ["Qadın geyimi", "Kişi geyimi", "Uşaq geyimi", "Alt paltarı və corab", "İdman geyimi", "Qadın ayaqqabısı", "Kişi ayaqqabısı", "Uşaq ayaqqabısı"]),
  top("Gözəllik", "gozellik", "Sparkles", 50, true, ["Kosmetika", "Ətir", "Dəri baxımı", "Saç baxımı", "Manikür", "Kişi baxımı"]),
  top("Supermarket", "supermarket", "ShoppingBasket", 60, true, ["Quru meyvə və qoz-fındıq", "Bal və şirniyyat", "Çay və qəhvə", "Milli məhsullar", "Konservlər", "İçkilər", "Təmizlik vasitələri"]),
  top("Uşaq", "usaq", "Baby", 70, true, ["Oyuncaqlar", "Körpə geyimi", "Uşaq arabaları", "Məktəb ləvazimatı", "Qidalandırma", "Uşaq otağı"]),
  top("İdman", "idman", "Dumbbell", 80, true, ["Fitnes avadanlığı", "Velosiped və skuter", "Düşərgə və turizm", "Balıqçılıq", "Komanda idmanı"]),
  top("Əyləncə", "eylence", "Gamepad2", 90, true, ["Kitablar", "Oyunlar və tapmacalar", "Musiqi alətləri", "Rəsm və əl işi ləvazimatı", "Video oyunlar", "Kolleksiya"]),
  top("Avtomobil", "avtomobil", "Car", 100, false, ["Ehtiyat hissələri", "Avtoaksesuarlar", "Yağlar və kimyəvi maddələr", "Təkər və disklər", "Avtoelektronika"]),
  top("Tikinti və bağ", "tikinti-ve-bag", "Hammer", 110, false, ["Alətlər", "Elektrik", "Santexnika", "Boya və qurğular", "Bağ və həyət"]),
  top("Ev heyvanları", "ev-heyvanlari", "PawPrint", 120, false, ["Pişik", "İt", "Digər heyvanlar"]),
  top("Hədiyyə və bayram", "hediyye-ve-bayram", "Gift", 130, false, ["Hədiyyə dəstləri", "Bayram bəzəkləri", "Güllər və dəstlər"]),
  top("Əl işi və milli", "el-isi-ve-milli", "Gem", 140, false, ["Xalça və kilim", "Zərgərlik (əl işi)", "Keramika", "Milli geyim və aksesuar"]),
  top("Digər", "diger", "Shapes", 1000, true, []),
];
