import assert from "node:assert/strict";
import test from "node:test";
import { getProviderRetryDecision } from "./reconciliation.js";

test("retries provider events below the retry limit", () => {
  assert.equal(getProviderRetryDecision(0, 3), "retry");
  assert.equal(getProviderRetryDecision(2, 3), "retry");
});

test("marks provider events exhausted at the retry limit", () => {
  assert.equal(getProviderRetryDecision(3, 3), "exhausted");
  assert.equal(getProviderRetryDecision(4, 3), "exhausted");
});
