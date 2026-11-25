import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import AdminShell from "@/components/admin-shell";
import { AdminReportDecision } from "@/components/admin-report-decision";
import { requireRole } from "@/lib/auth";
import { formatMessageTime } from "@/lib/messaging-client";
import { ADMIN_MESSAGE_LIMIT, openReportForAdmin, REPORT_STATUS_LABELS } from "@/lib/messaging-admin";
import { adminMessagingNavEnabled } from "@/lib/messaging-pages";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
const card = "rounded-card border border-line bg-white p-5";
const contextLabels = { PRODUCT: "Məhsul", ORDER: "Sifariş", STORE: "Ümumi sual" } as const;

/**
 * One messaging report and its conversation. Rendering this page writes the CONVERSATION_ADMIN_VIEW audit row (actor,
 * conversation id, report id) in the same transaction that reads the messages. Message text is plain React text.
 */
export default async function AdminMessageReportPage({ params }: { params: Promise<{ reportId: string }> }) {
  const admin = await requireRole("ADMIN");
  if (!admin) redirect("/admin/login");
  const { reportId } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(reportId)) notFound();
  const opened = await openReportForAdmin(prisma, { reportId, adminId: admin.id });
  if (!opened) notFound();
  const { report, otherReports, conversation, messages, truncated } = opened;
  const sender = (role: "CUSTOMER" | "STORE") => (role === "STORE" ? conversation.store.name : conversation.customer);
  return <AdminShell email={admin.email} messagingEnabled={await adminMessagingNavEnabled()}>
    <Link href="/admin/messages/reports" className="text-sm text-primary">← Mesaj şikayətləri</Link>
    <header className="mt-3 mb-5 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-h1 text-fg">Şikayət: {report.reasonLabel}</h1>
        <p className="mt-1 text-sm text-fg-secondary">{formatMessageTime(report.createdAt)} · {report.reporterRole === "STORE" ? "Mağaza" : "Müştəri"} şikayət edib · <span className="font-medium">{REPORT_STATUS_LABELS[report.status]}</span>{report.reviewedAt ? ` (${formatMessageTime(report.reviewedAt)}${report.reviewedBy ? `, ${report.reviewedBy.email}` : ""})` : ""}</p>
      </div>
      {report.status === "OPEN" && <AdminReportDecision reportId={report.id}/>}
    </header>
    <p className="mb-4 rounded-control bg-amber-50 p-3 text-xs text-amber-900">Bu söhbətin açılması audit jurnalına yazıldı (CONVERSATION_ADMIN_VIEW).</p>
    <div className="grid gap-5 xl:grid-cols-[320px_1fr]">
      <aside className="grid content-start gap-5">
        <section className={card}>
          <h2 className="font-semibold">Söhbət</h2>
          <dl className="mt-3 grid grid-cols-[110px_1fr] gap-2 text-sm">
            <dt className="text-fg-secondary">Mağaza</dt><dd><Link href={`/admin/stores/${encodeURIComponent(conversation.store.id)}`} className="text-primary">{conversation.store.name}</Link></dd>
            <dt className="text-fg-secondary">Müştəri</dt><dd>{conversation.customer}{conversation.customerDeleted ? " (hesab silinib)" : ""}</dd>
            <dt className="text-fg-secondary">Mövzu</dt><dd>{contextLabels[conversation.context]}{conversation.product ? `: ${conversation.product.name}` : ""}{conversation.orderRef ? ` · ${conversation.orderRef}` : ""}</dd>
            <dt className="text-fg-secondary">Başlayıb</dt><dd>{formatMessageTime(conversation.createdAt)}</dd>
          </dl>
        </section>
        <section className={card}>
          <h2 className="font-semibold">Şikayət qeydi</h2>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-fg-body">{report.note || "Qeyd yazılmayıb."}</p>
        </section>
        {otherReports.length > 0 && <section className={card}>
          <h2 className="font-semibold">Bu söhbətə digər şikayətlər</h2>
          <ul className="mt-2 divide-y divide-line text-sm">{otherReports.map((item) => <li key={item.id} className="py-2">
            <Link prefetch={false} href={`/admin/messages/reports/${encodeURIComponent(item.id)}`} className="text-primary">{item.reasonLabel}</Link> · {item.reporterRole === "STORE" ? "Mağaza" : "Müştəri"} · {REPORT_STATUS_LABELS[item.status]} · {formatMessageTime(item.createdAt)}
          </li>)}</ul>
        </section>}
      </aside>
      <section className={card} aria-label="Mesajlar">
        <h2 className="font-semibold">Mesajlar ({messages.length}{truncated ? `, son ${ADMIN_MESSAGE_LIMIT}` : ""})</h2>
        <ol className="mt-3 grid gap-2.5">
          {messages.map((message) => <li key={message.id} className={`flex ${message.senderRole === "STORE" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-card px-3.5 py-2.5 ${message.senderRole === "STORE" ? "bg-primary text-white" : "bg-surface-page text-fg"}`}>
              <p className={`text-[11px] font-semibold ${message.senderRole === "STORE" ? "text-white/80" : "text-fg-secondary"}`}>{sender(message.senderRole)}</p>
              <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.body}</p>
              <p className={`mt-1 text-[11px] ${message.senderRole === "STORE" ? "text-white/70" : "text-fg-secondary"}`}>{formatMessageTime(message.createdAt)}</p>
            </div>
          </li>)}
        </ol>
      </section>
    </div>
  </AdminShell>;
}
