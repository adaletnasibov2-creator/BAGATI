import { PrismaClient } from "@prisma/client";
import { citySlug, INITIAL_CATEGORIES, INITIAL_CITY_NAMES } from "../lib/reference-data";
import { CATEGORY_SEED } from "../lib/category-seed";

const prisma = new PrismaClient();

async function main() {
  // Qazax is the launch city.
  await prisma.city.upsert({
    where: { slug: "qazax" },
    update: {
      name: "Qazax",
      countryCode: "AZ",
      isActive: true,
    },
    create: {
      name: "Qazax",
      slug: "qazax",
      countryCode: "AZ",
    },
  });

  // Initial Azerbaijan locations. Existing city rows are left untouched so
  // their IDs, relations, and admin-managed active state remain intact.
  const initialCities = INITIAL_CITY_NAMES;

  for (const name of initialCities) {
    const slug = citySlug(name);
    const existing = await prisma.city.findFirst({
      where: { OR: [{ name }, { slug }] },
      select: { id: true },
    });

    if (existing) continue;

    await prisma.city.create({
      data: { name, slug, countryCode: "AZ", isActive: true },
    });
  }

  // Initial BAGATI marketplace taxonomy. Existing categories remain admin-managed:
  // rerunning the seed does not overwrite names, visibility, or parent assignments.
  const initialCategories = INITIAL_CATEGORIES;

  for (const category of initialCategories) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: {},
      create: category,
    });
  }

  // Two-level tree (same reviewed list as release-output/prod-categories-seed.sql): icon and order are set on a
  // top-level only while it has no icon yet; new rows are created by slug and never overwrite admin edits.
  for (const top of CATEGORY_SEED) {
    const existing = await prisma.category.findUnique({ where: { slug: top.slug }, select: { id: true, iconKey: true, parentId: true } });
    const parent = existing
      ? existing.iconKey === null && existing.parentId === null
        ? await prisma.category.update({ where: { id: existing.id }, data: { iconKey: top.iconKey, sortOrder: top.sortOrder } })
        : existing
      : await prisma.category.create({ data: { name: top.name, slug: top.slug, iconKey: top.iconKey, sortOrder: top.sortOrder } });
    if (existing && existing.parentId !== null) continue;
    for (const child of top.children) {
      await prisma.category.upsert({
        where: { slug: child.slug },
        update: {},
        create: { name: child.name, slug: child.slug, sortOrder: child.sortOrder, parentId: parent.id },
      });
    }
  }

  // Basic subscription plan
  await prisma.$executeRaw`
    INSERT INTO "SubscriptionPlan"
      ("id", "name", "slug", "description", "monthlyPrice", "isActive", "createdAt", "updatedAt")
    VALUES
      (
        gen_random_uuid()::text,
        'BASIC',
        'basic',
        'Kiçik mağazalar üçün əsas aylıq satıcı paketi',
        20.00,
        true,
        NOW(),
        NOW()
      )
    ON CONFLICT ("slug")
    DO UPDATE SET
      "name" = EXCLUDED."name",
      "description" = EXCLUDED."description",
      "monthlyPrice" = EXCLUDED."monthlyPrice",
      "isActive" = EXCLUDED."isActive",
      "updatedAt" = NOW()
  `;

  // Professional subscription plan
  await prisma.$executeRaw`
    INSERT INTO "SubscriptionPlan"
      ("id", "name", "slug", "description", "monthlyPrice", "isActive", "createdAt", "updatedAt")
    VALUES
      (
        gen_random_uuid()::text,
        'PRO',
        'professional',
        'Böyüyən mağazalar üçün genişləndirilmiş aylıq paket',
        50.00,
        true,
        NOW(),
        NOW()
      )
    ON CONFLICT ("slug")
    DO UPDATE SET
      "name" = EXCLUDED."name",
      "description" = EXCLUDED."description",
      "monthlyPrice" = EXCLUDED."monthlyPrice",
      "isActive" = EXCLUDED."isActive",
      "updatedAt" = NOW()
  `;

  console.log("Seed tamamlandı.");
}

main()
  .catch((error) => {
    const errorName = error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.name)
      ? error.name
      : "UnknownError";
    const rawCode = error && typeof error === "object" && "code" in error ? error.code : undefined;
    const code = typeof rawCode === "string" && /^(P\d{4}|E[A-Z0-9_]{1,24})$/.test(rawCode)
      ? rawCode
      : "unclassified";
    console.error(`Seed failed safely (${errorName}, ${code}). Raw database details and credentials were not logged.`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
