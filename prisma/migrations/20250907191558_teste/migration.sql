-- CreateTable
CREATE TABLE "PushToken" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "token" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "NotificationTicket" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "expoTicketId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pushTokenId" INTEGER NOT NULL,
    CONSTRAINT "NotificationTicket_pushTokenId_fkey" FOREIGN KEY ("pushTokenId") REFERENCES "PushToken" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PushToken_token_key" ON "PushToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTicket_expoTicketId_key" ON "NotificationTicket"("expoTicketId");
