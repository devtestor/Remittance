import assert from "node:assert/strict";
import test from "node:test";
import { consumeRateLimit } from "./rate-limit.js";

test("allows requests up to the configured limit and rejects the next one", async () => {
  const key = `security-test:${Date.now()}`;
  const first = await consumeRateLimit({ key, limit: 2, windowMs: 60_000 });
  const second = await consumeRateLimit({ key, limit: 2, windowMs: 60_000 });
  const third = await consumeRateLimit({ key, limit: 2, windowMs: 60_000 });

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
  assert.ok(third.retryAfterSeconds > 0);
});
