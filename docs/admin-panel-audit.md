# BAGATI admin paneli — audit və təkmilləşdirmə planı

## Əhatə və yoxlama sərhədi

Bu sənəd mövcud admin səhifələrinin, API route-larının, komponentlərin, Prisma modellərinin və əlaqəli testlərin statik kod yoxlamasına əsaslanır. Brauzerdə işlək E2E sınağı və ya verilənlər bazası sorğusu aparılmayıb; buna görə kodda və testdə görünən davranış faktiki işləyən deployment kimi təqdim edilmir. Bu audit zamanı kod, konfiqurasiya və verilənlər bazası dəyişdirilməyib.

Əsas baxılmış sahələr:

- Admin səhifələri: [app/admin](../app/admin), xüsusilə [dashboard](../app/admin/page.tsx), [bölmə səhifəsi](../app/admin/[...section]/page.tsx), [təsdiq gözləyən hesablar](../app/admin/verification/page.tsx), [email əməliyyatları](../app/admin/email/page.tsx) və [giriş](../app/admin/login/page.tsx).
- Naviqasiya və əməliyyat komponentləri: [AdminShell](../components/admin-shell.tsx), [AdminMutationForm](../components/admin-mutation-form.tsx), [AdminStoreProfileForm](../components/admin-store-profile-form.tsx), email və mağaza təsdiq/arxiv komponentləri.
- Admin API-lər: [ümumi admin resursları](../app/api/admin/[...resource]/route.ts), [satıcı yaratma](../app/api/admin/vendors/route.ts), mağaza review/activation/archive/delete route-ları, [returns](../app/api/admin/returns/route.ts), [email](../app/api/admin/email/route.ts), [login](../app/api/admin/login/route.ts).
- Məlumat modeli: [Prisma schema](../prisma/schema.prisma).
- Mövcud test və sənədlər: `scripts/admin-auth-security.test.mjs`, `scripts/admin-vendor-creation.test.ts`, `scripts/admin-store-management.test.ts`, `scripts/admin-store-archive.test.ts`, `scripts/admin-sales-report.test.ts`, [staging readiness](./staging-readiness.md), [transactional email](./transactional-email.md).

**Statusların mənası:** “qismən işlək” — server/API və UI əməliyyatlarının bir hissəsi kodla mövcuddur, lakin tələb olunan bütün biznes imkanları yoxdur və bu auditdə brauzerdə təsdiqlənməyib. “yalnız UI” — naviqasiya/görünüş var, işləyən idarəetmə route-u tapılmayıb. “yoxdur” — müvafiq admin funksiyası üçün səhifə/API/model sübutu tapılmayıb.

## Funksiyalar üzrə nəticə

