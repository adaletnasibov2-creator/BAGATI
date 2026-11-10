"use client";

import Image from "next/image";
import { useState } from "react";

export default function StorefrontImage({
  src,
  alt,
  className,
  fallback,
  fill = false,
  sizes,
  priority = false,
}: {
  src: string | null;
  alt: string;
  className: string;
  fallback: React.ReactNode;
  fill?: boolean;
  sizes?: string;
  priority?: boolean;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) return <>{fallback}</>;
  return <Image
    src={src}
    alt={alt}
    fill={fill}
    width={fill ? undefined : 96}
    height={fill ? undefined : 96}
    sizes={sizes}
    priority={priority}
    unoptimized
    onError={() => setFailedSrc(src)}
    className={className}
  />;
}
