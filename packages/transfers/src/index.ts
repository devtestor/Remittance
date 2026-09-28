import { createBalancedLedgerTransaction, type LedgerTransactionDraft } from "@glr/ledger";
import type {
  CurrencyCode,
  Money,
  PaymentMethod,
  PayoutMethod,
  Transfer,
  TransferFailureReason,
  TransferQuote,
  TransferStatus
} from "@glr/types";

export type QuoteInput = {
  sourceAmount: Money;
  destinationCurrency: CurrencyCode;
  exchangeRate: string;
  feeBasisPoints: number;
  fixedFeeMinor: string;
  now: Date;
  ttlMinutes: number;
};

export type CreateTransferInput = {
  id: string;
  senderUserId: string;
  beneficiaryId: string;
  quote: TransferQuote;
  paymentMethod: PaymentMethod;
  payoutMethod: PayoutMethod;
  now: Date;
};

export type TransferEvent =
  | { type: "QUOTE_ACCEPTED" }
  | { type: "PAYMENT_RECEIVED" }
  | { type: "COMPLIANCE_REVIEW_REQUIRED" }
  | { type: "COMPLIANCE_APPROVED" }
  | { type: "PAYOUT_SUBMITTED" }
  | { type: "PAYOUT_COMPLETED" }
  | { type: "FAIL"; reason: TransferFailureReason }
  | { type: "CANCEL"; reason: Extract<TransferFailureReason, "cancelled_by_user" | "cancelled_by_admin"> };

export type ProviderTransferEvent = "payment_received" | "payout_submitted" | "payout_completed" | "payout_failed";

export function applyProviderTransferEvent(
  transfer: Transfer,
  providerEvent: ProviderTransferEvent,
  now: Date
): { transfer: Transfer; postsPaymentLedger: boolean } {
  const event: TransferEvent = providerEvent === "payment_received"
    ? { type: "PAYMENT_RECEIVED" }
    : providerEvent === "payout_submitted"
      ? { type: "PAYOUT_SUBMITTED" }
      : providerEvent === "payout_completed"
        ? { type: "PAYOUT_COMPLETED" }
        : { type: "FAIL", reason: "payout_failed" };

  return {
    transfer: applyTransferEvent(transfer, event, now),
    postsPaymentLedger: providerEvent === "payment_received"
  };
}

const currencyExponent: Record<CurrencyCode, number> = {
  USD: 2,
  RWF: 0,
  KES: 2,
  UGX: 0,
  TZS: 0,
  CDF: 2
};

const transitions: Record<TransferStatus, Partial<Record<TransferEvent["type"], TransferStatus>>> = {
  draft: {
    QUOTE_ACCEPTED: "quoted",
    CANCEL: "cancelled"
  },
  quoted: {
    QUOTE_ACCEPTED: "pending_payment",
    CANCEL: "cancelled"
  },
  pending_payment: {
    PAYMENT_RECEIVED: "payment_received",
    COMPLIANCE_REVIEW_REQUIRED: "under_review",
    FAIL: "failed",
    CANCEL: "cancelled"
  },
  payment_received: {
    COMPLIANCE_REVIEW_REQUIRED: "under_review",
    PAYOUT_SUBMITTED: "processing_payout",
    FAIL: "failed"
  },
  under_review: {
    COMPLIANCE_APPROVED: "payment_received",
    FAIL: "failed",
    CANCEL: "cancelled"
  },
  processing_payout: {
    PAYOUT_COMPLETED: "completed",
    FAIL: "failed"
  },
  completed: {},
  failed: {},
  cancelled: {}
};

export function createQuote(input: QuoteInput): TransferQuote {
  const sourceAmountMinor = parseMinor(input.sourceAmount.amountMinor);
  const fixedFeeMinor = parseMinor(input.fixedFeeMinor);
  const variableFeeMinor = (sourceAmountMinor * BigInt(input.feeBasisPoints)) / 10_000n;
  const feeAmountMinor = fixedFeeMinor + variableFeeMinor;

  if (feeAmountMinor >= sourceAmountMinor) {
    throw new Error("Fee must be lower than source amount");
  }

  const netSourceAmountMinor = sourceAmountMinor - feeAmountMinor;
  const destinationAmountMinor = convertMinorAmount({
    amountMinor: netSourceAmountMinor,
    sourceCurrency: input.sourceAmount.currency,
    destinationCurrency: input.destinationCurrency,
    exchangeRate: input.exchangeRate
  });

  return {
    id: `quote_${input.now.getTime()}`,
    sourceAmount: input.sourceAmount,
    destinationAmount: {
      amountMinor: destinationAmountMinor.toString(),
      currency: input.destinationCurrency
    },
    feeAmount: {
      amountMinor: feeAmountMinor.toString(),
      currency: input.sourceAmount.currency
    },
    exchangeRate: input.exchangeRate,
    expiresAt: new Date(input.now.getTime() + input.ttlMinutes * 60_000).toISOString()
  };
}

