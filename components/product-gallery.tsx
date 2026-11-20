"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react";
import { cx, focusRing } from "@/components/ui/cx";

/**
 * Product gallery (DESIGN-T6): one square main image (fixed aspect ratio, so no layout shift while images load),
 * previous/next buttons and a counter when there are several images, and a thumbnail strip. Keyboard: Tab to the strip,
 * then ArrowLeft/ArrowRight/Home/End move between thumbnails and show that image (roving tabindex).
 */
export default function ProductGallery({ images, name }: { images: string[]; name: string }) {
  const [selected, setSelected] = useState(0);
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const thumbs = useRef<(HTMLButtonElement | null)[]>([]);
  const image = images[selected];
  const imageFailed = Boolean(image && failedImages.includes(image));
  const markImageFailed = (url: string) => setFailedImages(current => current.includes(url) ? current : [...current, url]);
  const many = images.length > 1;

  function show(index: number, focus = false) {
    const next = (index + images.length) % images.length;
    setSelected(next);
    if (focus) thumbs.current[next]?.focus();
  }

  function onThumbKey(event: KeyboardEvent<HTMLDivElement>) {
    const keys: Record<string, number> = { ArrowRight: selected + 1, ArrowLeft: selected - 1, Home: 0, End: images.length - 1 };
    if (!(event.key in keys)) return;
    event.preventDefault();
    show(keys[event.key], true);
  }

  const arrow = cx("absolute top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/95 text-fg shadow-subtle ring-1 ring-inset ring-line transition-colors hover:bg-white hover:text-primary", focusRing);

  return <div className="min-w-0">
    <div className="relative flex aspect-square max-h-[680px] items-center justify-center overflow-hidden rounded-feature border border-line bg-surface-sunken text-sm text-fg-muted">
      {image && !imageFailed ? (
        <Image
          src={image}
          alt={many ? `${name}, ${selected + 1}-ci şəkil` : name}
          fill
          priority={selected === 0}
          sizes="(min-width: 1024px) 55vw, 100vw"
          unoptimized={/^https?:\/\//i.test(image)}
          onError={() => markImageFailed(image)}
          className="object-contain p-4 sm:p-8"
        />
      ) : <div className="text-center"><ImageOff aria-hidden="true" size={30} className="mx-auto text-fg-muted"/><p className="mt-3">Şəkil yoxdur</p></div>}
      {many && <>
        <button type="button" aria-label="Əvvəlki şəkil" onClick={() => show(selected - 1)} className={cx(arrow, "left-3")}><ChevronLeft aria-hidden="true" size={20}/></button>
        <button type="button" aria-label="Növbəti şəkil" onClick={() => show(selected + 1)} className={cx(arrow, "right-3")}><ChevronRight aria-hidden="true" size={20}/></button>
        <span aria-live="polite" className="absolute bottom-3 right-3 rounded-full bg-white/95 px-2.5 py-1 text-xs font-medium text-fg-body shadow-subtle ring-1 ring-inset ring-line">{selected + 1} / {images.length}</span>
      </>}
    </div>
    {many && <div role="group" aria-label="Məhsul şəkilləri" onKeyDown={onThumbKey} className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
      {images.map((url, index) => <button
        key={`${url}-${index}`}
        ref={(node) => { thumbs.current[index] = node; }}
        type="button"
        tabIndex={selected === index ? 0 : -1}
        aria-label={`${index + 1}-ci şəkli göstər`}
        aria-pressed={selected === index}
        onClick={() => show(index)}
        className={cx("relative h-16 w-16 shrink-0 overflow-hidden rounded-control border-2 bg-surface-sunken transition-colors motion-reduce:transition-none sm:h-20 sm:w-20", focusRing, selected === index ? "border-primary" : "border-transparent hover:border-brand-200")}
      >{failedImages.includes(url) ? <ImageOff aria-hidden="true" size={18} className="absolute inset-0 m-auto text-fg-muted"/> : <Image src={url} alt="" fill sizes="80px" unoptimized={/^https?:\/\//i.test(url)} onError={() => markImageFailed(url)} className="object-contain p-1"/>}</button>)}
    </div>}
  </div>;
}
