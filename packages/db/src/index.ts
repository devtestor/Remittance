import { PrismaClient, type Prisma } from "@prisma/client";
import type { Beneficiary, CountryCode, CurrencyCode, KycStatus, Transfer, TransferQuote, UserProfile, UserRole } from "@glr/types";
import type { LedgerTransactionDraft } from "@glr/ledger";

export type DatabaseConnectionStatus = "not_configured" | "connected";

export const databaseSchemaLocation = "packages/db/prisma/schema.prisma";

export const prisma = new PrismaClient();

export function getDatabaseStatus(): DatabaseConnectionStatus {
  return "connected";
}

export async function checkDatabaseReady(): Promise<boolean> {
  await prisma.$queryRaw`SELECT 1`;
  return true;
}

export async function getWalletSummaryByUserId(userId: string): Promise<
  Array<{ amountMinor: string; currency: string }>
> {
  const entries = await prisma.ledgerEntry.findMany({
    where: { accountId: `customer:${userId}:payable` },
    select: { side: true, amountMinor: true, currency: true }
  });
  const balances = new Map<string, bigint>();

  for (const entry of entries) {
    const current = balances.get(entry.currency) ?? 0n;
    const amount = BigInt(entry.amountMinor.toString());
    balances.set(entry.currency, current + (entry.side === "credit" ? amount : -amount));
  }

  return Array.from(balances, ([currency, amountMinor]) => ({
    amountMinor: amountMinor.toString(),
    currency
  }));
}

export async function createUserRecord(input: {
  email: string;
  phoneNumber?: string;
  countryCode: CountryCode;
  role?: UserRole;
  kycStatus?: KycStatus;
}): Promise<UserProfile> {
  const record = await prisma.user.create({
    data: {
      email: input.email,
      phoneNumber: input.phoneNumber ?? null,
      countryCode: input.countryCode,
      role: input.role ?? "sender",
      kycStatus: input.kycStatus ?? "not_started"
    }
  });

  return mapUser(record);
}

export async function findUserById(id: string): Promise<UserProfile | null> {
  const record = await prisma.user.findUnique({
    where: { id }
  });

  return record ? mapUser(record) : null;
}

export async function findUserByEmail(email: string): Promise<UserProfile | null> {
  const record = await prisma.user.findUnique({ where: { email } });
  return record ? mapUser(record) : null;
}

export async function findUserByPhone(phoneNumber: string): Promise<UserProfile | null> {
  const record = await prisma.user.findUnique({ where: { phoneNumber } });
  return record ? mapUser(record) : null;
}

export async function upsertAdminUserRecord(input: {
  email: string;
  passwordHash: string;
  role?: Extract<UserRole, "admin" | "compliance">;
}): Promise<AdminUserProfile> {
  const record = await prisma.adminUser.upsert({
    where: { email: input.email },
    update: {
      passwordHash: input.passwordHash,
      role: input.role ?? "admin"
    },
    create: {
      email: input.email,
      passwordHash: input.passwordHash,
      role: input.role ?? "admin"
    }
  });

  return mapAdminUser(record);
}

export async function findAdminUserByEmail(email: string): Promise<(AdminUserProfile & { passwordHash: string; mfaSecret?: string }) | null> {
  const record = await prisma.adminUser.findUnique({ where: { email } });
  return record ? { ...mapAdminUser(record), passwordHash: record.passwordHash, ...(record.mfaSecret ? { mfaSecret: record.mfaSecret } : {}) } : null;
}

export async function findAdminUserById(id: string): Promise<AdminUserProfile | null> {
  const record = await prisma.adminUser.findUnique({ where: { id } });
  return record ? mapAdminUser(record) : null;
}

export async function listAdminUsers(): Promise<AdminUserProfile[]> {
  const records = await prisma.adminUser.findMany({
    orderBy: { createdAt: "desc" }
  });

  return records.map(mapAdminUser);
}

export async function createAdminUserRecord(input: {
  email: string;
  passwordHash: string;
  role: Extract<UserRole, "admin" | "compliance">;
}): Promise<AdminUserProfile> {
  const record = await prisma.adminUser.create({
    data: input
  });

  return mapAdminUser(record);
}

export async function updateAdminUserRecord(input: {
  id: string;
  role?: Extract<UserRole, "admin" | "compliance">;
  disabled?: boolean;
}): Promise<AdminUserProfile> {
  const record = await prisma.adminUser.update({
    where: { id: input.id },
    data: {
      ...(input.role ? { role: input.role } : {}),
      ...(typeof input.disabled === "boolean" ? { disabledAt: input.disabled ? new Date() : null } : {})
    }
  });

  return mapAdminUser(record);
}

