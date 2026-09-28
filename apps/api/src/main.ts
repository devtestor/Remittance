import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getConfig } from "@glr/config";
import { processProviderEvent } from "@glr/provider-events";
import {
  createBeneficiaryRecord,
  checkDatabaseReady,
  createAuditLogRecord,
  createAdminSessionRecord,
  createAdminUserRecord,
  createLedgerTransactionRecord,
  createOtpChallengeRecord,
  createSessionRecord,
  createTransferQuoteRecord,
  createTransferRecord,
  createUserRecord,
  createProviderEventRecord,
  deleteAdminSessionByTokenHash,
  deleteAdminSessionsByUserId,
  recordAdminLoginFailure,
  setAdminMfaSecret,
  upsertAdminUserRecord,
  findBeneficiaryById,
  findTransferById,
  findTransferByIdempotencyKey,
  findTransferQuoteById,
  findAdminUserByEmail,
  findAdminUserById,
  findAdminUserBySessionTokenHash,
  findUserByEmail,
  findUserById,
  findUserByPhone,
  findUserBySessionTokenHash,
  findProviderEventByIdempotencyKey,
  getProviderEventMetrics,
  findKycCaseById,
  findLatestKycCaseByUserId,
  createKycCaseRecord,
  decideKycCase,
  decideKycCaseByProvider,
  updateUserKycStatus,
  consumeOtpChallenge,
  findOtpChallengeById,
  incrementOtpChallengeAttempts,
  getWalletSummaryByUserId,
  findAdminKycCaseDetail,
  findAdminTransferDetail,
  listAdminKycCases,
  listAdminAuditLogs,
  listAdminRiskQueue,
  listAdminUsers,
  listAdminTransfers,
  listBeneficiariesByUserId,
  listTransfersBySenderUserId,
  recordTransferStateChange,
  resetAdminUserPassword,
  touchAdminUserLastLogin,
  updateAdminUserRecord,
  updateProviderEventRecord,
  updateTransferRecord
} from "@glr/db";
import type { AdminUserProfile } from "@glr/db";
import {
  applyTransferEvent,
  createPaymentReceivedLedgerTransaction,
  createQuote,
  createTransfer
} from "@glr/transfers";
import type {
  CurrencyCode,
  CountryCode,
  HealthResponse,
  KycStatus,
  Money,
  PaymentMethod,
  PayoutMethod,
  TransferFailureReason,
  TransferStatus,
  UserRole
} from "@glr/types";
import { z, ZodError } from "zod";
import { deliverOtp } from "./otp.js";
import { consumeRateLimit } from "./rate-limit.js";
import { deliverAdminTemporaryPassword } from "./password-delivery.js";
import {
  createSmileKycToken,
  parseSmileCallback,
  SmileCallbackError,
  SmileConfigurationError,
  SmileSignatureError
} from "./smile.js";
import { createTotpSecret, createTotpUri, verifyTotpCode } from "./totp.js";

const config = getConfig();
const devAdminEmail = process.env.ADMIN_DEV_EMAIL ?? "admin@velo.local";
const devAdminPassword = process.env.ADMIN_DEV_PASSWORD ?? "velo-admin-dev";
const devComplianceEmail = process.env.COMPLIANCE_DEV_EMAIL ?? "compliance@velo.local";
const devCompliancePassword = process.env.COMPLIANCE_DEV_PASSWORD ?? "velo-compliance-dev";

