import Image from "next/image";

type BrandLogoProps = {
  variant?: "full" | "compact" | "icon";
  href?: string;
  light?: boolean;
  className?: string;
  siteName?: string;
  logoUrl?: string | null;
  priority?: boolean;
};

export function BrandMark({ className = "h-10 w-auto" }: { className?: string; light?: boolean }) {
  return (
    <Image
      src="/bagati-mark.svg"
      alt=""
      aria-hidden="true"
      width={520}
      height={720}
      priority
      className={className}
    />
  );
}

export function BrandLogo({
  variant = "full",
  href = "/",
  light = false,
  className = "",
  siteName = "BAGATI",
  logoUrl = null,
  priority = false,
}: BrandLogoProps) {
  const textColor = light ? "text-white" : "text-[#173A3A]";
  const compact = variant === "icon";

  return (
    <a href={href} aria-label={`${siteName} ana səhifə`} className={`inline-flex shrink-0 items-center gap-2.5 ${className}`}>
      {logoUrl ? (
        <Image
          src={logoUrl}
          alt=""
          aria-hidden="true"
          width={520}
          height={720}
          priority={priority}
          unoptimized
          className={compact ? "h-11 w-auto max-w-[74px] shrink-0 object-contain sm:h-12 sm:max-w-[82px]" : "h-14 w-auto max-w-[96px] shrink-0 object-contain sm:h-16 sm:max-w-[110px]"}
        />
      ) : (
        <BrandMark className={compact ? "h-11 w-auto shrink-0 sm:h-12" : "h-14 w-auto shrink-0 sm:h-16"} />
      )}
      <span className={`block whitespace-nowrap font-serif font-semibold leading-none tracking-[0.14em] ${textColor} ${compact ? "text-[1.2rem] sm:text-[1.3rem]" : "text-[1.42rem] sm:text-[1.6rem]"}`}>
        BAGATI
      </span>
    </a>
  );
}
