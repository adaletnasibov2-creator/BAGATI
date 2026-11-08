"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  ShoppingBag,
} from "lucide-react";
import { useEffect, useState } from "react";

type HeroProduct = {
  id: string;
  name: string;
  price: string;
  discountPrice: string | null;
  image: string | null;
  store: string;
};

type HeroBanner = {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  buttonLabel: string;
  href: string;
};

const defaultSlides = [
  {
    id: "technology",
    eyebrow: "TEXNOLOGİYA VƏ GÜNDƏLİK SEÇİMLƏR",
    title: "Texnologiya ilə",
    highlight: "gününə yenilik qat.",
    description: "Smartfon və audio seçimlərini yerli mağazaların məhsulları arasından araşdır.",
    button: "Məhsulları kəşf et",
    href: "/products",
    image: "/images/home/hero-tech.webp",
    imageAlt: "İsti neytral fonda smartfon, ağıllı saat, simsiz qulaqlıqlar və ağ qulaqüstü qulaqlıq",
    visualLabel: "Texnologiya və elektronika",
    imagePosition: "left center",
  },
  {
    id: "fashion",
    eyebrow: "ÜSLUBUNA UYĞUN SEÇİMLƏR",
    title: "Gündəlik üslubuna",
    highlight: "öz toxunuşunu əlavə et.",
    description: "Çanta və aksesuarları müxtəlif mağazalarda kəşf et, sənə uyğun olanı seç.",
    button: "Mağazalara bax",
    href: "/stores",
    image: "/images/home/hero-fashion.webp",
    imageAlt: "Boz, karamel və bej tonlarında bir arada düzülmüş üç dəri çanta",
    visualLabel: "Çantalar və aksesuarlar",
    imagePosition: "center 50%",
  },
  {
    id: "home",
    eyebrow: "EV ÜÇÜN ZÖVQLÜ DETALLAR",
    title: "Məkanına yeni",
    highlight: "nəfəs gətir.",
    description: "Dekor və gündəlik ev əşyalarını bir yerdə araşdır, sevdiyin detalları tap.",
    button: "Kateqoriyaları kəşf et",
    href: "/categories",
    image: "/images/home/hero-home.webp",
    imageAlt: "Təbii tonlarda işıqlı qonaq otağı və ev dekoru",
    visualLabel: "Ev və dekor",
    imagePosition: "center 55%",
  },
];