export async function resetAdminUserPassword(input: {
  id: string;
  passwordHash: string;
}): Promise<AdminUserProfile> {
  const record = await prisma.adminUser.update({
    where: { id: input.id },
    data: { passwordHash: input.passwordHash, failedLoginAttempts: 0, lockedUntil: null }
  });

  await prisma.adminSession.deleteMany({
    where: { adminUserId: input.id }
  });

  return mapAdminUser(record);
}

export async function touchAdminUserLastLogin(id: string): Promise<void> {
  await prisma.adminUser.update({
    where: { id },
    data: { lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null }
  });
}

export async function recordAdminLoginFailure(input: {
  id: string;
  maxAttempts: number;
  lockDurationMs: number;
}): Promise<{ failedLoginAttempts: number; lockedUntil?: Date }> {
  const record = await prisma.adminUser.update({
    where: { id: input.id },
    data: { failedLoginAttempts: { increment: 1 } },
    select: { failedLoginAttempts: true, lockedUntil: true }
  });

  if (record.failedLoginAttempts < input.maxAttempts) {
    return { failedLoginAttempts: record.failedLoginAttempts };
  }

  const lockedUntil = new Date(Date.now() + input.lockDurationMs);
  await prisma.adminUser.update({
    where: { id: input.id },
    data: { lockedUntil }
  });

  return { failedLoginAttempts: record.failedLoginAttempts, lockedUntil };
}

export async function setAdminMfaSecret(input: { id: string; secret: string; enabled?: boolean }): Promise<AdminUserProfile> {
  const record = await prisma.adminUser.update({
    where: { id: input.id },
    data: {
      mfaSecret: input.secret,
      ...(typeof input.enabled === "boolean" ? { mfaEnabled: input.enabled } : {})
    }
  });

  return mapAdminUser(record);
}

export async function createAdminSessionRecord(input: {
  adminUserId: string;
  tokenHash: string;
  expiresAt: Date;
}): Promise<void> {
  await prisma.adminSession.create({
    data: {
      adminUserId: input.adminUserId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt
    }
  });
}

export async function findAdminUserBySessionTokenHash(tokenHash: string): Promise<AdminUserProfile | null> {
  const session = await prisma.adminSession.findUnique({
    where: { tokenHash },
    include: { adminUser: true }
  });

  if (!session || session.expiresAt.getTime() <= Date.now() || session.adminUser.disabledAt) {
    return null;
  }

  return mapAdminUser(session.adminUser);
}

export async function deleteAdminSessionByTokenHash(tokenHash: string): Promise<void> {
  await prisma.adminSession.deleteMany({ where: { tokenHash } });
}

export async function deleteAdminSessionsByUserId(adminUserId: string): Promise<number> {
  const result = await prisma.adminSession.deleteMany({ where: { adminUserId } });
  return result.count;
}

export type KycCaseSummary = {
  id: string;
  userId: string;
  status: KycStatus;
  legalName?: string;
  documentType?: string;
  provider?: string;
  providerCaseId?: string;
  submittedAt?: string;
  reviewedAt?: string;
  rejectionReason?: string;
};

export type AdminKycCaseSummary = KycCaseSummary & {
  user: UserProfile;
};

export type AdminTransferSummary = Transfer & {
  sender: Pick<UserProfile, "id" | "email" | "countryCode" | "kycStatus">;
  beneficiary: Pick<Beneficiary, "id" | "displayName" | "countryCode" | "payoutMethod">;
};

export type AdminTimelineEvent = {
  id: string;
  label: string;
  detail?: string | undefined;
  actorType?: string | undefined;
  createdAt: string;
};

export type AdminLedgerTransactionSummary = {
  id: string;
  idempotencyKey: string;
  memo: string;
  postedAt: string;
  entries: Array<{
    id: string;
    accountId: string;
    side: "debit" | "credit";
    amountMinor: string;
    currency: CurrencyCode;
    memo: string;
    createdAt: string;
  }>;
};

export type AdminProviderEventSummary = {
  id: string;
  provider: string;
  eventType: string;
  providerEventId?: string;
  idempotencyKey: string;
  status: string;
  receivedAt: string;
  processedAt?: string;
  errorMessage?: string;
};

export type AdminKycCaseDetail = AdminKycCaseSummary & {
  timeline: AdminTimelineEvent[];
  recentTransfers: AdminTransferSummary[];
};

export type AdminTransferDetail = AdminTransferSummary & {
  timeline: AdminTimelineEvent[];
  ledgerTransactions: AdminLedgerTransactionSummary[];
  providerEvents: AdminProviderEventSummary[];
};

export type AdminRiskItem = {
  id: string;
  entityType: "kyc_case" | "transfer";
  entityId: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  status: string;
  createdAt: string;
};

export type AdminAuditLogSummary = {
  id: string;
  actorType: string;
  actorEmail?: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
};

