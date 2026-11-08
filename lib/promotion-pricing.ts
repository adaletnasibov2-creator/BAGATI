import { Prisma } from "@prisma/client";

export type PromotionPriceInput = {
  id: string;
  storeId?: string | null;
  name: string;
  startsAt: Date;
  endsAt: Date;
  isActive: boolean;
  discountType: string | null;
  discountValue: Prisma.Decimal | number | string | null;
};

export function productPromotions(links: Array<{ promotion: PromotionPriceInput }>, storeId: string) {
  return links.map((link) => link.promotion).filter((promotion) => promotion.storeId === storeId);
}

export type EffectivePrice = {
  basePrice: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  promotion: PromotionPriceInput | null;
};

export function promotionStatus(promotion: PromotionPriceInput, now = new Date()) {
  if (!promotion.isActive) return "DISABLED" as const;
  if (promotion.startsAt.getTime() > now.getTime()) return "SCHEDULED" as const;
  if (promotion.endsAt.getTime() < now.getTime()) return "EXPIRED" as const;
  return "ACTIVE" as const;
}

export function calculateCampaignPrice(basePrice: Prisma.Decimal.Value, type: string | null, value: Prisma.Decimal.Value | null) {
  if (value === null || (type !== "PERCENT" && type !== "FIXED")) return null;
  const base = new Prisma.Decimal(basePrice);
  const amount = new Prisma.Decimal(value);
  if (!base.isFinite() || !base.gt(0) || !amount.isFinite() || !amount.gt(0)) return null;
  const discounted = type === "PERCENT"
    ? base.mul(new Prisma.Decimal(100).sub(amount)).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    : base.sub(amount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return discounted.gt(0) && discounted.lt(base) ? discounted : null;
}

export function calculateEffectivePrice(
  price: Prisma.Decimal.Value,
  manualDiscount: Prisma.Decimal.Value | null,
  promotions: PromotionPriceInput[] = [],
  now = new Date(),
): EffectivePrice {
  const basePrice = new Prisma.Decimal(price);
  const active = promotions
    .filter((promotion) => promotionStatus(promotion, now) === "ACTIVE")
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id));

  // Conflicting legacy records use one stable winner; discounts never stack.
  const selected = active.find((promotion) => calculateCampaignPrice(basePrice, promotion.discountType, promotion.discountValue) !== null) ?? null;
  const manual = manualDiscount === null ? null : new Prisma.Decimal(manualDiscount);
  const manualIsValid = manual !== null && manual.isFinite() && manual.gt(0) && manual.lt(basePrice);
  const unitPrice = selected
    ? calculateCampaignPrice(basePrice, selected.discountType, selected.discountValue)!
    : manualIsValid ? manual! : basePrice;
  return { basePrice, unitPrice, discountAmount: basePrice.sub(unitPrice), promotion: selected };
}

export function hasOverlappingEnabledPromotion(
  startsAt: Date,
  endsAt: Date,
  existing: Array<{ startsAt: Date; endsAt: Date }>,
) {
  return existing.some((item) => startsAt < item.endsAt && endsAt > item.startsAt);
}
