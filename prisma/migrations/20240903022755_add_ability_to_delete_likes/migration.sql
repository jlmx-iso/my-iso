-- AlterTable
ALTER TABLE "CommentLike" ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "EventLike" ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;
