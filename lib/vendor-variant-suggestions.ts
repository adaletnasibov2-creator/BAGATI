const values: Record<string, string[]> = {
  rəng: ["Qara", "Ağ", "Mavi", "Qırmızı", "Yaşıl", "Sarı", "Boz", "Qəhvəyi", "Bej", "Narıncı", "Bənövşəyi", "Çəhrayı"],
  ölçü: ["XS", "S", "M", "L", "XL", "XXL", "XXXL"],
  "ayaqqabı ölçüsü": ["35", "36", "37", "38", "39", "40", "41", "42", "43", "44", "45"],
  yaddaş: ["32 GB", "64 GB", "128 GB", "256 GB", "512 GB", "1 TB", "2 TB"],
  ram: ["4 GB", "8 GB", "16 GB", "32 GB", "64 GB"],
  ssd: ["256 GB", "512 GB", "1 TB", "2 TB"],
};

const allNames = ["Rəng", "Ölçü", "Ayaqqabı ölçüsü", "Yaddaş", "RAM", "SSD", "Material", "Model", "Stil", "Forma"];
const byCategory: Record<string, string[]> = {
  clothing: ["Rəng", "Ölçü", "Material", "Stil"],
  shoes: ["Rəng", "Ayaqqabı ölçüsü", "Material"],
  phones: ["Rəng", "Yaddaş", "RAM"],
  laptops: ["RAM", "SSD", "Yaddaş", "Model"],
  accessories: ["Növ", "Rəng", "Material"],
  beauty: ["Məhsul növü", "Həcm", "Brend"],
  home: ["Növ", "Ölçü", "Material", "Rəng"],
  kids: ["Yaş qrupu", "Ölçü", "Rəng"],
};

export function categorySuggestionKey(categoryName: string): string | null {
  const category = categoryName.trim().normalize("NFKC").toLocaleLowerCase("az-AZ");
  if (/ayaqqabı|footwear|shoes/.test(category)) return "shoes";
  if (/telefon|phone|smartphone|mobil/.test(category)) return "phones";
  if (/noutbuk|laptop|kompüter|computer/.test(category)) return "laptops";
  if (/geyim|clothing|apparel|paltar/.test(category)) return "clothing";
  if (/aksesuar|accessor/.test(category)) return "accessories";
  if (/gözəllik|qulluq|beauty|cosmetic/.test(category)) return "beauty";
  if (/ev|yaşayış|home|furniture/.test(category)) return "home";
  if (/uşaq|usaq|kids|child/.test(category)) return "kids";
  return null;
}

export function suggestedVariantAttributes(categoryName: string): string[] {
  const key = categorySuggestionKey(categoryName);
  return key ? byCategory[key] : allNames;
}

export function suggestedVariantValues(attributeName: string): string[] {
  return values[attributeName.trim().normalize("NFKC").toLocaleLowerCase("az-AZ")] || [];
}
