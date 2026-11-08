import { notFound } from "next/navigation";
import VendorProductEditor from "@/components/vendor-product-editor";
import { requireStoreAccess } from "@/lib/auth";

export default async function EditVendorProductPage({ params }: { params: Promise<{ storeId: string; productId: string }> }) {
  const { storeId, productId } = await params;
  if (!await requireStoreAccess(storeId)) notFound();
  return <VendorProductEditor storeId={storeId} productId={productId}/>;
}