const server = createServer(async (request, response) => {
  try {
    await handleRequest(request, response);
  } catch (error) {
    if (error instanceof RequestValidationError) {
      writeJson(response, 400, {
        error: "validation_error",
        issues: error.issues
      });
      return;
    }

    if (error instanceof ZodError) {
      writeJson(response, 400, {
        error: "validation_error",
        issues: error.issues
      });
      return;
    }

    if (error instanceof SmileConfigurationError) {
      writeJson(response, 503, { error: "smile_kyc_not_configured" });
      return;
    }

    if (error instanceof SmileSignatureError) {
      writeJson(response, 401, { error: "smile_signature_invalid" });
      return;
    }

    if (error instanceof SmileCallbackError) {
      writeJson(response, 400, { error: "smile_callback_invalid", message: error.message });
      return;
    }

    console.error(error);
    writeJson(response, 500, { error: "internal_server_error" });
  }
});

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders());
    response.end();
    return;
  }

  if (request.url === "/health") {
    const body: HealthResponse = {
      status: "ok",
      service: "api",
      timestamp: new Date().toISOString()
    };

    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
    return;
  }

  if (request.url === "/ready") {
    try {
      await checkDatabaseReady();
      writeJson(response, 200, { status: "ready", service: "api" });
    } catch {
      writeJson(response, 503, { status: "not_ready", service: "api" });
    }
    return;
  }

  if (request.method === "POST" && request.url === "/auth/otp/request") {
    if (!(await checkRateLimit(request, "otp_request", 5, 15 * 60_000, response))) return;
    const body = await readJson(request, otpRequestSchema);
    const code = randomBytes(4).readUInt32BE(0).toString().slice(0, 6).padStart(6, "0");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await deliverOtp(config, { phoneNumber: body.phoneNumber, code });
    const challenge = await createOtpChallengeRecord({
      email: body.email,
      phoneNumber: body.phoneNumber,
      countryCode: body.countryCode,
      codeHash: hashOtp(code),
      expiresAt
    });

    writeJson(response, 201, {
      challengeId: challenge.id,
      expiresAt: challenge.expiresAt.toISOString(),
      ...(config.nodeEnv === "development" && config.otpProvider === "console" ? { devCode: code } : {})
    });
    return;
  }

  if (request.method === "POST" && request.url === "/auth/otp/verify") {
    if (!(await checkRateLimit(request, "otp_verify", 10, 10 * 60_000, response))) return;
    const body = await readJson(request, otpVerifySchema);
    const challenge = await findOtpChallengeById(body.challengeId);

    if (!challenge || challenge.consumedAt || challenge.expiresAt.getTime() <= Date.now()) {
      writeJson(response, 401, { error: "otp_expired" });
      return;
    }

    if (challenge.attempts >= 5) {
      writeJson(response, 429, { error: "otp_attempts_exceeded" });
      return;
    }

    if (hashOtp(body.code) !== challenge.codeHash) {
      await incrementOtpChallengeAttempts(challenge.id);
      writeJson(response, 401, { error: "otp_invalid" });
      return;
    }

    await consumeOtpChallenge(challenge.id);
    const user =
      (await findUserByEmail(challenge.email)) ??
      (await findUserByPhone(challenge.phoneNumber)) ??
      (await createUserRecord({
        email: challenge.email,
        phoneNumber: challenge.phoneNumber,
        countryCode: challenge.countryCode,
        kycStatus: "not_started"
      }));
    writeJson(response, 200, await issueSession(user));
    return;
  }

  if (request.method === "POST" && request.url === "/admin/auth/login") {
    if (!(await checkRateLimit(request, "admin_login", 10, 15 * 60_000, response))) return;
    const body = await readJson(request, adminLoginSchema);
    const adminUser = await findAdminUserByEmail(body.email);

    if (adminUser?.lockedUntil && new Date(adminUser.lockedUntil).getTime() > Date.now()) {
      writeJson(response, 423, { error: "admin_account_locked" });
      return;
    }

    if (!adminUser || adminUser.disabledAt || !verifyPassword(body.password, adminUser.passwordHash)) {
      if (adminUser && !adminUser.disabledAt) {
        const failure = await recordAdminLoginFailure({
          id: adminUser.id,
          maxAttempts: 5,
          lockDurationMs: 15 * 60_000
        });

        if (failure.lockedUntil) {
          writeJson(response, 423, { error: "admin_account_locked" });
          return;
        }
      }
      writeJson(response, 401, { error: "admin_login_invalid" });
      return;
    }

    if (adminUser.mfaEnabled && (!body.mfaCode || !adminUser.mfaSecret || !verifyTotpCode(adminUser.mfaSecret, body.mfaCode))) {
      writeJson(response, 401, { error: "admin_mfa_required" });
      return;
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
    await createAdminSessionRecord({
      adminUserId: adminUser.id,
      tokenHash: hashSessionToken(token),
      expiresAt
    });
    await touchAdminUserLastLogin(adminUser.id);

    writeJson(response, 200, {
      token,
      expiresAt: expiresAt.toISOString(),
      adminUser: stripAdminPassword(adminUser)
    });
    return;
  }

  if (request.method === "GET" && request.url === "/admin/auth/me") {
    const admin = await requireAdmin(request, response, ["admin", "compliance"]);
    if (!admin) return;

    writeJson(response, 200, { adminUser: admin.user });
    return;
  }

  if (request.method === "POST" && request.url === "/admin/auth/mfa/setup") {
    const admin = await requireAdmin(request, response, ["admin", "compliance"]);
    if (!admin) return;

    const secret = createTotpSecret();
    await setAdminMfaSecret({ id: admin.user.id, secret, enabled: false });
    writeJson(response, 200, {
      secret,
      otpauthUri: createTotpUri({ secret, account: admin.user.email, issuer: "Velo" })
    });
    return;
  }

  if (request.method === "POST" && request.url === "/admin/auth/mfa/enable") {
    const admin = await requireAdmin(request, response, ["admin", "compliance"]);
    if (!admin) return;
    const body = await readJson(request, mfaCodeSchema);
    const adminUser = await findAdminUserByEmail(admin.user.email);

    if (!adminUser?.mfaSecret || !verifyTotpCode(adminUser.mfaSecret, body.mfaCode)) {
      writeJson(response, 400, { error: "admin_mfa_code_invalid" });
      return;
    }

    const user = await setAdminMfaSecret({ id: admin.user.id, secret: adminUser.mfaSecret, enabled: true });
    await createAuditLogRecord({
      actorType: "admin",
      actorAdminUserId: admin.user.id,
      action: "admin_user.mfa_enabled",
      entityType: "admin_user",
      entityId: admin.user.id
    });
    writeJson(response, 200, { adminUser: user });
    return;
  }

  if (request.method === "POST" && request.url === "/admin/auth/logout") {
    const token = readBearerToken(request);
    if (token) {
      await deleteAdminSessionByTokenHash(hashSessionToken(token));
    }
    response.writeHead(204, corsHeaders());
    response.end();
    return;
  }

  if (request.method === "POST" && request.url === "/users") {
    const body = await readJson(request, createUserRequestSchema);
    const user = await createUserRecord({
      email: body.email,
      countryCode: body.countryCode,
      ...(body.phoneNumber ? { phoneNumber: body.phoneNumber } : {}),
      ...(body.role ? { role: body.role } : {}),
      ...(body.kycStatus ? { kycStatus: body.kycStatus } : {})
    });
    writeJson(response, 201, user);
    return;
  }

  if (request.method === "GET" && request.url?.startsWith("/users?")) {
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
    const email = url.searchParams.get("email");

    if (!email) {
      writeJson(response, 400, { error: "email_required" });
      return;
    }

    writeJson(response, 200, { user: await findUserByEmail(email) });
    return;
  }

  if (request.method === "POST" && request.url === "/sessions") {
    const body = await readJson(request, createSessionRequestSchema);
    const user = await findUserById(body.userId);

    if (!user) {
      writeJson(response, 404, { error: "user_not_found" });
      return;
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await createSessionRecord({
      userId: user.id,
      tokenHash: hashSessionToken(token),
      expiresAt
    });

    writeJson(response, 201, { token, expiresAt: expiresAt.toISOString(), user });
    return;
  }

  if (request.method === "GET" && request.url?.match(/^\/sessions\/[^/]+$/)) {
    const token = request.url.split("/")[2];
    const user = token ? await findUserBySessionTokenHash(hashSessionToken(token)) : null;

    if (!user) {
      writeJson(response, 401, { error: "session_invalid" });
      return;
    }

    writeJson(response, 200, { user });
    return;
  }

  if (request.method === "GET" && request.url?.match(/^\/users\/[^/]+$/)) {
    const userId = request.url.split("/")[2];
    const user = userId ? await findUserById(userId) : null;

    if (!user) {
      writeJson(response, 404, { error: "user_not_found" });
      return;
    }

    writeJson(response, 200, user);
    return;
  }

  if (request.method === "GET" && request.url?.match(/^\/users\/[^/]+\/kyc$/)) {
    const userId = request.url.split("/")[2];
    const user = userId ? await findUserById(userId) : null;

    if (!userId || !user) {
      writeJson(response, 404, { error: "user_not_found" });
      return;
    }

    writeJson(response, 200, { user, kycCase: await findLatestKycCaseByUserId(userId) });
    return;
  }

  if (request.method === "POST" && request.url?.match(/^\/users\/[^/]+\/kyc$/)) {
    const userId = request.url.split("/")[2];
    const body = await readJson(request, submitKycRequestSchema);
    const user = userId ? await findUserById(userId) : null;

    if (!userId || !user) {
      writeJson(response, 404, { error: "user_not_found" });
      return;
    }

    const currentCase = await findLatestKycCaseByUserId(userId);
    if (currentCase?.status === "pending" || currentCase?.status === "approved") {
      writeJson(response, 200, { user, kycCase: currentCase });
      return;
    }

    const kycCase = await createKycCaseRecord({
      userId,
      legalName: body.legalName,
      documentType: body.documentType
    });
    const updatedUser = await updateUserKycStatus(userId, "pending");
    writeJson(response, 201, { user: updatedUser, kycCase });
    return;
  }

  if (request.method === "POST" && request.url?.match(/^\/users\/[^/]+\/kyc\/smile-token$/)) {
    const userId = request.url.split("/")[2];
    const body = await readJson(request, submitKycRequestSchema);
    const user = userId ? await findUserById(userId) : null;

    if (!userId || !user) {
      writeJson(response, 404, { error: "user_not_found" });
      return;
    }

    if (config.kycProvider !== "smile") {
      writeJson(response, 409, { error: "smile_kyc_not_enabled" });
      return;
    }

    const currentCase = await findLatestKycCaseByUserId(userId);

    if (currentCase?.status === "approved") {
      writeJson(response, 200, { user, kycCase: currentCase });
      return;
    }

    if (currentCase?.status === "pending" && currentCase.provider === "smile" && currentCase.providerCaseId) {
      writeJson(response, 200, {
        user,
        kycCase: currentCase,
        smile: await createSmileKycToken(config, { userId, jobId: currentCase.providerCaseId })
      });
      return;
    }

    const jobId = `velo_${randomUUID()}`;
    const kycCase = await createKycCaseRecord({
      userId,
      legalName: body.legalName,
      documentType: body.documentType,
      provider: "smile",
      providerCaseId: jobId
    });
    const updatedUser = await updateUserKycStatus(userId, "pending");

    writeJson(response, 201, {
      user: updatedUser,
      kycCase,
      smile: await createSmileKycToken(config, { userId, jobId })
    });
    return;
  }

  if (request.method === "POST" && request.url === "/kyc/smile/callback") {
    const body = await readJson(request, smileCallbackSchema);
    const decision = parseSmileCallback(config, body);

    if (decision.status === "pending") {
      writeJson(response, 202, { status: "pending" });
      return;
    }

    const result = await decideKycCaseByProvider({
      provider: "smile",
      providerCaseId: decision.jobId,
      status: decision.status,
      ...(decision.rejectionReason ? { rejectionReason: decision.rejectionReason } : {})
    });

    if (!result) {
      writeJson(response, 404, { error: "kyc_case_not_found" });
      return;
    }

    writeJson(response, 200, result);
    return;
  }

  if (request.method === "POST" && request.url?.match(/^\/admin\/kyc\/[^/]+\/decision$/)) {
    const admin = await requireAdmin(request, response, ["admin", "compliance"]);
    if (!admin) return;

    const caseId = request.url.split("/")[3];
    const body = await readJson(request, kycDecisionSchema);
    const existingCase = caseId ? await findKycCaseById(caseId) : null;

    if (!caseId || !existingCase) {
      writeJson(response, 404, { error: "kyc_case_not_found" });
      return;
    }

    const result = await decideKycCase({
      caseId,
      status: body.status,
      ...(body.rejectionReason ? { rejectionReason: body.rejectionReason } : {})
    });
    await createAuditLogRecord({
      actorType: "admin",
      ...(admin.user.id ? { actorAdminUserId: admin.user.id } : {}),
      action: `kyc.${body.status}`,
      entityType: "kyc_case",
      entityId: caseId,
      metadata: {
        userId: result.user.id,
        previousStatus: existingCase.status,
        nextStatus: body.status,
        ...(body.rejectionReason ? { rejectionReason: body.rejectionReason } : {})
      }
    });

    writeJson(response, 200, result);
    return;
  }

  if (request.method === "GET" && request.url?.match(/^\/admin\/kyc-cases\/[^/]+$/)) {
    const admin = await requireAdmin(request, response, ["admin", "compliance"]);
    if (!admin) return;

    const caseId = request.url.split("/")[3];
    const detail = caseId ? await findAdminKycCaseDetail(caseId) : null;

    if (!detail) {
      writeJson(response, 404, { error: "kyc_case_not_found" });
      return;
    }

    writeJson(response, 200, { case: detail });
    return;
  }

  if (request.method === "GET" && request.url?.startsWith("/admin/kyc-cases")) {
    const admin = await requireAdmin(request, response, ["admin", "compliance"]);
    if (!admin) return;

    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
    const query = adminKycCasesQuerySchema.parse({
      status: url.searchParams.get("status") ?? undefined
    });

    writeJson(response, 200, { cases: await listAdminKycCases(query.status) });
    return;
  }

  if (request.method === "GET" && request.url?.match(/^\/admin\/transfers\/[^/]+$/)) {
    const admin = await requireAdmin(request, response, ["admin", "compliance"]);
    if (!admin) return;

    const transferId = request.url.split("/")[3];
    const detail = transferId ? await findAdminTransferDetail(transferId) : null;

    if (!detail) {
      writeJson(response, 404, { error: "transfer_not_found" });
      return;
    }

    writeJson(response, 200, { transfer: detail });
    return;
  }

  if (request.method === "GET" && request.url?.startsWith("/admin/risk-queue")) {
    const admin = await requireAdmin(request, response, ["admin", "compliance"]);
    if (!admin) return;

    writeJson(response, 200, { items: await listAdminRiskQueue() });
    return;
  }

  if (request.method === "GET" && request.url?.startsWith("/admin/audit-logs")) {
    const admin = await requireAdmin(request, response, ["admin", "compliance"]);
    if (!admin) return;

    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
    const query = auditLogsQuerySchema.parse({
      query: url.searchParams.get("query") ?? undefined
    });

    writeJson(response, 200, { logs: await listAdminAuditLogs(query.query) });
    return;
  }

  if (request.method === "GET" && request.url === "/admin/users") {
    const admin = await requireAdmin(request, response, ["admin"]);
    if (!admin) return;

    writeJson(response, 200, { users: await listAdminUsers() });
    return;
  }

  if (request.method === "POST" && request.url === "/admin/users") {
    const admin = await requireAdmin(request, response, ["admin"]);
    if (!admin) return;

    const body = await readJson(request, createAdminUserSchema);
    const existingUser = await findAdminUserByEmail(body.email);
    if (existingUser) {
      writeJson(response, 409, { error: "admin_user_exists" });
      return;
    }

    const temporaryPassword = body.temporaryPassword ?? generateTemporaryPassword();
    const user = await createAdminUserRecord({
      email: body.email,
      role: body.role,
      passwordHash: hashPassword(temporaryPassword)
    });
    await createAuditLogRecord({
      actorType: "admin",
      ...(admin.user.id ? { actorAdminUserId: admin.user.id } : {}),
      action: "admin_user.created",
      entityType: "admin_user",
      entityId: user.id,
      metadata: { email: user.email, role: user.role }
    });
    await deliverAdminTemporaryPassword(config, { email: user.email, temporaryPassword });

    writeJson(response, 201, { user, ...(config.nodeEnv === "development" ? { temporaryPassword } : { delivered: true }) });
    return;
  }

  if (request.method === "PATCH" && request.url?.match(/^\/admin\/users\/[^/]+$/)) {
    const admin = await requireAdmin(request, response, ["admin"]);
    if (!admin) return;

    const adminUserId = request.url.split("/")[3];
    const body = await readJson(request, updateAdminUserSchema);

    if (!adminUserId) {
      writeJson(response, 400, { error: "admin_user_id_required" });
      return;
    }

    if (adminUserId === admin.user.id && body.disabled === true) {
      writeJson(response, 409, { error: "cannot_disable_self" });
      return;
    }

    const existingUser = await findAdminUserById(adminUserId);
    if (!existingUser) {
      writeJson(response, 404, { error: "admin_user_not_found" });
      return;
    }

    const user = await updateAdminUserRecord({
      id: adminUserId,
      ...(body.role ? { role: body.role } : {}),
      ...(typeof body.disabled === "boolean" ? { disabled: body.disabled } : {})
    });
    await createAuditLogRecord({
      actorType: "admin",
      ...(admin.user.id ? { actorAdminUserId: admin.user.id } : {}),
      action: body.disabled === true ? "admin_user.disabled" : body.disabled === false ? "admin_user.enabled" : "admin_user.updated",
      entityType: "admin_user",
      entityId: user.id,
      metadata: { email: user.email, role: user.role }
    });

    writeJson(response, 200, { user });
    return;
  }

  if (request.method === "POST" && request.url?.match(/^\/admin\/users\/[^/]+\/reset-password$/)) {
    const admin = await requireAdmin(request, response, ["admin"]);
    if (!admin) return;

    const adminUserId = request.url.split("/")[3];

    if (!adminUserId) {
      writeJson(response, 400, { error: "admin_user_id_required" });
      return;
    }

    const existingUser = await findAdminUserById(adminUserId);
    if (!existingUser) {
      writeJson(response, 404, { error: "admin_user_not_found" });
      return;
    }

    const temporaryPassword = generateTemporaryPassword();
    const user = await resetAdminUserPassword({
      id: adminUserId,
      passwordHash: hashPassword(temporaryPassword)
    });
    await createAuditLogRecord({
      actorType: "admin",
      ...(admin.user.id ? { actorAdminUserId: admin.user.id } : {}),
      action: "admin_user.password_reset",
      entityType: "admin_user",
      entityId: user.id,
      metadata: { email: user.email }
    });
    await deliverAdminTemporaryPassword(config, { email: user.email, temporaryPassword });

    writeJson(response, 200, { user, ...(config.nodeEnv === "development" ? { temporaryPassword } : { delivered: true }) });
    return;
  }

  if (request.method === "POST" && request.url?.match(/^\/admin\/users\/[^/]+\/revoke-sessions$/)) {
    const admin = await requireAdmin(request, response, ["admin"]);
    if (!admin) return;

    const adminUserId = request.url.split("/")[3];
    if (!adminUserId) {
      writeJson(response, 400, { error: "admin_user_id_required" });
      return;
    }

    const existingUser = await findAdminUserById(adminUserId);
    if (!existingUser) {
      writeJson(response, 404, { error: "admin_user_not_found" });
      return;
    }

    const revokedCount = await deleteAdminSessionsByUserId(adminUserId);
    await createAuditLogRecord({
      actorType: "admin",
      ...(admin.user.id ? { actorAdminUserId: admin.user.id } : {}),
      action: "admin_user.sessions_revoked",
      entityType: "admin_user",
      entityId: adminUserId,
      metadata: { email: existingUser.email, revokedCount }
    });

    writeJson(response, 200, { revokedCount });
    return;
  }

  if (request.method === "POST" && request.url?.match(/^\/admin\/transfers\/[^/]+\/provider-event$/)) {
    const admin = await requireAdmin(request, response, ["admin"]);
    if (!admin) return;

    const transferId = request.url.split("/")[3];
    const body = await readJson(request, providerSimulationSchema);
    const transfer = transferId ? await findTransferById(transferId) : null;

    if (!transferId || !transfer) {
      writeJson(response, 404, { error: "transfer_not_found" });
      return;
    }

    const existingEvent = await findProviderEventByIdempotencyKey(body.idempotencyKey);
    if (existingEvent) {
      writeJson(response, 200, { transfer, providerEvent: existingEvent, duplicate: true });
      return;
    }

    const providerEvent = await createProviderEventRecord({
      provider: "simulation",
      eventType: body.event,
      ...(body.providerEventId ? { providerEventId: body.providerEventId } : {}),
      idempotencyKey: body.idempotencyKey,
      transferId,
      payload: body
    });

    try {
      const updatedTransfer = await processProviderEvent({
        providerEventId: providerEvent.id,
        provider: "simulation",
        eventType: body.event,
        transfer,
        actorType: "admin",
        ...(admin.user.id ? { actorAdminUserId: admin.user.id } : {}),
        reasonPrefix: "provider_simulation"
      });
      writeJson(response, 200, { transfer: updatedTransfer, providerEvent });
    } catch (error) {
      await updateProviderEventRecord({
        id: providerEvent.id,
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Provider event failed"
      });
      writeJson(response, 409, {
        error: "provider_event_failed",
        message: error instanceof Error ? error.message : "Provider event failed"
      });
    }
    return;
  }

  if (request.method === "GET" && request.url === "/admin/provider-events/metrics") {
    const admin = await requireAdmin(request, response, ["admin", "compliance"]);
    if (!admin) return;

    writeJson(response, 200, {
      ...await getProviderEventMetrics(),
      generatedAt: new Date().toISOString()
    });
    return;
  }

  if (request.method === "POST" && request.url?.match(/^\/admin\/transfers\/[^/]+\/event$/)) {
    const admin = await requireAdmin(request, response, ["admin"]);
    if (!admin) return;

    const transferId = request.url.split("/")[3];
    const body = await readJson(request, adminTransferEventSchema);
    const transfer = transferId ? await findTransferById(transferId) : null;

    if (!transferId || !transfer) {
      writeJson(response, 404, { error: "transfer_not_found" });
      return;
    }

    const event = toTransferEvent(body);
    let updatedTransfer;

    try {
      updatedTransfer = applyTransferEvent(transfer, event, new Date());
    } catch (error) {
      writeJson(response, 409, {
        error: "invalid_transfer_transition",
        message: error instanceof Error ? error.message : "Transfer transition is not allowed"
      });
      return;
    }
    await updateTransferRecord(updatedTransfer);
    await recordTransferStateChange({
      transferId,
      fromStatus: transfer.status,
      toStatus: updatedTransfer.status,
      reason: body.note ?? body.event,
      actorType: "admin"
    });
    await createAuditLogRecord({
      actorType: "admin",
      ...(admin.user.id ? { actorAdminUserId: admin.user.id } : {}),
      action: `transfer.${body.event}`,
      entityType: "transfer",
      entityId: transferId,
      metadata: {
        previousStatus: transfer.status,
        nextStatus: updatedTransfer.status,
        ...(body.reason ? { reason: body.reason } : {}),
        ...(body.note ? { note: body.note } : {})
      }
    });

    writeJson(response, 200, { transfer: updatedTransfer });
    return;
  }

  if (request.method === "GET" && request.url === "/admin/transfers") {
    const admin = await requireAdmin(request, response, ["admin", "compliance"]);
    if (!admin) return;

    writeJson(response, 200, { transfers: await listAdminTransfers() });
    return;
  }

  if (request.method === "GET" && request.url?.match(/^\/wallets\/[^/]+\/summary$/)) {
    const userId = request.url.split("/")[2];

    if (!userId) {
      writeJson(response, 400, { error: "user_id_required" });
      return;
    }

    const user = userId ? await findUserById(userId) : null;

    if (!user) {
      writeJson(response, 404, { error: "user_not_found" });
      return;
    }

    writeJson(response, 200, {
      userId,
      balances: await getWalletSummaryByUserId(userId)
    });
    return;
  }

  if (request.method === "POST" && request.url === "/beneficiaries") {
    const body = await readJson(request, createBeneficiaryRequestSchema);
    const user = await findUserById(body.userId);

    if (!user) {
      writeJson(response, 404, { error: "user_not_found" });
      return;
    }

    const beneficiary = await createBeneficiaryRecord({
      userId: body.userId,
      displayName: body.displayName,
      countryCode: body.countryCode,
      payoutMethod: body.payoutMethod,
      ...(body.payoutToken ? { payoutToken: body.payoutToken } : {})
    });
    writeJson(response, 201, beneficiary);
    return;
  }

  if (request.method === "GET" && request.url?.startsWith("/beneficiaries")) {
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
    const query = listByUserQuerySchema.parse({
      userId: url.searchParams.get("userId") ?? undefined
    });
    const beneficiaries = await listBeneficiariesByUserId(query.userId);
    writeJson(response, 200, { beneficiaries });
    return;
  }

  if (request.method === "POST" && request.url === "/transfer-quotes") {
    const body = await readJson(request, createQuoteRequestSchema);
    const quote = createQuote({
      sourceAmount: body.sourceAmount,
      destinationCurrency: body.destinationCurrency,
      exchangeRate: body.exchangeRate,
      feeBasisPoints: body.feeBasisPoints,
      fixedFeeMinor: body.fixedFeeMinor,
      now: new Date(),
      ttlMinutes: 15
    });

    const savedQuote = await createTransferQuoteRecord({
      quote,
      ...(body.senderUserId ? { senderUserId: body.senderUserId } : {})
    });

    writeJson(response, 201, savedQuote);
    return;
  }

  if (request.method === "POST" && request.url === "/transfers") {
    const body = await readJson(request, createTransferRequestSchema);
    const idempotencyKey = body.idempotencyKey ?? `transfer:create:${body.senderUserId}:${body.quoteId}`;
    const existingTransfer = await findTransferByIdempotencyKey(idempotencyKey);

    if (existingTransfer) {
      writeJson(response, 200, existingTransfer);
      return;
    }

    const [quote, user, beneficiary] = await Promise.all([
      findTransferQuoteById(body.quoteId),
      findUserById(body.senderUserId),
      findBeneficiaryById(body.beneficiaryId)
    ]);

    if (!quote) {
      writeJson(response, 404, { error: "quote_not_found" });
      return;
    }

    if (Date.parse(quote.expiresAt) <= Date.now()) {
      writeJson(response, 409, { error: "quote_expired" });
      return;
    }

    if (!user) {
      writeJson(response, 404, { error: "user_not_found" });
      return;
    }

    if (user.kycStatus !== "approved") {
      writeJson(response, 403, { error: "kyc_required" });
      return;
    }

    if (!beneficiary) {
      writeJson(response, 404, { error: "beneficiary_not_found" });
      return;
    }

    const transfer = createTransfer({
      id: `tr_${randomUUID()}`,
      senderUserId: body.senderUserId,
      beneficiaryId: body.beneficiaryId,
      quote,
      paymentMethod: body.paymentMethod,
      payoutMethod: body.payoutMethod,
      now: new Date()
    });

    const savedTransfer = await createTransferRecord({
      transfer,
      quoteId: quote.id,
      idempotencyKey
    });
    await recordTransferStateChange({
      transferId: savedTransfer.id,
      toStatus: savedTransfer.status,
      reason: "transfer_created",
      actorType: "user",
      actorId: savedTransfer.senderUserId
    });

    writeJson(response, 201, savedTransfer);
    return;
  }

  if (request.method === "GET" && request.url?.startsWith("/transfers?")) {
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
    const query = listByUserQuerySchema.parse({
      userId: url.searchParams.get("senderUserId") ?? undefined
    });
    const transfers = await listTransfersBySenderUserId(query.userId);
    writeJson(response, 200, { transfers });
    return;
  }

  if (request.method === "POST" && request.url?.match(/^\/transfers\/[^/]+\/payment-received$/)) {
    const transferId = request.url.split("/")[2];
    const transfer = transferId ? await findTransferById(transferId) : null;

    if (!transfer) {
      writeJson(response, 404, { error: "transfer_not_found" });
      return;
    }

    if (transfer.status === "payment_received") {
      writeJson(response, 200, { transfer, duplicate: true });
      return;
    }

    const idempotencyKey = `payment-received:${transfer.id}`;
    const existingEvent = await findProviderEventByIdempotencyKey(idempotencyKey);
    if (existingEvent) {
      writeJson(response, 200, { transfer, duplicate: true });
      return;
    }
    const providerEvent = await createProviderEventRecord({
      provider: "demo-payment",
      eventType: "payment_received",
      idempotencyKey,
      transferId: transfer.id,
      payload: { transferId: transfer.id, source: "demo" }
    });

    try {
      const updatedTransfer = applyTransferEvent(transfer, { type: "PAYMENT_RECEIVED" }, new Date());
      const ledgerTransaction = createPaymentReceivedLedgerTransaction(updatedTransfer);
      const savedTransfer = await updateTransferRecord(updatedTransfer);
      await recordTransferStateChange({
        transferId: savedTransfer.id,
        fromStatus: transfer.status,
        toStatus: savedTransfer.status,
        reason: "payment_received",
        actorType: "provider"
      });
      await createLedgerTransactionRecord({
        transferId: savedTransfer.id,
        memo: `Payment received for transfer ${savedTransfer.id}`,
        ledgerTransaction
      });
      await updateProviderEventRecord({ id: providerEvent.id, status: "processed" });

      writeJson(response, 200, {
        transfer: savedTransfer,
        ledgerTransaction
      });
    } catch (error) {
      await updateProviderEventRecord({
        id: providerEvent.id,
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Payment event failed"
      });
      throw error;
    }
    return;
  }

  if (request.method === "GET" && request.url?.match(/^\/transfers\/[^/]+$/)) {
    const transferId = request.url.split("/")[2];
    const transfer = transferId ? await findTransferById(transferId) : null;

    if (!transfer) {
      writeJson(response, 404, { error: "transfer_not_found" });
      return;
    }

    writeJson(response, 200, transfer);
    return;
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "not_found" }));
}