| Funksiya | Mövcud vəziyyət | Əlaqəli sübut | Çatışmayan hissə | Təhlükəsizlik və məlumat riski | Prioritet |
|---|---|---|---|---|---|
| **1. Dashboard** | qismən işlək | [app/admin/page.tsx](../app/admin/page.tsx): müştəri/satıcı/mağaza/məhsul/sifariş sayları, abunəlik statusları və son qeydlər canlı Prisma sorğularından yığılır. | Gündəlik/aylıq satış, mağazaya görə dövriyyə və BAGATI komissiyası dashboard-da yoxdur; satış hesabatı ayrıca səhifədədir. Runtime performansı və hesabların real data ilə düzgünlüyü yoxlanmayıb. | Geniş həcmdə canlı DB sorğuları var; dashboard yalnız ADMIN səhifə qoruması ilə açılır. Məlumat məxfiliyi deployment-də yoxlanmayıb. | orta |
| **2. Məhsullar** | qismən işlək | [app/admin/[...section]/page.tsx](../app/admin/[...section]/page.tsx): məhsul axtarış/filtri, məhsul detalları, qiymət/endirim/stok/şəkil/variant/rəy məlumatının oxunması və status idarəsi. [admin API](../app/api/admin/[...resource]/route.ts) statusu və satışa uyğun mağaza/abunəlik şərtlərini yoxlayır. | Admin panelində məhsul yaratma və qiymət, endirim, stok, şəkil, variant və məhsul kateqoriyası sahələrini redaktə etmə görünmür; bu sahələr satıcı axınında ola bilər, admin tərəfindən idarə olunmur. | Aktiv etmə üçün kateqoriya, mağaza uyğunluğu, entitlement və məhsul limiti yoxlamaları var. Bu audit həmin yoxlamaları real DB əməliyyatı ilə sınaqdan keçirməyib. | orta |
| **3. Kateqoriyalar** | qismən işlək | [bölmə səhifəsi](../app/admin/[...section]/page.tsx) və [admin API](../app/api/admin/[...resource]/route.ts): yaratma, ad/slug redaktəsi, aktiv/deaktiv etmə; yalnız məhsulsuz və alt-kateqoriyasız kateqoriya silinir və audit edilir. Prisma-da `parentId`/`children` əlaqəsi var. | UI yeni kateqoriya üçün ana kateqoriya seçmir; redaktə ekranında ana kateqoriya və sıralama yoxdur. | Əlaqəli məhsul və uşaq kateqoriyası olan qeydlər silinmədən qorunur. Ağac dövrəsinin (özünü/descendant-ı parent seçmək) ayrıca qarşısının alındığı UI/API sübutu tapılmadı; ayrıca yoxlanmalıdır. | orta |
| **4. Mağazalar və satıcılar** | qismən işlək | [mağaza/satıcı səhifələri](../app/admin/[...section]/page.tsx), [vendor yaratma API-si](../app/api/admin/vendors/route.ts), review/activation/archive/delete route-ları. Yeni satıcı və mağaza tranzaksiyada yaradılır, parol bcrypt ilə hash olunur, təsdiq email-i outbox-a qoyulur. Review, aktivləşdirmə, deaktivləşdirmə, abunəlik və tarixçəli mağazanın yumşaq arxivlənməsi üçün qoruma/audit mövcuddur. Təsdiq gözləyən satıcı linki artıq `VendorProfile.id` istifadə edir. | Satıcı detalı mağaza sayını və sifariş sayını göstərir, amma satıcının sifariş/məhsul tarixçəsini birbaşa həmin səhifədə tam araşdırmır. | Admin role qoruması və mağaza sahiblik/status yoxlamaları mövcuddur. Mağaza tarixçəsi olduqda arxivləmə qorunur; tarixçəsiz mağazanın daimi silinməsi mümkündür və audit olunur. Verification link düzəlişi struktur regression testi ilə yoxlanıb, brauzer E2E yoxlanmayıb. | orta |
| **5. Sifarişlər** | qismən işlək | [sifariş səhifələri](../app/admin/[...section]/page.tsx), [admin API](../app/api/admin/[...resource]/route.ts), Prisma `Order`/`StoreOrder`/`Payment` modelləri. Axtarış, status/mağaza/tarix filtri, sifariş detalları və icazəli fulfillment keçidləri mövcuddur; status dəyişməsi transaction, audit və email outbox ilə əlaqələndirilib. | Ləğv və qaytarılma ayrıca idarəetmə axınlarıdır; tam sifariş timeline/kim dəyişdi görünüşü aydın deyil. Ödəniş provider-i və admin ödəniş idarəsi yoxdur. İxrac yoxdur. | Sifariş məlumatı və ünvan snapshot-u həssasdır; admin roluna geniş oxu icazəsi verilir. Status keçidləri helper ilə məhdudlaşdırılıb; real icra testi edilməyib. | yüksək |
| **6. Komissiyalar** | qismən işlək | [komissiya səhifəsi və hesabat](../app/admin/[...section]/page.tsx), [admin API](../app/api/admin/[...resource]/route.ts), Prisma `Commission`. Mağaza üzrə faiz və tarix aralığı yaratmaq/redaktə etmək, tarixlərin əsas uyğunluq yoxlaması və audit mövcuddur; aylıq hesabat komissiyanı çatdırılma tarixi üzrə hesablayır. | Ödəniş/settlement əməliyyatı yoxdur. Eyni mağaza üçün üst-üstə düşən qaydaların qarşısı görünən API kodunda alınmır; hesabatda uyğun qayda qeyri-müəyyən ola bilər. CSV/XLSX ixracı yoxdur. | Dərəcə 0–1 aralığı ilə məhdudlaşdırılır və dəyişiklik auditi var. Qayda üst-üstə düşməsi və geriyə tarixli redaktənin hesabatlara təsiri ayrıca siyasətləşdirilməlidir. | yüksək |
| **7. Ana səhifə və kampaniyalar** | qismən işlək | [admin ana səhifə idarəsi](../app/admin/[...section]/page.tsx), [banner API](../app/api/admin/homepage/banners/route.ts), [seçilmiş məzmun API-si](../app/api/admin/homepage/featured/route.ts), [ictimai ana səhifə](../app/(customer)/page.tsx). Bannerlərə tarix/aktivlik/sıra verilir, məhsul və mağazalar seçilir; mövcud satıcı `Promotion` axını və ana səhifə endirim göstərimi saxlanır. | Yaradılmış schema migration-ı deployment DB-sinə hələ tətbiq edilməyib. Admin kampaniya səhifəsi mövcud `Promotion` qeydlərini idarə etmir; həmin axın satıcı panelində qalır. Upload olunmuş, sonradan istifadə olunmayan media üçün təmizləmə UI-si yoxdur. | Banner/media mutation-ları ADMIN-only və auditlidir; seçimlər FK ilə qorunur. Aktiv olmayan və tarixdən kənar bannerlər ana səhifə sorğusunda çıxarılır. Storage konfiqurasiyası və browser E2E yoxlanmayıb. | yüksək |
| **8. Sayt parametrləri** | qismən işlək | [sayt parametrləri formu](../components/admin-site-settings-form.tsx), [parametr API-si](../app/api/admin/site-settings/route.ts), [ümumi ayar modeli](../prisma/schema.prisma), [header/footer](../app/(customer)/layout.tsx). Sayt adı/logo, əlaqə məlumatı, sosial URL-lər, çatdırılma/qaytarılma mətni və ana səhifə CTA mətni admin formundan dəyişdirilir. | Yeni schema migration-ı tətbiq edilmədiyi üçün idarəetmə deployment DB-sində hələ işə düşə bilməz. Brend görünüşündə yalnız mövcud header/footer, root metadata və ana səhifə CTA-sı dəyişir; bütün statik mətnlər CMS deyil. | Serverdə HTTPS/daxili URL və uzunluq validasiyası, ADMIN yoxlaması və audit var. Logo upload mövcud asset validator/storage adapterindən istifadə edir; real S3 inteqrasiyası yoxlanmayıb. | yüksək |
| **9. Müştərilər** | qismən işlək | [müştəri səhifələri](../app/admin/[...section]/page.tsx), [admin API](../app/api/admin/[...resource]/route.ts): axtarış, aktivlik filtri, profil/ünvanlar, sifariş sayı və hesabı aktiv/deaktiv etmə. | Müştəri detalında sifariş sayı var, sifariş tarixçəsinin özü göstərilmir. Sifarişlər siyahısından müştəriyə keçid mövcuddur, lakin müştəri detalından sifarişlərə keçid yoxdur. | Ünvan və əlaqə məlumatları şəxsi məlumatdır; hazırda ümumi ADMIN rolu ilə görünür. Hesab statusu dəyişməsi audit olunur, lakin audit yazısı əsas istifadəçi update-i ilə eyni transaction daxilində deyil. | orta |
| **10. Bildirişlər və e-poçt** | qismən işlək | [bildiriş/email səhifələri](../app/admin/[...section]/page.tsx), [email UI](../components/admin-email-operations.tsx), [email API](../app/api/admin/email/route.ts), Prisma `Notification`/`EmailOutbox`. Outbox sayları, son göndəriş cəhdləri və yalnız `retrySafe` uğursuz qeydləri təkrar növbəyə qoymaq mövcuddur. | Bildiriş siyahısı oxuma üçündür; admin tərəfindən bildiriş yaratma/redaktə görünmür. Şablonlar üçün UI yoxdur. Outbox statusu və SMTP provider qəbul cavabı inbox-a çatdırılmanın sübutu deyil. | Retry ADMIN ilə qorunur, origin yoxlanır və audit edilir. Real SMTP çatdırılması bu auditdə sınanmayıb; məxfi payload UI-də göstərilmir. | orta |
| **11. Admin təhlükəsizliyi** | qismən işlək | [admin login API](../app/api/admin/login/route.ts), [auth/session](../lib/auth.ts), [security bölməsi](../app/admin/[...section]/page.tsx), dedicated admin API-lər. `ADMIN` rolu yoxlanır; sessiya imzalı JWT + DB session, revoke və role re-check istifadə edir; cookie `httpOnly`, `sameSite=lax`, production-da `secure`; parol dəyişikliyi formu var. `Role` enum-da yalnız CUSTOMER/VENDOR/ADMIN rolları görünür. | Admin rolları və incə icazə matrisi, MFA/ikinci təsdiq, admin recovery flow və kritik əməliyyatlar üçün step-up auth yoxdur. Login rate limit-in bu route-da tətbiq edildiyi sübut olunmayıb. | Müxtəlif admin əməliyyatlarında audit mövcuddur, lakin əhatə vahid və hər yerdə tranzaksiyalı deyil; audit log dəyişdirilməz audit sistemi kimi təqdim edilə bilməz. `scripts/admin-auth-security.test.mjs` yalnız lokal server veriləndə HTTP yoxlaması edir; bu auditdə işə salınmayıb. | yüksək |
| **12. Hesabatlar** | qismən işlək | [hesabat səhifəsi](../app/admin/[...section]/page.tsx), [satış hesablayıcıları](../lib/admin-sales-report.ts), [aylıq mağaza/komissiya hesablayıcısı](../lib/store-monthly-sales.ts). Tarix, mağaza və şəhər filtri; xalis çatdırılmış satışın gün/mağaza/məhsul üzrə cəmləri; aylıq mağaza satışı və komissiya göstərilir. Uyğun unit testlər mövcuddur. | CSV/XLSX ixrac yoxdur. Gəlir yalnız çatdırılmış sifariş və təsdiqlənmiş refund qaydalarına əsaslanır; qismən refund üzrə qaytarılan vahid sayı ayrıca hesablanmır, komissiya qaydası olmayan sifarişlərdə hesablama natamam qala bilər. | Hesabat ödəniş/settlement deyil; səhifənin özü də bunu bildirir. Tarix aralığının browser/runtime məlumatları ilə doğruluğu bu auditdə yenidən sınaqdan keçirilməyib. | orta |

