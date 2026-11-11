"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type HeroBanner = {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  buttonLabel: string;
  href: string;
};

type Slide = {
  id: string;
  eyebrow: string;
  title: string;
  highlight: string;
  description: string;
  button: string;
  href: string;
  secondary: string;
  secondaryHref: string;
  image: string | null;
  imageAlt: string;
  // Focal point used when the photo is cropped to the wide strip shown below the xl breakpoint.
  imagePosition?: string;
  // Art-directed versions of the same scene for narrower viewports.
  sources?: { media: string; srcSet: string }[];
  visualLabel: string;
};

// All default slide photographs are local files in public/images/home (see the README there for
// sources and licences), so the hero never depends on a third-party image host.
const defaultSlides: Slide[] = [
  {
    id: "technology",
    eyebrow: "Elektronika",
    title: "Texnologiya ilə",
    highlight: "gününün rahatlığını seç.",
    description: "Smartfonlar, qulaqlıq və ev texnikası üçün BAGATI seçimləri bir məkanda.",
    button: "Məhsullara bax",
    href: "/products?category=elektronika",
    secondary: "Kateqoriyalar",
    secondaryHref: "/categories",
    image: "/images/home/hero-electronics-devices-desktop.webp",
    imageAlt: "Noutbuk, baş qulaqlığı, ağıllı saat, planşet, smartfon və qutusu ilə simsiz qulaqcıqlardan ibarət elektronika kompozisiyası",
    sources: [
      { media: "(max-width: 639px)", srcSet: "/images/home/hero-electronics-devices-mobile.webp" },
      { media: "(max-width: 1279px)", srcSet: "/images/home/hero-electronics-devices-tablet.webp" },
    ],
    visualLabel: "Texnologiya",
  },
  {
    id: "fashion",
    eyebrow: "Aksesuarlar",
    title: "Üslubuna",
    highlight: "öz toxunuşunu qat.",
    description: "Dəri çantalar, saatlar və aksesuarlar ilə gündəlik və xüsusi anlara uyğun seçimlər.",
    button: "Aksesuarları gör",
    href: "/products?category=aksesuarlar",
    secondary: "Mağazalar",
    secondaryHref: "/stores",
    image: "/images/home/hero-fashion-collection.webp",
    imageAlt: "Ağ fonda müxtəlif rəngli dəri əl çantaları kolleksiyası",
    imagePosition: "50% 55%",
    visualLabel: "Aksesuarlar",
  },
  {
    id: "home",
    eyebrow: "Ev və məişət",
    title: "Evin üçün",
    highlight: "rahat detal seç.",
    description: "Mebel, dekor və ev texnikası ilə daha keyfiyyətli, rahat bir yaşam sahəsi yarat.",
    button: "Ev məhsullarını kəşf et",
    href: "/products?category=ev-ve-meiset",
    secondary: "Bütün kateqoriyalar",
    secondaryHref: "/categories",
    image: "/images/home/hero-home.webp",
    imageAlt: "Divan, jurnal masası və puflar olan işıqlı qonaq otağı",
    imagePosition: "50% 68%",
    visualLabel: "Ev üçün",
  },
  {
    id: "beauty",
    eyebrow: "Gözəllik",
    title: "Özünə ayırdığın",
    highlight: "vaxtı gözəlləşdir.",
    description: "Parfüm, dəri qayğı və gündəlik güzəllik məhsullarını BAGATI-də tap.",
    button: "Gözəllik seçimi",
    href: "/products?category=gozellik-ve-saglamliq",
    secondary: "Yeni məhsullar",
    secondaryHref: "/new-products",
    image: "/images/home/hero-beauty-skincare.webp",
    imageAlt: "Damcılı serum şüşələri, krem qabları və sabundan ibarət dəriyə qulluq dəsti",
    imagePosition: "50% 78%",
    visualLabel: "Gözəllik",
  },
];

const controlButton =
  "inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/30 bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bagati-gold";

