/**
 * Messaging phase 8 (admin reports) on real PostgreSQL: no message text in the list, every open audited (and no audit
 * row means no messages), decisions audited, no route to unreported conversations, orphans readable by admin only.
 *
 * Safety: uses only BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL (loopback, port 5433, database name containing "verify")
 * and REQUIRES BAGATI_VERIFY_SCHEMA = a migrated cat_* scratch schema. Creates its own rows (random tag) and removes them.
 *
 *   BAGATI_VERIFY_SCHEMA=cat_messaging npx tsx --test scripts/messaging-admin.integration.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

function guardedScratchUrl(): { url: string } | { refuse: string } | { skip: string } {
  const raw = process.env.BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL;
  if (!raw) return { skip: "verify database URL is not set" };
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return { refuse: "the verify URL is not a valid URL" }; }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) return { refuse: "verify database host must be loopback" };
  if (parsed.port !== "5433") return { refuse: "verify database port must be exactly 5433" };
  if (!database.includes("verify")) return { refuse: "verify database name must contain \"verify\"" };
  const schema = process.env.BAGATI_VERIFY_SCHEMA;
  if (!schema) return { skip: "BAGATI_VERIFY_SCHEMA is not set (needs a migrated cat_* scratch schema)" };
  if (!/^cat_[a-z0-9_]{1,40}$/.test(schema)) return { refuse: "BAGATI_VERIFY_SCHEMA must be a cat_* scratch schema" };
  parsed.searchParams.set("schema", schema);
  return { url: parsed.toString() };
}

test("messaging admin reports on PostgreSQL", { timeout: 240_000 }, async (t) => {
  const guard = guardedScratchUrl();
  if ("skip" in guard) return t.skip(`NOT VERIFIED: ${guard.skip}`);
  if ("refuse" in guard) throw new Error(`Refusing to run: ${guard.refuse}.`);
  process.env.DATABASE_URL = guard.url;
  const prisma = new PrismaClient({ datasources: { db: { url: guard.url } } });
  const tag = `ad${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  try {
    try { await prisma.$queryRaw`SELECT 1`; } catch { return t.skip("NOT VERIFIED: verify database on 127.0.0.1:5433 is unreachable"); }
    const [where] = await prisma.$queryRaw<{ db: string; port: number; schema: string }[]>`SELECT current_database() AS db, inet_server_port() AS port, current_schema() AS schema`;
    assert.ok(where.db.includes("verify") && Number(where.port) === 5433 && where.schema.startsWith("cat_"));
    const migrated = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'ConversationReport'`;
    if (!migrated[0]?.n) return t.skip("NOT VERIFIED: scratch schema lacks the messaging tables (this test never migrates)");

    const adminLib = await import("../lib/messaging-admin");
    const service = await import("../lib/messaging-service");

    const city = await prisma.city.create({ data: { name: `Şəhər ${tag}`, slug: `${tag}-city`, isActive: true } });
    const mkUser = (suffix: string, role: "CUSTOMER" | "VENDOR" | "ADMIN") => prisma.user.create({ data: { id: `${tag}_${suffix}`, email: `${tag}-${suffix}@verify.invalid`, passwordHash: "x", role } });
    const [adminUser, customerA, customerB, seller] = await Promise.all([mkUser("ad", "ADMIN"), mkUser("ca", "CUSTOMER"), mkUser("cb", "CUSTOMER"), mkUser("s1", "VENDOR")]);
    await prisma.customerProfile.create({ data: { userId: customerA.id, firstName: "Aysel", lastName: "Məmmədova", phone: "+994501234567" } });
    const vendor = await prisma.vendorProfile.create({ data: { userId: seller.id, displayName: `Satıcı ${tag}`, sellerType: "INDIVIDUAL_ENTREPRENEUR", legalName: "S", voen: `7${Math.floor(Math.random() * 1e9).toString().padStart(9, "0")}`, legalAddress: "Ünvan" } });
    const store = await prisma.store.create({ data: { vendorId: vendor.id, cityId: city.id, name: `Mağaza ${tag}`, slug: `${tag}-store`, status: "ACTIVE", isActive: true, legalInfoApproved: true, adminManaged: true } });
    const thread = async (customerId: string, contextKey: string, bodies: string[]) => {
      const conversation = await prisma.conversation.create({ data: { storeId: store.id, customerId, context: contextKey === "store" ? "STORE" : "PRODUCT", contextKey, lastMessagePreview: "-", lastSenderRole: "CUSTOMER" } });
      for (const [i, body] of bodies.entries()) await prisma.conversationMessage.create({ data: { conversationId: conversation.id, senderRole: i % 2 ? "STORE" : "CUSTOMER", body, createdAt: new Date(Date.now() + i) } });
      return conversation.id;
    };
    const reported = await thread(customerA.id, "store", [`Gizli mətn ${tag} 1`, `Gizli cavab ${tag} 2`]);
    const unreported = await thread(customerB.id, "store", [`Şikayətsiz mətn ${tag}`]);
    const orphanThread = await thread(customerB.id, "product:abc", [`Yetim mətn ${tag}`]);
    const report = await prisma.conversationReport.create({ data: { conversationId: reported, reporterUserId: seller.id, reporterRole: "STORE", reason: "ABUSE", note: `Qeyd ${tag}` } });
    const orphanReport = await prisma.conversationReport.create({ data: { conversationId: orphanThread, reporterUserId: seller.id, reporterRole: "STORE", reason: "FRAUD" } });
    const audits = (action: string) => prisma.auditLog.findMany({ where: { actorId: adminUser.id, action }, orderBy: { createdAt: "asc" } });

    await t.test("list: store, display name, reason, date, status; never message text or the reporter note", async () => {
      const list = await adminLib.listConversationReports(prisma, { status: "OPEN", take: 100 });
      const mine = list.items.filter((item) => item.store.id === store.id);
      assert.deepEqual(mine.map((item) => item.id).sort(), [report.id, orphanReport.id].sort());
      const row = mine.find((item) => item.id === report.id)!;
      assert.equal(row.customer, "Aysel M.");
      assert.equal(row.reasonLabel, "Təhqir və ya hədə");
      assert.equal(row.status, "OPEN");
      const text = JSON.stringify(mine);
      assert.doesNotMatch(text, new RegExp(`Gizli|Yetim|Qeyd ${tag}|@|994501234567`), "no message text, note, e-mail or phone");
      assert.equal(await prisma.auditLog.count({ where: { actorId: adminUser.id } }), 0, "listing is not an open");
    });

    await t.test("open: one CONVERSATION_ADMIN_VIEW row per open (actor, conversation, report), then the messages", async () => {
      const opened = await adminLib.openReportForAdmin(prisma, { reportId: report.id, adminId: adminUser.id });
      assert.ok(opened);
      assert.deepEqual(opened.messages.map((m) => m.body), [`Gizli mətn ${tag} 1`, `Gizli cavab ${tag} 2`]);
      assert.equal(opened.report.note, `Qeyd ${tag}`);
      assert.equal(opened.conversation.customer, "Aysel M.");
      await adminLib.openReportForAdmin(prisma, { reportId: report.id, adminId: adminUser.id });
      const rows = await audits("CONVERSATION_ADMIN_VIEW");
      assert.equal(rows.length, 2, "every open is audited");
      for (const row of rows) {
        assert.equal(row.entityType, "Conversation");
        assert.equal(row.entityId, reported);
        assert.deepEqual(row.metadata, { reportId: report.id });
      }
    });

    await t.test("no audit row, no messages: a failing audit write returns nothing", async () => {
      await assert.rejects(adminLib.openReportForAdmin(prisma, { reportId: report.id, adminId: `${tag}_no_such_admin` }));
      assert.equal(await prisma.auditLog.count({ where: { actorId: `${tag}_no_such_admin` } }), 0);
    });

    await t.test("no access to unreported conversations: unknown report ids (including a conversation id) read and log nothing", async () => {
      const before = await prisma.auditLog.count({ where: { actorId: adminUser.id } });
      assert.equal(await adminLib.openReportForAdmin(prisma, { reportId: unreported, adminId: adminUser.id }), null, "a conversation id is not a report id");
      assert.equal(await adminLib.openReportForAdmin(prisma, { reportId: `${tag}-nope`, adminId: adminUser.id }), null);
      assert.equal(await prisma.auditLog.count({ where: { actorId: adminUser.id } }), before);
      const all = await adminLib.listConversationReports(prisma, { status: null, take: 100 });
      assert.ok(!JSON.stringify(all).includes("Şikayətsiz"), "the unreported thread appears nowhere");
    });

    await t.test("orphans: readable by admin through the report, invisible to the store", async () => {
      await prisma.$transaction(async (tx) => {
        const cleared = await service.deleteCustomerConversations(tx, customerB.id);
        assert.deepEqual(cleared, { deleted: 1, kept: 1 }, "the unreported thread goes, the reported one stays");
        await tx.user.delete({ where: { id: customerB.id } });
      });
      assert.equal(await prisma.conversation.count({ where: { id: unreported } }), 0);
      const opened = await adminLib.openReportForAdmin(prisma, { reportId: orphanReport.id, adminId: adminUser.id });
      assert.equal(opened?.conversation.customer, adminLib.DELETED_CUSTOMER_LABEL);
      assert.equal(opened?.conversation.customerDeleted, true);
      assert.deepEqual(opened?.messages.map((m) => m.body), [`Yetim mətn ${tag}`]);
      const listed = (await adminLib.listConversationReports(prisma, { status: "OPEN", take: 100 })).items.find((item) => item.id === orphanReport.id);
      assert.equal(listed?.customer, "Silinmiş hesab");
      const S = { role: "STORE" as const, userId: seller.id, storeId: store.id };
      assert.ok(!(await service.listConversations(prisma, { actor: S, limit: 50 })).items.some((item) => item.id === orphanThread));
      await assert.rejects(service.listMessages(prisma, { conversationId: orphanThread, actor: S }), (e) => (e as { code?: string }).code === "NOT_FOUND");
    });

    await t.test("decisions: REVIEWED / DISMISSED once, audited; a second decision changes nothing", async () => {
      const first = await adminLib.decideReport(prisma, { reportId: report.id, adminId: adminUser.id, status: "REVIEWED" });
      assert.deepEqual(first, { result: "DECIDED", status: "REVIEWED" });
      const stored = await prisma.conversationReport.findUniqueOrThrow({ where: { id: report.id } });
      assert.equal(stored.status, "REVIEWED");
      assert.equal(stored.reviewedById, adminUser.id);
      assert.ok(stored.reviewedAt);
      const again = await adminLib.decideReport(prisma, { reportId: report.id, adminId: adminUser.id, status: "DISMISSED" });
      assert.deepEqual(again, { result: "ALREADY_DECIDED", status: "REVIEWED" });
      assert.equal((await prisma.conversationReport.findUniqueOrThrow({ where: { id: report.id } })).status, "REVIEWED");
      assert.deepEqual(await adminLib.decideReport(prisma, { reportId: orphanReport.id, adminId: adminUser.id, status: "DISMISSED" }), { result: "DECIDED", status: "DISMISSED" });
      assert.deepEqual(await adminLib.decideReport(prisma, { reportId: `${tag}-nope`, adminId: adminUser.id, status: "REVIEWED" }), { result: "NOT_FOUND" });
      const reviewed = await audits("CONVERSATION_REPORT_REVIEWED");
      const dismissed = await audits("CONVERSATION_REPORT_DISMISSED");
      assert.equal(reviewed.length, 1);
      assert.equal(dismissed.length, 1);
      assert.equal(reviewed[0].entityId, report.id);
      assert.deepEqual(reviewed[0].metadata, { conversationId: reported, previousStatus: "OPEN" });
      // A decided report can still be opened (the thread was reported) and the open is still audited.
      const before = (await audits("CONVERSATION_ADMIN_VIEW")).length;
      assert.ok(await adminLib.openReportForAdmin(prisma, { reportId: report.id, adminId: adminUser.id }));
      assert.equal((await audits("CONVERSATION_ADMIN_VIEW")).length, before + 1);
    });
  } finally {
    await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: tag } } }).catch(() => undefined);
    await prisma.store.deleteMany({ where: { slug: { startsWith: tag } } }).catch(() => undefined);
    await prisma.vendorProfile.deleteMany({ where: { userId: { startsWith: tag } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { startsWith: tag } } }).catch(() => undefined);
    await prisma.city.deleteMany({ where: { slug: { startsWith: tag } } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});
