/**
 * SIGNUP-EASY-2 Part B: a guest's add-to-cart survives the login. No URL parameter (nothing a link could
 * trigger): on the 401 the product page stores the item in this tab's sessionStorage, then goes to
 * /login?next=<product page> as before. Back on that product page as a signed-in CUSTOMER, the page takes the item
 * (removing it FIRST, so a refresh or the back button cannot add it again) and calls POST /api/cart/items once.
 *
 * Every storage access is wrapped: private mode, blocked storage or a full quota simply means nothing is remembered.
 */
export const PENDING_CART_ADD_KEY = "bagati:pending-cart-add";
export const PENDING_CART_ADD_MAX_AGE_MS = 30 * 60 * 1000;

export type PendingCartAdd = { productId: string; variantId?: string; quantity: number; savedAt: number };
export type PendingCartStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** sessionStorage, or null when the browser refuses it. */
export function browserSessionStorage(): PendingCartStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function rememberPendingCartAdd(storage: PendingCartStorage | null, item: { productId: string; variantId?: string; quantity: number }, now = Date.now()) {
  if (!storage || !ID_PATTERN.test(item.productId) || (item.variantId !== undefined && !ID_PATTERN.test(item.variantId))) return false;
  if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 50) return false;
  const value: PendingCartAdd = { productId: item.productId, ...(item.variantId ? { variantId: item.variantId } : {}), quantity: item.quantity, savedAt: now };
  try {
    storage.setItem(PENDING_CART_ADD_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function parse(raw: string | null): PendingCartAdd | null {
  if (!raw || raw.length > 512) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const { productId, variantId, quantity, savedAt } = value as Record<string, unknown>;
    if (typeof productId !== "string" || !ID_PATTERN.test(productId)) return null;
    if (variantId !== undefined && (typeof variantId !== "string" || !ID_PATTERN.test(variantId))) return null;
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) return null;
    if (typeof savedAt !== "number" || !Number.isFinite(savedAt)) return null;
    return { productId, ...(typeof variantId === "string" ? { variantId } : {}), quantity, savedAt };
  } catch {
    return null;
  }
}

/**
 * The remembered item for THIS product, or null. Removes the stored item before returning it; if the removal fails
 * nothing is returned (never risk adding twice). An item for another product is left alone (it may belong to another
 * product page) and expires on its own; a broken or too old item is removed.
 */
export function takePendingCartAdd(storage: PendingCartStorage | null, productId: string, now = Date.now()): PendingCartAdd | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(PENDING_CART_ADD_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  const item = parse(raw);
  const fresh = item !== null && item.savedAt <= now && now - item.savedAt <= PENDING_CART_ADD_MAX_AGE_MS;
  if (item && fresh && item.productId !== productId) return null;
  try {
    storage.removeItem(PENDING_CART_ADD_KEY);
    if (storage.getItem(PENDING_CART_ADD_KEY) !== null) return null;
  } catch {
    return null;
  }
  return item && fresh ? item : null;
}

export type PendingCartPost = (body: { productId: string; variantId?: string; quantity: number }) => Promise<{ ok: boolean; status: number; error?: unknown }>;
export type PendingCartOutcome = { kind: "added" } | { kind: "failed"; serverError: string | null } | { kind: "network" };

/**
 * The product page's after-login step. Nothing happens (null) unless the viewer is a signed-in CUSTOMER and a fresh
 * item for THIS product is waiting; the item is removed before the single POST. A refusal (sold out, variant gone)
 * returns the server's own error text and the cart is unchanged (the server adds nothing on an error).
 */
export async function addRememberedCartItem(input: { storage: PendingCartStorage | null; productId: string; viewerIsCustomer: boolean; post: PendingCartPost; now?: number }): Promise<PendingCartOutcome | null> {
  if (!input.viewerIsCustomer) return null;
  const pending = takePendingCartAdd(input.storage, input.productId, input.now);
  if (!pending) return null;
  try {
    const result = await input.post({ productId: pending.productId, ...(pending.variantId ? { variantId: pending.variantId } : {}), quantity: pending.quantity });
    if (result.ok) return { kind: "added" };
    return { kind: "failed", serverError: result.status !== 401 && typeof result.error === "string" ? result.error : null };
  } catch {
    return { kind: "network" };
  }
}
