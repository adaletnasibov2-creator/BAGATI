import type { LegalAcceptanceSource, LegalDocument } from "@prisma/client";
import { formatBakuDateTime } from "@/lib/admin-audit-log";
import { LEGAL_DOCUMENT_LABELS, LEGAL_SOURCE_LABELS } from "@/lib/legal-gates";
import { LEGAL_VERSIONS } from "@/lib/legal-versions";

export type AdminLegalAcceptanceRow = {
  id: string;
  document: LegalDocument;
  version: string;
  source: LegalAcceptanceSource;
  acceptedAt: Date;
  vendorApplicationId: string | null;
};

/** Prisma select for the rows below (read-only admin view; no IP or user agent exists to show). */
export const adminLegalAcceptanceSelect = { id: true, document: true, version: true, source: true, acceptedAt: true, vendorApplicationId: true } as const;

/**
 * Read-only list of a user's acceptances: document, version, source, date (Baku time). Marks whether the version is the
 * current one and, on a seller application page, which row was accepted with that application.
 */
export function AdminLegalAcceptances({ rows, className = "", applicationId }: { rows: AdminLegalAcceptanceRow[]; className?: string; applicationId?: string }) {
  return <section className={className} aria-labelledby="admin-legal-acceptances-title">
    <h2 id="admin-legal-acceptances-title" className="font-semibold text-[#0d1b2a]">Hüquqi şərtlərin qəbulu</h2>
    {rows.length === 0
      ? <p className="mt-3 text-sm text-slate-500">Qeyd yoxdur. İstifadəçi hələ heç bir şərt versiyasını qəbul etməyib.</p>
      : <ul className="mt-3 grid gap-3 text-sm">{rows.map((row) => {
        const current = LEGAL_VERSIONS[row.document] === row.version;
        return <li key={row.id} className="rounded-xl border border-[#eeeae2] p-3">
          <p className="font-medium text-[#0d1b2a]">{LEGAL_DOCUMENT_LABELS[row.document]} · versiya {row.version}{" "}
            <span className={`ml-1 rounded-full px-2 py-0.5 text-xs ${current ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>{current ? "Hazırkı versiya" : "Köhnə versiya"}</span>
          </p>
          <p className="mt-1 text-slate-600">{LEGAL_SOURCE_LABELS[row.source]} · {formatBakuDateTime(row.acceptedAt)}</p>
          {applicationId && row.vendorApplicationId === applicationId && <p className="mt-1 text-xs font-medium text-[#85621d]">Bu müraciətlə qəbul edilib</p>}
        </li>;
      })}</ul>}
  </section>;
}
