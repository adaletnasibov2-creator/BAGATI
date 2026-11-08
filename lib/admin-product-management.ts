import { z } from "zod";
import { nullableSkuSchema } from "@/lib/sku-normalization";

const positiveMoney = z.coerce.number().finite().gt(0).max(9999999999);

export const adminProductUpdateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().max(5000).nullable(),
  sku: nullableSkuSchema,
  categoryId: z.string().nullable(),
  brandId: z.string().nullable(),
  price: positiveMoney,
  discountPrice: positiveMoney.nullable(),
  images: z.array(z.string().min(1).max(500)).max(12),
  quantity: z.number().int().min(0).max(1000000),
  lowStockThreshold: z.number().int().min(0).max(100000),
  variants: z.array(z.object({
    id: z.string().min(1),
    name: z.string().trim().min(1).max(100),
    sku: nullableSkuSchema,
    isActive: z.boolean(),
    price: positiveMoney.nullable(),
    discountPrice: positiveMoney.nullable(),
    quantity: z.number().int().min(0).max(1000000),
    lowStockThreshold: z.number().int().min(0).max(100000),
  })).max(100),
}).strict().superRefine((value, context) => {
  if (value.discountPrice !== null && value.discountPrice >= value.price) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["discountPrice"], message: "Endirim qiyməti əsas qiymətdən aşağı olmalıdır" });
  }
  for (const [index, variant] of value.variants.entries()) {
    if (variant.discountPrice !== null && variant.discountPrice >= (variant.price ?? value.price)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["variants", index, "discountPrice"], message: "Variant endirimi əsas qiymətdən aşağı olmalıdır" });
    }
  }
});

export function inventoryQuantityAllowed(quantity: number, reserved: number) {
  return Number.isInteger(quantity) && Number.isInteger(reserved) && quantity >= 0 && reserved >= 0 && quantity >= reserved;
}

export const adminPromotionSchema = z.object({
  id: z.string().min(1).optional(),
  storeId: z.string().min(1),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).nullable(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  isActive: z.boolean(),
  discountType: z.enum(["PERCENT", "FIXED"]),
  discountValue: z.coerce.number().finite().gt(0).max(9999999999),
  productIds: z.array(z.string().min(1)).min(1).max(100),
}).strict().superRefine((value, context) => {
  if (value.endsAt <= value.startsAt) context.addIssue({ code: z.ZodIssueCode.custom, path: ["endsAt"], message: "Bitmə vaxtı başlanğıcdan sonra olmalıdır" });
  if (value.discountType === "PERCENT" && value.discountValue >= 100) context.addIssue({ code: z.ZodIssueCode.custom, path: ["discountValue"], message: "Faiz endirimi 100%-dən kiçik olmalıdır" });
  if (new Set(value.productIds).size !== value.productIds.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["productIds"], message: "Məhsul təkrar seçilə bilməz" });
});

export function hasAdminPromotionConflict(
  candidate: { startsAt: Date; endsAt: Date; isActive: boolean },
  existing: readonly { startsAt: Date; endsAt: Date; isActive: boolean }[],
) {
  return candidate.isActive && existing.some((item) =>
    item.isActive && candidate.startsAt < item.endsAt && candidate.endsAt > item.startsAt,
  );
}
