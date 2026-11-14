"use client";

import AdminMutationForm from "@/components/admin-mutation-form";
import AdminStoreArchiveAction from "@/components/admin-store-archive-action";
import AdminStoreReviewActions from "@/components/admin-store-review-actions";
import { storeProfileChangeConfirmation, type AdminStoreProfileView, type ProfileOption } from "@/lib/admin-store-profile";

/**
 * Store profile editor. Options come from the server with the page (always including the current owner and city),
 * so the selects show the stored values from the first render. The form also sends the owner/city it was rendered
 * with; the server ignores unchanged values and refuses a stale save. Changing owner or city asks for confirmation.
 */
export default function AdminStoreProfileForm({ store, vendorOptions, cityOptions }: { store: AdminStoreProfileView; vendorOptions: ProfileOption[]; cityOptions: ProfileOption[] }) {
  const label = (options: ProfileOption[]) => (id: string) => options.find((option) => option.value === id)?.label ?? "seçilməyib";
  return <section className="mb-5 rounded-2xl border border-[#e7e3d9] bg-white p-5">
    <h2 className="mb-1 font-semibold">Mağaza profilini redaktə et</h2><p className="mb-4 text-sm text-slate-500">Sahiblik və mağaza məlumatlarındakı dəyişikliklər audit jurnalına yazılır.</p>
    <AdminMutationForm resource="stores" method="PATCH" className="grid gap-3 sm:grid-cols-2"
      confirmWhen={(payload) => storeProfileChangeConfirmation(store, payload, { vendor: label(vendorOptions), city: label(cityOptions) })}
      fields={[
        { name: "id", label: "", type: "hidden", value: store.id },
        { name: "expectedVendorId", label: "", type: "hidden", value: store.vendorId },
        { name: "expectedCityId", label: "", type: "hidden", value: store.cityId },
        { name: "name", label: "Mağaza adı", value: store.name, required: true },
        { name: "vendorId", label: "Satıcı sahibi", type: "select", value: store.vendorId, required: true, options: vendorOptions },
        { name: "cityId", label: "Şəhər", type: "select", value: store.cityId, required: true, options: cityOptions },
        { name: "address", label: "Ünvan", value: store.address },
        { name: "logoUrl", label: "Logo HTTPS URL", type: "url", value: store.logoUrl },
        { name: "contactPhone", label: "WhatsApp / telefon (məs. 055 123 45 67)", value: store.contactPhone },
        { name: "freeDeliveryThreshold", label: "Pulsuz çatdırılma həddi (AZN)", type: "number", min: "0", max: "9999999999.99", step: "0.01", value: store.freeDeliveryThreshold },
        { name: "deliveryFee", label: "Həddən aşağı çatdırılma haqqı (AZN)", type: "number", min: "0", max: "9999999999.99", step: "0.01", value: store.deliveryFee },
        { name: "contactEmail", label: "Bildiriş e-poçtu (alıcılara göstərilmir)", type: "email", value: store.contactEmail },
        { name: "latitude", label: "Enlik", type: "number", min: "-90", max: "90", value: store.latitude },
        { name: "longitude", label: "Uzunluq", type: "number", min: "-180", max: "180", value: store.longitude },
        { name: "mapUrl", label: "Xəritə HTTPS linki", type: "url", value: store.mapUrl },
        { name: "description", label: "Təsvir", type: "textarea", value: store.description },
      ]}/>
    <AdminStoreArchiveAction storeId={store.id} storeName={store.name}/>
    <AdminStoreReviewActions storeId={store.id} status={store.status} legalInfoApproved={store.legalInfoApproved} sellerType={store.sellerType} legalName={store.legalName} voen={store.voen} legalAddress={store.legalAddress} hasActiveGrant={store.hasActiveGrant}/>
  </section>;
}
