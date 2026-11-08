export const storefrontThemes = {
  forest: { label: "Meşə", accent: "#244f45", accentSoft: "#e8f0eb", highlight: "#c8a96b" },
  ocean: { label: "Dəniz", accent: "#24516a", accentSoft: "#e8f1f5", highlight: "#83b6c6" },
  copper: { label: "Mis", accent: "#704b38", accentSoft: "#f4eee8", highlight: "#c88e5c" },
} as const;

export type StorefrontTheme = keyof typeof storefrontThemes;

export function isStorefrontTheme(value: unknown): value is StorefrontTheme {
  return typeof value === "string" && Object.hasOwn(storefrontThemes, value);
}

export function getStorefrontTheme(value: string) {
  return storefrontThemes[isStorefrontTheme(value) ? value : "forest"];
}
