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
      // Square for phones: the 4:3 flat-lay with its plain background continued above and below (no device cropped).
      { media: "(max-width: 639px)", srcSet: "/images/home/hero-electronics-devices-square.webp" },
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
    href: "/products?category=ev-ve-mesiet",
    // Same label as slide 1, so both buttons fit on one line on a 390 px phone (the longer one wrapped below the fold).
    secondary: "Kateqoriyalar",
    secondaryHref: "/categories",
    // Art-directed crops of hero-home.webp, each centred on the room (57-70 KB instead of 348 KB).
    image: "/images/home/hero-home-desktop.webp",
    imageAlt: "Divan, jurnal masası və puflar olan işıqlı qonaq otağı",
    sources: [
      { media: "(max-width: 639px)", srcSet: "/images/home/hero-home-mobile.webp" },
      { media: "(max-width: 1279px)", srcSet: "/images/home/hero-home-tablet.webp" },
    ],
    visualLabel: "Ev üçün",
  },
  {
    id: "beauty",
    eyebrow: "Gözəllik",
    title: "Özünə ayırdığın",
    highlight: "vaxtı gözəlləşdir.",
    description: "Parfüm, dəri qayğı və gündəlik güzəllik məhsullarını BAGATI-də tap.",
    button: "Gözəllik seçimi",
    href: "/products?category=gozellik",
    secondary: "Yeni məhsullar",
    secondaryHref: "/new-products",
    image: "/images/home/hero-beauty-skincare.webp",
    imageAlt: "Damcılı serum şüşələri, krem qabları və sabundan ibarət dəriyə qulluq dəsti",
    imagePosition: "50% 78%",
    visualLabel: "Gözəllik",
  },
];

const controlButton =
  "inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/30 bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bagati-gold motion-reduce:transition-none";

/** Time each slide stays before autoplay moves on (owner decision 2026-11-16). */
export const HERO_AUTOPLAY_MS = 6000;
/** Crossfade length; matches the opacity transition class on the images. */
const CROSSFADE_MS = 500;

/** At most this many slides in the hero (the home page also reads at most 8 active banners). */
export const HERO_MAX_SLIDES = 8;

export type HeroSlide = Slide;

/**
 * The hero's slides (owner decision 2026-11-19): the active admin banners first, in the order the page passes them
 * (Sıra, then newest), then the built-in slides in their own order, until HERO_MAX_SLIDES. With no banners the hero
 * is the 4 built-in slides as before; with 8 or more banners only banners are shown.
 * Uploaded banners keep the T5 rules: fixed eyebrow and secondary button, no default label pill, decorative alt.
 * Built-in slides keep their labels and art-directed images. Pure, so it is unit-tested directly.
 */
export function buildHeroSlides(banners: HeroBanner[], max = HERO_MAX_SLIDES): Slide[] {
  const uploaded: Slide[] = banners.slice(0, max).map((banner, index) => {
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
      // Uploaded art sits next to the live title, so it is decorative (alt=""); a default photo keeps its alt.
      imageAlt: banner.imageUrl ? "" : visual.imageAlt,
      // An uploaded banner image is a single file: drop the default slide's art direction.
      imagePosition: banner.imageUrl ? undefined : visual.imagePosition,
      sources: banner.imageUrl ? undefined : visual.sources,
      // The default slide's label ("Texnologiya", ...) belongs to its photo, not to an uploaded banner.
      visualLabel: banner.imageUrl ? "" : visual.visualLabel,
    };
  });
  return [...uploaded, ...defaultSlides.slice(0, Math.max(0, max - uploaded.length))];
}