export type AdminUserProfile = {
  id: string;
  email: string;
  role: Extract<UserRole, "admin" | "compliance">;
  disabledAt?: string;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
  failedLoginAttempts: number;
  lockedUntil?: string;
  mfaEnabled: boolean;
};

export async function updateUserKycStatus(userId: string, status: KycStatus): Promise<UserProfile> {
  const record = await prisma.user.update({
    where: { id: userId },
    data: { kycStatus: status }
  });

  return mapUser(record);
}

export async function createKycCaseRecord(input: {
  userId: string;
  legalName: string;
  documentType: string;
  provider?: string;
  providerCaseId?: string;
}): Promise<KycCaseSummary> {
  const record = await prisma.kycCase.create({
    data: {
      userId: input.userId,
      legalName: input.legalName,
      documentType: input.documentType,
      provider: input.provider ?? null,
      providerCaseId: input.providerCaseId ?? null,
      status: "pending",
      submittedAt: new Date()
    }
  });

  return mapKycCase(record);
}

export async function findLatestKycCaseByUserId(userId: string): Promise<KycCaseSummary | null> {
  const record = await prisma.kycCase.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" }
  });

  return record ? mapKycCase(record) : null;
}

export async function findKycCaseById(id: string): Promise<KycCaseSummary | null> {
  const record = await prisma.kycCase.findUnique({ where: { id } });
  return record ? mapKycCase(record) : null;
}

export async function listAdminKycCases(status?: KycStatus): Promise<AdminKycCaseSummary[]> {
  const records = await prisma.kycCase.findMany({
    where: status ? { status } : {},
    include: { user: true },
    orderBy: { createdAt: "desc" },
    take: 50
  });

  return records.map((record) => ({
    ...mapKycCase(record),
    user: mapUser(record.user)
  }));
}

export async function findAdminKycCaseDetail(caseId: string): Promise<AdminKycCaseDetail | null> {
  const record = await prisma.kycCase.findUnique({
    where: { id: caseId },
    include: { user: true }
  });

  if (!record) {
    return null;
  }

  const auditLogs = await prisma.auditLog.findMany({
    where: {
      entityType: "kyc_case",
      entityId: caseId
    },
    include: { actorAdminUser: true },
    orderBy: { createdAt: "asc" }
  });
  const recentTransfers = await prisma.transfer.findMany({
    where: { senderUserId: record.userId },
    include: {
      sender: true,
      beneficiary: true
    },
    orderBy: { createdAt: "desc" },
    take: 5
  });
  const timeline: AdminTimelineEvent[] = [
    {
      id: `${record.userId}:created`,
      label: "User created",
      detail: record.user.email,
      actorType: "user",
      createdAt: record.user.createdAt.toISOString()
    },
    ...(record.submittedAt
      ? [{
          id: `${record.id}:submitted`,
          label: "KYC submitted",
          detail: record.provider ? `${record.provider} ${record.providerCaseId ?? ""}`.trim() : "manual review",
          actorType: "user",
          createdAt: record.submittedAt.toISOString()
        }]
      : []),
    ...(record.reviewedAt
      ? [{
          id: `${record.id}:reviewed`,
          label: `KYC ${record.status}`,
          detail: record.rejectionReason ?? undefined,
          actorType: record.provider ? "provider" : "admin",
          createdAt: record.reviewedAt.toISOString()
        }]
      : []),
    ...auditLogs.map((auditLog) => ({
      id: auditLog.id,
      label: auditLog.action,
      detail: auditLog.actorAdminUser?.email,
      actorType: auditLog.actorType,
      createdAt: auditLog.createdAt.toISOString()
    }))
  ].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

  return {
    ...mapKycCase(record),
    user: mapUser(record.user),
    timeline,
    recentTransfers: recentTransfers.map(mapAdminTransfer)
  };
}

export async function decideKycCaseByProvider(input: {
  provider: string;
  providerCaseId: string;
  status: Extract<KycStatus, "approved" | "rejected">;
  rejectionReason?: string;
}): Promise<{ kycCase: KycCaseSummary; user: UserProfile } | null> {
  const existing = await prisma.kycCase.findUnique({
    where: {
      provider_providerCaseId: {
        provider: input.provider,
        providerCaseId: input.providerCaseId
      }
    }
  });

  if (!existing) {
    return null;
  }

  const record = await prisma.kycCase.update({
    where: { id: existing.id },
    data: {
      status: input.status,
      reviewedAt: new Date(),
      rejectionReason: input.rejectionReason ?? null
    }
  });
  const user = await updateUserKycStatus(record.userId, input.status);

  return { kycCase: mapKycCase(record), user };
}