export function HeroCarousel({ products, banners = [] }: { products: HeroProduct[]; banners?: HeroBanner[] }) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const slides = banners.length
    ? banners.map((banner) => ({
        id: banner.id,
        eyebrow: "BAGATI KAMPANİYASI",
        title: banner.title,
        highlight: "",
        description: banner.description,
        button: banner.buttonLabel,
        href: banner.href,
        image: banner.imageUrl,
        imageAlt: banner.title,
        visualLabel: "Xüsusi təklif",
        imagePosition: "center",
      }))
    : defaultSlides;

  useEffect(() => {
    setActive((value) => value % slides.length);
  }, [slides.length]);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReducedMotion(preference.matches);
    updatePreference();
    preference.addEventListener("change", updatePreference);
    return () => preference.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    if (paused || interacting || reducedMotion) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") setActive((value) => (value + 1) % slides.length);
    }, 7000);
    return () => window.clearInterval(timer);
  }, [paused, interacting, reducedMotion, slides.length]);

  const slide = slides[active];
  const step = (delta: number) => setActive((value) => (value + delta + slides.length) % slides.length);

  return (
    <section
      role="region"
      aria-roledescription="karusel"
      aria-label="BAGATI alış-veriş təqdimatı"
      onMouseEnter={() => setInteracting(true)}
      onMouseLeave={() => setInteracting(false)}
      onFocusCapture={() => setInteracting(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setInteracting(false);
      }}
      className="relative isolate overflow-hidden rounded-[24px] bg-[#F0F2EB] shadow-[0_24px_64px_rgba(23,58,58,.12)] sm:rounded-[32px]"
    >
      <div className="grid xl:min-h-[470px] xl:grid-cols-[.96fr_1.04fr]">
        <div className="relative order-last flex min-h-[350px] flex-col justify-center px-5 pb-[4.25rem] pt-6 sm:min-h-[390px] sm:px-9 sm:py-9 xl:order-first xl:min-h-[470px] xl:px-10 lg:px-12">
          <div key={active} className="relative z-10 max-w-[560px] animate-[hero-fade-in_.35s_ease-out]">
            <p className="flex items-center gap-2 text-[.68rem] font-bold tracking-[.16em] text-[#58786D] sm:text-xs">
              <span className="h-px w-7 bg-[#C79A52]" />{slide.eyebrow}
            </p>
            <h1 className="mt-4 text-[2.15rem] font-semibold leading-[1.05] tracking-[-.05em] text-[#173A3A] sm:mt-5 sm:text-5xl xl:text-[3.6rem]">
              {slide.title}{slide.highlight && <><br /><span className="font-serif font-normal italic tracking-[-.035em] text-[#638078]">{" "}{slide.highlight}</span></>}
            </h1>
            <p className="mt-4 max-w-[430px] text-[.93rem] leading-7 text-[#566B65] sm:mt-5 sm:text-base sm:leading-7">{slide.description}</p>
            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 sm:mt-6">
              <Link href={slide.href} className="inline-flex min-h-12 items-center gap-2 rounded-full bg-[#174746] px-6 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(23,58,58,.18)] transition hover:bg-[#23635D] sm:min-h-[52px] sm:px-7">
                {slide.button}<ChevronRight aria-hidden="true" size={16} />
              </Link>
              <Link href="/deals" className="inline-flex min-h-11 items-center text-sm font-semibold text-[#46645D] transition hover:text-[#2F6F68]">Endirimlərə bax <ChevronRight aria-hidden="true" size={16} /></Link>
            </div>
          </div>

          {active === 0 && products.length > 0 && (
            <div className="relative z-10 mt-5 hidden grid-cols-2 gap-2.5 sm:mt-6 sm:grid sm:gap-3">
              {products.slice(0, 2).map((product) => <HeroProductTile key={product.id} product={product} />)}
            </div>
          )}

          <div className="absolute bottom-3 left-4 z-20 flex items-center gap-1 rounded-full border border-[#E1EAE5] bg-white/95 px-1.5 py-1 shadow-sm backdrop-blur sm:bottom-4 sm:left-8 md:left-9 lg:left-12">
            {slides.map((item, index) => (
              <button key={item.id} type="button" onClick={() => setActive(index)} aria-label={`${index + 1}-ci bannerə keç`} aria-current={index === active ? "true" : undefined} className="grid min-h-11 min-w-11 place-items-center rounded-full">
                <span aria-hidden="true" className={index === active ? "h-1.5 w-5 rounded-full bg-[#638078] transition-all" : "h-1.5 w-1.5 rounded-full bg-[#A3AEAA] transition-all"} />
              </button>
            ))}
            <button type="button" onClick={() => setPaused((value) => !value)} aria-label={paused || reducedMotion ? "Banner keçidini başladın" : "Banner keçidini dayandırın"} aria-pressed={paused || reducedMotion} disabled={reducedMotion} className="grid h-11 w-11 place-items-center rounded-full text-[#24413D] hover:bg-[#F1F5F2] disabled:cursor-not-allowed disabled:opacity-60">
              {paused || reducedMotion ? <Play size={13} fill="currentColor" /> : <Pause size={13} />}
            </button>
          </div>
        </div>

        <div className="relative order-first h-[250px] overflow-hidden bg-[#F6F1E8] sm:h-[310px] md:h-[min(60vw,520px)] xl:order-last xl:h-auto xl:min-h-[470px]">
          <div aria-hidden="true" className="absolute inset-0 bg-[#F6F1E8]" />
          <div className="absolute inset-0 z-[1]">
            <Image key={slide.image} src={slide.image} alt={slide.imageAlt} fill priority loading="eager" sizes="(max-width: 768px) 100vw, 54vw" unoptimized={/^https?:\/\//i.test(slide.image)} style={{ objectPosition: slide.imagePosition }} className="object-cover" />
          </div>
          <div className="absolute left-4 top-4 z-10 inline-flex min-h-10 items-center gap-2 rounded-full border border-white/60 bg-white/90 px-4 text-xs font-bold text-[#24413D] shadow-sm backdrop-blur sm:left-6 sm:top-6">
            <ShoppingBag aria-hidden="true" size={15} className="text-[#8A6A37]" />{slide.visualLabel}
          </div>
          <div className="absolute right-4 top-4 z-10 flex gap-2 sm:right-6 sm:top-6">
            <button type="button" onClick={() => step(-1)} aria-label="Əvvəlki banner" className="grid h-11 w-11 place-items-center rounded-full border border-white/70 bg-white/90 text-[#24413D] shadow-sm backdrop-blur transition hover:bg-white"><ChevronLeft size={18} /></button>
            <button type="button" onClick={() => step(1)} aria-label="Növbəti banner" className="grid h-11 w-11 place-items-center rounded-full border border-white/70 bg-white/90 text-[#24413D] shadow-sm backdrop-blur transition hover:bg-white"><ChevronRight size={18} /></button>
          </div>
          <div className="absolute bottom-4 left-4 z-10 rounded-xl border border-white/25 bg-[#173A3A]/65 px-3.5 py-2.5 text-xs font-medium tracking-wide text-white backdrop-blur-md sm:bottom-6 sm:left-6 sm:px-4 sm:text-sm">
            BAGATI <span className="mx-1 text-[#E6D8BD]">/</span> {slide.visualLabel}
          </div>
        </div>
      </div>
      <span className="sr-only" aria-live="polite">{slide.eyebrow}: {slide.title} {slide.highlight}</span>
    </section>
  );
}

