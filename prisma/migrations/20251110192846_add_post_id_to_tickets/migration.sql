-- AlterTable
ALTER TABLE "public"."NotificationTicket" ADD COLUMN     "postId" TEXT;

-- CreateIndex
CREATE INDEX "NotificationTicket_postId_idx" ON "public"."NotificationTicket"("postId");