export async function decideKycCase(input: {
  caseId: string;
  status: Extract<KycStatus, "approved" | "rejected">;
  rejectionReason?: string;
}): Promise<{ kycCase: KycCaseSummary; user: UserProfile }> {
  const record = await prisma.kycCase.update({
    where: { id: input.caseId },
    data: {
      status: input.status,
      reviewedAt: new Date(),
      rejectionReason: input.rejectionReason ?? null
    }
  });
  const user = await updateUserKycStatus(record.userId, input.status);

  return { kycCase: mapKycCase(record), user };
}

export async function createOtpChallengeRecord(input: {
  email: string;
  phoneNumber: string;
  countryCode: CountryCode;
  codeHash: string;
  expiresAt: Date;
}): Promise<{ id: string; expiresAt: Date }> {
  const record = await prisma.otpChallenge.create({
    data: input,
    select: { id: true, expiresAt: true }
  });

  return record;
}

export async function findOtpChallengeById(id: string) {
  return prisma.otpChallenge.findUnique({ where: { id } });
}

export async function incrementOtpChallengeAttempts(id: string): Promise<void> {
  await prisma.otpChallenge.update({
    where: { id },
    data: { attempts: { increment: 1 } }
  });
}

export async function consumeOtpChallenge(id: string): Promise<void> {
  await prisma.otpChallenge.update({
    where: { id },
    data: { consumedAt: new Date() }
  });
}

export async function createSessionRecord(input: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}): Promise<void> {
  await prisma.session.create({
    data: {
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt
    }
  });
}

export async function findUserBySessionTokenHash(tokenHash: string): Promise<UserProfile | null> {
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true }
  });

  if (!session || session.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  return mapUser(session.user);
}

export async function createBeneficiaryRecord(input: {
  userId: string;
  displayName: string;
  countryCode: CountryCode;
  payoutMethod: Beneficiary["payoutMethod"];
  payoutToken?: string;
}): Promise<Beneficiary> {
  const record = await prisma.beneficiary.create({
    data: {
      userId: input.userId,
      displayName: input.displayName,
      countryCode: input.countryCode,
      payoutMethod: input.payoutMethod,
      payoutToken: input.payoutToken ?? null
    }
  });

  return mapBeneficiary(record);
}

export async function findBeneficiaryById(id: string): Promise<Beneficiary | null> {
  const record = await prisma.beneficiary.findUnique({
    where: { id }
  });

  return record ? mapBeneficiary(record) : null;
}

export async function listBeneficiariesByUserId(userId: string): Promise<Beneficiary[]> {
  const records = await prisma.beneficiary.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" }
  });

  return records.map(mapBeneficiary);
}

export async function createTransferQuoteRecord(input: {
  quote: TransferQuote;
  senderUserId?: string;
}): Promise<TransferQuote> {
  const record = await prisma.transferQuote.create({
    data: {
      id: input.quote.id,
      senderUserId: input.senderUserId ?? null,
      sourceAmountMinor: input.quote.sourceAmount.amountMinor,
      sourceCurrency: input.quote.sourceAmount.currency,
      destinationAmountMinor: input.quote.destinationAmount.amountMinor,
      destinationCurrency: input.quote.destinationAmount.currency,
      feeAmountMinor: input.quote.feeAmount.amountMinor,
      feeCurrency: input.quote.feeAmount.currency,
      exchangeRate: input.quote.exchangeRate,
      expiresAt: input.quote.expiresAt
    }
  });

  return mapQuote(record);
}

export async function findTransferQuoteById(id: string): Promise<TransferQuote | null> {
  const record = await prisma.transferQuote.findUnique({
    where: { id }
  });

  return record ? mapQuote(record) : null;
}

export async function createTransferRecord(input: {
  transfer: Transfer;
  quoteId: string;
  idempotencyKey: string;
}): Promise<Transfer> {
  const record = await prisma.transfer.create({
    data: {
      id: input.transfer.id,
      senderUserId: input.transfer.senderUserId,
      beneficiaryId: input.transfer.beneficiaryId,
      quoteId: input.quoteId,
      sourceAmountMinor: input.transfer.sourceAmount.amountMinor,
      sourceCurrency: input.transfer.sourceAmount.currency,
      destinationAmountMinor: input.transfer.destinationAmount.amountMinor,
      destinationCurrency: input.transfer.destinationAmount.currency,
      feeAmountMinor: input.transfer.feeAmount.amountMinor,
      feeCurrency: input.transfer.feeAmount.currency,
      exchangeRate: input.transfer.exchangeRate,
      paymentMethod: input.transfer.paymentMethod,
      payoutMethod: input.transfer.payoutMethod,
      status: input.transfer.status,
      idempotencyKey: input.idempotencyKey,
      createdAt: input.transfer.createdAt,
      updatedAt: input.transfer.updatedAt
    }
  });

  return mapTransfer(record);
}

