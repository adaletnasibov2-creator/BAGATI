export function toWhatsAppHref(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (!/^\+?[\d\s().-]+$/.test(trimmed)) return null;
  const hasInternationalPrefix = trimmed.startsWith("+") || trimmed.startsWith("00");
  if (!hasInternationalPrefix) return null;

  const digits = trimmed.startsWith("00")
    ? trimmed.slice(2).replace(/\D/g, "")
    : trimmed.replace(/\D/g, "");
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  return `https://wa.me/${digits}`;
}

export function toTelephoneHref(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (!/^\+?[\d\s().-]+$/.test(trimmed)) return null;
  const hasInternationalPrefix = trimmed.startsWith("+") || trimmed.startsWith("00");
  const digits = trimmed.startsWith("00")
    ? trimmed.slice(2).replace(/\D/g, "")
    : trimmed.replace(/\D/g, "");
  if (!/^\d{5,15}$/.test(digits)) return null;
  return `tel:${hasInternationalPrefix ? "+" : ""}${digits}`;
}
