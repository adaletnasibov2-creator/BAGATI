import { Prisma } from "@prisma/client";
import { z } from "zod";

export const DEFAULT_FREE_DELIVERY_THRESHOLD = new Prisma.Decimal("30.00");
export const TEMPORARY_DEFAULT_DELIVERY_FEE = new Prisma.Decimal("0.00");

export const deliveryAmountSchema = z.union([z.string().trim().min(1), z.number()])
  .transform(Number)
  .pipe(z.number()
    .finite()
    .min(0)
    .max(9_999_999_999.99)
    .refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001, "Məbləğ ən çox iki onluq rəqəm daşıya bilər"));

export function calculateStoreDelivery(
  subtotal: Prisma.Decimal.Value,
  config: { freeDeliveryThreshold?: Prisma.Decimal.Value | null; deliveryFee?: Prisma.Decimal.Value | null } = {},
) {
  const orderSubtotal = new Prisma.Decimal(subtotal);
  const freeDeliveryThreshold = config.freeDeliveryThreshold == null
    ? DEFAULT_FREE_DELIVERY_THRESHOLD
    : new Prisma.Decimal(config.freeDeliveryThreshold);
  const configuredDeliveryFee = config.deliveryFee == null
    ? TEMPORARY_DEFAULT_DELIVERY_FEE
    : new Prisma.Decimal(config.deliveryFee);
  const freeDelivery = orderSubtotal.gte(freeDeliveryThreshold);
  const deliveryFee = freeDelivery ? new Prisma.Decimal(0) : configuredDeliveryFee;

  return { subtotal: orderSubtotal, deliveryFee, freeDelivery, freeDeliveryThreshold };
}
