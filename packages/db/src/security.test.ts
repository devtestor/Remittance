import assert from "node:assert/strict";
import test from "node:test";
import { createAdminUserRecord, prisma, recordAdminLoginFailure, touchAdminUserLastLogin } from "./index.js";

test("persists admin login lockout state and clears it after a successful login", async (context) => {
  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    context.skip("PostgreSQL is not available");
    return;
  }

  const email = `security-${Date.now()}@velo.local`;
  const user = await createAdminUserRecord({
    email,
    passwordHash: "test-password-hash",
    role: "admin"
  });

  try {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const failure = await recordAdminLoginFailure({ id: user.id, maxAttempts: 5, lockDurationMs: 900_000 });
      assert.equal(failure.lockedUntil, undefined);
    }

    const locked = await recordAdminLoginFailure({ id: user.id, maxAttempts: 5, lockDurationMs: 900_000 });
    assert.ok(locked.lockedUntil);

    await touchAdminUserLastLogin(user.id);
    const refreshed = await prisma.adminUser.findUnique({ where: { id: user.id } });
    assert.equal(refreshed?.failedLoginAttempts, 0);
    assert.equal(refreshed?.lockedUntil, null);
  } finally {
    await prisma.adminUser.delete({ where: { id: user.id } });
  }
});
