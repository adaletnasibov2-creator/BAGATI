/**
 * Insert-only reference data for an empty or partially populated BAGATI database.
 *
 *   npm run reference-data            # dry run (default): reads only, prints what would be inserted
 *   npm run reference-data -- --apply # inserts ONLY the missing rows listed by the dry run
 *
 * Never updates, reactivates, renames or deletes existing rows (unlike `prisma db seed`, which
 * reactivates Qazax and overwrites subscription plan prices). Inactive reference rows are reported
 * for a human decision. Output contains slugs and counts only — no connection details.
 */
import { PrismaClient } from "@prisma/client";
import { planReferenceData } from "../lib/reference-data";

async function main() {
  const apply = process.argv.includes("--apply");
  const prisma = new PrismaClient();
  try {
    const [cities, categories, plans] = await Promise.all([
      prisma.city.findMany({ select: { name: true, slug: true, isActive: true } }),
      prisma.category.findMany({ select: { name: true, slug: true, isActive: true } }),
      prisma.subscriptionPlan.findMany({ select: { slug: true, isActive: true } }),
    ]);
    const plan = planReferenceData({ cities, categories, plans });
    console.log(`Mövcud: ${cities.length} şəhər, ${categories.length} kateqoriya, ${plans.length} abunə planı.`);
    console.log(`Əlavə ediləcək: ${plan.cityInserts.length} şəhər, ${plan.categoryInserts.length} kateqoriya, ${plan.planInserts.length} abunə planı.`);
    for (const row of plan.cityInserts) console.log(`  + city ${row.slug}`);
    for (const row of plan.categoryInserts) console.log(`  + category ${row.slug}`);
    for (const row of plan.planInserts) console.log(`  + plan ${row.slug} (${row.monthlyPrice} AZN)`);
    for (const row of plan.inactiveExisting) console.log(`  ! inactive ${row.kind} ${row.slug} — not changed; activate from the admin panel if intended`);

    if (!apply) {
      console.log("Quru yoxlama: heç nə yazılmadı. Tətbiq etmək üçün --apply əlavə edin.");
      return;
    }
    const result = await prisma.$transaction(async (tx) => {
      const createdCities = plan.cityInserts.length
        ? await tx.city.createMany({ data: plan.cityInserts.map((row) => ({ ...row, countryCode: "AZ", isActive: true })), skipDuplicates: true })
        : { count: 0 };
      const createdCategories = plan.categoryInserts.length
        ? await tx.category.createMany({ data: plan.categoryInserts.map((row) => ({ ...row, isActive: true })), skipDuplicates: true })
        : { count: 0 };
      const createdPlans = plan.planInserts.length
        ? await tx.subscriptionPlan.createMany({ data: plan.planInserts.map((row) => ({ ...row, isActive: true })), skipDuplicates: true })
        : { count: 0 };
      return { cities: createdCities.count, categories: createdCategories.count, plans: createdPlans.count };
    });
    console.log(`Yazıldı: ${result.cities} şəhər, ${result.categories} kateqoriya, ${result.plans} abunə planı.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^P\d{4}$/.test(error.code) ? error.code : "unclassified";
  console.error(`Reference data failed safely (${code}). Database details were not logged.`);
  process.exitCode = 1;
});
