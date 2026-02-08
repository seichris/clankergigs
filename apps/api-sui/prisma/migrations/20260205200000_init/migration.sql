-- CreateTable
CREATE TABLE "Bounty" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bountyObjectId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "issueNumber" INTEGER NOT NULL,
    "issueUrl" TEXT NOT NULL,
    "admin" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "fundedMist" TEXT NOT NULL DEFAULT '0',
    "escrowedMist" TEXT NOT NULL DEFAULT '0',
    "paidMist" TEXT NOT NULL DEFAULT '0',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Funding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bountyObjectId" TEXT NOT NULL,
    "receiptObjectId" TEXT NOT NULL,
    "funder" TEXT NOT NULL,
    "amountMist" TEXT NOT NULL,
    "lockedUntilMs" BIGINT NOT NULL,
    "txDigest" TEXT NOT NULL,
    "eventSeq" INTEGER NOT NULL,
    "timestampMs" BIGINT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Funding_bountyObjectId_fkey" FOREIGN KEY ("bountyObjectId") REFERENCES "Bounty" ("bountyObjectId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bountyObjectId" TEXT NOT NULL,
    "claimObjectId" TEXT NOT NULL,
    "claimer" TEXT NOT NULL,
    "claimUrl" TEXT NOT NULL,
    "txDigest" TEXT NOT NULL,
    "eventSeq" INTEGER NOT NULL,
    "timestampMs" BIGINT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Claim_bountyObjectId_fkey" FOREIGN KEY ("bountyObjectId") REFERENCES "Bounty" ("bountyObjectId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bountyObjectId" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "amountMist" TEXT NOT NULL,
    "txDigest" TEXT NOT NULL,
    "eventSeq" INTEGER NOT NULL,
    "timestampMs" BIGINT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payout_bountyObjectId_fkey" FOREIGN KEY ("bountyObjectId") REFERENCES "Bounty" ("bountyObjectId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bountyObjectId" TEXT NOT NULL,
    "funder" TEXT NOT NULL,
    "amountMist" TEXT NOT NULL,
    "txDigest" TEXT NOT NULL,
    "eventSeq" INTEGER NOT NULL,
    "timestampMs" BIGINT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Refund_bountyObjectId_fkey" FOREIGN KEY ("bountyObjectId") REFERENCES "Bounty" ("bountyObjectId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IndexerState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packageId" TEXT NOT NULL,
    "cursorTx" TEXT,
    "cursorSeq" INTEGER,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Bounty_bountyObjectId_key" ON "Bounty"("bountyObjectId");

-- CreateIndex
CREATE UNIQUE INDEX "Funding_txDigest_eventSeq_key" ON "Funding"("txDigest", "eventSeq");

-- CreateIndex
CREATE INDEX "Funding_bountyObjectId_idx" ON "Funding"("bountyObjectId");

-- CreateIndex
CREATE INDEX "Funding_funder_idx" ON "Funding"("funder");

-- CreateIndex
CREATE UNIQUE INDEX "Funding_receiptObjectId_key" ON "Funding"("receiptObjectId");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_txDigest_eventSeq_key" ON "Claim"("txDigest", "eventSeq");

-- CreateIndex
CREATE INDEX "Claim_bountyObjectId_idx" ON "Claim"("bountyObjectId");

-- CreateIndex
CREATE INDEX "Claim_claimer_idx" ON "Claim"("claimer");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_claimObjectId_key" ON "Claim"("claimObjectId");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_txDigest_eventSeq_key" ON "Payout"("txDigest", "eventSeq");

-- CreateIndex
CREATE INDEX "Payout_bountyObjectId_idx" ON "Payout"("bountyObjectId");

-- CreateIndex
CREATE INDEX "Payout_recipient_idx" ON "Payout"("recipient");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_txDigest_eventSeq_key" ON "Refund"("txDigest", "eventSeq");

-- CreateIndex
CREATE INDEX "Refund_bountyObjectId_idx" ON "Refund"("bountyObjectId");

-- CreateIndex
CREATE INDEX "Refund_funder_idx" ON "Refund"("funder");

-- CreateIndex
CREATE UNIQUE INDEX "IndexerState_packageId_key" ON "IndexerState"("packageId");
