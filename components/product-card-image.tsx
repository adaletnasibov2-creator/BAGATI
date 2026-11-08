"use client";

import Image from "next/image";
import { useState } from "react";
import { ImageOff } from "lucide-react";

export default function ProductCardImage({ src, alt, sizes }: { src: string | null | undefined; alt: string; sizes: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <span className="flex flex-col items-center gap-2"><ImageOff aria-hidden="true" size={22}/><span>Şəkil yoxdur</span></span>;
  return <Image
    src={src}
    alt={alt}
    fill
    unoptimized={/^https?:\/\//i.test(src)}
    sizes={sizes}
    onError={() => setFailed(true)}
    className="object-contain p-3 transition duration-300 group-hover:scale-[1.035] sm:p-5"
  />;
}
