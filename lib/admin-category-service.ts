/**
 * Admin category management (Kataloq > Kateqoriyalar). Every mutation runs in one transaction and writes one
 * AuditLog row. Rules: two levels only (lib/category-tree.ts + DB trigger), globally unique ASCII slugs, icon keys
 * from the allowlist only, photos only from admin uploads / https (same rule as homepage images), delete only
 * without products and subcategories (deactivate otherwise), bulk product moves max 100 with a version check.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  CATEGORY_NAME_MAX,
  categorySlug,
  checkCategoryPlacement,
  compareCategories,
  isValidCategorySlug,
  placementErrorMessages,
} from "@/lib/category-tree";
import { isCategoryIconKey } from "@/lib/category-icons";
import { isSafeHomepageImageUrl } from "@/lib/site-content";

export const MOVE_PRODUCTS_MAX = 100;
const OTHER_NAME = "digər";

export class CategoryAdminError extends Error {
  constructor(readonly status: 404 | 409 | 422, message: string, readonly details?: unknown) {
    super(message);
  }
}

type Tx = Prisma.TransactionClient;
type Db = Pick<PrismaClient, "$transaction">;

const nameSchema = z.string().trim().min(2, "Ad ən azı 2 simvol olmalıdır").max(CATEGORY_NAME_MAX, "Ad 100 simvoldan uzun ola bilməz");
const optionalText = z.string().trim().max(500).nullable().optional();

export const createCategorySchema = z.object({
  name: nameSchema,
  slug: z.string().trim().max(120).optional().nullable(),
  parentId: z.string().trim().min(1).max(64).nullable().optional(),
  iconKey: optionalText,
  imageUrl: optionalText,
  isActive: z.boolean().optional(),
}).strict();

export const updateCategorySchema = z.object({
  name: nameSchema.optional(),
  slug: z.string().trim().min(2).max(120).optional(),
  parentId: z.string().trim().min(1).max(64).nullable().optional(),
  iconKey: optionalText,
  imageUrl: optionalText,
  isActive: z.boolean().optional(),
}).strict();

export const moveProductsSchema = z.object({
  fromCategoryId: z.string().trim().min(1).max(64),
  toCategoryId: z.string().trim().min(1).max(64),
  items: z.array(z.object({ id: z.string().trim().min(1).max(64), version: z.string().datetime() })).min(1).max(MOVE_PRODUCTS_MAX),
}).strict();

function normalizeIconKey(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (!isCategoryIconKey(value)) throw new CategoryAdminError(422, "Bu ikon icazə verilən siyahıda yoxdur.");
  return value;
}

function normalizeImageUrl(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (!isSafeHomepageImageUrl(value)) throw new CategoryAdminError(422, "Şəkil yalnız admin yükləməsindən və ya https ünvanından ola bilər.");
  return value;
}

function normalizeSlug(value: string | null | undefined, name: string): string {
  const slug = categorySlug(value?.trim() ? value : name);
  if (!isValidCategorySlug(slug)) throw new CategoryAdminError(422, "Slug yalnız kiçik latın hərfləri, rəqəmlər və tire ola bilər (ən azı 2 simvol).");
  return slug;
}

/** Maps DB guard / unique errors to admin messages; anything else is rethrown. */
export function mapCategoryDbError(error: unknown): never {
  if (error instanceof CategoryAdminError) throw error;
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new CategoryAdminError(409, "Bu slug artıq başqa kateqoriyada istifadə olunur.");
  const message = error instanceof Error ? error.message : "";
  if (message.includes("CATEGORY_DEPTH")) throw new CategoryAdminError(422, "Kateqoriyalar yalnız iki səviyyəli ola bilər (üst > alt).");
  if (message.includes("CATEGORY_IN_USE")) throw new CategoryAdminError(409, "Məhsulu və ya alt kateqoriyası olan kateqoriya silinmir; onu deaktiv edin.");
  throw error;
}

async function audit(tx: Tx, actorId: string, action: string, entityId: string | null, metadata: Prisma.InputJsonValue) {
  await tx.auditLog.create({ data: { actorId, action, entityType: "Category", entityId, metadata } });
}

async function siblingRows(tx: Tx, parentId: string | null) {
  // Lock the sibling rows so two concurrent reorders/creates in the same list serialize.
  if (parentId === null) await tx.$queryRaw`SELECT "id" FROM "Category" WHERE "parentId" IS NULL FOR UPDATE`;
  else await tx.$queryRaw`SELECT "id" FROM "Category" WHERE "parentId" = ${parentId} FOR UPDATE`;
  return tx.category.findMany({ where: { parentId }, select: { id: true, name: true, sortOrder: true } });
}

function nextSortOrder(siblings: { name: string; sortOrder: number }[]): number {
  const regular = siblings.filter((row) => row.name.trim().toLocaleLowerCase("az-AZ") !== OTHER_NAME).map((row) => row.sortOrder);
  return (regular.length ? Math.max(...regular) : 0) + 10;
}

