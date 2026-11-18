import type { Metadata } from "next";
import Link from "next/link";
import { absoluteSiteUrl } from "@/lib/category-seo";

// Seller agreement, final text of 2026-11-18 (owner, v2). Static text in code: no database read in this page.
// Public since Phase B (consent checkboxes): indexed, linked from the footer and from /terms section 9.
// Changing this text requires a new LEGAL_VERSIONS.SELLER_TERMS (lib/legal-versions.ts; scripts/legal-versions.test.ts).
const title = "Satıcı şərtləri";
const description = "BAGATI-də mağaza açan və məhsul satan satıcılar üçün şərtlər: abunə haqqı, komissiya, ödəniş, məhsul məlumatı, sifariş, qaytarma və mağazanın dayandırılması.";

export function generateMetadata(): Metadata {
  const canonical = absoluteSiteUrl("/seller-terms");
  return { title, description, robots: { index: true, follow: true }, ...(canonical ? { alternates: { canonical } } : {}) };
}

const h2 = "mt-4 text-xl font-semibold text-bagati-deep";
const link = "font-medium text-bagati-primary underline underline-offset-2";

export default function SellerTermsPage() {
  return <div className="container py-10 sm:py-14">
    <article className="mx-auto max-w-3xl rounded-[24px] border border-[#E5E9E5] bg-white p-6 shadow-[0_10px_28px_rgba(23,58,58,.05)] sm:p-10">
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[#173A3A]">{title}</h1>
      <div className="mt-5 grid gap-4 text-sm leading-7 text-bagati-secondary sm:text-base">
        <p><strong>Bu şərtlər BAGATI-də mağaza açan və məhsul satan satıcılar üçündür.</strong> Satıcı müraciətini göndərməklə və razılıq xanasını işarələməklə bu şərtləri qəbul etmiş olursunuz. Alıcılar üçün qaydalar <Link href="/terms" className={link}>İstifadə şərtləri</Link> səhifəsindədir. Platformanı fərdi sahibkar Nəsibov Ədalət Şücaət oğlu (VÖEN 4202455532, Qazax şəhəri) idarə edir.</p>

        <h2 className={h2}>1. Kim satıcı ola bilər</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>Satıcı VÖEN-i olan fərdi sahibkar və ya hüquqi şəxsdir. VÖEN və hüquqi məlumatlar doğru olmalıdır.</li>
          <li>Müraciətiniz yoxlanılır. Yalan və ya natamam məlumat verildikdə müraciət rədd edilə bilər.</li>
          <li>Bir satıcının bir neçə mağazası ola bilər. Hər mağaza bu şərtlərə tabedir.</li>
        </ul>

        <h2 className={h2}>2. Abunə haqqı</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>Mağaza paketlə fəaliyyət göstərir: BASIC 20 AZN, PRO 50 AZN (ödəniş dövrü paket səhifəsində göstərilir).</li>
          <li>Abunə müddəti bitdikdə və yenilənmədikdə mağaza və onun məhsulları saytda görünmür. Məlumatlarınız silinmir və abunə yeniləndikdə mağaza yenidən görünür.</li>
          <li>Haqlar və paketlərin imkanları dəyişə bilər. Dəyişiklik barədə əvvəlcədən xəbər veriləcək.</li>
        </ul>

        <h2 className={h2}>3. Komissiya və ödəniş xidməti haqqı</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>Onlayn ödəniş aktiv olduqdan sonra hər satışdan platformanın komissiyası tutulur: standart 10 %. Komissiya satış məbləğindən hesablanır.</li>
          <li>Onlayn ödənişi lisenziyalı ödəniş xidməti Epoint həyata keçirir. Onlayn ödəniş aktiv olduqda ödənişin ümumi məbləğindən 3 % xidmət haqqı tutulur. Bunun 1,5 %-i satıcının, 1,5 %-i platformanın payıdır.</li>
          <li>Hər halda sifariş üzrə hesablama məbləği alıcıya göstərilən sifariş məbləğinə əsaslanır. Alıcıdan əlavə komissiya alınmır.</li>
        </ul>

        <h2 className={h2}>4. Ödəniş və pulun bölünməsi</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>Onlayn ödəniş aktiv olduqda satıcının öz Epoint hesabı olmalıdır. Hesabı olmayan mağaza saytda qala bilər, amma onun sifarişləri onlayn ödənilə bilməz.</li>
          <li>Onlayn ödəniş aktiv olduqda hər mağaza sifarişi ayrıca ödənilir. Ödənilən məbləğ Epoint tərəfindən satıcı ilə platforma arasında bölünür.</li>
          <li>Onlayn ödəniş aktiv olduqda bir mağaza sifarişi üçün ödəniş xidmətinin təyin etdiyi limit tətbiq olunur (hazırda 500 AZN).</li>
          <li>Onlayn ödəniş aktiv olmayan müddətdə sifarişlər „Ödəniş gözləyir“ statusu ilə qeyd olunur və ödəniş satıcı ilə alıcı arasında razılaşdırılır.</li>
        </ul>

        <h2 className={h2}>5. Vergi və hesabat</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>Satıcı öz gəlirinə və vergi öhdəliklərinə özü cavabdehdir. Platforma satıcının vergi məsələlərində iştirak etmir.</li>
          <li>Satıcı lazım gəldikdə məhsulun və satışın qanuniliyini təsdiq edən sənədləri təqdim etməlidir.</li>
        </ul>

        <h2 className={h2}>6. Məhsul məlumatı</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>Məhsulun adı, təsviri, şəkli, qiyməti və stoku doğru və aktual olmalıdır.</li>
          <li>Qiymət manatla (AZN) göstərilir. Göstərilən qiymət sifariş verildikdən sonra dəyişdirilmir.</li>
          <li>Başqasının şəklini və mətnini icazəsiz istifadə etmək olmaz.</li>
          <li>Qanunla satışı qadağan olunmuş və ya məhdudlaşdırılmış məhsulları satmaq olmaz. Buraya saxta və ya orijinal olmayan məhsulu orijinal kimi satmaq, silah, narkotik və digər qadağan olunmuş mallar daxildir.</li>
          <li>Məhsullar platformada əvvəlcədən təsdiq olunmur, ona görə məhsula görə məsuliyyəti birbaşa satıcı daşıyır.</li>
        </ul>

        <h2 className={h2}>7. Sifariş və çatdırılma</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>Sifariş gəldikdə vaxtında qəbul edib hazırlamaq lazımdır.</li>
          <li>Çatdırılma haqqını, şərtlərini və üsulunu mağaza özü təyin edir və mağaza səhifəsində göstərir.</li>
          <li>Stokda olmayan və ya səhv qiymətlə göstərilmiş məhsul üçün sifarişi alıcını xəbərdar etməklə ləğv etmək olar. Ödəniş edilibsə, məbləğ alıcıya qaytarılır.</li>
        </ul>

        <h2 className={h2}>8. Qaytarma və geri ödəmə</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>Qaytarma qaydasını mağaza özü təyin edir və alıcıya əvvəlcədən bildirir. Bu qayda qanunla alıcıya verilən hüquqları məhdudlaşdırmır.</li>
          <li>Qaytarma sorğusuna vaxtında cavab verilməlidir. Mübahisə yaranarsa, platforma müraciətə baxa bilər.</li>
          <li>Onlayn ödəniş aktiv olduqda qəbul edilmiş qaytarmada geri ödənən məbləğ satıcının payından tutulur. Platformanın komissiyasının qaytarmada necə hesablanması ödəniş xidmətinin qaydalarına uyğun müəyyən edilir.</li>
        </ul>

        <h2 className={h2}>9. Alıcılarla mesajlaşma</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>Alıcıların mesajlarına nəzakətlə və mümkün qədər tez cavab verin.</li>
          <li>Spam, təhqir, aldadıcı təklif və alıcını platformadan kənar ödənişə yönəltmək qadağandır.</li>
          <li>Təhlükəsizlik üçün mesajda telefon və e-poçt paylaşmaq məhdudlaşdırıla bilər.</li>
          <li>Şikayət olunan söhbətə platforma yalnız yoxlama məqsədilə baxa bilər. Hər belə baxış jurnalda qeyd olunur.</li>
        </ul>

        <h2 className={h2}>10. Alıcıların məlumatları</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>Sifarişlə sizə verilən alıcı məlumatları (ad, telefon, ünvan) yalnız sifarişi hazırlamaq və çatdırmaq üçün istifadə olunmalıdır.</li>
          <li>Bu məlumatları üçüncü tərəflərə vermək, satmaq və reklam üçün istifadə etmək qadağandır.</li>
        </ul>

        <h2 className={h2}>11. Mağazanın dayandırılması</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>Qaydaları pozan, alıcılardan əsaslı şikayət gələn və ya aldatma əlamətləri olan mağaza müvəqqəti və ya tamamilə dayandırıla bilər.</li>
          <li>Satıcı da istənilən vaxt mağazasını bağlamaq üçün bizə yaza bilər. Bağlanmadan əvvəl icra olunmamış sifarişlər yerinə yetirilməlidir.</li>
        </ul>

        <h2 className={h2}>12. Məsuliyyət</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>Satıcı məhsulun keyfiyyətinə, qanuniliyinə, çatdırılmasına və qaytarılmasına görə alıcı qarşısında məsuliyyət daşıyır.</li>
          <li>Platforma texniki fasilələrə və üçüncü tərəflərin (ödəniş xidməti, bank, internet) səbəb olduğu gecikmələrə görə məsuliyyət daşımır.</li>
        </ul>

        <h2 className={h2}>13. Tətbiq olunan hüquq</h2>
        <p>Bu şərtlərə Azərbaycan Respublikasının qanunvericiliyi tətbiq olunur. Problem yaranarsa, əvvəl <Link href="/contact" className={link}>Əlaqə</Link> üzrə bizə yazın; razılaşma baş tutmasa, mübahisə qanunvericilikdə nəzərdə tutulan qaydada həll olunur.</p>

        <h2 className={h2}>14. Şərtlərin dəyişdirilməsi</h2>
        <p>Şərtləri yeniləyə bilərik. Əsaslı dəyişiklik barədə satıcılara e-poçtla xəbər verəcəyik. Yeni variant dərc olunandan sonra mağazanı istifadə etməyə davam etmək yeni şərtlərin qəbulu sayılır.</p>
        <p>Son yenilənmə: 18 noyabr 2026.</p>
      </div>
    </article>
  </div>;
}