void ensureDevAdmin().catch((error: unknown) => {
  console.error("Dev admin bootstrap deferred until database migrations are applied", error);
}).finally(() => {
  server.listen(config.apiPort, () => {
    console.log(`API listening on http://localhost:${config.apiPort}`);
  });
});

type CreateQuoteRequest = {
  senderUserId?: string | undefined;
  sourceAmount: Money;
  destinationCurrency: CurrencyCode;
  exchangeRate: string;
  feeBasisPoints: number;
  fixedFeeMinor: string;
};

const currencyCodeSchema = z.enum(["USD", "RWF", "KES", "UGX", "TZS", "CDF"]);
const countryCodeSchema = z.enum(["US", "RW", "KE", "UG", "TZ", "CD"]);
const moneySchema = z.object({
  amountMinor: z.string().regex(/^\d+$/, "amountMinor must be a non-negative integer string"),
  currency: currencyCodeSchema
});

const createQuoteRequestSchema = z.object({
  senderUserId: z.string().min(1).optional(),
  sourceAmount: moneySchema,
  destinationCurrency: currencyCodeSchema,
  exchangeRate: z.string().regex(/^\d+(\.\d+)?$/, "exchangeRate must be a positive decimal string"),
  feeBasisPoints: z.number().int().min(0).max(10_000),
  fixedFeeMinor: z.string().regex(/^\d+$/, "fixedFeeMinor must be a non-negative integer string")
});

