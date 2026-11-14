/**
 * Admin side of content pages: list, editor data, save and restore. Server-only.
 * Every save or restore runs in ONE transaction: lock the page row, refuse a stale editor (409), write the page,
 * append a revision, keep the newest CONTENT_REVISIONS_KEPT revisions, write an audit row. Nothing is ever restored
 * by deleting: a restore copies an old revision into a NEW revision.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { CONTENT_PAGE_DEFAULTS, CONTENT_PAGE_META, CONTENT_PAGE_SLUGS, CONTENT_REVISIONS_KEPT, formatContentDateTime, type ContentPageSlug } from "@/lib/content-pages";

export class ContentPageError extends Error {
  constructor(readonly code: "CONFLICT" | "NOT_FOUND") { super(code); this.name = "ContentPageError"; }
}

type Tx = Prisma.TransactionClient;

async function lockPage(tx: Tx, slug: ContentPageSlug) {
  const rows = await tx.$queryRaw<{ id: string; updatedAt: Date }[]>`SELECT "id", "updatedAt" FROM "ContentPage" WHERE "slug" = ${slug} FOR UPDATE`;
  return rows[0] ?? null;
}

function assertFresh(current: { updatedAt: Date } | null, expectedUpdatedAt: string | null) {
  const actual = current ? current.updatedAt.toISOString() : null;
  if (actual !== expectedUpdatedAt) throw new ContentPageError("CONFLICT");
}

/** Keeps the newest CONTENT_REVISIONS_KEPT revisions of a page; returns how many were removed. */
async function trimRevisions(tx: Tx, pageId: string): Promise<number> {
  const keep = await tx.contentPageRevision.findMany({ where: { pageId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: CONTENT_REVISIONS_KEPT, select: { id: true } });
  const removed = await tx.contentPageRevision.deleteMany({ where: { pageId, id: { notIn: keep.map((row) => row.id) } } });
  return removed.count;
}

export async function saveContentPage(db: PrismaClient, input: { slug: ContentPageSlug; actorId: string; title: string; body: string; note: string | null; expectedUpdatedAt: string | null }) {
  try {
    return await db.$transaction(async (tx) => {
      const current = await lockPage(tx, input.slug);
      assertFresh(current, input.expectedUpdatedAt);
      const page = current
        ? await tx.contentPage.update({ where: { id: current.id }, data: { title: input.title, body: input.body, published: true, updatedById: input.actorId } })
        : await tx.contentPage.create({ data: { slug: input.slug, title: input.title, body: input.body, published: true, updatedById: input.actorId } });
      const revision = await tx.contentPageRevision.create({ data: { pageId: page.id, title: input.title, body: input.body, note: input.note, createdById: input.actorId } });
      const trimmed = await trimRevisions(tx, page.id);
      await tx.auditLog.create({ data: {
        actorId: input.actorId, action: "CONTENT_PAGE_UPDATE", entityType: "ContentPage", entityId: page.id,
        metadata: { slug: input.slug, revisionId: revision.id, titleLength: input.title.length, bodyLength: input.body.length, noteLength: input.note?.length ?? 0, created: !current, trimmedRevisions: trimmed },
      } });
      return { page, revision };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ContentPageError("CONFLICT");
    throw error;
  }
}

export async function restoreContentRevision(db: PrismaClient, input: { slug: ContentPageSlug; actorId: string; revisionId: string; expectedUpdatedAt: string | null }) {
  return db.$transaction(async (tx) => {
    const current = await lockPage(tx, input.slug);
    if (!current) throw new ContentPageError("NOT_FOUND");
    assertFresh(current, input.expectedUpdatedAt);
    const source = await tx.contentPageRevision.findFirst({ where: { id: input.revisionId, pageId: current.id }, select: { id: true, title: true, body: true, createdAt: true } });
    if (!source) throw new ContentPageError("NOT_FOUND");
    const page = await tx.contentPage.update({ where: { id: current.id }, data: { title: source.title, body: source.body, published: true, updatedById: input.actorId } });
    const note = `Versiya bərpa edildi: ${source.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC`;
    const revision = await tx.contentPageRevision.create({ data: { pageId: page.id, title: source.title, body: source.body, note, createdById: input.actorId } });
    const trimmed = await trimRevisions(tx, page.id);
    await tx.auditLog.create({ data: {
      actorId: input.actorId, action: "CONTENT_PAGE_RESTORE", entityType: "ContentPage", entityId: page.id,
      metadata: { slug: input.slug, fromRevisionId: source.id, revisionId: revision.id, trimmedRevisions: trimmed },
    } });
    return { page, revision };
  });
}

export async function listContentPages(db: PrismaClient) {
  const rows = await db.contentPage.findMany({ select: { slug: true, title: true, published: true, updatedAt: true, updatedBy: { select: { email: true } }, _count: { select: { revisions: true } } } });
  return CONTENT_PAGE_SLUGS.map((slug) => {
    const row = rows.find((item) => item.slug === slug);
    return { slug, ...CONTENT_PAGE_META[slug], title: row?.title ?? CONTENT_PAGE_DEFAULTS[slug].title, fromDatabase: Boolean(row), updatedAt: row?.updatedAt ?? null, updatedBy: row?.updatedBy?.email ?? null, revisions: row?._count.revisions ?? 0 };
  });
}

export async function loadContentPageEditor(db: PrismaClient, slug: ContentPageSlug) {
  const row = await db.contentPage.findUnique({
    where: { slug },
    select: { title: true, body: true, updatedAt: true, updatedBy: { select: { email: true } }, revisions: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: CONTENT_REVISIONS_KEPT, select: { id: true, title: true, note: true, createdAt: true, body: true, createdBy: { select: { email: true } } } } },
  });
  return {
    slug,
    ...CONTENT_PAGE_META[slug],
    title: row?.title ?? CONTENT_PAGE_DEFAULTS[slug].title,
    body: row?.body ?? CONTENT_PAGE_DEFAULTS[slug].body,
    fromDatabase: Boolean(row),
    updatedAt: row?.updatedAt.toISOString() ?? null,
    updatedAtLabel: row ? formatContentDateTime(row.updatedAt) : null,
    updatedBy: row?.updatedBy?.email ?? null,
    revisions: (row?.revisions ?? []).map((revision, index) => ({
      id: revision.id, title: revision.title, note: revision.note, createdAt: revision.createdAt.toISOString(), createdAtLabel: formatContentDateTime(revision.createdAt), createdBy: revision.createdBy?.email ?? null,
      bodyLength: revision.body.length, current: index === 0 && revision.title === row?.title && revision.body === row?.body,
    })),
  };
}

export type ContentPageEditorData = Awaited<ReturnType<typeof loadContentPageEditor>>;
