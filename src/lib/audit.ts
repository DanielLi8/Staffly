import type { Prisma } from "@prisma/client";

/**
 * Staff and department administration audit actions. Written in the same
 * transaction as the change they describe, so a row exists exactly when the
 * change does.
 */
export type AuditAction =
  | "STAFF_CREATED"
  | "STAFF_UPDATED"
  | "STAFF_DEACTIVATED"
  | "STAFF_REACTIVATED"
  | "DEPARTMENT_CREATED"
  | "DEPARTMENT_UPDATED";

export interface AuditEntry {
  actorId: string;
  action: AuditAction;
  targetType: "User" | "Department";
  targetId: string;
  hospitalId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

export async function writeAudit(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      hospitalId: entry.hospitalId ?? null,
      metadata: entry.metadata,
    },
  });
}
