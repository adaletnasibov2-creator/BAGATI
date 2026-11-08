import Link from "next/link";

export default function VendorPlanGate({ storeId, message }: { storeId: string; message: string }) {
  return <section className="mt-5 rounded-2xl border border-[#e8d9b5] bg-[#fbf8f0] p-5" role="status">
    <h2 className="font-semibold text-[#142d38]">Bu imkan paketinizə daxil deyil</h2>
    <p className="mt-2 text-sm text-slate-600">{message}</p>
    <Link href={`/vendor/${storeId}/subscription`} className="mt-4 inline-flex rounded-xl bg-[#173c40] px-4 py-2.5 text-sm font-semibold text-white">Abunəlik planlarına bax</Link>
  </section>;
}
