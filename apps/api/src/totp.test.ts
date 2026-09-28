import assert from "node:assert/strict";
import test from "node:test";
import { createTotpSecret, createTotpUri, verifyTotpCode } from "./totp.js";

test("verifies RFC 6238 SHA-1 test vectors", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

  assert.equal(verifyTotpCode(secret, "287082", 59_000), true);
  assert.equal(verifyTotpCode(secret, "081804", 1_111_111_109_000), true);
  assert.equal(verifyTotpCode(secret, "000000", 59_000), false);
});

test("creates authenticator setup material", () => {
  const secret = createTotpSecret();
  const uri = createTotpUri({ secret, account: "admin@velo.local", issuer: "Velo" });

  assert.equal(secret.length, 32);
  assert.match(uri, /^otpauth:\/\/totp\/Velo:admin%40velo\.local\?/);
  assert.match(uri, new RegExp(`secret=${secret}`));
});
