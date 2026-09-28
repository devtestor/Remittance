import { getConfig } from "@glr/config";
import { processProviderEvent } from "@glr/provider-events";
import { getProviderRetryDecision } from "./reconciliation.js";
import {
  findTransferById,
  incrementProviderEventRetry,
  listProviderEventsForReconciliation,
  prisma,
  updateProviderEventRecord
} from "@glr/db";

const config = getConfig();
const intervalMs = Number.parseInt(process.env.PROVIDER_RECONCILIATION_INTERVAL_MS ?? "30000", 10);
const staleAfterMs = Number.parseInt(process.env.PROVIDER_EVENT_STALE_AFTER_MS ?? "60000", 10);
const maxRetries = Number.parseInt(process.env.PROVIDER_EVENT_MAX_RETRIES ?? "3", 10);

console.log(`Worker booted for ${config.nodeEnv} environment`);

async function reconcileProviderEvents(): Promise<void> {
  const staleBefore = new Date(Date.now() - staleAfterMs);
  const events = await listProviderEventsForReconciliation({ staleBefore });

  if (!events.length) {
    return;
  }

  for (const event of events) {
    if (getProviderRetryDecision(event.retryCount, maxRetries) === "exhausted") {
      await updateProviderEventRecord({
        id: event.id,
        status: "ignored",
        errorMessage: `Provider event retry limit exhausted after ${event.retryCount} attempts`
      });
      console.error(JSON.stringify({
        level: "error",
        action: "provider_event_retry_exhausted",
        eventId: event.id,
        transferId: event.transferId,
        retryCount: event.retryCount
      }));
      continue;
    }

    const retryCount = await incrementProviderEventRetry(event.id);
    if (!event.transferId) {
      await updateProviderEventRecord({ id: event.id, status: "ignored", errorMessage: "Provider event has no transfer" });
      continue;
    }

    const transfer = await findTransferById(event.transferId);
    if (!transfer) {
      await updateProviderEventRecord({ id: event.id, status: "failed", errorMessage: "Transfer not found during reconciliation" });
      continue;
    }

    try {
      const eventType = event.eventType;
      if (!(["payment_received", "payout_submitted", "payout_completed", "payout_failed"] as string[]).includes(eventType)) {
        await updateProviderEventRecord({ id: event.id, status: "ignored", errorMessage: `Unsupported provider event: ${eventType}` });
        continue;
      }

      await processProviderEvent({
        providerEventId: event.id,
        provider: event.provider,
        eventType: eventType as "payment_received" | "payout_submitted" | "payout_completed" | "payout_failed",
        transfer,
        actorType: "system",
        reasonPrefix: "provider_reconciliation"
      });
    } catch (error) {
      await updateProviderEventRecord({
        id: event.id,
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Provider reconciliation failed"
      });
    }

    console.warn(JSON.stringify({
      level: "warn",
      action: "provider_event_reconciliation_required",
      eventId: event.id,
      provider: event.provider,
      eventType: event.eventType,
      transferId: event.transferId,
      status: event.status,
      retryCount,
      receivedAt: event.receivedAt.toISOString(),
      errorMessage: event.errorMessage
    }));
  }
}

void reconcileProviderEvents().catch((error) => {
  console.error("Provider reconciliation failed", error);
});

const timer = setInterval(() => {
  void reconcileProviderEvents().catch((error) => {
    console.error("Provider reconciliation failed", error);
  });
}, intervalMs);

async function shutdown(): Promise<void> {
  clearInterval(timer);
  await prisma.$disconnect();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
