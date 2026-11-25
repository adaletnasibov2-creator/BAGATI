/**
 * PHONE-REQUIRED-1: no order without a valid Azerbaijani mobile number; signup stays phone-free.
 * Unit tests only (no database): the shared validator, the profile write after an order (mocked db), and source checks
 * that every order goes through the one guarded path.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { AZ_PHONE_ERROR, normalizeAzMobilePhone, normalizeAzPhone } from "../lib/az-phone";
import { rememberOrderPhone } from "../lib/profile-phone";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const BASE = "1b7a709";

// ---------------------------------------------------------------- validator

test("mobile validator: every accepted spelling gives +994XXXXXXXXX", () => {
  for (const input of [
    "0501234567", "050 123 45 67", "050-123-45-67", "(050) 123 45 67", "501234567", "50 123 45 67",
    "+994501234567", "+994 50 123 45 67", "994501234567", "00994501234567", "  +994 50 123 45 67  ",
  ]) assert.equal(normalizeAzMobilePhone(input), "+994501234567", JSON.stringify(input));
});

test("mobile validator: every mobile operator code is accepted", () => {
  for (const code of ["10", "50", "51", "55", "60", "70", "77", "99"]) {
    assert.equal(normalizeAzMobilePhone(`0${code} 123 45 67`), `+994${code}1234567`, code);
    assert.equal(normalizeAzMobilePhone(`+994${code}1234567`), `+994${code}1234567`, code);
  }
});

test("mobile validator: empty, blank, wrong length, foreign, letters and landlines are rejected", () => {
  for (const input of [
    null, undefined, "", " ", "   ", "abc", "abcdefg", "1234567", "0501234", "050 123 45 6", "050 123 45 678",
    "+7 912 345 67 89", "+1 555 123 4567", "+994 33 123 45 67", "+99450123456", "050\n1234567", "tel:+994501234567",
    "012 555 12 34", "+994 12 555 12 34", "022 255 12 34", "036 544 12 34", "018 555 12 34",
  ]) assert.equal(normalizeAzMobilePhone(input as string), null, JSON.stringify(input));
  // Landlines are still valid numbers for the store contact fields; only orders need a mobile.
  assert.equal(normalizeAzPhone("012 555 12 34")?.mobile, false);
});

test("the error text is the existing Azerbaijani phone message (no new text)", () => {
  assert.equal(AZ_PHONE_ERROR, "Telefon nömrəsini Azərbaycan formatında yazın, məsələn +994 55 123 45 67 və ya 055 123 45 67.");
  const base = execFileSync("git", ["show", `${BASE}:lib/az-phone.ts`], { cwd: root, encoding: "utf8" });
  assert.ok(base.includes(AZ_PHONE_ERROR), "the message exists in the base commit");
});

// ---------------------------------------------------------------- profile write after an order

function profileDb(initial: { phone: string | null } | null, createFailsWith?: string) {
  let profile = initial ? { ...initial } : null;
  const calls: string[] = [];
  const db = {
    customerProfile: {
      findUnique: async () => { calls.push("findUnique"); return profile ? { phone: profile.phone } : null; },
      updateMany: async ({ where, data }: { where: { phone: string | null }; data: { phone: string } }) => {
        calls.push("updateMany");
        if (!profile || profile.phone !== where.phone) return { count: 0 };
        profile.phone = data.phone; return { count: 1 };
      },
      create: async ({ data }: { data: { phone: string } }) => {
        calls.push("create");
        if (createFailsWith) throw new Prisma.PrismaClientKnownRequestError("unique", { code: createFailsWith, clientVersion: "test" });
        profile = { phone: data.phone }; return { id: "p1" };
      },
    },
  };
  return { db: db as never, get profile() { return profile; }, calls };
}

test("after an order: an empty or invalid profile phone gets the order phone; a valid one is kept", async () => {
  for (const before of [null, "", "  ", "12345", "012 555 12 34", "not a phone"]) {
    const row = profileDb({ phone: before });
    assert.equal(await rememberOrderPhone(row.db, "u1", "+994501234567"), "saved", JSON.stringify(before));
    assert.equal(row.profile?.phone, "+994501234567");
  }
  const valid = profileDb({ phone: "055 999 99 99" });
  assert.equal(await rememberOrderPhone(valid.db, "u1", "+994501234567"), "kept");
  assert.equal(valid.profile?.phone, "055 999 99 99", "a valid mobile is never overwritten");
  assert.ok(!valid.calls.includes("updateMany"));
});

test("after an order: no profile -> created; a profile created meanwhile is left alone; invalid input writes nothing", async () => {
  const none = profileDb(null);
  assert.equal(await rememberOrderPhone(none.db, "u1", "0501234567"), "created");
  assert.equal(none.profile?.phone, "+994501234567", "stored normalized");
  assert.equal(await rememberOrderPhone(profileDb(null, "P2002").db, "u1", "+994501234567"), "kept");
  const bad = profileDb({ phone: null });
  assert.equal(await rememberOrderPhone(bad.db, "u1", "abc"), "kept");
  assert.deepEqual(bad.calls, [], "no database call for an invalid phone");
});

test("after an order: a phone saved between the read and the write is not replaced (compare-and-set)", async () => {
  const row = profileDb({ phone: null });
  const db = row.db as unknown as { customerProfile: { findUnique: () => Promise<unknown> } };
  const original = db.customerProfile.findUnique;
  db.customerProfile.findUnique = async () => { const result = await original(); row.profile!.phone = "+994559999999"; return result; };
  assert.equal(await rememberOrderPhone(row.db, "u1", "+994501234567"), "kept");
  assert.equal(row.profile?.phone, "+994559999999");
});

// ---------------------------------------------------------------- server: the one order path

test("POST /api/orders is the only place an order is created", () => {
  const files = execFileSync("git", ["ls-files", "app", "lib"], { cwd: root, encoding: "utf8" }).split("\n").filter((file) => /\.(ts|tsx)$/.test(file));
  const creators = files.filter((file) => /\.order\.create\(/.test(read(file)));
  assert.deepEqual(creators, ["app/api/orders/route.ts"]);
});

test("POST /api/orders refuses a missing/invalid phone before the cart and stock are locked, and snapshots +994", () => {
  const route = read("app/api/orders/route.ts");
  const check = route.indexOf('const orderPhone=normalizeAzMobilePhone(address.phone);if(!orderPhone)throw new Error("PHONE_INVALID");');
  const addressLoad = route.indexOf('throw new Error("ADDRESS_INVALID")');
  const cartLock = route.indexOf('FROM "Cart" WHERE "userId" = $1 FOR UPDATE');
  assert.ok(addressLoad > 0 && check > addressLoad && check < cartLock, "checked right after the address, before any lock");
  assert.match(route, /createOrderAddressSnapshot\(\{\.\.\.address,phone:orderPhone\},coordinatePin\.selected\)/);
  assert.match(route, /PHONE_INVALID:AZ_PHONE_ERROR,/);
  assert.match(route, /code==="PHONE_INVALID"\?422:/);
});

test("POST /api/orders saves the phone to the profile only after the commit, best-effort", () => {
  const route = read("app/api/orders/route.ts");
  const commitEnd = route.indexOf("},{isolationLevel:Prisma.TransactionIsolationLevel.Serializable");
  const remember = route.indexOf("await rememberOrderPhone(prisma,user.id,orderPhone)");
  const respond = route.indexOf("return NextResponse.json(orderCreateResponse(");
  assert.ok(commitEnd > 0 && remember > commitEnd && remember < respond);
  assert.match(route, /if\(orderPhone\)\{try\{await rememberOrderPhone\(prisma,user\.id,orderPhone\)\}catch\(error\)\{console\.error\(/);
});

test("address API (POST and PATCH) accepts only a mobile number and stores it as +994", () => {
  for (const path of ["app/api/account/addresses/route.ts", "app/api/account/addresses/[addressId]/route.ts"]) {
    const route = read(path);
    assert.match(route, /issue\.path\[0\] === "phone"\)\) return NextResponse\.json\(\{ error: AZ_PHONE_ERROR, code: "PHONE_INVALID" \}/, path);
    assert.match(route, /const mobilePhone = normalizeAzMobilePhone\(parsed\.data\.phone\);/, path);
    assert.match(route, /parsed\.data\.phone = mobilePhone;/, path);
  }
  const post = read("app/api/account/addresses/route.ts");
  assert.ok(post.indexOf("parsed.data.phone = mobilePhone;") < post.indexOf("const { rememberPhone, ...address } = parsed.data;"), "normalized before the create");
});

test("signup does not ask for a phone", () => {
  const register = read("lib/validation.ts").split("export const registerSchema")[1].split("export const vendorRegisterSchema")[0];
  assert.doesNotMatch(register, /phone/);
  assert.doesNotMatch(read("components/register-form.tsx"), /phone|Telefon/i);
});

// ---------------------------------------------------------------- checkout UI

test("checkout: phone field is required, a tel input, checked before save and before the order", () => {
  const form = read("components/checkout-form.tsx");
  assert.match(form, /<input id="checkout-phone" type="tel" inputMode="tel" autoComplete="tel" required /);
  assert.match(form, /aria-invalid=\{phoneError\?true:undefined\} aria-describedby=\{phoneError\?"checkout-phone-error":undefined\}/);
  assert.match(form, /if\(!normalizeAzMobilePhone\(phone\)\)\{setPhoneError\(AZ_PHONE_ERROR\);focusPhone\(\);return\}/);
  assert.match(form, /const chosen=addresses\.find\(row=>row\.id===selected\);if\(chosen&&!normalizeAzMobilePhone\(chosen\.phone\)\)\{fixAddressPhone\(chosen\);return\}/);
  assert.match(form, /if\(data\.code==="PHONE_INVALID"&&chosen\)\{fixAddressPhone\(chosen\);return\}/);
  // A saved address with a bad phone is edited in place (PATCH), not duplicated.
  assert.match(form, /fetch\("\/api\/account\/addresses\/"\+fixingId,\{method:"PATCH"/);
  // Prefill from the profile stays (SIGNUP-EASY-1).
  assert.match(form, /\[phone,setPhone\]=useState\(customerPhone\)/);
  assert.match(read("app/(customer)/checkout/page.tsx"), /customerPhone=\{profile\?\.phone \?\? ""\}/);
});

// ---------------------------------------------------------------- texts and legal pages

const AZ = /[əğıöşüçƏĞİÖŞÜÇ]/;
function baseFile(path: string) {
  try { return execFileSync("git", ["show", `${BASE}:${path}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).replace(/\r\n/g, "\n"); } catch { return ""; }
}

/** Existing wording reused on the seller order page by SELLER-CUSTOMER-CARD-1, with the file it already came from. */
const REUSED_ON_ORDER_PAGE: Record<string, string> = {
  "Zəng et": "components/customer-footer.tsx",
  "Ünvanı kopyala": "components/vendor-delivery-address-menu.tsx",
  "Ünvan kopyalandı.": "components/vendor-delivery-address-menu.tsx",
  "Xəritə nöqtəsi yoxdur.": "app/admin/_sections/order-detail.tsx",
};