export async function findTransferByIdempotencyKey(idempotencyKey: string): Promise<Transfer | null> {
  const record = await prisma.transfer.findUnique({
    where: { idempotencyKey }
  });

  return record ? mapTransfer(record) : null;
}

export async function findTransferById(id: string): Promise<Transfer | null> {
  const record = await prisma.transfer.findUnique({
    where: { id }
  });

  return record ? mapTransfer(record) : null;
}

export async function listTransfersBySenderUserId(senderUserId: string): Promise<Transfer[]> {
  const records = await prisma.transfer.findMany({
    where: { senderUserId },
    orderBy: { createdAt: "desc" },
    take: 25
  });

  return records.map(mapTransfer);
}

export async function listAdminTransfers(): Promise<AdminTransferSummary[]> {
  const records = await prisma.transfer.findMany({
    include: {
      sender: true,
      beneficiary: true
    },
    orderBy: { createdAt: "desc" },
    take: 50
  });

  return records.map(mapAdminTransfer);
}

export async function findAdminTransferDetail(transferId: string): Promise<AdminTransferDetail | null> {
  const record = await prisma.transfer.findUnique({
    where: { id: transferId },
    include: {
      sender: true,
      beneficiary: true,
      stateChanges: { orderBy: { createdAt: "asc" } },
      providerEvents: { orderBy: { receivedAt: "asc" } },
      ledgerTransactions: {
        orderBy: { postedAt: "asc" },
        include: {
          entries: { orderBy: { createdAt: "asc" } }
        }
      }
    }
  });

  if (!record) {
    return null;
  }

  const auditLogs = await prisma.auditLog.findMany({
    where: {
      entityType: "transfer",
      entityId: transferId
    },
    include: { actorAdminUser: true },
    orderBy: { createdAt: "asc" }
  });
  const timeline: AdminTimelineEvent[] = [
    {
      id: `${record.id}:created`,
      label: "Transfer created",
      detail: `${formatMinorAmount(record.sourceAmountMinor)} ${record.sourceCurrency}`,
      actorType: "user",
      createdAt: record.createdAt.toISOString()
    },
    ...record.stateChanges.map((stateChange) => ({
      id: stateChange.id,
      label: stateChange.fromStatus ? `${stateChange.fromStatus} to ${stateChange.toStatus}` : stateChange.toStatus,
      detail: stateChange.reason ?? undefined,
      actorType: stateChange.actorType,
      createdAt: stateChange.createdAt.toISOString()
    })),
    ...record.ledgerTransactions.map((ledgerTransaction) => ({
      id: ledgerTransaction.id,
      label: "Ledger posted",
      detail: ledgerTransaction.memo,
      actorType: "system",
      createdAt: ledgerTransaction.postedAt.toISOString()
    })),
    ...record.providerEvents.map((providerEvent) => ({
      id: providerEvent.id,
      label: `${providerEvent.provider} ${providerEvent.eventType}`,
      detail: providerEvent.errorMessage ?? providerEvent.status,
      actorType: "provider",
      createdAt: providerEvent.receivedAt.toISOString()
    })),
    ...auditLogs.map((auditLog) => ({
      id: auditLog.id,
      label: auditLog.action,
      detail: auditLog.actorAdminUser?.email,
      actorType: auditLog.actorType,
      createdAt: auditLog.createdAt.toISOString()
    }))
  ].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

  return {
    ...mapAdminTransfer(record),
    timeline,
    providerEvents: record.providerEvents.map((providerEvent) => ({
      id: providerEvent.id,
      provider: providerEvent.provider,
      eventType: providerEvent.eventType,
      ...(providerEvent.providerEventId ? { providerEventId: providerEvent.providerEventId } : {}),
      idempotencyKey: providerEvent.idempotencyKey,
      status: providerEvent.status,
      receivedAt: providerEvent.receivedAt.toISOString(),
      ...(providerEvent.processedAt ? { processedAt: providerEvent.processedAt.toISOString() } : {}),
      ...(providerEvent.errorMessage ? { errorMessage: providerEvent.errorMessage } : {})
    })),
    ledgerTransactions: record.ledgerTransactions.map((ledgerTransaction) => ({
      id: ledgerTransaction.id,
      idempotencyKey: ledgerTransaction.idempotencyKey,
      memo: ledgerTransaction.memo,
      postedAt: ledgerTransaction.postedAt.toISOString(),
      entries: ledgerTransaction.entries.map((entry) => ({
        id: entry.id,
        accountId: entry.accountId,
        side: entry.side,
        amountMinor: formatMinorAmount(entry.amountMinor),
        currency: entry.currency,
        memo: entry.memo,
        createdAt: entry.createdAt.toISOString()
      }))
    }))
  };
}

