export type StoreDeletionDependencies = {
  products: number;
  storeOrders: number;
  promotions: number;
  commissions: number;
  notifications: number;
  returnRequests: number;
  productImports: number;
  hasSubscription: boolean;
};

export function getStoreDeletionBlockers(dependencies: StoreDeletionDependencies): string[] {
  const blockers: string[] = [];
  if (dependencies.products) blockers.push("products");
  if (dependencies.storeOrders) blockers.push("storeOrders");
  if (dependencies.promotions) blockers.push("promotions");
  if (dependencies.commissions) blockers.push("commissions");
  if (dependencies.notifications) blockers.push("notifications");
  if (dependencies.returnRequests) blockers.push("returnRequests");
  if (dependencies.productImports) blockers.push("productImports");
  if (dependencies.hasSubscription) blockers.push("subscription");
  return blockers;
}
