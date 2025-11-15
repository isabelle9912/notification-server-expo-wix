-- CreateTable
CREATE TABLE "public"."PushToken" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."NotificationTicket" (
    "id" SERIAL NOT NULL,
    "expoTicketId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pushTokenId" INTEGER NOT NULL,

    CONSTRAINT "NotificationTicket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushToken_token_key" ON "public"."PushToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTicket_expoTicketId_key" ON "public"."NotificationTicket"("expoTicketId");

-- AddForeignKey
ALTER TABLE "public"."NotificationTicket" ADD CONSTRAINT "NotificationTicket_pushTokenId_fkey" FOREIGN KEY ("pushTokenId") REFERENCES "public"."PushToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;