export async function listAdminRiskQueue(): Promise<AdminRiskItem[]> {
  const [kycCases, transfers, auditLogs] = await Promise.all([
    prisma.kycCase.findMany({
      where: { status: { in: ["pending", "rejected"] } },
      include: { user: true },
      orderBy: { createdAt: "desc" },
      take: 30
    }),
    prisma.transfer.findMany({
      where: { status: { in: ["under_review", "failed", "cancelled"] } },
      include: { sender: true, beneficiary: true },
      orderBy: { updatedAt: "desc" },
      take: 30
    }),
    prisma.auditLog.findMany({
      where: { actorType: "admin" },
      include: { actorAdminUser: true },
      orderBy: { createdAt: "desc" },
      take: 20
    })
  ]);

  return [
    ...kycCases.map((record): AdminRiskItem => ({
      id: `kyc:${record.id}`,
      entityType: "kyc_case",
      entityId: record.id,
      severity: record.status === "rejected" ? "high" : "medium",
      title: record.legalName ?? record.user.email,
      detail: `${record.status} identity review for ${record.user.email}`,
      status: record.status,
      createdAt: (record.submittedAt ?? record.createdAt).toISOString()
    })),
    ...transfers.map((record): AdminRiskItem => ({
      id: `transfer:${record.id}`,
      entityType: "transfer",
      entityId: record.id,
      severity: record.status === "failed" || record.status === "cancelled" ? "high" : "medium",
      title: `${record.sender.email} to ${record.beneficiary.displayName}`,
      detail: `${formatMinorAmount(record.sourceAmountMinor)} ${record.sourceCurrency} transfer requires operations attention`,
      status: record.status,
      createdAt: record.updatedAt.toISOString()
    })),
    ...auditLogs.map((record): AdminRiskItem => ({
      id: `audit:${record.id}`,
      entityType: record.entityType === "kyc_case" ? "kyc_case" : "transfer",
      entityId: record.entityId,
      severity: "low",
      title: record.action,
      detail: `${record.actorAdminUser?.email ?? record.actorType} action on ${record.entityType}`,
      status: record.action,
      createdAt: record.createdAt.toISOString()
    }))
  ].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()).slice(0, 50);
}

export async function listAdminAuditLogs(query?: string): Promise<AdminAuditLogSummary[]> {
  const where: Prisma.AuditLogWhereInput | undefined = query
    ? {
        OR: [
          { action: { contains: query, mode: "insensitive" } },
          { entityType: { contains: query, mode: "insensitive" } },
          { entityId: { contains: query, mode: "insensitive" } }
        ]
      }
    : undefined;
  const records = await prisma.auditLog.findMany({
    ...(where ? { where } : {}),
    include: { actorAdminUser: true },
    orderBy: { createdAt: "desc" },
    take: 100
  });

  return records.map((record) => ({
    id: record.id,
    actorType: record.actorType,
    ...(record.actorAdminUser ? { actorEmail: record.actorAdminUser.email } : {}),
    action: record.action,
    entityType: record.entityType,
    entityId: record.entityId,
    createdAt: record.createdAt.toISOString()
  }));
}

export async function updateTransferRecord(transfer: Transfer): Promise<Transfer> {
  const record = await prisma.transfer.update({
    where: { id: transfer.id },
    data: {
      status: transfer.status,
      failureReason: transfer.failureReason ?? null,
      updatedAt: transfer.updatedAt
    }
  });

  return mapTransfer(record);
}

export async function recordTransferStateChange(input: {
  transferId: string;
  fromStatus?: Transfer["status"];
  toStatus: Transfer["status"];
  reason?: string;
  actorType?: "user" | "admin" | "system" | "provider";
  actorId?: string;
}): Promise<void> {
  await prisma.transferStateChange.create({
    data: {
      transferId: input.transferId,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus,
      reason: input.reason ?? null,
      actorType: input.actorType ?? "system",
      actorId: input.actorId ?? null
    }
  });
}

export async function findProviderEventByIdempotencyKey(idempotencyKey: string) {
  return prisma.providerEvent.findUnique({ where: { idempotencyKey } });
}

export type ProviderReconciliationItem = {
  id: string;
  provider: string;
  eventType: string;
  idempotencyKey: string;
  transferId?: string;
  status: string;
  retryCount: number;
  receivedAt: Date;
  processedAt?: Date;
  errorMessage?: string;
};

