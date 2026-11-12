"use client";

import { useEffect, useState } from "react";
import AdminMutationForm from "@/components/admin-mutation-form";
import AdminStoreArchiveAction from "@/components/admin-store-archive-action";
import AdminStoreReviewActions from "@/components/admin-store-review-actions";

type Option = { id: string; name: string };
export default function AdminStoreProfileForm({ store }: { store: any }) {
  const [cities, setCities] = useState<Option[]>([]); const [vendors, setVendors] = useState<Option[]>([]);
  const [optionsError, setOptionsError] = useState("");
  useEffect(() => {
    let active = true;
    fetch("/api/admin/store-options", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Satıcı və şəhər siyahısını yükləmək mümkün olmadı.");
        if (active) { setCities(data.cities); setVendors(data.vendors); setOptionsError(""); }
      })
      .catch((error: unknown) => {
        if (active) setOptionsError(error instanceof Error ? error.message : "Satıcı və şəhər siyahısını yükləmək mümkün olmadı.");
      });
    return () => { active = false; };
  }, []);
  return <section className="mb-5 rounded-2xl border border-[#e7e3d9] bg-white p-5">
    <h2 className="mb-1 font-semibold">Mağaza profilini redaktə et</h2><p className="mb-4 text-sm text-slate-500">Sahiblik və mağaza məlumatlarındakı dəyişikliklər audit jurnalına yazılır.</p>
    {optionsError && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{optionsError} Sahibliyi və şəhəri dəyişmək üçün məlumatlar yüklənməlidir.</p>}
    <AdminMutationForm resource="stores" method="PATCH" className="grid gap-3 sm:grid-cols-2" fields={[
      { name: "id", label: "", type: "hidden", value: store.id },
      { name: "name", label: "Mağaza adı", value: store.name, required: true },
      { name: "vendorId", label: "Satıcı sahibi", type: "select", value: store.vendorId, required: true, options: vendors.map(({ id, name }) => ({ value: id, label: name })) },
      { name: "cityId", label: "Şəhər", type: "select", value: store.cityId, required: true, options: cities.map(({ id, name }) => ({ value: id, label: name })) },
      { name: "address", label: "Ünvan", value: store.address },
      { name: "logoUrl", label: "Logo HTTPS URL", type: "url", value: store.logoUrl },
      { name: "contactPhone", label: "WhatsApp / telefon (məs. 055 123 45 67)", value: store.contactPhone },
      { name: "freeDeliveryThreshold", label: "Pulsuz çatdırılma həddi (AZN)", type: "number", min: "0", max: "9999999999.99", step: "0.01", value: Number(store.freeDeliveryThreshold) },
      { name: "deliveryFee", label: "Həddən aşağı çatdırılma haqqı (AZN)", type: "number", min: "0", max: "9999999999.99", step: "0.01", value: Number(store.deliveryFee) },
      { name: "contactEmail", label: "Bildiriş e-poçtu (alıcılara göstərilmir)", type: "email", value: store.contactEmail },
      { name: "latitude", label: "Enlik", type: "number", min: "-90", max: "90", value: store.latitude },
      { name: "longitude", label: "Uzunluq", type: "number", min: "-180", max: "180", value: store.longitude },
      { name: "mapUrl", label: "Xəritə HTTPS linki", type: "url", value: store.mapUrl },
      { name: "description", label: "Təsvir", type: "textarea", value: store.description },
    ]}/>
    <AdminStoreArchiveAction storeId={store.id} storeName={store.name}/>
    <AdminStoreReviewActions storeId={store.id} status={store.status} legalInfoApproved={store.legalInfoApproved} sellerType={store.vendor?.sellerType||null} legalName={store.vendor?.legalName||null} voen={store.vendor?.voen||null} legalAddress={store.vendor?.legalAddress||null} hasActiveGrant={Boolean(store.complimentaryEntitlements?.some((grant: { revokedAt: unknown }) => !grant.revokedAt))}/>
  </section>;
}
