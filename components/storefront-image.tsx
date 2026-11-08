"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

export default function StorefrontImage({
  src,
  alt,
  className,
  fallback,
  fill = false,
  sizes,
}: {
  src: string | null;
  alt: string;
  className: string;
  fallback: React.ReactNode;
  fill?: boolean;
  sizes?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) return <>{fallback}</>;
  return <Image
    src={src}
    alt={alt}
    fill={fill}
    width={fill ? undefined : 96}
    height={fill ? undefined : 96}
    sizes={sizes}
    unoptimized
    onError={() => setFailed(true)}
    className={className}
  />;
}