test("reused wording on the order page already exists elsewhere", () => {
  for (const [text, source] of Object.entries(REUSED_ON_ORDER_PAGE)) assert.ok(read(source).includes(text), `${text} in ${source}`);
});

test("texts: no new visible Azerbaijani text in the changed files; legal pages unchanged", () => {
  const changed = ["components/checkout-form.tsx", "app/api/orders/route.ts", "app/api/account/addresses/route.ts", "app/api/account/addresses/[addressId]/route.ts", "app/vendor/[storeId]/orders/[storeOrderId]/page.tsx", "lib/az-phone.ts", "lib/profile-phone.ts"];
  const fragments = (source: string) => new Set(source.split(/["'`<>{}]|\$\{/).map((part) => part.trim()).filter((part) => AZ.test(part) && !part.startsWith("//") && !part.startsWith("*")));
  for (const path of changed) {
    const before = fragments(baseFile(path));
    // Comments are not visible text.
    const now = read(path).split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*\*)/.test(line)).join("\n");
    // SELLER-CUSTOMER-CARD-1 reused existing wording on the order page; each text is checked to exist in another file below.
    const reusedLater = path === "app/vendor/[storeId]/orders/[storeOrderId]/page.tsx" ? new Set(Object.keys(REUSED_ON_ORDER_PAGE)) : new Set<string>();
    // PRICE-SYMBOL-1 only swapped the unit AZN -> ₼ inside existing sentences: such a fragment is not new text.
    const added = [...fragments(now)].filter((fragment) => !before.has(fragment) && !before.has(fragment.replace(/₼/g, "AZN")) && !reusedLater.has(fragment));
    assert.deepEqual(added, [], `${path}: new Azerbaijani text`);
  }
  for (const path of ["app/(customer)/terms/page.tsx", "app/(customer)/privacy/page.tsx", "app/(customer)/seller-terms/page.tsx"]) {
    const now = read(path);
    assert.ok(now.length > 0 && now === baseFile(path), `${path} unchanged`);
  }
});