type CreateTransferRequest = {
  senderUserId: string;
  beneficiaryId: string;
  quoteId: string;
  paymentMethod: PaymentMethod;
  payoutMethod: PayoutMethod;
  idempotencyKey?: string | undefined;
};

const createTransferRequestSchema = z.object({
  senderUserId: z.string().min(1),
  beneficiaryId: z.string().min(1),
  quoteId: z.string().min(1),
  paymentMethod: z.enum(["card", "bank_account", "mobile_money", "crypto_wallet"]),
  payoutMethod: z.enum(["mobile_money", "bank_account", "crypto_wallet"]),
  idempotencyKey: z.string().min(1).optional()
});

type CreateUserRequest = {
  email: string;
  phoneNumber?: string | undefined;
  countryCode: CountryCode;
  role?: UserRole | undefined;
  kycStatus?: KycStatus | undefined;
};

const createUserRequestSchema = z.object({
  email: z.string().email(),
  phoneNumber: z.string().min(7).optional(),
  countryCode: countryCodeSchema,
  role: z.enum(["sender", "admin", "compliance"]).optional(),
  kycStatus: z.enum(["not_started", "pending", "approved", "rejected", "expired"]).optional()
});

const createSessionRequestSchema = z.object({
  userId: z.string().min(1)
});

