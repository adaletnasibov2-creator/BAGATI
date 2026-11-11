"use client";

import { useState } from "react";
import Image from "next/image";
import { ImageOff } from "lucide-react";

export default function ProductGallery({ images, name }: { images: string[]; name: string }) {
  const [selected, setSelected] = useState(0);
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const image = images[selected];
  const imageFailed = Boolean(image && failedImages.includes(image));
  const markImageFailed = (url: string) => setFailedImages(current => current.includes(url) ? current : [...current, url]);
  return <div className="min-w-0">
    <div className="relative flex aspect-square max-h-[680px] items-center justify-center overflow-hidden rounded-[26px] bg-[#F4F5F1] text-sm text-muted">
      {image && !imageFailed ? (
        <Image
          src={image}
          alt={name}
          fill
          priority={selected === 0}
          sizes="(min-width: 1024px) 55vw, 100vw"
          unoptimized={/^https?:\/\//i.test(image)}
          onError={() => markImageFailed(image)}
          className="object-contain p-4 sm:p-8"
        />
      ) : <div className="text-center"><ImageOff aria-hidden="true" size={30} className="mx-auto text-[#74847C]"/><p className="mt-3">Şəkil yoxdur</p></div>}
    </div>
    {images.length > 1 && <div className="mt-3 grid grid-cols-5 gap-2 sm:grid-cols-6">{images.map((url, index) => <button key={`${url}-${index}`} type="button" aria-label={`${index + 1}-ci şəkli göstər`} aria-pressed={selected === index} onClick={() => setSelected(index)} className={`relative aspect-square min-h-11 overflow-hidden rounded-xl border-2 bg-[#F4F5F1] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C79A52] motion-reduce:transition-none ${selected === index ? "border-[#85621d]" : "border-transparent hover:border-[#C9D8D1]"}`}>{failedImages.includes(url) ? <ImageOff aria-hidden="true" size={18} className="absolute inset-0 m-auto text-[#74847C]"/> : <Image src={url} alt="" fill sizes="(min-width: 640px) 12vw, 18vw" unoptimized={/^https?:\/\//i.test(url)} onError={() => markImageFailed(url)} className="object-contain p-1"/>}</button>)}</div>}
  </div>;
}