export async function listProviderEventsForReconciliation(input: {
  staleBefore: Date;
  limit?: number;
}): Promise<ProviderReconciliationItem[]> {
  const limit = input.limit ?? 100;
  const records = await prisma.$queryRaw<Array<{
    id: string;
    provider: string;
    eventType: string;
    idempotencyKey: string;
    transferId: string | null;
    status: string;
    retryCount: number;
    receivedAt: Date;
    processedAt: Date | null;
    errorMessage: string | null;
  }>>`SELECT "id", "provider", "eventType", "idempotencyKey", "transferId", "status", "retryCount", "receivedAt", "processedAt", "errorMessage"
     FROM "ProviderEvent"
     WHERE "status" IN ('received', 'failed') AND "receivedAt" <= ${input.staleBefore}
     ORDER BY "receivedAt" ASC
     LIMIT ${limit}`;

  return records.map((record) => ({
    id: record.id,
    provider: record.provider,
    eventType: record.eventType,
    idempotencyKey: record.idempotencyKey,
    ...(record.transferId ? { transferId: record.transferId } : {}),
    status: record.status,
    retryCount: record.retryCount,
    receivedAt: record.receivedAt,
    ...(record.processedAt ? { processedAt: record.processedAt } : {}),
    ...(record.errorMessage ? { errorMessage: record.errorMessage } : {})
  }));
}

export async function getProviderEventMetrics(): Promise<{
  received: number;
  processed: number;
  failed: number;
  ignored: number;
  retryable: number;
  oldestRetryableAt?: Date;
}> {
  const records = await prisma.$queryRaw<Array<{ status: string; count: bigint; oldestRetryableAt: Date | null }>>`
    SELECT "status", COUNT(*)::bigint AS "count",
      MIN(CASE WHEN "status" IN ('received', 'failed') THEN "receivedAt" ELSE NULL END) AS "oldestRetryableAt"
    FROM "ProviderEvent"
    GROUP BY "status"`;
  const metrics = { received: 0, processed: 0, failed: 0, ignored: 0, retryable: 0 };
  let oldestRetryableAt: Date | undefined;

  for (const record of records) {
    if (record.status in metrics) {
      metrics[record.status as keyof typeof metrics] = Number(record.count);
    }
    if (record.status === "received" || record.status === "failed") {
      metrics.retryable += Number(record.count);
      if (record.oldestRetryableAt && (!oldestRetryableAt || record.oldestRetryableAt < oldestRetryableAt)) {
        oldestRetryableAt = record.oldestRetryableAt;
      }
    }
  }

  return { ...metrics, ...(oldestRetryableAt ? { oldestRetryableAt } : {}) };
}

export async function createProviderEventRecord(input: {
  provider: string;
  eventType: string;
  providerEventId?: string;
  idempotencyKey: string;
  transferId?: string;
  payload: Prisma.InputJsonValue;
}): Promise<{ id: string; status: string }> {
  const record = await prisma.providerEvent.create({
    data: {
      provider: input.provider,
      eventType: input.eventType,
      providerEventId: input.providerEventId ?? null,
      idempotencyKey: input.idempotencyKey,
      transferId: input.transferId ?? null,
      payload: input.payload,
      status: "received"
    }
  });

  return { id: record.id, status: record.status };
}

export async function updateProviderEventRecord(input: {
  id: string;
  status: "processed" | "failed" | "ignored";
  errorMessage?: string;
}): Promise<void> {
  await prisma.providerEvent.update({
    where: { id: input.id },
    data: {
      status: input.status,
      processedAt: new Date(),
      errorMessage: input.errorMessage ?? null
    }
  });
}

export async function incrementProviderEventRetry(id: string): Promise<number> {
  const [record] = await prisma.$queryRaw<Array<{ retryCount: number }>>`UPDATE "ProviderEvent"
    SET "retryCount" = "retryCount" + 1
    WHERE "id" = ${id}
    RETURNING "retryCount"`;

  if (!record) {
    throw new Error("Provider event not found");
  }

  return record.retryCount;
}

export async function createAuditLogRecord(input: {
  actorType: "user" | "admin" | "system" | "provider";
  actorUserId?: string;
  actorAdminUserId?: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Prisma.InputJsonValue;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorType: input.actorType,
      actorUserId: input.actorUserId ?? null,
      actorAdminUserId: input.actorAdminUserId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      ...(input.metadata ? { metadata: input.metadata } : {})
    }
  });
}

export async function createLedgerTransactionRecord(input: {
  transferId?: string;
  memo: string;
  ledgerTransaction: LedgerTransactionDraft;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const entry of input.ledgerTransaction.entries) {
      await tx.ledgerAccount.upsert({
        where: { id: entry.accountId },
        update: {},
        create: {
          id: entry.accountId,
          currency: entry.currency,
          name: entry.accountId
        }
      });
    }

    await tx.ledgerTransaction.create({
      data: {
        transferId: input.transferId ?? null,
        idempotencyKey: input.ledgerTransaction.idempotencyKey,
        memo: input.memo,
        entries: {
          create: input.ledgerTransaction.entries.map((entry) => ({
            accountId: entry.accountId,
            side: entry.side,
            amountMinor: entry.amountMinor.toString(),
            currency: entry.currency,
            memo: entry.memo
          }))
        }
      }
    });
  });
}

