/**
 * ADMIN-3-SAFETY-1: admin writes whose audit row used to be written AFTER the change, outside any transaction (a failed
 * audit write left an unaudited change). Each function now runs the change and its audit row in ONE transaction, so
 * either both are saved or neither. Action names, entity types, entity ids and metadata are exactly as before
 * (app/api/admin/[...resource]/route.ts), so the audit log and the security summary read the same rows.
 */

type AuditRow = { actorId: string; action: string; entityType: string; entityId: string };
/** The parts of a Prisma transaction client these writes use. */
export type AuditedWriteTx = {
  auditLog: { create(args: { data: AuditRow }): Promise<unknown> };
  user: { update(args: { where: { id: string; role: { in: string[] } }; data: { isActive: boolean }; select: { id: true; isActive: true; role: true } }): Promise<unknown> };
  brand: { update(args: { where: { id: string }; data: { name: string } }): Promise<unknown> };
  city: { update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown> };
  supportTicket: { update(args: { where: { id: string }; data: { status: string } }): Promise<unknown> };
};
export type AuditedWriteDb = { $transaction<T>(run: (tx: AuditedWriteTx) => Promise<T>): Promise<T> };

/** Customer / seller account activate or deactivate (audit USER_ACTIVATE / USER_DEACTIVATE on User). */
export function setUserActiveAudited(db: AuditedWriteDb, adminId: string, userId: string, isActive: boolean) {
  return db.$transaction(async (tx) => {
    const item = await tx.user.update({ where: { id: userId, role: { in: ["CUSTOMER", "VENDOR"] } }, data: { isActive }, select: { id: true, isActive: true, role: true } });
    await tx.auditLog.create({ data: { actorId: adminId, action: isActive ? "USER_ACTIVATE" : "USER_DEACTIVATE", entityType: "User", entityId: userId } });
    return item;
  });
}

/** Brand rename (audit UPDATE on Brand). */
export function renameBrandAudited(db: AuditedWriteDb, adminId: string, brandId: string, name: string) {
  return db.$transaction(async (tx) => {
    const item = await tx.brand.update({ where: { id: brandId }, data: { name } });
    await tx.auditLog.create({ data: { actorId: adminId, action: "UPDATE", entityType: "Brand", entityId: brandId } });
    return item;
  });
}

/** City name / slug / country code / active change (audit UPDATE on City). `data` is the update as built by the route. */
export function updateCityAudited(db: AuditedWriteDb, adminId: string, cityId: string, auditEntityId: string, data: Record<string, unknown>) {
  return db.$transaction(async (tx) => {
    const item = await tx.city.update({ where: { id: cityId }, data });
    await tx.auditLog.create({ data: { actorId: adminId, action: "UPDATE", entityType: "City", entityId: auditEntityId } });
    return item;
  });
}

/** Support ticket status (audit TICKET_<STATUS> on SupportTicket). */
export function setTicketStatusAudited(db: AuditedWriteDb, adminId: string, ticketId: string, status: string) {
  return db.$transaction(async (tx) => {
    const item = await tx.supportTicket.update({ where: { id: ticketId }, data: { status } });
    await tx.auditLog.create({ data: { actorId: adminId, action: `TICKET_${status}`, entityType: "SupportTicket", entityId: ticketId } });
    return item;
  });
}
