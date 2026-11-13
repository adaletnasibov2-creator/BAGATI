import { SELLER_APPLICATION_STATUS_LABELS, type SellerApplicationStatus } from "@/lib/seller-application";

const tone: Record<SellerApplicationStatus, string> = {
  PENDING: "bg-amber-50 text-amber-900 border-amber-200",
  APPROVED: "bg-green-50 text-green-800 border-green-200",
  REJECTED: "bg-red-50 text-red-800 border-red-200",
  WITHDRAWN: "bg-slate-50 text-slate-600 border-slate-200",
};

export default function SellerApplicationStatusBadge({ status }: { status: SellerApplicationStatus }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${tone[status]}`}>{SELLER_APPLICATION_STATUS_LABELS[status]}</span>;
}
