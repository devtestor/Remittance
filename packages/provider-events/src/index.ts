import {
  createAuditLogRecord,
  createLedgerTransactionRecord,
  recordTransferStateChange,
  updateProviderEventRecord,
  updateTransferRecord
} from "@glr/db";
import {
  applyProviderTransferEvent,
  createPaymentReceivedLedgerTransaction,
  createPayoutFailedRefundLedgerTransaction
} from "@glr/transfers";
import type { ProviderTransferEvent } from "@glr/transfers";
import type { Transfer } from "@glr/types";

export async function processProviderEvent(input: {
  providerEventId: string;
  provider: string;
  eventType: ProviderTransferEvent;
  transfer: Transfer;
  actorType: "provider" | "system" | "admin";
  actorAdminUserId?: string;
  reasonPrefix: string;
}): Promise<Transfer> {
  const result = applyProviderTransferEvent(input.transfer, input.eventType, new Date());
  const updatedTransfer = result.transfer;

  await updateTransferRecord(updatedTransfer);
  await recordTransferStateChange({
    transferId: input.transfer.id,
    fromStatus: input.transfer.status,
    toStatus: updatedTransfer.status,
    reason: `${input.reasonPrefix}:${input.eventType}`,
    actorType: input.actorType
  });

  if (result.postsPaymentLedger) {
    await createLedgerTransactionRecord({
      transferId: input.transfer.id,
      memo: `Payment received for transfer ${input.transfer.id}`,
      ledgerTransaction: createPaymentReceivedLedgerTransaction(updatedTransfer)
    });
  }

  if (input.eventType === "payout_failed") {
    await createLedgerTransactionRecord({
      transferId: input.transfer.id,
      memo: `Refund for failed payout on transfer ${input.transfer.id}`,
      ledgerTransaction: createPayoutFailedRefundLedgerTransaction(updatedTransfer)
    });
  }

  await updateProviderEventRecord({ id: input.providerEventId, status: "processed" });
  await createAuditLogRecord({
    actorType: input.actorType,
    ...(input.actorAdminUserId ? { actorAdminUserId: input.actorAdminUserId } : {}),
    action: `${input.provider}.provider_event.${input.eventType}`,
    entityType: "transfer",
    entityId: input.transfer.id,
    metadata: { provider: input.provider, providerEventId: input.providerEventId }
  });

  return updatedTransfer;
}
