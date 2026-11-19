/**
 * Links of the category filter tree (SCALE-FIX-3, B2). The tree is a client component, so it cannot take an `href`
 * function from the server any more; it takes this small description instead and builds each link the same way the
 * page did: `category` first, then the kept parameters in their order, no "?" when there is nothing to add.
 */
export type CategoryFilterLink = { path: string; params: [string, string][] };

export function categoryFilterHref(link: CategoryFilterLink, slug: string | null): string {
  const query = new URLSearchParams();
  if (slug) query.set("category", slug);
  for (const [key, value] of link.params) query.set(key, value);
  return `${link.path}${query.size ? `?${query.toString()}` : ""}`;
}