### UI, API və model arasında sərhəd

- Admin naviqasiyasında `/admin/payments` linki var ([AdminShell](../components/admin-shell.tsx)), amma catch-all admin səhifəsində uyğun `payments` bölməsi, ayrıca admin payments API-si və ya ödəniş idarəetmə UI-si tapılmadı. Linkin işlək ödəniş paneli olduğu iddia edilə bilməz; mövcud axında bu, işləməyən/boş naviqasiya nöqtəsidir. `Payment` modeli yalnız qeydləri saxlayır; provider inteqrasiyası bu auditdə tapılmayıb.
- `/admin/refunds` üçün səhifə provayderin qoşulmadığını və refund-un icra edilmədiyini bildirir; Prisma-da ayrıca refund/payment settlement modeli yoxdur. ReturnRequest prosesi refund ödənişini özü icra etmir.
- Baxılmış admin API route-larında Server Actions tapılmadı; dəyişikliklər route handler-lər vasitəsilə aparılır.
- [store/profile/order/return/commission API-үүд](../app/api/admin/[...resource]/route.ts) зэрэг həssas mutation-lar `requireRole("ADMIN")` ilə qorunur. Ancaq testlərin əksəriyyəti source/struktur və saf helper yoxlamalarıdır; onların mövcudluğu browser E2E keçdiyini göstərmir.
- Səhifələrdə cədvəllər `overflow-x-auto` ilə sarınıb, admin mobil menyusu var. Bu, 390×844 və ya digər mobil ölçüdə bütün formaların əlverişli işlədiyini təsdiqləmir; vizual/mobil E2E aparılmayıb.

