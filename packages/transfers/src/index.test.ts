import assert from "node:assert/strict";
import test from "node:test";
import {
  applyProviderTransferEvent,
  applyTransferEvent,
  createPaymentReceivedLedgerTransaction,
  createPayoutFailedRefundLedgerTransaction,
  createQuote,
  createTransfer
} from "./index.js";

test("creates a quote with fixed and variable fees", () => {
  const quote = createQuote({
    sourceAmount: {
      amountMinor: "10000",
      currency: "USD"
    },
    destinationCurrency: "RWF",
    exchangeRate: "1410.25",
    feeBasisPoints: 150,
    fixedFeeMinor: "99",
    now: new Date("2026-09-07T00:00:00.000Z"),
    ttlMinutes: 15
  });

  assert.equal(quote.feeAmount.amountMinor, "249");
  assert.equal(quote.destinationAmount.currency, "RWF");
  assert.equal(quote.destinationAmount.amountMinor, "137513");
  assert.equal(quote.expiresAt, "2026-09-07T00:15:00.000Z");
});

test("advances transfer through payment and payout states", () => {
  const now = new Date("2026-09-07T00:00:00.000Z");
  const quote = createQuote({
    sourceAmount: {
      amountMinor: "10000",
      currency: "USD"
    },
    destinationCurrency: "RWF",
    exchangeRate: "1410.25",
    feeBasisPoints: 150,
    fixedFeeMinor: "99",
    now,
    ttlMinutes: 15
  });

  const transfer = createTransfer({
    id: "tr_123",
    senderUserId: "user_123",
    beneficiaryId: "ben_123",
    quote,
    paymentMethod: "card",
    payoutMethod: "mobile_money",
    now
  });

  const paid = applyTransferEvent(transfer, { type: "PAYMENT_RECEIVED" }, now);
  const processing = applyTransferEvent(paid, { type: "PAYOUT_SUBMITTED" }, now);
  const completed = applyTransferEvent(processing, { type: "PAYOUT_COMPLETED" }, now);

  assert.equal(completed.status, "completed");
});

test("rejects invalid transfer transitions", () => {
  const now = new Date("2026-09-07T00:00:00.000Z");
  const quote = createQuote({
    sourceAmount: {
      amountMinor: "10000",
      currency: "USD"
    },
    destinationCurrency: "RWF",
    exchangeRate: "1410.25",
    feeBasisPoints: 150,
    fixedFeeMinor: "99",
    now,
    ttlMinutes: 15
  });
  const transfer = createTransfer({
    id: "tr_123",
    senderUserId: "user_123",
    beneficiaryId: "ben_123",
    quote,
    paymentMethod: "card",
    payoutMethod: "mobile_money",
    now
  });

  assert.throws(
    () => applyTransferEvent(transfer, { type: "PAYOUT_COMPLETED" }, now),
    /Invalid transfer transition/
  );
});

test("creates balanced payment received ledger entries", () => {
  const now = new Date("2026-09-07T00:00:00.000Z");
  const quote = createQuote({
    sourceAmount: {
      amountMinor: "10000",
      currency: "USD"
    },
    destinationCurrency: "RWF",
    exchangeRate: "1410.25",
    feeBasisPoints: 150,
    fixedFeeMinor: "99",
    now,
    ttlMinutes: 15
  });
  const transfer = createTransfer({
    id: "tr_123",
    senderUserId: "user_123",
    beneficiaryId: "ben_123",
    quote,
    paymentMethod: "card",
    payoutMethod: "mobile_money",
    now
  });

  const transaction = createPaymentReceivedLedgerTransaction(transfer);

  assert.equal(transaction.idempotencyKey, "transfer:tr_123:payment-received");
  assert.equal(transaction.entries.length, 2);
});

test("maps provider events to the shared transfer lifecycle", () => {
  const now = new Date("2026-09-07T00:00:00.000Z");
  const quote = createQuote({
    sourceAmount: { amountMinor: "10000", currency: "USD" },
    destinationCurrency: "RWF",
    exchangeRate: "1410.25",
    feeBasisPoints: 150,
    fixedFeeMinor: "99",
    now,
    ttlMinutes: 15
  });
  const transfer = createTransfer({
    id: "tr_provider",
    senderUserId: "user_provider",
    beneficiaryId: "ben_provider",
    quote,
    paymentMethod: "card",
    payoutMethod: "mobile_money",
    now
  });

  const paid = applyProviderTransferEvent(transfer, "payment_received", now);
  const completed = applyProviderTransferEvent(paid.transfer, "payout_submitted", now);

  assert.equal(paid.transfer.status, "payment_received");
  assert.equal(paid.postsPaymentLedger, true);
  assert.equal(completed.transfer.status, "processing_payout");
  assert.equal(completed.postsPaymentLedger, false);
});

test("creates an idempotent balanced refund for a failed payout", () => {
  const now = new Date("2026-09-07T00:00:00.000Z");
  const transfer = createTransfer({
    id: "tr_refund",
    senderUserId: "user_refund",
    beneficiaryId: "ben_refund",
    quote: createQuote({
      sourceAmount: { amountMinor: "12500", currency: "USD" },
      destinationCurrency: "RWF",
      exchangeRate: "1410.25",
      feeBasisPoints: 150,
      fixedFeeMinor: "99",
      now,
      ttlMinutes: 15
    }),
    paymentMethod: "card",
    payoutMethod: "mobile_money",
    now
  });
  const refund = createPayoutFailedRefundLedgerTransaction(transfer);

  assert.equal(refund.idempotencyKey, "transfer:tr_refund:payout-failed-refund");
  assert.equal(refund.entries[0]?.side, "debit");
  assert.equal(refund.entries[1]?.side, "credit");
  assert.equal(refund.entries[0]?.amountMinor, 12500n);
});