export function createTransfer(input: CreateTransferInput): Transfer {
  return {
    id: input.id,
    senderUserId: input.senderUserId,
    beneficiaryId: input.beneficiaryId,
    sourceAmount: input.quote.sourceAmount,
    destinationAmount: input.quote.destinationAmount,
    feeAmount: input.quote.feeAmount,
    exchangeRate: input.quote.exchangeRate,
    paymentMethod: input.paymentMethod,
    payoutMethod: input.payoutMethod,
    status: "pending_payment",
    createdAt: input.now.toISOString(),
    updatedAt: input.now.toISOString()
  };
}

export function applyTransferEvent(transfer: Transfer, event: TransferEvent, now: Date): Transfer {
  const nextStatus = transitions[transfer.status][event.type];

  if (!nextStatus) {
    throw new Error(`Invalid transfer transition from ${transfer.status} using ${event.type}`);
  }

  const nextTransfer: Transfer = {
    ...transfer,
    status: nextStatus,
    updatedAt: now.toISOString()
  };

  if (event.type === "FAIL" || event.type === "CANCEL") {
    nextTransfer.failureReason = event.reason;
  }

  return nextTransfer;
}

export function createPaymentReceivedLedgerTransaction(transfer: Transfer): LedgerTransactionDraft {
  const amountMinor = parseMinor(transfer.sourceAmount.amountMinor);

  return createBalancedLedgerTransaction(`transfer:${transfer.id}:payment-received`, [
    {
      accountId: `platform:cash:${transfer.sourceAmount.currency.toLowerCase()}`,
      side: "debit",
      amountMinor,
      currency: transfer.sourceAmount.currency,
      memo: `Payment received for transfer ${transfer.id}`
    },
    {
      accountId: `customer:${transfer.senderUserId}:payable`,
      side: "credit",
      amountMinor,
      currency: transfer.sourceAmount.currency,
      memo: `Customer payable for transfer ${transfer.id}`
    }
  ]);
}

export function createPayoutFailedRefundLedgerTransaction(transfer: Transfer): LedgerTransactionDraft {
  const amountMinor = parseMinor(transfer.sourceAmount.amountMinor);

  return createBalancedLedgerTransaction(`transfer:${transfer.id}:payout-failed-refund`, [
    {
      accountId: `customer:${transfer.senderUserId}:payable`,
      side: "debit",
      amountMinor,
      currency: transfer.sourceAmount.currency,
      memo: `Refund for failed payout on transfer ${transfer.id}`
    },
    {
      accountId: `platform:cash:${transfer.sourceAmount.currency.toLowerCase()}`,
      side: "credit",
      amountMinor,
      currency: transfer.sourceAmount.currency,
      memo: `Cash returned for failed payout on transfer ${transfer.id}`
    }
  ]);
}

function convertMinorAmount(input: {
  amountMinor: bigint;
  sourceCurrency: CurrencyCode;
  destinationCurrency: CurrencyCode;
  exchangeRate: string;
}): bigint {
  const sourceScale = 10n ** BigInt(currencyExponent[input.sourceCurrency]);
  const destinationScale = 10n ** BigInt(currencyExponent[input.destinationCurrency]);
  const rate = decimalToRatio(input.exchangeRate);
  const numerator = input.amountMinor * destinationScale * rate.numerator;
  const denominator = sourceScale * rate.denominator;

  return roundDiv(numerator, denominator);
}

function decimalToRatio(value: string): { numerator: bigint; denominator: bigint } {
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new Error("Exchange rate must be a positive decimal string");
  }

  const [whole, fraction = ""] = value.split(".");
  const denominator = 10n ** BigInt(fraction.length);
  return {
    numerator: BigInt(`${whole}${fraction}`),
    denominator
  };
}

function parseMinor(value: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new Error("Money amountMinor must be a non-negative integer string");
  }

  return BigInt(value);
}

function roundDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}