## Təhlükəsizlik və audit qiymətləndirməsi

**Kodla təsdiqlənən müsbət nəzarətlər**

- Admin səhifələri `requireRole("ADMIN")` ilə qorunur; admin API-lər də öz server tərəfində rol yoxlaması aparır.
- Satıcı yaratma endpoint-i serverdə Zod validasiyası edir, parolu `bcrypt.hash(..., 12)` ilə saxlayır, User/VendorProfile/Store/outbox/audit yazılarını transaction-da yaradır.
- Mağaza təsdiqi hüquqi məlumatı, satıcı/şəhər aktivliyini və adi mağaza üçün abunəliyi nəzərə alır. Arxivləmə tarixçəni saxlayır; tarixçəsiz mağazanın silinməsi ayrıca məhdudlaşdırılıb və audit olunur.
- Sifariş statusu üçün icazəli keçid helper-i, transaction və audit/outbox axını mövcuddur. Kateqoriya silmə bağlı məhsul və alt-kateqoriyanı yoxlayır.
- Outbox retry yalnız `FAILED` və `retrySafe=true` qeydi üçün açılır; təkrar əməl audit edilir.

**Açıq yoxlama və risk**

- Təsdiq gözləyən satıcı sətrinin linki `User.id` verir, halbuki satıcı detal route-u `VendorProfile.id` ilə axtarır ([verification/page.tsx](../app/admin/verification/page.tsx), [admin section page](../app/admin/[...section]/page.tsx)). Bu, koddan görünən identifikator uyğunsuzluğudur; browser-də reproduksiya edilməyib.
- Admin rolunun hər bir əməkdaşa bütün müştəri, sifariş ünvanı, maliyyə və vendor məlumatlarını açması least-privilege baxımından məhdudiyyətsizdir. Permission modeli görünmür.
- Audit log mövcuddur, amma bütün mutation-lar üçün eyni atomiklik və əhatə təminatı sübut olunmayıb. Audit cədvəli tətbiq DB-sindədir; dəyişdirilməz/ayrı saxlanma təminatı bu yoxlamada müəyyən edilməyib.
- Komissiya qaydaları üçün vaxt aralığı yoxlanır, lakin eyni mağazada üst-üstə düşən intervalın rəddi görünən handler-də yoxdur.
- Login üçün rate-limit/lockout bu admin login handler-də görünmür; reverse proxy və ya ümumi middleware səviyyəsində olub-olmadığı yoxlanmayıb.
- Heç bir cross-account test və ya browser E2E bu auditdə işə salınmayıb. Beləliklə, DB ownership davranışını runtime-da keçmiş kimi təqdim etmirik.

## Mövcud test sübutu və məhdudiyyət

Admin test faylları mövcuddur:

- `admin-vendor-creation.test.ts`: admin-only gate, server validation, parol hash-i, transaction və outbox barədə mənbə yoxlamaları.
- `admin-store-management.test.ts`, `admin-store-archive.test.ts`: entitlement, approval, audit və tarixçənin qorunmasına dair struktur/helper yoxlamaları.
- `admin-sales-report.test.ts`: satış hesablayıcıları və tarix sərhədləri üçün unit testləri.
- `admin-auth-security.test.mjs`: yalnız `BAGATI_BASE_URL` ilə localhost-da işləyən serverə unauthenticated admin API sorğuları göndərən HTTP testi.

Auditin ilkin mərhələsində test, build, browser və DB-backed əməliyyat işə salınmamışdı. Son tətbiq qeydində yeni kod üçün faktiki işlədilən yoxlamalar ayrıca göstərilir.

