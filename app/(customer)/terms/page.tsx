import type { Metadata } from "next";
import { TextLink } from "@/components/ui/text-link";
import { absoluteSiteUrl } from "@/lib/category-seo";
import { LegalDocument } from "@/components/legal-document";

// Legal page, final text of 2026-11-17 (owner). Static text in code: no database read in this page.
const title = "İstifadə şərtləri";
const description = "BAGATI alıcılarla mağazaları bir araya gətirən platformadır; məhsulu müvafiq mağaza satdığı üçün alış-veriş müqaviləsi siz və mağaza arasında bağlanır.";

export function generateMetadata(): Metadata {
  const canonical = absoluteSiteUrl("/terms");
  return { title, description, robots: { index: true, follow: true }, ...(canonical ? { alternates: { canonical } } : {}) };
}


export default function TermsPage() {
  // DESIGN-T9: shared reading layout; the document below is unchanged (only class names were removed from it).
  return <LegalDocument title={title}>
        <p><strong>BAGATI alıcılarla mağazaları bir araya gətirən platformadır; məhsulu müvafiq mağaza satdığı üçün alış-veriş müqaviləsi siz və mağaza arasında bağlanır.</strong> Saytdan istifadə etməklə bu şərtləri qəbul etmiş sayılırsınız. Platformanı fərdi sahibkar Nəsibov Ədalət Şücaət oğlu (VÖEN 4202455532, Qazax şəhəri) idarə edir.</p>

        <h2>1. Platformamızın rolu</h2>
        <ul>
          <li>BAGATI mağazaların məhsullarını göstərir, sifarişi mağazaya ötürür və ödəniş, mesajlaşma kimi alətlər təqdim edir.</li>
          <li>Məhsulun təsviri, qiyməti, keyfiyyəti, stoku, çatdırılması və qaytarma şərtlərinə görə birbaşa mağaza məsuliyyət daşıyır.</li>
          <li>Biz mağazaları qeydiyyat zamanı VÖEN məlumatı ilə yoxlayırıq, amma hər məhsulu özümüz yoxlamırıq.</li>
        </ul>

        <h2>2. Hesab</h2>
        <ul>
          <li>Hesab açmaq üçün 18 yaşınız tamam olmalı və məlumatlarınız doğru olmalıdır.</li>
          <li>Hesabınızın təhlükəsizliyinə siz cavabdehsiniz. Şifrə və təsdiq kodlarını başqasına verməyin.</li>
          <li>Qaydaları pozan, aldatma və ya sui-istifadə əlamətləri olan hesabı müvəqqəti və ya tamamilə dayandıra bilərik.</li>
        </ul>

        <h2>3. Sifariş və qiymət</h2>
        <ul>
          <li>Saytdakı qiymətlər Azərbaycan manatı ilə (AZN) göstərilir.</li>
          <li>Sifariş verdikdə görünən qiymət, çatdırılma haqqı və ümumi məbləğ sifarişdə dərhal qeyd olunur və sonradan dəyişdirilmir.</li>
          <li>Bir səbətdə bir neçə mağazanın məhsulu ola bilər. Hər mağaza üçün ayrı sifariş yaradılır və ayrıca çatdırılır.</li>
          <li>Stokda olmayan və ya səhv qiymətlə göstərilən məhsul üçün mağaza sifarişi əvvəlcədən xəbərdar etməklə ləğv edə bilər; ödəniş edilibsə, ödədiyiniz məbləğ geri qaytarılır.</li>
        </ul>

        <h2>4. Ödəniş</h2>
        <ul>
          <li>Onlayn ödəniş aktiv olduqda ödəniş lisenziyalı ödəniş xidməti Epoint vasitəsilə həyata keçirilir. Kart məlumatlarını biz görmürük və saxlamırıq. Onlayn ödəniş aktiv olmayan müddətdə sifariş „Ödəniş gözləyir“ statusu ilə qeyd olunur.</li>
          <li>Onlayn ödəniş aktiv olduqda hər mağaza sifarişi ayrıca ödənilir. Məbləğ mağazaya və platformaya ödəniş xidməti tərəfindən bölünür. Siz yalnız sifarişdə göstərilən məbləği ödəyirsiniz, əlavə komissiya alınmır.</li>
          <li>Bir ödəniş üçün ödəniş xidmətinin təyin etdiyi məbləğ limiti var (hazırda 500 AZN). Bu limitdən çox olan mağaza sifarişini bir dəfəyə vermək mümkün olmaya bilər.</li>
          <li>Ödəniş tamamlanmayan sifariş müəyyən müddətdən sonra avtomatik ləğv oluna bilər.</li>
        </ul>

        <h2>5. Çatdırılma</h2>
        <ul>
          <li>Çatdırılma haqqı, şərtləri və üsulu hər mağazanın özünə məxsusdur və mağaza səhifəsində və səbətdə göstərilir.</li>
          <li>Sifarişin vəziyyətini hesabınızdakı „Sifarişlərim“ bölməsindən izləyə bilərsiniz.</li>
          <li>Düzgün ünvan və telefon nömrəsi yazmaq sizin məsuliyyətinizdir.</li>
        </ul>

        <h2>6. Qaytarma və geri ödəniş</h2>
        <ul>
          <li>Qaytarma şərtləri mağazalar üzrə fərqlənə bilər. Alışdan əvvəl mağazadan soruşun və ya mağaza ilə mesajlaşın.</li>
          <li>Qaytarma sorğusunu hesabınızdakı „Qaytarılma sorğuları“ bölməsindən göndərə bilərsiniz. Mağaza sorğunu qəbul və ya rədd edə bilər; mübahisə yaranarsa, platforma müraciətinə baxa bilər.</li>
          <li>Qəbul edilmiş qaytarmada ödənilmiş məbləğ geri qaytarılır. Qaytarma üsulu və müddəti ödəniş üsulundan, ödəniş xidmətindən və bankdan asılıdır.</li>
          <li>Azərbaycan qanunvericiliyi istehlakçıların hüquqlarını qoruyur; bu şərtlər həmin hüquqları məhdudlaşdırmır.</li>
        </ul>

        <h2>7. Mağaza ilə mesajlaşma</h2>
        <ul>
          <li>Mesajlaşma alıcı ilə mağaza arasında məhsul, sifariş və mağaza sualı üçündür.</li>
          <li>Haqsız, təhqiredici, aldadıcı və ya spam mesaj göndərmək qadağandır. Saatda göndərilə bilən mesaj sayı məhdudlaşdırılıb.</li>
          <li>Təhlükəsizlik üçün mesajda telefon nömrəsi və e-poçt paylaşmaq məhdudlaşdırıla bilər.</li>
          <li>Hər tərəf mesajı şikayət edə bilər. Şikayət olunan söhbətlərə yalnız yoxlama məqsədilə baxdığımız qeyd olunur.</li>
        </ul>

        <h2>8. Qadağan olunan hərəkətlər</h2>
        <ul>
          <li>Saxta məlumatla qeydiyyat, başqasının hesabından istifadə.</li>
          <li>Saytın işini pozmaq, avtomatik sorğularla yükləmək, təhlükəsizlik mühafizəsini aşmaq.</li>
          <li>Qanuna zidd olan, aldadıcı və ya üçüncü şəxsin hüquqlarını pozan məzmun yerləşdirmək.</li>
        </ul>

        <h2>9. Satıcılar üçün</h2>
        <p>Satıcılar ayrıca <TextLink href="/seller-terms">satıcı şərtlərini</TextLink> qəbul edir. Onlar məhsul məlumatının doğruluğuna, stokuna, çatdırılmasına, qaytarma qaydasına və vergi öhdəliklərinə görə özləri məsuliyyət daşıyır.</p>

        <h2>10. Məsuliyyətin həddi</h2>
        <p>Biz platformanın fasiləsiz işləməsinə çalışırıq, amma texniki işlər və ya üçüncü tərəflərin (ödəniş xidməti, bank, internet) səbəbindən fasilələr ola bilər. Mağazanın öz məhsulu və xidməti üzrə öhdəliklərinə görə platforma məsuliyyət daşımır.</p>

        <h2>11. Tətbiq olunan hüquq və mübahisələr</h2>
        <p>Bu şərtlərə Azərbaycan Respublikasının qanunvericiliyi tətbiq olunur. Problem yaranarsa, əvvəl <TextLink href="/contact">Əlaqə</TextLink> üzrə bizə yazın; razılaşma baş tutmasa, mübahisə qanunvericilikdə nəzərdə tutulan qaydada həll olunur.</p>

        <h2>12. Şərtlərin dəyişdirilməsi</h2>
        <p>Şərtləri vaxtaşırı yeniləyə bilərik. Yeni variant bu səhifədə dərc olunan andan qüvvəyə minir. Son yenilənmə: 17 noyabr 2026.</p>
  </LegalDocument>;
}
