export function canonicalHostRedirectUrl(requestUrl: string, hostHeader: string | null) {
  if (hostHeader?.split(":")[0].trim().toLowerCase() !== "www.shopbagati.com") return null;
  const target = new URL(requestUrl);
  target.protocol = "https:";
  target.hostname = "shopbagati.com";
  target.port = "";
  return target;
}
