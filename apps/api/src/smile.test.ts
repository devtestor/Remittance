import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "@glr/config";
import { Signature } from "smile-identity-core";
import { parseSmileCallback, SmileSignatureError } from "./smile.js";

const config: AppConfig = {
  nodeEnv: "test",
  apiPort: 4000,
  otpProvider: "console",
  kycProvider: "smile",
  smilePartnerId: "test-partner",
  smileApiKey: "test-api-key",
  smileCallbackUrl: "https://example.test/callback",
  smileSidServer: "0",
  adminPasswordDelivery: "console"
};

test("rejects Smile callbacks without a signature", () => {
  assert.throws(
    () => parseSmileCallback(config, { timestamp: "2026-09-08T00:00:00Z", partner_params: { job_id: "job_1" } }),
    SmileSignatureError
  );
});

test("rejects Smile callbacks with an invalid signature", () => {
  assert.throws(
    () => parseSmileCallback(config, {
      timestamp: "2026-09-08T00:00:00Z",
      signature: "invalid-signature",
      partner_params: { job_id: "job_1" },
      JobComplete: "true",
      ResultCode: "0810"
    }),
    SmileSignatureError
  );
});

test("accepts a signed approved callback", () => {
  const signed = new Signature("test-partner", "test-api-key").generate_signature("2026-09-08T00:00:00Z");
  const decision = parseSmileCallback(config, {
    timestamp: signed.timestamp,
    signature: signed.signature,
    partner_params: { job_id: "job_approved" },
    JobComplete: "true",
    ResultCode: "0810"
  });

  assert.deepEqual(decision, { jobId: "job_approved", status: "approved" });
});

test("rejects a signed callback when the signature is tampered", () => {
  const signed = new Signature("test-partner", "test-api-key").generate_signature("2026-09-08T00:00:00Z");

  assert.throws(
    () => parseSmileCallback(config, {
      timestamp: signed.timestamp,
      signature: "tampered-signature",
      partner_params: { job_id: "job_tampered" },
      JobComplete: "true",
      ResultCode: "0810"
    }),
    SmileSignatureError
  );
});
