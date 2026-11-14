import { StatusBadge } from "@/components/admin-ui/status-badge";
import { adminStatusLabel, adminStatusTone, type AdminStatusKind } from "@/lib/admin-labels";

/** Status value → Azerbaijani label in a coloured badge (lib/admin-labels.ts). The raw value is the tooltip. */
export function AdminStatusBadge({ kind, value }: { kind: AdminStatusKind; value: string | null | undefined }) {
  return <StatusBadge tone={adminStatusTone(kind, value)} title={value ?? undefined}>{adminStatusLabel(kind, value)}</StatusBadge>;
}
