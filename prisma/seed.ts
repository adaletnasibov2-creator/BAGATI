import { PrismaClient } from "@prisma/client";

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
  const initialCities = [
    "Bakı",
    "Gəncə",
    "Sumqayıt",
    "Mingəçevir",
    "Naxçıvan",
    "Şəki",
    "Şirvan",
    "Naftalan",
    "Yevlax",
    "Tovuz",
    "Ağstafa",
    "Şəmkir",
    "Gədəbəy",
    "Göyçay",
    "Ağdaş",
    "Bərdə",
    "Ağcabədi",
    "Lənkəran",
    "Masallı",
    "Astara",
    "Quba",
    "Qusar",
    "Xaçmaz",
    "Şamaxı",
    "İsmayıllı",
    "Ağsu",
    "Salyan",
    "Sabirabad",
    "Saatlı",
    "Biləsuvar",
    "Cəlilabad",
    "Hacıqabul",
    "Neftçala",
    "Kürdəmir",
    "Zaqatala",
    "Balakən",
    "Qax",
    "Oğuz",
    "Qəbələ",
    "Füzuli",
    "Ağdam",
    "Beyləqan",
    "İmişli",
    "Şuşa",
    "Xankəndi",
    "Laçın",
    "Kəlbəcər",
    "Qubadlı",
    "Zəngilan",
    "Cəbrayıl",
    "Xocavənd",
    "Xocalı",
    "Tərtər",
  ];

  // Match the admin slug convention (lowercase ASCII words separated by
  // hyphens), with Azerbaijani-specific letters transliterated explicitly.
  const citySlug = (name: string) =>
    name
      .toLowerCase()
      .replace(/ə/g, "e")
      .replace(/ı/g, "i")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

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
  const initialCategories = [
    { name: "Elektronika", slug: "elektronika" },
    { name: "Geyim", slug: "geyim" },
    { name: "Ev və məişət", slug: "ev-ve-mesiet" },
    { name: "Əyləncə", slug: "eylence" },
    { name: "İdman", slug: "idman" },
    { name: "Uşaq", slug: "usaq" },
    { name: "Gözəllik", slug: "gozellik" },
    { name: "Aksesuarlar", slug: "aksesuarlar" },
    { name: "Supermarket", slug: "supermarket" },
    { name: "Digər", slug: "diger" },
  ];

  for (const category of initialCategories) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: {},
      create: category,
    });
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
