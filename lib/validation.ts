import { z } from "zod";
import { optionalAzPhoneSchema } from "@/lib/az-phone";
import { newVoenSchema } from "@/lib/seller-application";

export const registerSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
});

export const vendorRegisterSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  phone: z.string().trim().min(5).max(40),
});

export const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});

export const productQuerySchema = z.object({
  city: z.string().optional(),
  category: z.string().optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * Admin-created vendor onboarding. Business/legal fields map to existing
 * VendorProfile columns (sellerType/legalName/voen/legalAddress) and store
 * contact fields to existing Store columns; no schema-only duplication.
 *
 * storeAddress is the factual/physical address (Store.address).
 * legalAddress is the registered legal address (VendorProfile.legalAddress).
 * No store-level category field exists in the schema; categories attach to
 * products, so this form intentionally does not collect a store category.
 */
export const adminCreateVendorSchema = z
  .object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    email: z.string().trim().email().max(254),
    password: z.string().min(12).max(128),
    phone: z.string().trim().max(40).optional().nullable(),
    sellerType: z.enum(["INDIVIDUAL_ENTREPRENEUR", "REGISTERED_COMPANY"]),
    legalName: z.string().trim().min(2).max(200),
    // Same rule as customer applications: exactly 10 digits, stored as digits only.
    voen: newVoenSchema,
    legalAddress: z.string().trim().max(400).optional().nullable(),

    storeName: z.string().trim().min(2).max(120),
    storeDescription: z.string().trim().max(3000).optional().nullable(),
    cityId: z.string().trim().min(1),
    storeAddress: z.string().trim().max(300).optional().nullable(),
    contactPhone: optionalAzPhoneSchema.optional(),
    contactEmail: z.string().trim().email().max(254).optional().nullable(),
    initialStatus: z.enum(["DRAFT", "PENDING_REVIEW"]).default("DRAFT"),
    adminManaged: z.boolean().default(false),
    managementReason: z.string().trim().max(500).nullish().transform((v) => v ?? ""),
    internalNote: z.string().trim().max(1000).nullish().transform((v) => v ?? ""),
  })
  .superRefine((data, ctx) => {
    if (data.sellerType === "REGISTERED_COMPANY" && !data.legalAddress?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["legalAddress"],
        message: "Qeydiyyatda olan şirkət üçün hüquqi ünvan tələb olunur.",
      });
    }
    if (data.adminManaged && !data.managementReason.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["managementReason"],
        message: "Admin tərəfindən idarə olunan mağaza üçün idarəetmə səbəbi tələb olunur.",
      });
    }
  });
