/**
 * Delivery location wiring (source-level): address APIs, order creation, seller and admin pages. The pure rules are
 * covered by delivery-location.test.ts.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");

test("address APIs: a pin outside Azerbaijan is refused (422) and a valid pin is stored rounded", () => {
  for (const file of ["app/api/account/addresses/route.ts", "app/api/account/addresses/[addressId]/route.ts"]) {
    const source = read(file);
    const pairCheck = source.indexOf("Xəritə koordinatları birlikdə daxil edilməlidir");
    const boxCheck = source.indexOf("const pin = normalizeDeliveryCoordinates(parsed.data.latitude, parsed.data.longitude);");
    const write = source.search(/tx\.address\.(create|update)\(/);
    assert.ok(pairCheck > 0 && boxCheck > pairCheck && write > boxCheck, `${file}: pair check -> box check -> write`);
    assert.match(source, /if \(!pin\) return NextResponse\.json\(\{ error: OUTSIDE_AZERBAIJAN_MESSAGE \}, \{ status: 422 \}\);/);
    assert.match(source, /Object\.assign\(parsed\.data, pin\);/);
    // Addresses without a pin keep working: the box check only runs when a latitude is sent.
    assert.match(source, /if \(parsed\.data\.latitude != null\) \{/);
  }
});
