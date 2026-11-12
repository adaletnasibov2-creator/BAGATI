import { isPublicStoreEligible, type PublicStoreCandidate } from "@/lib/public-store-eligibility";
import { publicStoreEligibilityBaseWhere } from "@/lib/seller-legal-policy";
import { activeComplimentaryEntitlementSelect } from "@/lib/subscription-entitlements";
import { isValidCoordinates } from "@/lib/map-location";

type StoreMapRecord = PublicStoreCandidate & {
  name:string;
  slug:string;
  address:string|null;
  logoUrl:string|null;
  latitude:number|null;
  longitude:number|null;
  city:{name:string;isActive:boolean};
};
export type PublicStoreMapMarker = {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  logoUrl: string | null;
  latitude: number;
  longitude: number;
  city: string;
};
type FindMany = (args: any) => Promise<StoreMapRecord[]>;

export async function getPublicStoreMapMarkers(findMany: FindMany): Promise<PublicStoreMapMarker[]> {
  const rows = await findMany({
    where: { ...publicStoreEligibilityBaseWhere(), latitude: { not: null }, longitude: { not: null } },
    select: {
      id:true, name:true, slug:true, address:true, logoUrl:true, latitude:true, longitude:true,
      status:true, isActive:true, legalInfoApproved:true, adminManaged:true,
      city:{select:{name:true,isActive:true}},
      vendor:{select:{sellerType:true,legalName:true,voen:true,legalAddress:true,user:{select:{isActive:true}}}},
      subscription:{select:{status:true,currentPeriodStart:true,currentPeriodEnd:true,plan:{select:{isActive:true,slug:true}}}},
      complimentaryEntitlements: activeComplimentaryEntitlementSelect,
    },
    orderBy: { name: "asc" },
  });
  return rows.flatMap(store => {
    const { latitude, longitude } = store;
    if (!isPublicStoreEligible(store) || latitude == null || longitude == null || !isValidCoordinates({latitude,longitude})) return [];
    return [{ id:store.id, name:store.name, slug:store.slug, address:store.address, logoUrl:store.logoUrl, city:store.city.name, latitude, longitude }];
  });
}