export async function createCategory(db: Db, actorId: string, raw: unknown) {
  const parsed = createCategorySchema.safeParse(raw);
  if (!parsed.success) throw new CategoryAdminError(422, parsed.error.issues[0]?.message ?? "Kateqoriya məlumatlarını yoxlayın");
  const input = parsed.data;
  const slug = normalizeSlug(input.slug, input.name);
  const iconKey = normalizeIconKey(input.iconKey) ?? null;
  const imageUrl = normalizeImageUrl(input.imageUrl) ?? null;
  const parentId = input.parentId ?? null;
  try {
    return await db.$transaction(async (tx) => {
      if (parentId) {
        await tx.$queryRaw`SELECT "id" FROM "Category" WHERE "id" = ${parentId} FOR SHARE`;
        const parent = await tx.category.findUnique({ where: { id: parentId }, select: { id: true, parentId: true } });
        const error = checkCategoryPlacement(parent ? [parent] : [], { parentId });
        if (error) throw new CategoryAdminError(422, placementErrorMessages[error]);
      }
      const siblings = await siblingRows(tx, parentId);
      const created = await tx.category.create({
        data: { name: input.name, slug, parentId, iconKey, imageUrl, isActive: input.isActive ?? true, sortOrder: nextSortOrder(siblings) },
      });
      await audit(tx, actorId, "CATEGORY_CREATE", created.id, { name: created.name, slug: created.slug, parentId, iconKey, imageUrl, sortOrder: created.sortOrder });
      return created;
    });
  } catch (error) {
    mapCategoryDbError(error);
  }
}

export async function updateCategory(db: Db, actorId: string, id: string, raw: unknown) {
  const parsed = updateCategorySchema.safeParse(raw);
  if (!parsed.success) throw new CategoryAdminError(422, parsed.error.issues[0]?.message ?? "Kateqoriya məlumatlarını yoxlayın");
  const input = parsed.data;
  const iconKey = normalizeIconKey(input.iconKey);
  const imageUrl = normalizeImageUrl(input.imageUrl);
  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Category" WHERE "id" = ${id} FOR UPDATE`;
      const current = await tx.category.findUnique({ where: { id } });
      if (!current) throw new CategoryAdminError(404, "Kateqoriya tapılmadı.");
      const data: Prisma.CategoryUncheckedUpdateInput = {};
      if (input.name !== undefined && input.name !== current.name) data.name = input.name;
      if (input.slug !== undefined) {
        const slug = normalizeSlug(input.slug, current.name);
        if (slug !== current.slug) data.slug = slug;
      }
      if (iconKey !== undefined && iconKey !== current.iconKey) data.iconKey = iconKey;
      if (imageUrl !== undefined && imageUrl !== current.imageUrl) data.imageUrl = imageUrl;
      if (input.isActive !== undefined && input.isActive !== current.isActive) data.isActive = input.isActive;
      if (input.parentId !== undefined && input.parentId !== current.parentId) {
        const parentId = input.parentId;
        if (parentId) await tx.$queryRaw`SELECT "id" FROM "Category" WHERE "id" = ${parentId} FOR SHARE`;
        const related = await tx.category.findMany({
          where: { OR: [...(parentId ? [{ id: parentId }] : []), { parentId: id }] },
          select: { id: true, parentId: true },
        });
        const error = checkCategoryPlacement(related, { id, parentId });
        if (error) throw new CategoryAdminError(422, placementErrorMessages[error]);
        data.parentId = parentId;
        data.sortOrder = nextSortOrder(await siblingRows(tx, parentId));
      }
      if (!Object.keys(data).length) return current;
      const updated = await tx.category.update({ where: { id }, data });
      const before = Object.fromEntries(Object.keys(data).map((key) => [key, (current as Record<string, unknown>)[key] ?? null]));
      const after = Object.fromEntries(Object.keys(data).map((key) => [key, (updated as Record<string, unknown>)[key] ?? null]));
      const action = data.parentId !== undefined ? "CATEGORY_MOVE" : data.isActive !== undefined && Object.keys(data).length === 1 ? (updated.isActive ? "CATEGORY_ACTIVATE" : "CATEGORY_DEACTIVATE") : "CATEGORY_UPDATE";
      await audit(tx, actorId, action, id, { before, after } as Prisma.InputJsonValue);
      return updated;
    });
  } catch (error) {
    mapCategoryDbError(error);
  }
}

