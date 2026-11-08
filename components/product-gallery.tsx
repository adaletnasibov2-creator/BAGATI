"use client";

import { useState } from "react";

export default function ProductGallery({ images, name }: { images: string[]; name: string }) {
  const [selected, setSelected] = useState(0);
  const image = images[selected];
  return <div className="min-w-0">
    <div className="flex aspect-square max-h-[640px] items-center justify-center overflow-hidden rounded-[26px] bg-[#efeee9] text-sm text-muted">{image ? <img src={image} alt={name} className="h-full w-full object-cover"/> : <div className="text-center"><div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-white text-emerald">B</div><p className="mt-4">Şəkil yoxdur</p></div>}</div>
    {images.length > 1 && <div className="mt-3 grid grid-cols-5 gap-2 sm:grid-cols-6">{images.map((url, index) => <button key={`${url}-${index}`} type="button" aria-label={`${index + 1}-ci şəkli göstər`} aria-pressed={selected === index} onClick={() => setSelected(index)} className={`aspect-square overflow-hidden rounded-xl border-2 ${selected === index ? "border-[#85621d]" : "border-transparent"}`}><img src={url} alt="" className="h-full w-full object-cover"/></button>)}</div>}
  </div>;
}
