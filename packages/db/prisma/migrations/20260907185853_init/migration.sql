-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('sender', 'admin', 'compliance');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('not_started', 'pending', 'approved', 'rejected', 'expired');

-- CreateEnum
CREATE TYPE "CountryCode" AS ENUM ('US', 'RW', 'KE', 'UG', 'TZ', 'CD');

-- CreateEnum
CREATE TYPE "CurrencyCode" AS ENUM ('USD', 'RWF', 'KES', 'UGX', 'TZS', 'CDF');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('card', 'bank_account', 'mobile_money', 'crypto_wallet');

-- CreateEnum
CREATE TYPE "PayoutMethod" AS ENUM ('mobile_money', 'bank_account', 'crypto_wallet');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('draft', 'quoted', 'pending_payment', 'payment_received', 'under_review', 'processing_payout', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "TransferFailureReason" AS ENUM ('payment_failed', 'payout_failed', 'compliance_rejected', 'expired', 'cancelled_by_user', 'cancelled_by_admin');

-- CreateEnum
CREATE TYPE "LedgerEntrySide" AS ENUM ('debit', 'credit');

-- CreateEnum
CREATE TYPE "ProviderEventStatus" AS ENUM ('received', 'processed', 'failed', 'ignored');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('user', 'admin', 'system', 'provider');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'sender',
    "email" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "countryCode" "CountryCode" NOT NULL,
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'not_started',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycCase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "KycStatus" NOT NULL DEFAULT 'pending',
    "provider" TEXT,
    "providerCaseId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Beneficiary" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "countryCode" "CountryCode" NOT NULL,
    "payoutMethod" "PayoutMethod" NOT NULL,
    "payoutToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Beneficiary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferQuote" (
    "id" TEXT NOT NULL,
    "senderUserId" TEXT,
    "sourceAmountMinor" DECIMAL(20,0) NOT NULL,
    "sourceCurrency" "CurrencyCode" NOT NULL,
    "destinationAmountMinor" DECIMAL(20,0) NOT NULL,
    "destinationCurrency" "CurrencyCode" NOT NULL,
    "feeAmountMinor" DECIMAL(20,0) NOT NULL,
    "feeCurrency" "CurrencyCode" NOT NULL,
    "exchangeRate" DECIMAL(24,12) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransferQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transfer" (
    "id" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "beneficiaryId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "sourceAmountMinor" DECIMAL(20,0) NOT NULL,
    "sourceCurrency" "CurrencyCode" NOT NULL,
    "destinationAmountMinor" DECIMAL(20,0) NOT NULL,
    "destinationCurrency" "CurrencyCode" NOT NULL,
    "feeAmountMinor" DECIMAL(20,0) NOT NULL,
    "feeCurrency" "CurrencyCode" NOT NULL,
    "exchangeRate" DECIMAL(24,12) NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "payoutMethod" "PayoutMethod" NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'pending_payment',
    "failureReason" "TransferFailureReason",
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferStateChange" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "fromStatus" "TransferStatus",
    "toStatus" "TransferStatus" NOT NULL,
    "reason" TEXT,
    "actorType" "AuditActorType" NOT NULL DEFAULT 'system',
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransferStateChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "id" TEXT NOT NULL,
    "currency" "CurrencyCode" NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerTransaction" (
    "id" TEXT NOT NULL,
    "transferId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "memo" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "ledgerTransactionId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "side" "LedgerEntrySide" NOT NULL,
    "amountMinor" DECIMAL(20,0) NOT NULL,
    "currency" "CurrencyCode" NOT NULL,
    "memo" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "providerEventId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "transferId" TEXT,
    "status" "ProviderEventStatus" NOT NULL DEFAULT 'received',
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "ProviderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorType" "AuditActorType" NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phoneNumber_key" ON "User"("phoneNumber");

-- CreateIndex
CREATE INDEX "User_countryCode_idx" ON "User"("countryCode");

-- CreateIndex
CREATE INDEX "User_kycStatus_idx" ON "User"("kycStatus");

-- CreateIndex
CREATE INDEX "KycCase_userId_status_idx" ON "KycCase"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "KycCase_provider_providerCaseId_key" ON "KycCase"("provider", "providerCaseId");

-- CreateIndex
CREATE INDEX "Beneficiary_userId_idx" ON "Beneficiary"("userId");

-- CreateIndex
CREATE INDEX "Beneficiary_countryCode_payoutMethod_idx" ON "Beneficiary"("countryCode", "payoutMethod");

-- CreateIndex
CREATE INDEX "TransferQuote_senderUserId_idx" ON "TransferQuote"("senderUserId");

-- CreateIndex
CREATE INDEX "TransferQuote_expiresAt_idx" ON "TransferQuote"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Transfer_idempotencyKey_key" ON "Transfer"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Transfer_senderUserId_createdAt_idx" ON "Transfer"("senderUserId", "createdAt");

-- CreateIndex
CREATE INDEX "Transfer_beneficiaryId_idx" ON "Transfer"("beneficiaryId");

-- CreateIndex
CREATE INDEX "Transfer_status_createdAt_idx" ON "Transfer"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TransferStateChange_transferId_createdAt_idx" ON "TransferStateChange"("transferId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerAccount_currency_idx" ON "LedgerAccount"("currency");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerTransaction_idempotencyKey_key" ON "LedgerTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "LedgerTransaction_transferId_idx" ON "LedgerTransaction"("transferId");

-- CreateIndex
CREATE INDEX "LedgerTransaction_postedAt_idx" ON "LedgerTransaction"("postedAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_accountId_createdAt_idx" ON "LedgerEntry"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_ledgerTransactionId_idx" ON "LedgerEntry"("ledgerTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderEvent_idempotencyKey_key" ON "ProviderEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ProviderEvent_provider_eventType_idx" ON "ProviderEvent"("provider", "eventType");

-- CreateIndex
CREATE INDEX "ProviderEvent_transferId_idx" ON "ProviderEvent"("transferId");

-- CreateIndex
CREATE INDEX "ProviderEvent_status_receivedAt_idx" ON "ProviderEvent"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderEvent_provider_providerEventId_key" ON "ProviderEvent"("provider", "providerEventId");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "KycCase" ADD CONSTRAINT "KycCase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Beneficiary" ADD CONSTRAINT "Beneficiary_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_beneficiaryId_fkey" FOREIGN KEY ("beneficiaryId") REFERENCES "Beneficiary"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "TransferQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferStateChange" ADD CONSTRAINT "TransferStateChange_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "Transfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "Transfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_ledgerTransactionId_fkey" FOREIGN KEY ("ledgerTransactionId") REFERENCES "LedgerTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderEvent" ADD CONSTRAINT "ProviderEvent_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "Transfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
