import type { CurrencyCode } from "@glr/types";

export type LedgerEntrySide = "debit" | "credit";

export type LedgerEntryDraft = {
  accountId: string;
  side: LedgerEntrySide;
  amountMinor: bigint;
  currency: CurrencyCode;
  memo: string;
};

export type LedgerTransactionDraft = {
  idempotencyKey: string;
  entries: LedgerEntryDraft[];
};

export function assertBalanced(entries: LedgerEntryDraft[]): void {
  const totals = new Map<CurrencyCode, bigint>();

  for (const entry of entries) {
    const current = totals.get(entry.currency) ?? 0n;
    const signedAmount = entry.side === "debit" ? entry.amountMinor : -entry.amountMinor;
    totals.set(entry.currency, current + signedAmount);
  }

  for (const [currency, total] of totals.entries()) {
    if (total !== 0n) {
      throw new Error(`Unbalanced ledger entries for ${currency}`);
    }
  }
}

export function createBalancedLedgerTransaction(
  idempotencyKey: string,
  entries: LedgerEntryDraft[]
): LedgerTransactionDraft {
  if (entries.length < 2) {
    throw new Error("A ledger transaction must have at least two entries");
  }

  for (const entry of entries) {
    if (entry.amountMinor <= 0n) {
      throw new Error("Ledger entry amounts must be positive");
    }
  }

  assertBalanced(entries);

  return {
    idempotencyKey,
    entries
  };
}
