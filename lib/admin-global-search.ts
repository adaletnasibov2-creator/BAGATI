/**
 * ADMIN-POWER-1: the top-bar admin search. ADMIN-only callers (app/api/admin/search/route.ts).
 * Four groups, at most ADMIN_SEARCH_GROUP_LIMIT rows each, queried in parallel with the term's LIKE wildcards escaped:
 * - stores by name;  - products by name;
 * - orders by number (only when the term looks like one: letters/digits, >= 6, optional "#");
 * - customer and seller accounts by e-mail, first/last name, phone or seller name.
 * Only display fields leave the server: no password hash, tokens, VÖEN or phone numbers (the phone is matched, never
 * returned). Links point at the existing admin pages.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { ADMIN_POWER_1_TEXT, ADMIN_SEARCH_GROUP_LIMIT, type AdminSearchTerm } from "@/lib/admin-power-1";
import { adminStatusLabel } from "@/lib/admin-labels";

type Db = Pick<PrismaClient, "store" | "product" | "order" | "user">;
export type AdminSearchHit = { id: string; title: string; detail: string; href: string };
export type AdminSearchResult = { stores: AdminSearchHit[]; products: AdminSearchHit[]; orders: AdminSearchHit[]; users: AdminSearchHit[] };

const like = (value: string) => ({ contains: value, mode: "insensitive" as const });

export function adminSearchUserWhere(value: string): Prisma.UserWhereInput {
  return {
    role: { in: ["CUSTOMER", "VENDOR"] },
    OR: [
      { email: like(value) },
      { customerProfile: { firstName: like(value) } },
      { customerProfile: { lastName: like(value) } },
      { customerProfile: { phone: like(value) } },
      { vendorProfile: { displayName: like(value) } },
    ],
  };
}

export async function adminGlobalSearch(db: Db, term: Extract<AdminSearchTerm, { ok: true }>): Promise<AdminSearchResult> {
  const take = ADMIN_SEARCH_GROUP_LIMIT;
  const [stores, products, orders, users] = await Promise.all([
    db.store.findMany({ where: { name: like(term.like) }, orderBy: { name: "asc" }, take, select: { id: true, name: true, status: true, city: { select: { name: true } } } }),
    db.product.findMany({ where: { name: like(term.like) }, orderBy: { createdAt: "desc" }, take, select: { id: true, name: true, status: true, store: { select: { name: true } } } }),
    term.orderFragment
      ? db.order.findMany({ where: { id: { contains: term.orderFragment } }, orderBy: { createdAt: "desc" }, take, select: { id: true, status: true, user: { select: { email: true } } } })
      : Promise.resolve([]),
    db.user.findMany({ where: adminSearchUserWhere(term.like), orderBy: { createdAt: "desc" }, take, select: { id: true, email: true, role: true, customerProfile: { select: { firstName: true, lastName: true } }, vendorProfile: { select: { id: true, displayName: true } } } }),
  ]);
  return {
    stores: stores.map((row) => ({ id: row.id, title: row.name, detail: [row.city?.name, adminStatusLabel("store", row.status)].filter(Boolean).join(" · "), href: `/admin/stores/${row.id}` })),
    products: products.map((row) => ({ id: row.id, title: row.name, detail: [row.store.name, adminStatusLabel("product", row.status)].join(" · "), href: `/admin/products/${row.id}` })),
    orders: orders.map((row) => ({ id: row.id, title: `#${row.id.slice(-8).toUpperCase()}`, detail: [row.user.email, adminStatusLabel("order", row.status)].join(" · "), href: `/admin/orders/${row.id}` })),
    users: users.flatMap((row) => {
      if (row.role === "VENDOR") {
        if (!row.vendorProfile) return [];
        return [{ id: row.id, title: row.vendorProfile.displayName || row.email, detail: `${row.email} · ${ADMIN_POWER_1_TEXT.roleVendor}`, href: `/admin/vendors/${row.vendorProfile.id}` }];
      }
      const name = [row.customerProfile?.firstName, row.customerProfile?.lastName].filter(Boolean).join(" ");
      return [{ id: row.id, title: name || row.email, detail: `${row.email} · ${ADMIN_POWER_1_TEXT.roleCustomer}`, href: `/admin/customers/${row.id}` }];
    }),
  };
}
