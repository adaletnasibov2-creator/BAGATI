/**
 * Admin store profile form (/admin/stores/:id): options, a plain view for the client component, and the rule for
 * what a save may change. Pure: no database access, unit-tested in scripts/admin-fixes.test.ts.
 */

export type ProfileOption = { value: string; label: string };

type OptionRow = { id: string; name: string };

/**
 * Select options with the store's current value always present, even when that city or seller is inactive (the
 * active-only lists would otherwise drop it and the select would show "Seçin", so a save could change it).
 */
export function storeProfileOptions(rows: OptionRow[], current: { id: string; name: string } | null, inactiveSuffix = " (deaktiv)"): ProfileOption[] {
  const options = rows.map((row) => ({ value: row.id, label: row.name }));
  if (current && !rows.some((row) => row.id === current.id)) options.unshift({ value: current.id, label: `${current.name}${inactiveSuffix}` });
  return options;
}

const decimalNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const number = Number(typeof value === "object" ? String(value) : value);
  return Number.isFinite(number) ? number : null;
};

/** Plain, serialisable values for the client form (no Prisma Decimal, Date or nested records). */
export type AdminStoreProfileView = {
  id: string;
  name: string;
  vendorId: string;
  cityId: string;
  address: string | null;
  logoUrl: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  freeDeliveryThreshold: number | null;
  deliveryFee: number | null;
  latitude: number | null;
  longitude: number | null;
  mapUrl: string | null;
  description: string | null;
  status: string;
  legalInfoApproved: boolean;
  sellerType: string | null;
  legalName: string | null;
  voen: string | null;
  legalAddress: string | null;
  hasActiveGrant: boolean;
};

type StoreRecord = {
  id: string; name: string; vendorId: string; cityId: string; address?: string | null; logoUrl?: string | null;
  contactPhone?: string | null; contactEmail?: string | null; freeDeliveryThreshold?: unknown; deliveryFee?: unknown;
  latitude?: unknown; longitude?: unknown; mapUrl?: string | null; description?: string | null; status: string;
  legalInfoApproved: boolean;
  vendor?: { sellerType?: string | null; legalName?: string | null; voen?: string | null; legalAddress?: string | null } | null;
  complimentaryEntitlements?: Array<{ revokedAt: unknown }> | null;
};

export function toAdminStoreProfileView(store: StoreRecord): AdminStoreProfileView {
  return {
    id: store.id,
    name: store.name,
    vendorId: store.vendorId,
    cityId: store.cityId,
    address: store.address ?? null,
    logoUrl: store.logoUrl ?? null,
    contactPhone: store.contactPhone ?? null,
    contactEmail: store.contactEmail ?? null,
    freeDeliveryThreshold: decimalNumber(store.freeDeliveryThreshold),
    deliveryFee: decimalNumber(store.deliveryFee),
    latitude: decimalNumber(store.latitude),
    longitude: decimalNumber(store.longitude),
    mapUrl: store.mapUrl ?? null,
    description: store.description ?? null,
    status: store.status,
    legalInfoApproved: store.legalInfoApproved,
    sellerType: store.vendor?.sellerType ?? null,
    legalName: store.vendor?.legalName ?? null,
    voen: store.vendor?.voen ?? null,
    legalAddress: store.vendor?.legalAddress ?? null,
    hasActiveGrant: Boolean(store.complimentaryEntitlements?.some((grant) => !grant.revokedAt)),
  };
}

/**
 * Confirmation text before a save that changes the owner or the city; null when neither changes. The form shows it
 * with window.confirm, so such a change is never made by accident.
 */
export function storeProfileChangeConfirmation(initial: { vendorId: string; cityId: string }, submitted: Record<string, unknown>, labels: { vendor: (id: string) => string; city: (id: string) => string }): string | null {
  const lines: string[] = [];
  if (typeof submitted.vendorId === "string" && submitted.vendorId !== initial.vendorId) {
    lines.push(`Satıcı sahibi dəyişəcək: ${labels.vendor(initial.vendorId)} → ${labels.vendor(submitted.vendorId)}. Hüquqi yoxlama yenidən tələb olunacaq.`);
  }
  if (typeof submitted.cityId === "string" && submitted.cityId !== initial.cityId) {
    lines.push(`Şəhər dəyişəcək: ${labels.city(initial.cityId)} → ${labels.city(submitted.cityId)}.`);
  }
  return lines.length ? `${lines.join("\n")}\n\nDavam edilsin?` : null;
}

export type StoreProfilePlan =
  | { ok: false; reason: "STALE" }
  | { ok: true; ownerChanged: boolean; cityChanged: boolean; vendorId?: string; cityId?: string };

/**
 * What a save may change. The owner or city changes ONLY when the submitted value differs from the stored one; an
 * unchanged value is ignored (no legal re-review, no owner-change audit, no active check). When the form sent the
 * values it was rendered with (expected*), a store changed meanwhile by someone else is refused as stale.
 */
export function planStoreProfileUpdate(current: { vendorId: string; cityId: string }, submitted: { vendorId?: string; cityId?: string; expectedVendorId?: string; expectedCityId?: string }): StoreProfilePlan {
  if (submitted.expectedVendorId !== undefined && submitted.expectedVendorId !== current.vendorId) return { ok: false, reason: "STALE" };
  if (submitted.expectedCityId !== undefined && submitted.expectedCityId !== current.cityId) return { ok: false, reason: "STALE" };
  const ownerChanged = Boolean(submitted.vendorId) && submitted.vendorId !== current.vendorId;
  const cityChanged = Boolean(submitted.cityId) && submitted.cityId !== current.cityId;
  return { ok: true, ownerChanged, cityChanged, ...(ownerChanged ? { vendorId: submitted.vendorId } : {}), ...(cityChanged ? { cityId: submitted.cityId } : {}) };
}