/** Swaps the category with its neighbour among its siblings and renumbers them 10, 20, ...; Digər stays last. */
export async function reorderCategory(db: Db, actorId: string, id: string, direction: "up" | "down") {
  try {
    return await db.$transaction(async (tx) => {
      const current = await tx.category.findUnique({ where: { id }, select: { id: true, name: true, parentId: true } });
      if (!current) throw new CategoryAdminError(404, "Kateqoriya tapılmadı.");
      if (current.name.trim().toLocaleLowerCase("az-AZ") === OTHER_NAME) throw new CategoryAdminError(422, "“Digər” həmişə sonuncu qalır.");
      const siblings = (await siblingRows(tx, current.parentId)).sort(compareCategories)
        .filter((row) => row.name.trim().toLocaleLowerCase("az-AZ") !== OTHER_NAME);
      const index = siblings.findIndex((row) => row.id === id);
      const target = direction === "up" ? index - 1 : index + 1;
      if (index < 0 || target < 0 || target >= siblings.length) return { changed: false };
      [siblings[index], siblings[target]] = [siblings[target], siblings[index]];
      const changes: { id: string; from: number; to: number }[] = [];
      for (const [position, row] of siblings.entries()) {
        const sortOrder = (position + 1) * 10;
        if (row.sortOrder !== sortOrder) {
          await tx.category.update({ where: { id: row.id }, data: { sortOrder } });
          changes.push({ id: row.id, from: row.sortOrder, to: sortOrder });
        }
      }
      await audit(tx, actorId, "CATEGORY_REORDER", id, { direction, parentId: current.parentId, changes });
      return { changed: true };
    });
  } catch (error) {
    mapCategoryDbError(error);
  }
}

export async function deleteCategory(db: Db, actorId: string, id: string) {
  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Category" WHERE "id" = ${id} FOR UPDATE`;
      const category = await tx.category.findUnique({ where: { id }, select: { id: true, name: true, slug: true, parentId: true, _count: { select: { products: true, children: true } } } });
      if (!category) throw new CategoryAdminError(404, "Kateqoriya tapılmadı.");
      if (category._count.products || category._count.children) {
        const reasons = [
          category._count.products ? `${category._count.products} məhsul bu kateqoriyadadır (əvvəlcə köçürün)` : null,
          category._count.children ? `${category._count.children} alt kateqoriyası var` : null,
        ].filter(Boolean).join("; ");
        throw new CategoryAdminError(409, `Silmək olmaz: ${reasons}. Bunun əvəzinə deaktiv edin.`);
      }
      await tx.category.delete({ where: { id } });
      await audit(tx, actorId, "CATEGORY_DELETE", id, { name: category.name, slug: category.slug, parentId: category.parentId });
      return { deleted: true };
    });
  } catch (error) {
    mapCategoryDbError(error);
  }
}

/**
 * Bulk "Məhsulları köçür": moves up to 100 products from one category to an active subcategory. Each product is
 * updated only if it is still in the source category and unchanged since the admin loaded the list (updatedAt =
 * version). If any product changed, nothing is moved (409 with the ids). Only categoryId changes (Prisma also bumps
 * updatedAt, which is the version marker). One audit row per action.
 */
export async function moveProductsToCategory(db: Db, actorId: string, raw: unknown) {
  const parsed = moveProductsSchema.safeParse(raw);
  if (!parsed.success) throw new CategoryAdminError(422, `Ən azı 1, ən çox ${MOVE_PRODUCTS_MAX} məhsul seçin.`);
  const { fromCategoryId, toCategoryId, items } = parsed.data;
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new CategoryAdminError(422, "Məhsul təkrar seçilib.");
  if (fromCategoryId === toCategoryId) throw new CategoryAdminError(422, "Hədəf kateqoriya mənbədən fərqli olmalıdır.");
  class StaleError extends Error { constructor(readonly ids: string[]) { super("STALE"); } }
  try {
    return await db.$transaction(async (tx) => {
      const [from, to] = await Promise.all([
        tx.category.findUnique({ where: { id: fromCategoryId }, select: { id: true, name: true } }),
        tx.category.findUnique({ where: { id: toCategoryId }, select: { id: true, name: true, parentId: true, isActive: true, parent: { select: { isActive: true } } } }),
      ]);
      if (!from) throw new CategoryAdminError(404, "Mənbə kateqoriya tapılmadı.");
      if (!to || !to.isActive || !to.parentId || !to.parent?.isActive) throw new CategoryAdminError(422, "Hədəf aktiv alt kateqoriya olmalıdır.");
      const stale: string[] = [];
      for (const item of items) {
        const result = await tx.product.updateMany({
          where: { id: item.id, categoryId: fromCategoryId, updatedAt: new Date(item.version) },
          data: { categoryId: toCategoryId },
        });
        if (result.count !== 1) stale.push(item.id);
      }
      if (stale.length) throw new StaleError(stale);
      await tx.auditLog.create({
        data: {
          actorId,
          action: "PRODUCTS_CATEGORY_MOVE",
          entityType: "Category",
          entityId: toCategoryId,
          metadata: { fromCategoryId, fromName: from.name, toCategoryId, toName: to.name, count: items.length, productIds: items.map((item) => item.id) },
        },
      });
      return { moved: items.length };
    });
  } catch (error) {
    if (error instanceof StaleError) {
      throw new CategoryAdminError(409, `${error.ids.length} məhsul bu arada dəyişib və ya köçürülüb; heç nə köçürülmədi. Siyahını yeniləyin.`, { staleIds: error.ids });
    }
    mapCategoryDbError(error);
  }
}