const otpRequestSchema = z.object({
  email: z.string().email(),
  phoneNumber: z.string().min(7),
  countryCode: countryCodeSchema
});

const otpVerifySchema = z.object({
  challengeId: z.string().min(1),
  code: z.string().regex(/^\d{6}$/)
});

const adminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  mfaCode: z.string().regex(/^\d{6}$/).optional()
});

const mfaCodeSchema = z.object({ mfaCode: z.string().regex(/^\d{6}$/) });

const submitKycRequestSchema = z.object({
  legalName: z.string().min(2),
  documentType: z.enum(["national_id", "passport", "drivers_license"])
});

const smileCallbackSchema = z.record(z.string(), z.unknown());

const kycDecisionSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  rejectionReason: z.string().min(1).optional()
});

const adminTransferEventSchema = z.object({
  event: z.enum([
    "COMPLIANCE_REVIEW_REQUIRED",
    "COMPLIANCE_APPROVED",
    "PAYOUT_SUBMITTED",
    "PAYOUT_COMPLETED",
    "FAIL",
    "CANCEL"
  ]),
  reason: z.enum([
    "payment_failed",
    "payout_failed",
    "compliance_rejected",
    "expired",
    "cancelled_by_user",
    "cancelled_by_admin"
  ]).optional(),
  note: z.string().min(1).max(300).optional()
}).superRefine((value, context) => {
  if (value.event === "FAIL" && !value.reason) {
    context.addIssue({ code: "custom", path: ["reason"], message: "reason is required for FAIL" });
  }

  if (value.event === "CANCEL" && value.reason !== "cancelled_by_admin") {
    context.addIssue({ code: "custom", path: ["reason"], message: "CANCEL requires cancelled_by_admin" });
  }
});