## Ən vacib beş çatışmazlıq

1. **Admin məhsul idarəetməsi əsasən baxış/status səviyyəsindədir** — qiymət, endirim, stok, şəkil və variant redaktəsi admin panelində yoxdur.
2. **Ödəniş/refund əməliyyat paneli yoxdur** — naviqasiya linki olsa da, işləyən admin payment bölməsi/provider yoxdur; refund qeydi real ödəniş deyil.
3. **Mövcud `Promotion` qeydlərinin admin CRUD-u yoxdur** — satıcı kampaniya axını qalır; admin panelində yalnız ana səhifə banneri və seçilmiş bölmələr idarə olunur.
4. **Schema migration və storage deployment-də tətbiq edilməyib/yoxlanmayıb** — yeni parametr/bannner cədvəlləri migration tələb edir; bu audit işi DB-yə toxunmayıb.
5. **İcazə və maliyyə nəzarəti natamamdır** — granular admin rolları/MFA görünmür, komissiya intervalı üst-üstə düşməsi yoxlanmır, audit əhatəsi vahid deyil və CSV/XLSX hesabat ixracı yoxdur.

## Təkmilləşdirmə planı

Mərhələləri mövcud axınları yenidən yazmadan, hər mərhələdə ayrıca code review və testlərlə icra etmək məqsədəuyğundur.

| Mərhələ | İş | Mövcud məlumatla / yeni kod | Tələb olunan yoxlama |
|---|---|---|---|
| **0. Dar funksional düzəliş və baseline** | Satıcı verification link-ini `VendorProfile.id` ilə uyğunlaşdırmaq; köhnə/fərqli ID halı üçün düzgün not-found davranışını təsdiqləmək. | Kiçik mövcud kod düzəlişi; sxem dəyişikliyi tələb etmir. | Unit/regression testdə profile ID və user ID fərqli olsun; localhost admin HTTP test; brauzerdə verification siyahısından satıcı detalına keçid. |
| **1. Mövcud admin əməliyyatlarını möhkəmləndirmə** | Kateqoriya parent seçimi/sıralama ehtiyacını dəqiqləşdirmək; mağaza və müştəri detail-dan əlaqəli order/product tarixçəsinə keçid; komissiya intervalının toqquşma siyasəti; mutation auditlərini eyni transaction-da standartlaşdırmaq. | Parent əlaqəsi artıq var; sıralama üçün yeni sahə və migration yalnız biznes tələbi təsdiqlənərsə. Audit/interval doğrulaması kod işi tələb edir. | Unit testlər, DB izolyasiyalı API integration, unauthorized/IDOR testləri, concurrency və audit rollback testləri. |
| **2. Dashboard və hesabatlar** | KPI tər definitions (gross/net, refund, commission), drill-down, pagination/query limitləri və CSV export; export formatı təsdiqlənəndən sonra XLSX ehtiyacını qiymətləndirmək. | Mövcud hesabat hesablayıcıları təkrar istifadə olunur; export endpoint/UI yeni koddur, adətən yeni model tələb etmir. | Hesablayıcı unit testləri, timezone və refund halları, export məzmunu/authorization, böyük dataset yoxlaması. |
| **3. Kampaniya və ana səhifə CMS** | İlkin tətbiq hazırdır: mövcud satıcı Promotion axını saxlanıb; admin banner planlaması, ana səhifədə seçilmiş məhsul/mağaza və tarixə görə göstərim əlavə edilib. Adminin Promotion qeydlərini ayrıca idarə etməsi bu scope-a daxil deyil. | Yeni `HomeBanner`, `HomepageFeaturedProduct`, `HomepageFeaturedStore` modelləri və SQL migration faylı yaradılıb; migration işlədilməyib. | Unit/structural testlər keçib; staging DB migration, storage konfiqurasiyası və browser E2E ayrıca tələb olunur. |
| **4. Sayt parametrləri** | İlkin tətbiq hazırdır: sayt adı/logo, əlaqə, sosial URL, çatdırılma/qaytarılma mətni və ana səhifə CTA parametrləri üçün ADMIN-only API/form əlavə edilib. | Yeni singleton `SiteSettings` modeli və SQL migration faylı yaradılıb; migration işlədilməyib. | Typecheck və schema/test yoxlamaları keçib; staging DB migration və browser E2E hələ yoxdur. |
| **5. Maliyyə və admin təhlükəsizliyi** | Payment provider seçimi təsdiqlənəndən sonra payment/refund paneli; role/permission matrisi, MFA və login rate limiting; dəyişdirilməz audit strategiyası. | Provider inteqrasiyası və permission/audit modeli yeni kod və xarici konfiqurasiya tələb edir. | Provider sandbox (real ödənişsiz), idempotency/webhook imza testləri, MFA/rate-limit, rol matrisinin negative tests, audit completeness. |
| **6. Mobil və browser E2E** | Admin login, satıcı yaratma, mağaza approval/arxiv, sifariş/returns, validation/error/success və 390×844 naviqasiya axınları. | Mövcud UI-lər üçün test infrastrukturu; yalnız təkrarlanan usability problemi varsa kiçik UI düzəlişi. | Mövcud browser E2E vasitəsi ilə staging/test DB-də ssenarilər; screenshot/overflow və keyboard/form yoxlaması. |