type TransferQuoteRecord = Prisma.TransferQuoteGetPayload<Record<string, never>>;
type TransferRecord = Prisma.TransferGetPayload<Record<string, never>>;
type UserRecord = Prisma.UserGetPayload<Record<string, never>>;
type BeneficiaryRecord = Prisma.BeneficiaryGetPayload<Record<string, never>>;
type KycCaseRecord = Prisma.KycCaseGetPayload<Record<string, never>>;
type AdminTransferRecord = Prisma.TransferGetPayload<{
  include: {
    sender: true;
    beneficiary: true;
  };
}>;

function mapAdminTransfer(record: AdminTransferRecord): AdminTransferSummary {
  return {
    ...mapTransfer(record),
    sender: {
      id: record.sender.id,
      email: record.sender.email,
      countryCode: record.sender.countryCode,
      kycStatus: record.sender.kycStatus
    },
    beneficiary: {
      id: record.beneficiary.id,
      displayName: record.beneficiary.displayName,
      countryCode: record.beneficiary.countryCode,
      payoutMethod: record.beneficiary.payoutMethod
    }
  };
}

function mapAdminUser(record: Prisma.AdminUserGetPayload<Record<string, never>>): AdminUserProfile {
  if (record.role !== "admin" && record.role !== "compliance") {
    throw new Error("Admin user role must be admin or compliance");
  }

  return {
    id: record.id,
    email: record.email,
    role: record.role,
    ...(record.disabledAt ? { disabledAt: record.disabledAt.toISOString() } : {}),
    ...(record.lastLoginAt ? { lastLoginAt: record.lastLoginAt.toISOString() } : {}),
    failedLoginAttempts: record.failedLoginAttempts,
    ...(record.lockedUntil ? { lockedUntil: record.lockedUntil.toISOString() } : {}),
    mfaEnabled: record.mfaEnabled,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}

function mapUser(record: UserRecord): UserProfile {
  const user: UserProfile = {
    id: record.id,
    role: record.role,
    email: record.email,
    countryCode: record.countryCode,
    kycStatus: record.kycStatus,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };

  if (record.phoneNumber) {
    user.phoneNumber = record.phoneNumber;
  }

  return user;
}

function mapKycCase(record: KycCaseRecord): KycCaseSummary {
  const summary: KycCaseSummary = {
    id: record.id,
    userId: record.userId,
    status: record.status
  };

  if (record.legalName) summary.legalName = record.legalName;
  if (record.documentType) summary.documentType = record.documentType;
  if (record.provider) summary.provider = record.provider;
  if (record.providerCaseId) summary.providerCaseId = record.providerCaseId;
  if (record.submittedAt) summary.submittedAt = record.submittedAt.toISOString();
  if (record.reviewedAt) summary.reviewedAt = record.reviewedAt.toISOString();
  if (record.rejectionReason) summary.rejectionReason = record.rejectionReason;

  return summary;
}

function mapBeneficiary(record: BeneficiaryRecord): Beneficiary {
  return {
    id: record.id,
    userId: record.userId,
    displayName: record.displayName,
    countryCode: record.countryCode,
    payoutMethod: record.payoutMethod,
    createdAt: record.createdAt.toISOString()
  };
}

function mapQuote(record: TransferQuoteRecord): TransferQuote {
  return {
    id: record.id,
    sourceAmount: {
      amountMinor: record.sourceAmountMinor.toString(),
      currency: record.sourceCurrency
    },
    destinationAmount: {
      amountMinor: record.destinationAmountMinor.toString(),
      currency: record.destinationCurrency
    },
    feeAmount: {
      amountMinor: record.feeAmountMinor.toString(),
      currency: record.feeCurrency
    },
    exchangeRate: record.exchangeRate.toString(),
    expiresAt: record.expiresAt.toISOString()
  };
}

function mapTransfer(record: TransferRecord): Transfer {
  const transfer: Transfer = {
    id: record.id,
    senderUserId: record.senderUserId,
    beneficiaryId: record.beneficiaryId,
    sourceAmount: {
      amountMinor: record.sourceAmountMinor.toString(),
      currency: record.sourceCurrency
    },
    destinationAmount: {
      amountMinor: record.destinationAmountMinor.toString(),
      currency: record.destinationCurrency
    },
    feeAmount: {
      amountMinor: record.feeAmountMinor.toString(),
      currency: record.feeCurrency
    },
    exchangeRate: record.exchangeRate.toString(),
    paymentMethod: record.paymentMethod,
    payoutMethod: record.payoutMethod,
    status: record.status,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };

  if (record.failureReason) {
    transfer.failureReason = record.failureReason;
  }

  return transfer;
}

function formatMinorAmount(value: { toString(): string }): string {
  return value.toString();
}
