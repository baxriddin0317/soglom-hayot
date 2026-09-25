-- AlterTable
ALTER TABLE "User" ADD COLUMN     "adminMode" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "language" TEXT;

-- AlterTable
ALTER TABLE "Medication" ADD COLUMN     "asNeeded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "everyDays" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "lowStockNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "maxPerDay" INTEGER,
ADD COLUMN     "refillDays" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "stock" DOUBLE PRECISION,
ADD COLUMN     "stockUnit" TEXT,
ADD COLUMN     "unitsPerDose" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD COLUMN     "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- CreateTable
CREATE TABLE "SystemState" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemState_pkey" PRIMARY KEY ("key")
);

