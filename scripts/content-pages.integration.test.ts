/**
 * Content pages against the isolated verification PostgreSQL cluster, in a SCRATCH schema only.
 *
 * Safety: uses only BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL (loopback, port 5433, database name containing "verify")
 * and REQUIRES BAGATI_VERIFY_SCHEMA starting with "cp_" that already has migration 20261114030000 (it empties the
 * content page tables of that schema). Never applies migrations. Skips (NOT VERIFIED) when the cluster, schema or
 * migration is missing. Removes its admin user in `finally`.
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
  if (!schema) return { skip: "BAGATI_VERIFY_SCHEMA is not set (needs a migrated cp_* scratch schema)" };
  if (!/^cp_[a-z0-9_]{1,40}$/.test(schema)) return { refuse: "BAGATI_VERIFY_SCHEMA must be a cp_* scratch schema" };
  parsed.searchParams.set("schema", schema);
  return { url: parsed.toString() };
}

test("content pages: save, stale save refused, 20 revisions kept, restore as a new version, audit, public read, seed", { timeout: 120_000 }, async (t) => {
  const guard = guardedScratchUrl();
  if ("skip" in guard) return t.skip(`NOT VERIFIED: ${guard.skip}`);
  if ("refuse" in guard) throw new Error(`Refusing to run: ${guard.refuse}.`);
  process.env.DATABASE_URL = guard.url;
  const prisma = new PrismaClient({ datasources: { db: { url: guard.url } } });
  let adminId = "";
  try {
    try { await prisma.$queryRaw`SELECT 1`; } catch { return t.skip("NOT VERIFIED: verify database on 127.0.0.1:5433 is unreachable"); }
    const [where] = await prisma.$queryRaw<{ db: string; port: number; schema: string }[]>`SELECT current_database() AS db, inet_server_port() AS port, current_schema() AS schema`;
    assert.ok(where.db.includes("verify") && Number(where.port) === 5433 && where.schema.startsWith("cp_"));
    const migrated = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE migration_name = '20261114030000_content_pages' AND finished_at IS NOT NULL`.catch(() => [{ n: 0 }]);
    if (!migrated[0]?.n) return t.skip("NOT VERIFIED: scratch schema lacks migration 20261114030000 (this test never migrates)");

    await prisma.contentPageRevision.deleteMany({});
    await prisma.contentPage.deleteMany({});
    const admin = await prisma.user.create({ data: { email: `content-${randomUUID().slice(0, 8)}@verify.invalid`, passwordHash: "x", role: "ADMIN" } });
    adminId = admin.id;
    const pagesAdmin = await import("../lib/content-pages-admin");
    const pages = await import("../lib/content-pages");

    await t.test("public read falls back to the built-in text without a row", async () => {
      const page = await pages.getPublicContentPage("terms");
      assert.equal(page.fromDatabase, false);
      assert.equal(page.title, pages.CONTENT_PAGE_DEFAULTS.terms.title);
    });

    let updatedAt: string | null = null;
    await t.test("first save creates the page, a revision and an audit row", async () => {
      const { page, revision } = await pagesAdmin.saveContentPage(prisma, { slug: "terms", actorId: adminId, title: "Şərtlər v1", body: "## Bir\n\nMətn 1", note: "ilk", expectedUpdatedAt: null });
      updatedAt = page.updatedAt.toISOString();
      assert.equal(await prisma.contentPageRevision.count({ where: { pageId: page.id } }), 1);
      const audit = await prisma.auditLog.findFirst({ where: { action: "CONTENT_PAGE_UPDATE", entityId: page.id }, select: { actorId: true, metadata: true } });
      assert.equal(audit?.actorId, adminId);
      assert.equal((audit?.metadata as { revisionId: string; slug: string }).revisionId, revision.id);
      const read = await pages.getPublicContentPage("terms");
      assert.deepEqual([read.fromDatabase, read.title], [true, "Şərtlər v1"]);
    });

    await t.test("a stale editor is refused (another admin saved meanwhile)", async () => {
      await assert.rejects(pagesAdmin.saveContentPage(prisma, { slug: "terms", actorId: adminId, title: "x", body: "y", note: null, expectedUpdatedAt: null }), (error: unknown) => error instanceof pagesAdmin.ContentPageError && error.code === "CONFLICT");
      await assert.rejects(pagesAdmin.saveContentPage(prisma, { slug: "terms", actorId: adminId, title: "x", body: "y", note: null, expectedUpdatedAt: "2000-01-01T00:00:00.000Z" }), /CONFLICT/);
    });

    let firstRevisionId = "";
    await t.test("only the newest 20 revisions are kept", async () => {
      firstRevisionId = (await prisma.contentPageRevision.findFirstOrThrow({ orderBy: { createdAt: "asc" }, select: { id: true } })).id;
      for (let index = 2; index <= 22; index += 1) {
        const { page } = await pagesAdmin.saveContentPage(prisma, { slug: "terms", actorId: adminId, title: `Şərtlər v${index}`, body: `Mətn ${index}`, note: null, expectedUpdatedAt: updatedAt });
        updatedAt = page.updatedAt.toISOString();
      }
      assert.equal(await prisma.contentPageRevision.count(), 20);
      assert.equal(await prisma.contentPageRevision.count({ where: { id: firstRevisionId } }), 0, "the oldest was trimmed");
      assert.equal(await prisma.auditLog.count({ where: { action: "CONTENT_PAGE_UPDATE", actorId: adminId } }), 22);
    });

    await t.test("restore copies an old version into a NEW revision; nothing is deleted except beyond 20", async () => {
      const editor = await pagesAdmin.loadContentPageEditor(prisma, "terms");
      assert.equal(editor.revisions.length, 20);
      assert.equal(editor.revisions[0].current, true);
      const old = editor.revisions[10];
      const before = await prisma.contentPageRevision.findMany({ select: { id: true } });
      const { page, revision } = await pagesAdmin.restoreContentRevision(prisma, { slug: "terms", actorId: adminId, revisionId: old.id, expectedUpdatedAt: updatedAt });
      updatedAt = page.updatedAt.toISOString();
      assert.equal(page.title, old.title);
      assert.notEqual(revision.id, old.id);
      assert.match(revision.note ?? "", /^Versiya bərpa edildi/);
      assert.equal(await prisma.contentPageRevision.count({ where: { id: old.id } }), 1, "the restored version itself is kept");
      const after = new Set((await prisma.contentPageRevision.findMany({ select: { id: true } })).map((row) => row.id));
      assert.equal(before.filter((row) => !after.has(row.id)).length, 1, "only the single oldest revision was trimmed");
      const audit = await prisma.auditLog.findFirst({ where: { action: "CONTENT_PAGE_RESTORE", entityId: page.id }, select: { metadata: true } });
      assert.equal((audit?.metadata as { fromRevisionId: string }).fromRevisionId, old.id);
    });

    await t.test("restore refuses an unknown revision, another page's revision and a stale editor", async () => {
      await assert.rejects(pagesAdmin.restoreContentRevision(prisma, { slug: "terms", actorId: adminId, revisionId: "nope", expectedUpdatedAt: updatedAt }), /NOT_FOUND/);
      const { page } = await pagesAdmin.saveContentPage(prisma, { slug: "about", actorId: adminId, title: "Haqqımızda", body: "Mətn", note: null, expectedUpdatedAt: null });
      const aboutRevision = await prisma.contentPageRevision.findFirstOrThrow({ where: { pageId: page.id }, select: { id: true } });
      await assert.rejects(pagesAdmin.restoreContentRevision(prisma, { slug: "terms", actorId: adminId, revisionId: aboutRevision.id, expectedUpdatedAt: updatedAt }), /NOT_FOUND/);
      await assert.rejects(pagesAdmin.restoreContentRevision(prisma, { slug: "terms", actorId: adminId, revisionId: aboutRevision.id, expectedUpdatedAt: null }), /CONFLICT/);
    });

    await t.test("unpublished or deleted rows fall back to the built-in text", async () => {
      await prisma.contentPage.update({ where: { slug: "about" }, data: { published: false } });
      assert.equal((await pages.getPublicContentPage("about")).fromDatabase, false);
    });

    await t.test("seed creates only missing pages, once", async () => {
      const { seedWithPrisma } = await import("./seed-content-pages");
      assert.deepEqual(await seedWithPrisma(), ["privacy", "help"], "terms and about exist and are untouched");
      assert.equal((await prisma.contentPage.findUniqueOrThrow({ where: { slug: "terms" } })).updatedById, adminId);
      assert.equal(await prisma.contentPageRevision.count({ where: { page: { slug: "help" } } }), 1);
    });
    await t.test("seed is idempotent", async () => {
      const { seedWithPrisma } = await import("./seed-content-pages");
      assert.deepEqual(await seedWithPrisma(), []);
    });
  } finally {
    await prisma.contentPageRevision.deleteMany({}).catch(() => undefined);
    await prisma.contentPage.deleteMany({}).catch(() => undefined);
    if (adminId) {
      await prisma.auditLog.deleteMany({ where: { actorId: adminId } }).catch(() => undefined);
      await prisma.user.delete({ where: { id: adminId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  }
});