## Mövcud paneldən kod yazmadan dəyişdirilə bilənlər

Hazırkı UI/API vasitəsilə admin aşağıdakı mövcud məlumatları idarə edə bilər (bu siyahı yalnız kod səviyyəsində imkanları ifadə edir):

- mağaza profili, sahiblik, review/approval, aktivlik və arxiv;
- satıcı hesabı yaratmaq və aktiv/deaktiv etmək;
- məhsulun satış statusu;
- kateqoriya, brend və şəhər qeydlərinin mövcud sahələri;
- sifariş fulfillment statusu, qaytarılma qərarının bir hissəsi və dəstək ticket statusu;
- mağaza üzrə komissiya qaydaları və abunəlik statusu;
- email outbox statusuna baxmaq və təhlükəsiz işarələnmiş bəzi failed item-ləri yenidən növbəyə qoymaq;
- müştəri hesabını aktiv/deaktiv etmək;
- sayt parametrləri və ana səhifə hero bannerlərini tarix/status ilə idarə etmək;
- ana səhifədə görünən məhsul və mağaza seçimlərini sıralı şəkildə dəyişmək.

Banner, sayt parametrləri və seçilmiş məhsul/mağaza siyahısı üçün kodsuz idarəetmə UI/API əlavə olunub. Ana səhifədə `Promotion` əsasında məhsul endirimi mövcud əvvəlki axınla işləyir, lakin `Promotion`/`Coupon` qeydlərinin admin CRUD-u, payment/refund settlement, permission matrisi və hesabat ixracı yoxdur.

## Tövsiyə olunan ilk iş

Satıcı verification ID uyğunsuzluğu əvvəlki mərhələdə düzəldilib və struktur regression testindən keçib; browser E2E hələ edilməyib. Bu mərhələdə parametrlər və ana səhifə idarəsi kod səviyyəsində əlavə olundu, amma staging DB migration tətbiqi ayrıca, qorunan DB URL ilə sonrakı buraxılış addımıdır.

## Kampaniya və sayt parametrləri mərhələsinin icra qeydi

- Əlavə olunan cədvəllər: `SiteSettings`, `HomeBanner`, `HomepageFeaturedProduct`, `HomepageFeaturedStore`; yeni migration: `prisma/migrations/20261012120000_admin_homepage_management/migration.sql`.
- Migration faylı yaradıldı və Prisma schema validation/Client generation aparıldı; **heç bir verilənlər bazasına migration/seed yazılmadı**.
- Parametrlər/banner/seçilmiş kontent API-ləri `requireRole("ADMIN")`, server-side Zod validation və audit qeydlərindən istifadə edir.
- Şəkil yükləməsi mövcud format/signature/Sharp normalizasiya və store-asset storage adapterindən istifadə edir; canlı S3/CDN yoxlanmayıb.
- `npm run test:admin-homepage`, mövcud promotion pricing və əlaqəli admin testləri, TypeScript typecheck və dəyişdirilən TypeScript fayllarının lint-i işlədilib. Lint çıxışı 52 xəbərdarlıq/0 xəta göstərdi; xəbərdarlıqlar əsasən öncədən mövcud `any` istifadələrindədir.
- Brauzer E2E və production build bu mərhələdə icra edilməyib. DB migration, storage provider və son canlı görünüş ayrıca yoxlanmalıdır.

## Admin idarəetmə tamamlamaları (2026-10-12)