function HeroProductTile({ product }: { product: HeroProduct }) {
  const hasDiscount = product.discountPrice !== null && Number(product.discountPrice) > 0 && Number(product.discountPrice) < Number(product.price);
  return (
    <Link href={`/products/${product.id}`} className="group grid min-w-0 grid-cols-[54px_minmax(0,1fr)] items-center gap-2 overflow-hidden rounded-[15px] border border-white/80 bg-white/95 p-1.5 shadow-[0_10px_25px_rgba(11,23,38,.12)] backdrop-blur-sm transition hover:-translate-y-0.5 hover:shadow-[0_16px_32px_rgba(11,23,38,.17)] sm:grid-cols-[62px_minmax(0,1fr)] sm:gap-2.5 sm:p-2">
      <div className="relative aspect-square overflow-hidden rounded-[10px] bg-[#F1F4F5]">
        {product.image ? <Image src={product.image} alt={product.name} fill unoptimized={/^https?:\/\//i.test(product.image)} sizes="(max-width: 640px) 42vw, 220px" className="object-contain p-1.5 transition duration-300 group-hover:scale-[1.025]" /> : <div className="flex h-full flex-col items-center justify-center gap-2 text-[#8A8E91]"><ShoppingBag size={21} strokeWidth={1.4} /><span className="text-[.62rem]">Şəkil yoxdur</span></div>}
      </div>
      <div className="min-w-0 py-1 pr-1">
        <p className="truncate text-[.57rem] text-[#667085] sm:text-[.62rem]">{product.store}</p>
        <p className="mt-0.5 line-clamp-2 text-[.64rem] font-semibold leading-4 text-[#16202C] sm:text-[.7rem]">{product.name}</p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
          <span className="text-[.68rem] font-bold text-[#173A3A] sm:text-xs">{hasDiscount ? product.discountPrice : product.price} ₼</span>
          {hasDiscount && <span className="text-[.58rem] text-[#667085] line-through">{product.price} ₼</span>}
        </div>
      </div>
    </Link>
  );
}
