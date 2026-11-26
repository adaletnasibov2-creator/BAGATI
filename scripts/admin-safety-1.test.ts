/**
 * ADMIN-3-SAFETY-1 (T1 of release-output/admin-3-audit-1-report.md)
 * (a) The four admin writes that used to audit AFTER the change, outside a transaction (user activate/deactivate, brand
 *     rename, city change, support ticket status), now write the change and the audit row in ONE transaction, with the
 *     same action names and entities. Proven with an in-memory fake transaction (no database): both writes go through
 *     the transaction client, and when the audit write fails nothing is committed.
 * (b) Confirm dialogs (the shared useConfirmDialog) before an order status change, a shipment status change and a city
 *     deactivation, with exactly the three owner-approved texts and the existing button labels.
 * (c) No other new visible text; store delete/archive, legal pages, prisma and packages untouched (BASE..own commit).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { renameBrandAudited, setTicketStatusAudited, setUserActiveAudited, updateCityAudited, type AuditedWriteDb } from "../lib/admin-audited-writes";

const root = process.cwd();
const BASE = "36fc5ec";
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");
// Scope checks compare BASE with this task's newest commit (not the working tree); before the commit, the working tree.
const TASK = git("log", "--format=%H", "--grep=^ADMIN-3-SAFETY-1", `${BASE}..HEAD`).trim().split(/\r?\n/).filter(Boolean)[0] ?? null;
const atTask = (path: string) => (TASK ? git("show", `${TASK}:${path}`).replace(/\r\n/g, "\n") : read(path));
const atBase = (path: string) => git("show", `${BASE}:${path}`).replace(/\r\n/g, "\n");

const ROUTE = "app/api/admin/[...resource]/route.ts";
const TEXT = {
  order: "Sifarişin statusunu dəyişmək istədiyinizə əminsiniz?",
  shipment: "Çatdırılma statusunu dəyişmək istədiyinizə əminsiniz?",
  city: "Şəhəri deaktiv etsəniz, bu şəhərdəki bütün mağazalar saytda görünməyəcək. Davam edək?",
} as const;

// ---- fake database: writes inside $transaction are staged and committed only if the callback succeeds ----
type Write = { model: string; op: string; args: unknown };
function fakeDb(options: { failAudit?: boolean } = {}) {
  const committed: Write[] = [];
  const outsideTx: Write[] = [];
  let transactions = 0;
  const client = (sink: Write[]) => new Proxy({}, {
    get: (_t, model: string) => new Proxy({}, {
      get: (_m, op: string) => async (args: unknown) => {
        if (model === "auditLog" && options.failAudit) throw new Error("audit write failed");
        sink.push({ model, op, args });
        return { id: "row", ...((args as { data?: object })?.data ?? {}) };
      },
    }),
  });
  const db = new Proxy({}, {
    get: (_t, key: string) => {
      if (key === "$transaction") {
        return async (run: (tx: unknown) => Promise<unknown>) => {
          transactions += 1;
          const staged: Write[] = [];
          const result = await run(client(staged)); // throws -> nothing committed (rollback)
          committed.push(...staged);
          return result;
        };
      }
      return (client(outsideTx) as Record<string, unknown>)[key];
    },
  }) as AuditedWriteDb;
  return { db, committed, outsideTx, transactions: () => transactions };
}

const CASES = [
  { name: "user deactivate", run: (db: AuditedWriteDb) => setUserActiveAudited(db, "admin-1", "user-1", false), model: "user", audit: { actorId: "admin-1", action: "USER_DEACTIVATE", entityType: "User", entityId: "user-1" } },
  { name: "user activate", run: (db: AuditedWriteDb) => setUserActiveAudited(db, "admin-1", "user-1", true), model: "user", audit: { actorId: "admin-1", action: "USER_ACTIVATE", entityType: "User", entityId: "user-1" } },
  { name: "brand rename", run: (db: AuditedWriteDb) => renameBrandAudited(db, "admin-1", "brand-1", "Yeni ad"), model: "brand", audit: { actorId: "admin-1", action: "UPDATE", entityType: "Brand", entityId: "brand-1" } },
  { name: "city change", run: (db: AuditedWriteDb) => updateCityAudited(db, "admin-1", "city-1", "city-1", { isActive: false }), model: "city", audit: { actorId: "admin-1", action: "UPDATE", entityType: "City", entityId: "city-1" } },
  { name: "ticket status", run: (db: AuditedWriteDb) => setTicketStatusAudited(db, "admin-1", "ticket-1", "RESOLVED"), model: "supportTicket", audit: { actorId: "admin-1", action: "TICKET_RESOLVED", entityType: "SupportTicket", entityId: "ticket-1" } },
] as const;

test("(a) change and audit row are written in one transaction, with the same action names as before", async () => {
  for (const c of CASES) {
    const { db, committed, outsideTx, transactions } = fakeDb();
    await c.run(db);
    assert.equal(transactions(), 1, `${c.name}: one transaction`);
    assert.deepEqual(outsideTx, [], `${c.name}: nothing written outside the transaction`);
    assert.deepEqual(committed.map((w) => `${w.model}.${w.op}`), [`${c.model}.update`, "auditLog.create"], `${c.name}: change, then audit, both in the transaction`);
    assert.deepEqual((committed[1].args as { data: unknown }).data, c.audit, `${c.name}: audit row unchanged`);
  }
});

test("(a) when the audit write fails, the change is not committed either (rolled back with it)", async () => {
  for (const c of CASES) {
    const { db, committed, outsideTx } = fakeDb({ failAudit: true });
    await assert.rejects(c.run(db), /audit write failed/, c.name);
    assert.deepEqual(committed, [], `${c.name}: nothing committed`);
    assert.deepEqual(outsideTx, [], `${c.name}: nothing outside`);
  }
});

test("(a) the user update keeps its role guard and selection; the route uses the audited writes only", () => {
  const lib = read("lib/admin-audited-writes.ts");
  assert.match(lib, /where: \{ id: userId, role: \{ in: \["CUSTOMER", "VENDOR"\] \} \}, data: \{ isActive \}, select: \{ id: true, isActive: true, role: true \}/);
  const route = atTask(ROUTE);
  assert.doesNotMatch(route, /[^a-zA-Z.]audit\(/, "the old after-the-change audit helper is gone");
  for (const call of ["setUserActiveAudited(db, admin.id, id, parsed.data.isActive)", "renameBrandAudited(db, admin.id, id, parsed.data.name)", "updateCityAudited(db, admin.id, cityId, id, { ...values, ...(values.slug ? { slug: slug(values.slug) } : {}) })", "setTicketStatusAudited(db, admin.id, id, parsed.data.status)"]) {
    assert.equal(route.split(call).length, 2, call);
  }
  for (const old of ["db.user.update(", "db.brand.update(", "db.city.update(", "db.supportTicket.update("]) assert.ok(!route.includes(old), old);
  // The same action names as before this task.
  const base = atBase(ROUTE);
  for (const action of ['"USER_ACTIVATE" : "USER_DEACTIVATE", "User"', '"UPDATE", "Brand"', '"UPDATE", "City"', "`TICKET_${parsed.data.status}`, \"SupportTicket\""]) assert.ok(base.includes(action), `base had ${action}`);
});

test("(b) confirm dialogs with the owner-approved texts and the existing button labels", () => {
  const order = atTask("app/admin/_sections/order-detail.tsx");
  assert.ok(order.includes(`<StatusForm resource="orders" id={order.id} status={order.status} options={allowedOrderStatuses} button="Statusu saxla" confirm="${TEXT.order}" />`), "order status form asks first");
  // StatusForm passes `confirm` to AdminMutationForm, which asks with the shared dialog before sending.
  assert.match(read("app/admin/_sections/shared.tsx"), /if\(resource==="orders"\)return[\s\S]*?confirmMessage=\{confirm\}/);
  assert.match(read("components/admin-mutation-form.tsx"), /if\(confirmMessage&&!\(await confirm\(\{message:confirmMessage,danger:method==="DELETE"\}\)\)\)return;/);

  const shipment = atTask("components/admin-shipment-status-control.tsx");
  assert.match(shipment, /import \{ useConfirmDialog \} from "@\/components\/admin-ui\/confirm-dialog";/);
  const ask = shipment.indexOf(`if (!(await confirm("${TEXT.shipment}"))) return;`);
  assert.ok(ask > 0 && ask < shipment.indexOf("await fetch("), "asks before the request");
  assert.match(shipment, /<form onSubmit=\{save\}[^>]*>\{dialog\}/);

  const cities = atTask("app/admin/_sections/cities.tsx");
  assert.ok(cities.includes(`confirmMessage={r.isActive?"${TEXT.city}":undefined}`), "asks only on the form of an active city (the deactivation form)");
  assert.equal(cities.split("confirmMessage=").length, 2, "the rename form does not ask");

  // Buttons: the dialog's existing labels (no confirmLabel/cancelLabel passed).
  const dialog = read("components/admin-ui/confirm-dialog.tsx");
  assert.ok(dialog.includes('options.cancelLabel ?? "Ləğv et"') && dialog.includes('options.confirmLabel ?? "Təsdiqlə"'));
  for (const source of [shipment, cities, order]) assert.doesNotMatch(source, /confirmLabel|cancelLabel/);
});

test("(c) no other new visible text; store delete/archive, legal pages, prisma and packages untouched", () => {
  const AZ = /[əğıöüşçƏĞİÖÜŞÇ]/;
  const fragments = (source: string) => new Set(source.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*\*|\{\/\*)/.test(line)).join("\n").split(/["'`<>{}]|\$\{/).map((part) => part.trim()).filter((part) => AZ.test(part)));
  const approved = new Set<string>(Object.values(TEXT));
  const changed = (TASK ? git("diff", "--name-only", BASE, TASK) : git("diff", "--name-only", BASE)).split(/\r?\n/).filter((path) => /\.(ts|tsx)$/.test(path) && !path.startsWith("scripts/"));
  assert.ok(changed.length >= 4,`changed files found: ${changed.join(", ")}`);
  for (const path of changed) {
    let before = new Set<string>();
    try { before = fragments(atBase(path)); } catch { /* new file */ }
    const added = [...fragments(atTask(path))].filter((part) => !before.has(part) && !approved.has(part));
    assert.deepEqual(added, [], `${path}: new Azerbaijani text`);
  }
  const untouched = ["app/api/admin/stores", "components/admin-store-archive-action.tsx", "app/(customer)/terms", "app/(customer)/privacy", "app/(customer)/seller-terms", "lib/legal-versions.ts", "prisma", "package.json", "package-lock.json"];
  const diff = TASK ? git("diff", "--name-only", BASE, TASK, "--", ...untouched) : git("diff", "--name-only", BASE, "--", ...untouched);
  assert.equal(diff.trim(), "");
  // Exactly these files changed in the task (checked once committed; before that, new files are untracked).
  if (TASK) {
    const all = git("diff", "--name-only", BASE, TASK).split(/\r?\n/).filter(Boolean).sort();
    // + three older tests updated for the new code: active-cities (city update pin), admin-design-2 (reads its own
    // commit), admin-ui-kit (the shipment control now uses the confirm dialog).
    assert.deepEqual(all, ["app/admin/_sections/cities.tsx", "app/admin/_sections/order-detail.tsx", "app/api/admin/[...resource]/route.ts", "components/admin-shipment-status-control.tsx", "lib/admin-audited-writes.ts", "scripts/active-cities.test.ts", "scripts/admin-design-2.test.ts", "scripts/admin-safety-1.test.ts", "scripts/admin-ui-kit.test.ts"]);
  }
});
