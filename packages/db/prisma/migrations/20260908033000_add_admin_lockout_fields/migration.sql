-- AlterTable
ALTER TABLE "AdminUser"
ADD COLUMN "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lockedUntil" TIMESTAMP(3),
ADD COLUMN "mfaSecret" TEXT,
ADD COLUMN "mfaEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "AdminUser_lockedUntil_idx" ON "AdminUser"("lockedUntil");