const providerSimulationSchema = z.object({
  event: z.enum(["payment_received", "payout_submitted", "payout_completed", "payout_failed"]),
  idempotencyKey: z.string().min(1).max(120),
  providerEventId: z.string().min(1).max(120).optional()
});

const adminKycCasesQuerySchema = z.object({
  status: z.enum(["not_started", "pending", "approved", "rejected", "expired"]).optional()
});

const auditLogsQuerySchema = z.object({
  query: z.string().min(1).max(120).optional()
});

const createAdminUserSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "compliance"]),
  temporaryPassword: z.string().min(12).optional()
});

const updateAdminUserSchema = z.object({
  role: z.enum(["admin", "compliance"]).optional(),
  disabled: z.boolean().optional()
});

type CreateBeneficiaryRequest = {
  userId: string;
  displayName: string;
  countryCode: CountryCode;
  payoutMethod: PayoutMethod;
  payoutToken?: string | undefined;
};

const createBeneficiaryRequestSchema = z.object({
  userId: z.string().min(1),
  displayName: z.string().min(1),
  countryCode: countryCodeSchema,
  payoutMethod: z.enum(["mobile_money", "bank_account", "crypto_wallet"]),
  payoutToken: z.string().min(1).optional()
});

const listByUserQuerySchema = z.object({
  userId: z.string().min(1)
});

