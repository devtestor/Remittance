import assert from "node:assert/strict";
import test from "node:test";
import { assertBalanced, createBalancedLedgerTransaction } from "./index.js";

test("accepts balanced ledger entries by currency", () => {
  assert.doesNotThrow(() => {
    assertBalanced([
      {
        accountId: "cash:usd",
        side: "debit",
        amountMinor: 1000n,
        currency: "USD",
        memo: "cash received"
      },
      {
        accountId: "liability:customer",
        side: "credit",
        amountMinor: 1000n,
        currency: "USD",
        memo: "customer liability"
      }
    ]);
  });
});

test("rejects unbalanced ledger entries", () => {
  assert.throws(
    () =>
      assertBalanced([
        {
          accountId: "cash:usd",
          side: "debit",
          amountMinor: 1000n,
          currency: "USD",
          memo: "cash received"
        },
        {
          accountId: "liability:customer",
          side: "credit",
          amountMinor: 900n,
          currency: "USD",
          memo: "customer liability"
        }
      ]),
    /Unbalanced ledger entries/
  );
});

test("rejects zero or negative ledger entry amounts", () => {
  assert.throws(
    () =>
      createBalancedLedgerTransaction("transfer:test", [
        {
          accountId: "cash:usd",
          side: "debit",
          amountMinor: 0n,
          currency: "USD",
          memo: "cash received"
        },
        {
          accountId: "liability:customer",
          side: "credit",
          amountMinor: 0n,
          currency: "USD",
          memo: "customer liability"
        }
      ]),
    /positive/
  );
});
