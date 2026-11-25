import { notFound } from "next/navigation";
import { requireVendorStorePage } from "@/lib/vendor-area";
import VendorSection from "@/components/vendor-section";
// SELLER-PANEL-3: ?copy=<productId> opens the form pre-filled from that product ("Surətini yarat"); the id is only read
// through the seller's own product API (store-scoped), so another store's product simply does not load.
export default async function NewProduct({params,searchParams}:{params:Promise<{storeId:string}>;searchParams:Promise<{copy?:string|string[]}>}){const {storeId}=await params;if(!await requireVendorStorePage(storeId))notFound();const {copy}=await searchParams;const copyFrom=typeof copy==="string"&&/^[A-Za-z0-9_-]{1,64}$/.test(copy)?copy:null;return <VendorSection storeId={storeId} section="new" title="Yeni məhsul" copyFrom={copyFrom}/>}