- Mövcud məhsulun redaktəsi `/admin/products/[id]` detalına qoşulub. ADMIN-only API qiymət, endirim, mətn, kateqoriya/brend, mövcud mağaza şəkilləri, variant və stok sahələrini yoxlayır; stok dəyişikliklərini inventory adjustment və audit log-da qeyd edir, rezerv edilmiş stokdan aşağı qiymətə icazə vermir. Yeni məhsul yaratma və variant əlavə/silmə bu redaktorun əhatəsində deyil.
- Admin `/admin/promotions` səhifəsi mövcud `Promotion` modelinə qoşulub: mağaza kampaniyası yaratmaq/redaktə etmək/deaktiv etmək, aktiv məhsulları seçmək, endirim və tarix təyin etmək mümkündür. API ADMIN rolunu, məhsulun seçilmiş mağazaya aid və aktiv olmasını, sabit endirimin məhsul qiymətindən aşağı olmasını yoxlayır; üst-üstə düşən aktiv məhsul kampaniyaları eyni serializable tranzaksiyada rədd edilir. Silmək əvəzinə deaktiv edilir, dəyişikliklər audit olunur. DB-backed və vendor API ilə paralel axın inteqrasiya testi staging-də hələ aparılmayıb.
- Eyni mağazada üst-üstə düşən komissiya tarix aralıqları admin yaratma/redaktə API-sində serializable tranzaksiya daxilində rədd edilir. Əvvəldən mövcud olan mümkün overlap qeydləri dəyişdirilmir; aylıq hesabat çatdırılma anına uyğun, ən son başlayan qaydanı seçmək davranışını saxlayır. Köhnə qeydlərin ayrıca audit/araşdırması qalır.
- `/admin/reports` filtrləri üçün ADMIN-only `/api/admin/reports` CSV ixracı əlavə edilib. Tarix aralığı 366 günlə məhdudlaşdırılır, satış və komissiya hesablamaları mövcud hesabat helper-lərindən gəlir, mətn hüceyrələrində CSV formula injection simvolları zərərsizləşdirilir. İxrac və UI server bazasında test edilməyib.
- Yeni helper/regression testləri məhsul/kampaniya validasiyasını, rezerv stok sərhədini, komissiya tarix intervalını, CSV escape və route qorumasını yoxlayır. Typecheck keçib; hədəf testlər keçib; dəyişən fayllar üçün lint 0 xəta ilə bitib. Production build dummy, əlçatmaz DB URL və ayrıca build qovluğu ilə keçib (30/30 statik səhifə); əsas `bagati` DB-yə sorğu/migration/test edilməyib.
- Brauzer E2E, real staging DB əməliyyatları, S3 bucket, email sink və payment provider hələ yoxlanmayıb/konfiqurasiya edilməyib.

## Staging hazırlığı və yenidən yoxlama qeydi (2026-10-12)

- Verification siyahısı vendor link-i `user.vendorProfile.id` ilə yaradır; bu, vendor detal route-un gözlədiyi `VendorProfile.id`-dir. Müvafiq regresiya yoxlaması `scripts/admin-vendor-creation.test.ts` daxilində mövcuddur. Bu mərhələdə kod dəyişməyib.
- Sayt parametrləri, bannerlər və seçilmiş məhsul/mağazalar üçün admin route-ları və UI mövcuddur. API-lər `requireRole("ADMIN")` ilə qorunur; browser E2E və DB-backed API inteqrasiyası staging mühitində hələ icra olunmayıb.
- Admin navigation `/admin/payments` link-ийг göstərirdi, catch-all page isə həmin route üçün səhifə göstərmirdi. İndi həmin route provider-in qoşulmadığını və əməliyyatların bağlı olduğunu izah edir; ödəniş funksiyası **mövcud deyil** və heç bir fake əməliyyat göstərilmir.
- Email outbox worker `npm run email:worker:watch` ilə ayrıca prosesdir. O, DB outbox-ını oxuyub SMTP-yə göndərə bilər; mail sink təsdiqlənənədək staging-də başladılmamalıdır.
- Şəkil storage adapterində S3-compatible driver və production-da lokal storage üçün bloklama mövcuddur. S3/CDN üçün real provider, staging bucket və davamlılıq yoxlaması hələ yoxdur.
- Yeni `/api/health` yalnız proses liveness-i bildirir; DB və storage readiness yoxlaması deyil.
- Lokal `.env` DB adı `bagati` göstərir. Buna görə migration, seed, DB-backed test və bu DB konfiqurasiyası ilə build edilməyib. Staging migration üçün `npm run staging:migrate` guard-ı, boş `.env.staging.example` və `docs/staging-deployment.md` əlavə olunub.
- Browser E2E aləti (Playwright/Cypress) quraşdırılmış deyil; heç bir browser E2E iddia edilmir. Yeni staging guard/health testləri və əlaqəli regression checks-in nəticələri icra edən sessiyanın hesabatında verilməlidir.

## Sonrakı admin yoxlaması və icra qeydi (2026-10-13)

Bu yoxlama mənbə kodu və testlərə əsaslanır. Admin hesabı ilə brauzerə giriş, DB-backed admin dəyişiklikləri, media yükləməsi və real məlumat ixracı bu mərhələdə sınaqdan keçirilməyib; verilənlər bazasına sorğu və yazı aparılmayıb.

