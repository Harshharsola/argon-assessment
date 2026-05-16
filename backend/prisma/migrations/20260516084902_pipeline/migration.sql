-- CreateEnum
CREATE TYPE "ProcessingStage" AS ENUM ('PENDING', 'CONVERTING', 'COMPRESSING', 'GENERATING_VARIANTS', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "VariantType" AS ENUM ('THUMBNAIL', 'WEB', 'FULL');

-- AlterTable
ALTER TABLE "Image" ADD COLUMN     "compressionRatio" DOUBLE PRECISION,
ADD COLUMN     "pHash" TEXT,
ADD COLUMN     "processingStage" "ProcessingStage" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "stagingKey" TEXT,
ALTER COLUMN "storedKey" DROP NOT NULL,
ALTER COLUMN "url" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ImageVariant" (
    "id" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "variantType" "VariantType" NOT NULL,
    "key" TEXT NOT NULL,
    "widthPx" INTEGER NOT NULL,
    "heightPx" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImageVariant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImageVariant_imageId_idx" ON "ImageVariant"("imageId");

-- CreateIndex
CREATE UNIQUE INDEX "ImageVariant_imageId_variantType_key" ON "ImageVariant"("imageId", "variantType");

-- CreateIndex
CREATE INDEX "Image_pHash_idx" ON "Image"("pHash");

-- AddForeignKey
ALTER TABLE "ImageVariant" ADD CONSTRAINT "ImageVariant_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "Image"("id") ON DELETE CASCADE ON UPDATE CASCADE;
