import { notFound } from "next/navigation";
import { requireVendorStorePage } from "@/lib/vendor-area";
import VendorSection from "@/components/vendor-section";
export default async function NewProduct({params}:{params:Promise<{storeId:string}>}){const {storeId}=await params;if(!await requireVendorStorePage(storeId))notFound();return <VendorSection storeId={storeId} section="new" title="Yeni məhsul"/>}
