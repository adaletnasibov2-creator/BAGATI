// EXPLAIN (ANALYZE, BUFFERS) of the exact SQL the app's own functions send, on schema scale_audit.
// Run from the repo root: DATABASE_URL=<verify ...?schema=scale_audit> npx tsx <this file> <label> <outFile>
import { writeFileSync } from "node:fs";
import { PrismaClient, Prisma } from "@prisma/client";
import { countVisibleProductsByCategory } from "../../lib/public-category-tree";
import { createPrismaPublicProductCatalogClient, findPublicProductCatalogPage } from "../../lib/public-product-catalog";

const url = process.env.DATABASE_URL ?? "";
if (!/127\.0\.0\.1:5433\/.*verify.*schema=scale_audit/.test(url)) throw new Error("refusing: scale_audit on the verify cluster only");
const [label, out] = process.argv.slice(2);
const prisma = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: "event", level: "query" }] });
let captured: { query: string; params: unknown[]; duration: number }[] = [];
prisma.$on("query", (e) => captured.push({ query: e.query, params: JSON.parse(e.params), duration: e.duration }));

const include = {
  store: { select: { id: true, name: true } },
  inventory: { select: { variantId: true, quantity: true, reserved: true } },
  variants: { where: { isActive: true }, select: { id: true } },
  promotionProducts: { include: { promotion: true } },
} satisfies Prisma.ProductInclude;

async function capture(name: string, run: () => Promise<unknown>) {
  captured = [];
  const t = performance.now();
  await run();
  const ms = performance.now() - t;
  return { name, totalMs: Math.round(ms), queries: captured.map((q) => ({ ...q })) };
}

const scenarios = [
  await capture("category-counts (layout, every page)", () => countVisibleProductsByCategory(prisma, new Date())),
  await capture("catalog newest (/products)", () => findPublicProductCatalogPage(createPrismaPublicProductCatalogClient(prisma, include), {}, { sort: "newest", limit: 48, paginate: true })),
  await capture("catalog category top-level (/products?category=elektronika)", () => findPublicProductCatalogPage(createPrismaPublicProductCatalogClient(prisma, include), { categorySlug: "elektronika" }, { sort: "newest", limit: 48, paginate: true })),
  await capture("catalog search common (/products?q=Smartfon)", () => findPublicProductCatalogPage(createPrismaPublicProductCatalogClient(prisma, include), { query: "Smartfon", searchFields: "catalog" }, { sort: "newest", limit: 48, paginate: true })),
  await capture("catalog search rare (/products?q=Nova qara 777)", () => findPublicProductCatalogPage(createPrismaPublicProductCatalogClient(prisma, include), { query: "Nova qara 777", searchFields: "catalog" }, { sort: "newest", limit: 48, paginate: true })),
  await capture("catalog name sort (/products?sort=name)", () => findPublicProductCatalogPage(createPrismaPublicProductCatalogClient(prisma, include), {}, { sort: "name", limit: 48, paginate: true })),
];

/** Untyped SQL literals in place of $n, so PostgreSQL infers the types exactly as with the app's typed binding. */
function inlineParams(query: string, params: unknown[]): string {
  return query.replace(/\$(\d+)/g, (_, n: string) => {
    const value = params[Number(n) - 1];
    if (value === null || value === undefined) return "NULL";
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return `'${String(value).replace(/'/g, "''")}'`;
  });
}

// EXPLAIN the heaviest query of each scenario (by duration), with the same parameters.
const report: unknown[] = [];
for (const scenario of scenarios) {
  const heaviest = [...scenario.queries].sort((a, b) => b.duration - a.duration)[0];
  const plan = await prisma.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(`EXPLAIN (ANALYZE, BUFFERS) ${inlineParams(heaviest.query, heaviest.params)}`);
  report.push({
    scenario: scenario.name,
    totalMs: scenario.totalMs,
    queryCount: scenario.queries.length,
    queryDurationsMs: scenario.queries.map((q) => q.duration),
    heaviestSql: heaviest.query.replace(/"scale_audit"\./g, "").slice(0, 1500),
    plan: plan.map((row) => row["QUERY PLAN"]),
  });
  console.log(`${label} | ${scenario.name} | total ${scenario.totalMs} ms | ${scenario.queries.length} queries | heaviest ${heaviest.duration} ms | ${plan.at(-1)?.["QUERY PLAN"]}`);
}
writeFileSync(out, JSON.stringify(report, null, 2));
await prisma.$disconnect();
