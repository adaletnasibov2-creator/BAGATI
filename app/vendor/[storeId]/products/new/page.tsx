import { notFound } from "next/navigation";
import { requireStoreAccess } from "@/lib/auth";
import VendorSection from "@/components/vendor-section";
export default async function NewProduct({params}:{params:Promise<{storeId:string}>}){const {storeId}=await params;if(!await requireStoreAccess(storeId))notFound();return <VendorSection storeId={storeId} section="new" title="Yeni məhsul"/>}