export function HeroCarousel({ banners = [] }: { banners?: HeroBanner[] }) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const touchStartX = useRef<number | null>(null);

  const slides: Slide[] = banners.length
    ? banners.map((banner, index) => {
        const visual = defaultSlides[index % defaultSlides.length];
        return {
          ...visual,
          id: banner.id,
          eyebrow: "BAGATI seçimi",
          title: banner.title,
          highlight: "",
          description: banner.description,
          button: banner.buttonLabel,
          href: banner.href,
          secondary: "Kateqoriyalar",
          secondaryHref: "/categories",
          image: banner.imageUrl || visual.image,
          imageAlt: banner.imageUrl ? banner.title || visual.imageAlt : visual.imageAlt,
          // An uploaded banner image is a single file: drop the default slide's art direction.
          imagePosition: banner.imageUrl ? undefined : visual.imagePosition,
          sources: banner.imageUrl ? undefined : visual.sources,
          visualLabel: visual.visualLabel,
        };
      })
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
      if (document.visibilityState === "visible") {
        setActive((value) => (value + 1) % slides.length);
      }
    }, 7000);
    return () => window.clearInterval(timer);
  }, [paused, interacting, reducedMotion, slides.length]);

  const slide = slides[active] ?? slides[0];
  const step = (delta: number) => setActive((value) => (value + delta + slides.length) % slides.length);

  return (
    <section
      role="region"
      tabIndex={0}
      aria-roledescription="karusel"
      aria-label="BAGATI alış-veriş təqdimatı"
      data-active-slide={slide.id}
      onMouseEnter={() => setInteracting(true)}
      onMouseLeave={() => setInteracting(false)}
      onFocusCapture={() => setInteracting(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setInteracting(false);
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          step(-1);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          step(1);
        }
      }}
      onTouchStart={(event) => {
        touchStartX.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        const startX = touchStartX.current;
        const endX = event.changedTouches[0]?.clientX;
        touchStartX.current = null;
        if (startX === null || endX === undefined || Math.abs(endX - startX) < 48) return;
        step(endX < startX ? 1 : -1);
      }}
      className="relative isolate overflow-hidden rounded-[28px] border border-bagati-border bg-[#102726] shadow-[0_20px_44px_rgba(23,58,58,.10)] outline-none focus-visible:ring-2 focus-visible:ring-bagati-gold focus-visible:ring-offset-2"
      style={{ touchAction: "pan-y" }}
    >
      {/* The photograph is not used as a text backdrop: below xl it has its own strip above the
          copy, from xl it fills the right-hand panel. No overlay or control covers the products. */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-[#e1ded7] sm:aspect-[5/2] lg:aspect-[3/1] xl:absolute xl:inset-y-0 xl:right-0 xl:aspect-auto xl:w-[58%]">
        {slide.image ? (
          <picture key={slide.id}>
            {slide.sources?.map((item) => <source key={item.media} media={item.media} srcSet={item.srcSet} />)}
            {/* Plain <img> inside <picture>: the sources are art-directed, pre-optimised WebP files. */}
            <img
              src={slide.image}
              alt={slide.imageAlt}
              decoding="async"
              draggable={false}
              className="absolute inset-0 h-full w-full object-cover"
              style={slide.imagePosition ? { objectPosition: slide.imagePosition } : undefined}
            />
          </picture>
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(243,233,213,0.7),_rgba(23,58,58,0.18)_45%,_rgba(23,58,58,0.75)_100%)]" />
        )}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 hidden w-[13%] bg-[linear-gradient(90deg,#102726_0%,rgba(16,39,38,0.62)_38%,rgba(16,39,38,0)_100%)] xl:block"
        />
      </div>

      {/* Fixed minimum heights keep the carousel from changing height between slides. */}
      <div className="relative z-10 flex min-h-[416px] flex-col justify-between gap-5 p-5 sm:min-h-[404px] sm:gap-6 sm:p-7 xl:min-h-[520px] xl:w-[45%] xl:p-9">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center rounded-full border border-white/25 bg-white/10 px-2.5 py-1 text-[.62rem] font-semibold uppercase tracking-[.18em] text-white/90">
            {slide.eyebrow}
          </span>
          <button
            type="button"
            aria-label={paused ? "Karuseli davam et" : "Karuseli dayandır"}
            onClick={() => setPaused((value) => !value)}
            className={controlButton}
          >
            {paused ? <Play aria-hidden="true" size={15} className="fill-current" /> : <Pause aria-hidden="true" size={15} className="fill-current" />}
          </button>
        </div>

        <div className="max-w-[560px]">
          <h1 className="font-serif text-[2.1rem] leading-[0.98] tracking-[-.055em] text-white sm:text-[2.75rem] xl:text-[3.25rem]">
            {slide.title}
            {slide.highlight && (
              <>
                <br />
                <span className="font-normal italic text-[#F2E8C8]">{slide.highlight}</span>
              </>
            )}
          </h1>
          <p className="mt-4 max-w-[32rem] text-sm leading-6 text-white/85 sm:text-base">{slide.description}</p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link href={slide.href} className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#F3E9D5] px-5 text-sm font-semibold text-[#173A3A] transition hover:bg-[#E8D7B7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F3E9D5]">
              {slide.button}
            </Link>
            <Link href={slide.secondaryHref} className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/35 bg-white/8 px-4 text-sm font-semibold text-white transition hover:bg-white/12 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F3E9D5]">
              {slide.secondary}
            </Link>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            {slides.map((item, index) => (
              <button
                key={item.id}
                type="button"
                aria-label={`${index + 1}. slayd`}
                aria-pressed={index === active}
                onClick={() => setActive(index)}
                className={`h-2.5 rounded-full transition-all duration-200 ${index === active ? "w-8 bg-[#F0E3BE]" : "w-2.5 bg-white/70 hover:bg-white"}`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="mr-1 hidden rounded-full border border-white/20 bg-white/10 px-2 py-1 text-[.62rem] font-medium uppercase tracking-[.18em] text-white/80 sm:inline-flex">
              {slide.visualLabel}
            </span>
            <button type="button" aria-label="Əvvəlki slayd" onClick={() => step(-1)} className={controlButton}>
              <ChevronLeft aria-hidden="true" size={18} />
            </button>
            <button type="button" aria-label="Növbəti slayd" onClick={() => step(1)} className={controlButton}>
              <ChevronRight aria-hidden="true" size={18} />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
