/**
 * Admin access to customer <-> store conversations (phase 8). Server-only. The ONLY admin code that reads the
 * messaging tables. Rules (owner decision 2026-11-17):
 *
 * - Admin reaches a conversation only through one of its reports: there is no conversation list, no search, no lookup
 *   by conversation id. A conversation that was never reported is unreachable for admin.
 * - The report list shows store, customer display name, reason, date and status, never message text.
 * - Every open of a report writes an AuditLog row CONVERSATION_ADMIN_VIEW (actor, conversation id, report id) in the
 *   same transaction that reads the messages: no audit row, no messages.
 * - Marking a report REVIEWED or DISMISSED is audited (CONVERSATION_REPORT_REVIEWED / _DISMISSED).
 * - Orphans (customer account deleted, customerId NULL) are readable here, through their report, and nowhere else.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { customerDisplayName, REPORT_REASONS, type ReportReason } from "@/lib/messaging";

type Db = PrismaClient;

export const CONVERSATION_ADMIN_VIEW = "CONVERSATION_ADMIN_VIEW";
export const REPORT_DECISION_ACTIONS = { REVIEWED: "CONVERSATION_REPORT_REVIEWED", DISMISSED: "CONVERSATION_REPORT_DISMISSED" } as const;
export const REPORT_STATUSES = ["OPEN", "REVIEWED", "DISMISSED"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = { OPEN: "Açıq", REVIEWED: "Baxılıb", DISMISSED: "Rədd edilib" };
export const DELETED_CUSTOMER_LABEL = "Silinmiş hesab";
/** Messages shown when a report is opened (newest, in time order). */
export const ADMIN_MESSAGE_LIMIT = 200;

export const reportReasonLabel = (reason: string) => (Object.prototype.hasOwnProperty.call(REPORT_REASONS, reason) ? REPORT_REASONS[reason as ReportReason] : reason);
export const isReportStatus = (value: unknown): value is ReportStatus => typeof value === "string" && (REPORT_STATUSES as readonly string[]).includes(value);

const customerName = (conversation: { customerId: string | null; customer: { customerProfile: { firstName: string | null; lastName: string | null } | null } | null }) =>
  conversation.customerId === null ? DELETED_CUSTOMER_LABEL : customerDisplayName(conversation.customer?.customerProfile?.firstName, conversation.customer?.customerProfile?.lastName);

/** Report list (newest first). No message text and no reporter note: those are shown only when a report is opened. */
/** ADMIN-POWER-1: the number of OPEN reports for the dashboard queue (a count only: no report, conversation or message is read). */
export function countOpenConversationReports(db: Pick<PrismaClient, "conversationReport">): Promise<number> {
  return db.conversationReport.count({ where: { status: "OPEN" } });
}

export async function listConversationReports(db: Db, input: { status?: ReportStatus | null; skip?: number; take?: number }) {
  const where: Prisma.ConversationReportWhereInput = input.status ? { status: input.status } : {};
  const take = Math.min(Math.max(input.take ?? 25, 1), 100);
  const [rows, total] = await Promise.all([
    db.conversationReport.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: Math.max(input.skip ?? 0, 0),
      take,
      select: {
        id: true, reason: true, status: true, reporterRole: true, createdAt: true, reviewedAt: true,
        conversation: { select: { context: true, customerId: true, store: { select: { id: true, name: true } }, customer: { select: { customerProfile: { select: { firstName: true, lastName: true } } } } } },
      },
    }),
    db.conversationReport.count({ where }),
  ]);
  return {
    total,
    items: rows.map((row) => ({
      id: row.id,
      reason: row.reason,
      reasonLabel: reportReasonLabel(row.reason),
      status: row.status,
      reporterRole: row.reporterRole,
      createdAt: row.createdAt,
      reviewedAt: row.reviewedAt,
      context: row.conversation.context,
      store: row.conversation.store,
      customer: customerName(row.conversation),
      customerDeleted: row.conversation.customerId === null,
    })),
  };
}

/**
 * Opens one report for an admin: writes the CONVERSATION_ADMIN_VIEW audit row FIRST, then reads the conversation, in
 * one transaction. Null for an unknown report id (nothing is written, nothing is read).
 */
export async function openReportForAdmin(db: Db, input: { reportId: string; adminId: string }) {
  return db.$transaction(async (tx) => {
    const report = await tx.conversationReport.findUnique({ where: { id: input.reportId }, select: { id: true, conversationId: true } });
    if (!report) return null;
    await tx.auditLog.create({
      data: { actorId: input.adminId, action: CONVERSATION_ADMIN_VIEW, entityType: "Conversation", entityId: report.conversationId, metadata: { reportId: report.id } },
    });
    const conversation = await tx.conversation.findUniqueOrThrow({
      where: { id: report.conversationId },
      select: {
        id: true, context: true, customerId: true, createdAt: true,
        store: { select: { id: true, name: true } },
        customer: { select: { customerProfile: { select: { firstName: true, lastName: true } } } },
        product: { select: { id: true, name: true } },
        storeOrder: { select: { id: true, orderId: true } },
        reports: { orderBy: { createdAt: "desc" }, select: { id: true, reason: true, note: true, status: true, reporterRole: true, createdAt: true, reviewedAt: true, reviewedBy: { select: { email: true } } } },
      },
    });
    const newest = await tx.conversationMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: ADMIN_MESSAGE_LIMIT + 1,
      select: { id: true, senderRole: true, body: true, createdAt: true },
    });
    const opened = conversation.reports.find((item) => item.id === report.id)!;
    return {
      report: { ...opened, reasonLabel: reportReasonLabel(opened.reason) },
      otherReports: conversation.reports.filter((item) => item.id !== report.id).map((item) => ({ ...item, reasonLabel: reportReasonLabel(item.reason) })),
      conversation: {
        id: conversation.id,
        context: conversation.context,
        createdAt: conversation.createdAt,
        store: conversation.store,
        customer: customerName(conversation),
        customerDeleted: conversation.customerId === null,
        product: conversation.product,
        orderRef: conversation.storeOrder ? conversation.storeOrder.orderId.slice(-8).toUpperCase() : null,
        orderId: conversation.storeOrder?.orderId ?? null,
      },
      messages: newest.slice(0, ADMIN_MESSAGE_LIMIT).reverse(),
      truncated: newest.length > ADMIN_MESSAGE_LIMIT,
    };
  });
}

/**
 * Admin decision on an OPEN report (REVIEWED or DISMISSED), audited in the same transaction. A report that is not OPEN
 * any more is left as it is ("ALREADY_DECIDED").
 */
export async function decideReport(db: Db, input: { reportId: string; adminId: string; status: "REVIEWED" | "DISMISSED"; now?: Date }) {
  return db.$transaction(async (tx) => {
    const report = await tx.conversationReport.findUnique({ where: { id: input.reportId }, select: { id: true, status: true, conversationId: true } });
    if (!report) return { result: "NOT_FOUND" as const };
    const updated = await tx.conversationReport.updateMany({
      where: { id: report.id, status: "OPEN" },
      data: { status: input.status, reviewedById: input.adminId, reviewedAt: input.now ?? new Date() },
    });
    if (updated.count === 0) return { result: "ALREADY_DECIDED" as const, status: report.status };
    await tx.auditLog.create({
      data: { actorId: input.adminId, action: REPORT_DECISION_ACTIONS[input.status], entityType: "ConversationReport", entityId: report.id, metadata: { conversationId: report.conversationId, previousStatus: report.status } },
    });
    return { result: "DECIDED" as const, status: input.status };
  });
}