class RequestValidationError extends Error {
  constructor(readonly issues: unknown) {
    super("Request validation failed");
  }
}

async function readJson<T>(request: IncomingMessage, schema: z.ZodType<T>): Promise<T> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  try {
    return schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch (error) {
    if (error instanceof ZodError) {
      throw new RequestValidationError(error.issues);
    }

    throw new RequestValidationError([{ message: "Request body must be valid JSON" }]);
  }
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, corsHeaders({ "content-type": "application/json" }));
  response.end(
    JSON.stringify(body, (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value))
  );
}

function corsHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,x-admin-api-key",
    ...extra
  };
}

function readBearerToken(request: IncomingMessage): string | null {
  const authorization = request.headers.authorization;
  return authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() || null : null;
}

async function checkRateLimit(
  request: IncomingMessage,
  scope: string,
  limit: number,
  windowMs: number,
  response: ServerResponse
): Promise<boolean> {
  const address = request.socket.remoteAddress ?? "unknown";
  const key = `${scope}:${address}`;
  const result = await consumeRateLimit({ key, limit, windowMs });

  if (result.allowed) {
    return true;
  }

  response.writeHead(429, { ...corsHeaders(), "retry-after": String(result.retryAfterSeconds) });
  response.end(JSON.stringify({ error: "rate_limited", retryAfterSeconds: result.retryAfterSeconds }));
  return false;
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function hashOtp(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

async function requireAdmin(
  request: IncomingMessage,
  response: ServerResponse,
  allowedRoles: Array<AdminUserProfile["role"]> = ["admin"]
): Promise<{ user: AdminUserProfile } | null> {
  const token = readBearerToken(request);

  if (token) {
    const user = await findAdminUserBySessionTokenHash(hashSessionToken(token));

    if (user && allowedRoles.includes(user.role)) {
      return { user };
    }

    if (user) {
      writeJson(response, 403, { error: "admin_forbidden" });
      return null;
    }
  }

  if (config.nodeEnv === "development" && config.adminApiKey && request.headers["x-admin-api-key"] === config.adminApiKey) {
    const devKeyUser: AdminUserProfile = {
      id: "",
      email: "dev-admin-key",
      role: "admin",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      failedLoginAttempts: 0,
      mfaEnabled: false
    };

    if (!allowedRoles.includes(devKeyUser.role)) {
      writeJson(response, 403, { error: "admin_forbidden" });
      return null;
    }

    return {
      user: {
        ...devKeyUser
      }
    };
  }

  writeJson(response, 401, { error: "admin_unauthorized" });
  return null;
}

async function ensureDevAdmin(): Promise<void> {
  if (config.nodeEnv !== "development") {
    return;
  }

  await upsertAdminUserRecord({
    email: devAdminEmail,
    passwordHash: hashPassword(devAdminPassword),
    role: "admin"
  });
  await upsertAdminUserRecord({
    email: devComplianceEmail,
    passwordHash: hashPassword(devCompliancePassword),
    role: "compliance"
  });
  console.log(`Dev admins ready: ${devAdminEmail}, ${devComplianceEmail}`);
}

function hashPassword(password: string, salt = randomBytes(16).toString("hex")): string {
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function generateTemporaryPassword(): string {
  return `velo-${randomBytes(9).toString("base64url")}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [algorithm, salt, hash] = storedHash.split(":");

  if (algorithm !== "scrypt" || !salt || !hash) {
    return false;
  }

  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, expected.length);

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function stripAdminPassword(adminUser: AdminUserProfile & { passwordHash: string }): AdminUserProfile {
  return {
    id: adminUser.id,
    email: adminUser.email,
    role: adminUser.role,
    failedLoginAttempts: 0,
    mfaEnabled: adminUser.mfaEnabled,
    createdAt: adminUser.createdAt,
    updatedAt: adminUser.updatedAt
  };
}

function toTransferEvent(body: {
  event: "COMPLIANCE_REVIEW_REQUIRED" | "COMPLIANCE_APPROVED" | "PAYOUT_SUBMITTED" | "PAYOUT_COMPLETED" | "FAIL" | "CANCEL";
  reason?: TransferFailureReason | undefined;
}): Parameters<typeof applyTransferEvent>[1] {
  if (body.event === "FAIL") {
    return { type: "FAIL", reason: body.reason ?? "payout_failed" };
  }

  if (body.event === "CANCEL") {
    return { type: "CANCEL", reason: "cancelled_by_admin" };
  }

  return { type: body.event };
}

async function issueSession(user: Awaited<ReturnType<typeof findUserById>>) {
  if (!user) {
    throw new Error("Cannot create a session for a missing user");
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await createSessionRecord({
    userId: user.id,
    tokenHash: hashSessionToken(token),
    expiresAt
  });

  return { token, expiresAt: expiresAt.toISOString(), user };
}
