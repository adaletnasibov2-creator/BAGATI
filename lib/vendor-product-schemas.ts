import { z } from "zod";
import { optionalStockQuantitySchema } from "@/lib/stock-quantity";
import { optionalSkuSchema } from "@/lib/sku-normalization";

export const vendorProductVariantCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  options: z.record(z.unknown()).default({}),
  sku: optionalSkuSchema,
  isActive: z.boolean().default(true),
  price: z.coerce.number().positive().nullable().optional(),
  discountPrice: z.coerce.number().positive().nullable().optional(),
  images: z.array(z.string().min(1).max(500)).max(12).default([]),
  quantity: optionalStockQuantitySchema.default(0),
  lowStockThreshold: optionalStockQuantitySchema.default(5),
});

export const vendorProductCreateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().max(5000).nullable().optional(),
  sku: optionalSkuSchema,
  price: z.coerce.number().positive(),
  discountPrice: z.union([z.coerce.number().positive(), z.null()]).optional(),
  categoryId: z.string().nullable().optional(),
  brandId: z.string().nullable().optional(),
  images: z.array(z.string().min(1).max(500)).max(12).default([]),
  quantity: optionalStockQuantitySchema.default(0),
  lowStockThreshold: optionalStockQuantitySchema.default(5),
  status: z.enum(["DRAFT", "ACTIVE"]).default("DRAFT"),
  variantsEnabled: z.boolean().optional(),
  variants: z.array(vendorProductVariantCreateSchema).max(100).default([]),
});

export const legacyVendorProductSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().max(5000).optional().nullable(),
  price: z.coerce.number().positive(),
  discountPrice: z.coerce.number().positive().optional().nullable(),
  sku: optionalSkuSchema,
  categoryId: z.string().optional().nullable(),
  brandId: z.string().optional().nullable(),
  images: z.array(z.string().min(1).max(500)).max(12).default([]),
  quantity: optionalStockQuantitySchema.default(0),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).default("DRAFT"),
  variants: z.array(z.object({
    name: z.string().trim().min(1),
    options: z.record(z.unknown()),
    sku: optionalSkuSchema,
    quantity: optionalStockQuantitySchema.default(0),
  })).max(50).default([]),
});

export const legacyVendorProductPatchSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(2).max(160).optional(),
  description: z.string().max(5000).nullable().optional(),
  price: z.coerce.number().positive().optional(),
  discountPrice: z.union([z.coerce.number().positive(), z.null()]).optional(),
  sku: optionalSkuSchema,
  categoryId: z.string().nullable().optional(),
  brandId: z.string().nullable().optional(),
  images: z.array(z.string().min(1).max(500)).max(12).optional(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(),
});