export function HeroCarousel({ banners = [] }: { banners?: HeroBanner[] }) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  // False until hydration: autoplay and preloading only start once the carousel can react.
  const [hydrated, setHydrated] = useState(false);
  const [tabHidden, setTabHidden] = useState(false);
  // Slides whose image is in the DOM (the first one from the server; the next one is added ahead of time).
  const [rendered, setRendered] = useState<ReadonlySet<number>>(() => new Set([0]));
  const [loaded, setLoaded] = useState<ReadonlySet<number>>(() => new Set());
  // The slide whose image is fully visible underneath; the active one fades in on top of it once loaded.
  const [shown, setShown] = useState(0);
  const touchStartX = useRef<number | null>(null);

  const slides = buildHeroSlides(banners);

  useEffect(() => {
    setActive((value) => value % slides.length);
  }, [slides.length]);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReducedMotion(preference.matches);
    const updateVisibility = () => setTabHidden(document.visibilityState !== "visible");
    updatePreference();
    updateVisibility();
    setHydrated(true);
    preference.addEventListener("change", updatePreference);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
      preference.removeEventListener("change", updatePreference);
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);

  // Keep the active slide and the one after it in the DOM, so the next photo is already downloaded when it is due.
  useEffect(() => {
    if (!hydrated) return;
    setRendered((current) => {
      const next = (active + 1) % slides.length;
      if (current.has(active) && current.has(next)) return current;
      return new Set([...current, active, next]);
    });
  }, [hydrated, active, slides.length]);

  // Once the active image has loaded and faded in, it becomes the image underneath for the next change.
  const activeReady = loaded.has(active) || !slides[active]?.image;
  useEffect(() => {
    if (!activeReady || shown === active) return;
    const timer = window.setTimeout(() => setShown(active), reducedMotion ? 0 : CROSSFADE_MS);
    return () => window.clearTimeout(timer);
  }, [activeReady, active, shown, reducedMotion]);

  const markLoaded = (index: number) => setLoaded((current) => (current.has(index) ? current : new Set([...current, index])));

  // Autoplay is driven by the progress fill in the active dot: its animationend moves to the next slide, so a hover or
  // focus pause freezes the fill and the timer together. Never runs under reduced motion.
  const autoplay = hydrated && !reducedMotion && slides.length > 1;
  const autoplayRunning = autoplay && !paused && !interacting && !tabHidden;

  const slide = slides[active] ?? slides[0];
  const step = (delta: number) => setActive((value) => (value + delta + slides.length) % slides.length);
  // One pause button: in the eyebrow row from 640 px, in the controls row on phones (so the buttons of the slide stay
  // above the bottom tab bar on a 390 x 844 phone). Only one of the two is ever displayed.
  const pauseButton = (
    <button
      type="button"
      aria-label={paused ? "Karuseli davam et" : "Karuseli dayandır"}
      onClick={() => setPaused((value) => !value)}
      className={controlButton}
    >
      {paused ? <Play aria-hidden="true" size={15} className="fill-current" /> : <Pause aria-hidden="true" size={15} className="fill-current" />}
    </button>
  );

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
      className="relative isolate overflow-hidden rounded-feature bg-brand-900 shadow-overlay outline-none focus-visible:ring-2 focus-visible:ring-bagati-gold focus-visible:ring-offset-2"
      style={{ touchAction: "pan-y" }}
    >
      {/* The photograph is not used as a text backdrop: below xl it has its own strip above the
          copy, from xl it fills the right-hand panel. No overlay or control covers the products. */}
      {/* Hero sizes (owner, 2026-11-16): image 4:3 on phones (so the buttons stay in the first screen of a 390x844 phone),
          2:1 from 640 px, 5:2 from 1024 px; from 1280 px the panel fills the right side of a 600 px tall hero. The aspect ratios and min-heights reserve the space before any
          image arrives, so nothing below moves while the photos load. */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-brand-800 sm:aspect-[2/1] lg:aspect-[5/2] xl:absolute xl:inset-y-0 xl:right-0 xl:aspect-auto xl:w-[56%]">
        {/* Every slide image that is in the DOM is stacked here. The one underneath ("shown") stays visible until the
            active one has loaded and faded in on top, so a change never shows an empty grey box. */}
        {slides.map((item, index) => {
          if (!rendered.has(index)) return null;
          const isActive = index === active;
          const visible = index === shown || (isActive && (loaded.has(index) || !item.image));
          const layer = `absolute inset-0 transition-opacity duration-500 ease-out motion-reduce:transition-none ${visible ? "opacity-100" : "opacity-0"} ${isActive ? "z-[2]" : index === shown ? "z-[1]" : "z-0"}`;
          if (!item.image) {
            return <div key={item.id} aria-hidden={!isActive} className={`${layer} bg-[radial-gradient(circle_at_top_left,_rgba(243,233,213,0.7),_rgba(23,58,58,0.18)_45%,_rgba(23,58,58,0.75)_100%)]`} />;
          }
          return (
            <picture key={item.id}>
              {item.sources?.map((source) => <source key={source.media} media={source.media} srcSet={source.srcSet} />)}
              {/* Plain <img> inside <picture>: the sources are art-directed, pre-optimised WebP files. The first slide
                  is the page's main image (high priority); the others are fetched ahead of their turn at low priority. */}
              <img
                ref={(element) => {
                  // An image that finished before hydration fires no onLoad that React can see.
                  if (element?.complete && element.naturalWidth > 0) markLoaded(index);
                }}
                src={item.image}
                alt={isActive ? item.imageAlt : ""}
                aria-hidden={!isActive}
                decoding="async"
                loading={index === 0 ? "eager" : "lazy"}
                fetchPriority={index === 0 ? "high" : "low"}
                draggable={false}
                onLoad={() => markLoaded(index)}
                className={`${layer} h-full w-full object-cover`}
                style={item.imagePosition ? { objectPosition: item.imagePosition } : undefined}
              />
            </picture>
          );
        })}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 z-[3] hidden w-[13%] bg-[linear-gradient(90deg,#10292a_0%,rgba(16,41,42,0.62)_38%,rgba(16,41,42,0)_100%)] xl:block"
        />
      </div>

      {/* Fixed minimum heights (and line clamps on the copy) keep the carousel from changing height between slides. */}
      <div className="bagati-on-dark relative z-10 flex min-h-[404px] flex-col justify-between gap-4 p-5 sm:min-h-[404px] sm:gap-6 sm:p-8 xl:min-h-[clamp(560px,44vw,640px)] xl:w-[46%] xl:p-11">
        <div className="flex items-center justify-between gap-3">
          {/* Gold hairline + eyebrow: the one gold accent of the hero (decoration; the text is cream). */}
          <span className="inline-flex min-w-0 items-center gap-3 text-kicker uppercase text-gold-200">
            <span aria-hidden="true" className="h-px w-8 shrink-0 bg-gold-400" />
            <span className="truncate">{slide.eyebrow}</span>
          </span>
          <span className="hidden sm:inline-flex">{pauseButton}</span>
        </div>

        <div className="max-w-[560px]">
          <h1 className="line-clamp-3 font-serif text-[2rem] font-medium leading-[1.04] tracking-[-0.025em] text-white sm:text-[3rem] xl:text-[3.5rem]">
            {slide.title}
            {slide.highlight && (
              <>
                <br />
                <span className="font-normal italic text-gold-200">{slide.highlight}</span>
              </>
            )}
          </h1>
          {slide.description && <p className="mt-4 line-clamp-2 max-w-[32rem] text-body leading-6 text-white/85 sm:line-clamp-3 sm:text-body-lg">{slide.description}</p>}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link href={slide.href} className="inline-flex min-h-12 items-center justify-center rounded-full bg-gold-100 px-6 text-body font-semibold text-fg shadow-subtle transition-colors hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bagati-gold motion-reduce:transition-none">
              {slide.button}
            </Link>
            <Link href={slide.secondaryHref} className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/40 px-5 text-body font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bagati-gold motion-reduce:transition-none">
              {slide.secondary}
            </Link>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="-ml-2.5 flex items-center">
            {slides.map((item, index) => {
              const isActive = index === active;
              return (
                // 44 px hit area around a small track; the track holds the autoplay progress fill.
                <button
                  key={item.id}
                  type="button"
                  aria-label={`${index + 1}. slayd`}
                  aria-pressed={isActive}
                  onClick={() => setActive(index)}
                  className="group/dot grid h-11 min-w-11 place-items-center rounded-full px-1.5"
                >
                  <span className={`relative block h-2.5 overflow-hidden rounded-full transition-all duration-200 motion-reduce:transition-none ${isActive ? (autoplay ? "w-8 bg-white/35" : "w-8 bg-gold-200") : "w-2.5 bg-white/70 group-hover/dot:bg-white"}`}>
                  {isActive && autoplay && (
                    // Progress fill = the autoplay timer. Keyed by slide so a manual change restarts it; paused with the
                    // carousel (hover, focus, pause button, hidden tab).
                    <span
                      key={item.id}
                      aria-hidden="true"
                      data-hero-progress=""
                      className="absolute inset-0 origin-left rounded-full bg-gold-200"
                      style={{
                        animation: `bagati-hero-progress ${HERO_AUTOPLAY_MS}ms linear forwards`,
                        animationPlayState: autoplayRunning ? "running" : "paused",
                      }}
                      onAnimationEnd={(event) => {
                        if (event.target !== event.currentTarget) return;
                        setActive((value) => (value + 1) % slides.length);
                      }}
                    />
                  )}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <span className="sm:hidden">{pauseButton}</span>
            {slide.visualLabel && <span className="mr-1 hidden rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-xs font-medium text-white/85 sm:inline-flex">
              {slide.visualLabel}
            </span>}
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
