-- AlterTable
ALTER TABLE "AdminUser" ADD COLUMN     "disabledAt" TIMESTAMP(3),
ADD COLUMN     "lastLoginAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "AdminUser_disabledAt_idx" ON "AdminUser"("disabledAt");