| Sahə | Yenilənmiş vəziyyət | Təsdiqlənən sərhəd |
|---|---|---|
| İcmal | qismən işlək | Sayğaclar və son sifariş/mağazalar Prisma-dan yığılır; canlı dashboard nəticələri bu mərhələdə yoxlanmayıb. |
| Məhsullar | işlək kod yolu, runtime təsdiqi yoxdur | Siyahı/status, detal/redaktə, qiymət/endirim, kateqoriya/brend, şəkil, variant və stok redaktəsi artıq mövcuddur; redaktə API-si rezerv stok və mağazaya aid şəkil qaydalarını yoxlayır. Əvvəlki qeyddəki “admin redaktəsi yoxdur” bəndi köhnəlmişdi. |
| Kateqoriyalar, brendlər, şəhərlər | qismən işlək | CRUD və server API-ləri mövcuddur. Kateqoriya UI-si ana kateqoriya/sıra sahələrini idarə etmir; ağac dövrəsi siyasəti ayrıca yoxlanmalıdır. |
| Mağazalar və satıcılar | qismən işlək | Vendor/mağaza yaratma, review, aktivləşdirmə, arxiv, profil və abunə statusu axınları mövcuddur; real admin brauzer sessiyası ilə sınaqdan keçirilməyib. |
| Sifarişlər və qaytarılmalar | qismən işlək | Fulfillment keçidləri, qaytarılma sorğusu və refund qeydi axınları var. Payment provayderi olmadığı üçün refund qeydi real ödəniş/refund əməliyyatı deyil. |
| Kampaniya və ana səhifə | qismən işlək | Banner/featured idarəsi və `Promotion` idarəetməsi var; upload/storage provider və canlı səhifədə persistensiya bu mərhələdə yoxlanmayıb. |
| Sayt parametrləri | logo göstərimi düzəldildi; DB persistensiyası yenidən yoxlanmayıb | `SiteSettings.logoUrl` və `siteName` əvvəlcə yadda saxlanırdı, lakin ortaq `BrandLogo` komponenti onları heç yerdə istifadə etmirdi. İndi ictimai header/footer və metadata/favicon həmin dəyərləri alır. Upload, Save və refresh axınını DB-yə yazmadan E2E təsdiqləmək mümkün olmadı. |
| Bulk məhsul idarəetməsi | CSV/XLSX import və CSV export əlavə edildi; runtime DB təsdiqi yoxdur | Admin store-scope, server validation, 1000 sətir/12 MB hədləri, create/update/mixed SKU qaydası, transaction, inventory adjustment və audit əlavə edilib. Yeni məhsullar qaralama yaradılır; status mapping/import vasitəsilə yayım qəsdən bağlıdır. Mövcud variantları idxalla yeniləmək dəstəklənmir, belə sətirlər açıq xəta alır; yeni məhsul variantları dəstəklənir. Export cursor-paginated və CSV formula injection qoruması ilə işləyir. |
| Ödənişlər, səlahiyyətlər və təhlükəsizlik | natamam | `/admin/payments` izahlı, read-only səhifədir; provider və settlement yoxdur. Admin səlahiyyətləri granular deyil, yalnız `ADMIN` rolu görünür. MFA və rate limit-in mövcud deployment-də qurulması yoxlanmayıb. |
| Dəstək, bildiriş, email və audit | qismən işlək | Ticket statusu, bildiriş/outbox baxışı və audit jurnalı üçün səhifələr mövcuddur; xarici email göndərilməsi və audit-in DB-dən kənar dəyişdirilməzliyi təsdiqlənməyib. |

**İcra və yoxlama:** Logo dəyişiklikləri schema/migration tələb etmir. Admin import/export mövcud `Product`, `ProductVariant`, `Inventory`, `InventoryAdjustment`, `ProductImport` və `AuditLog` modellərindən istifadə edir; migration, seed və DB yazısı icra edilməyib. `npm run typecheck`, `npm run test:admin-homepage`, `npm run test:admin-product-management`, `npm run test:product-import` uğurla keçib. Testlər kod/validasiya səviyyəsindədir, browser və DB-backed sınaq deyil. WhatsApp üçün schema/settings dəyəri və təsdiqlənmiş beynəlxalq nömrə layihədə yoxdur; yeni əlaqə məlumatı uydurulmayıb.

### Əlavə təhlükəsiz yoxlama (2026-10-13)

- İzolyasiya edilmiş production build uğurla tamamlandı; build müvəqqəti qovluğu silindikdən sonra Next.js-in `tsconfig.json` və `next-env.d.ts` fayllarına yazdığı həmin qovluğa aid iki stale istinad silindi. Başqa TypeScript parametrləri dəyişdirilmədi; müvəqqəti build qovluğu mövcud deyil.
- Dəyişdirilmiş faylların ESLint yoxlaması 0 xəta və 48 xəbərdarlıqla bitdi; xəbərdarlıqlar əsasən admin catch-all səhifəsindəki mövcud `any` tipləridir. Typecheck uğurludur.
- Admin, import/export, homepage, reporting, store/vendor management və returns testləri 52/52 keçdi. Yerli serverə yönələn admin authorization smoke test-i də mühafizə olunan POST-ların sessiyasız 403 qaytardığını təsdiqlədi.
- Browser-də ana səhifənin desktop və mobil header/footer renderi yoxlanıldı; yüklənməyən `<img>` tapılmadı. `/`, `/products` və `/admin/login` HTTP 200 qaytardı; bu, həmin səhifələrin və ya qorunan admin iş axınlarının tam E2E yoxlanması deyil. Logo upload/save, import, export və digər DB yazan axınlar sınaqdan keçirilmədi.
- Bu yoxlamalarda migration, seed və verilənlər bazasına yazı aparılmadı. Dev server konsolunda smooth-scroll attribute-i üçün Next.js xəbərdarlığı var; bu, admin dəyişikliklərinə aid deyil.
