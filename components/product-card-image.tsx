"use client";

import Image from "next/image";
import { useState } from "react";
import { ImageOff } from "lucide-react";

const blurPlaceholder = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 30'%3E%3Crect width='24' height='30' fill='%23EEF3F0'/%3E%3C/svg%3E";

export default function ProductCardImage({
  src,
  secondarySrc,
  alt,
  sizes,
}: {
  src: string | null | undefined;
  secondarySrc?: string | null;
  alt: string;
  sizes: string;
}) {
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const primarySrc = [src, secondarySrc].find((image) => image && !failedSources.includes(image));
  const hoverSrc = src && secondarySrc && secondarySrc !== src && primarySrc === src && !failedSources.includes(secondarySrc)
    ? secondarySrc
    : null;

  if (!primarySrc) {
    return (
      <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[linear-gradient(145deg,#F7F8F6,#EEF3F0)] text-xs text-bagati-muted">
        <ImageOff aria-hidden="true" size={24} strokeWidth={1.5} />
        <span>Şəkil yoxdur</span>
      </span>
    );
  }

  const remote = (image: string) => /^https?:\/\//i.test(image);

  return (
    <>
      <Image
        src={primarySrc}
        alt={alt}
        fill
        unoptimized={remote(primarySrc)}
        sizes={sizes}
        placeholder="blur"
        blurDataURL={blurPlaceholder}
        onError={() => setFailedSources((current) => [...current, primarySrc])}
        className={`object-contain p-3 transition-[opacity,transform] duration-300 motion-reduce:transition-none sm:p-5 ${hoverSrc ? "group-hover:scale-[1.025] group-hover:opacity-0 group-focus-within:opacity-0" : "motion-safe:group-hover:scale-[1.025]"}`}
      />
      {hoverSrc && (
        <Image
          src={hoverSrc}
          alt=""
          aria-hidden="true"
          fill
          unoptimized={remote(hoverSrc)}
          sizes={sizes}
          placeholder="blur"
          blurDataURL={blurPlaceholder}
          onError={() => setFailedSources((current) => [...current, hoverSrc])}
          className="pointer-events-none object-contain p-3 opacity-0 transition-[opacity,transform] duration-300 group-hover:scale-[1.025] group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none sm:p-5"
        />
      )}
    </>
  );
}
