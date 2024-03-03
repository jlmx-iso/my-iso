/*
  Warnings:

  - You are about to drop the column `isPublic` on the `Event` table. All the data in the column will be lost.
  - You are about to drop the column `isPublic` on the `PortfolioImage` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[stripeId]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `location` to the `Photographer` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Comment" ALTER COLUMN "isDeleted" SET DEFAULT false;

-- AlterTable
ALTER TABLE "Event" DROP COLUMN "isPublic",
ADD COLUMN     "isFulfilled" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "isDeleted" SET DEFAULT false;

-- AlterTable
ALTER TABLE "Photographer" ADD COLUMN     "location" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "PortfolioImage" DROP COLUMN "isPublic",
ALTER COLUMN "isDeleted" SET DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "stripeId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_stripeId_key" ON "User"("stripeId");
