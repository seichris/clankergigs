-- Stop the API/indexers and back up SQLite before deploying this migration.

-- Rebuild children before removing the old global bounty-ID uniqueness.

-- NOT NULL + FK constraints reject orphaned rows instead of discarding them.

PRAGMA foreign_keys=ON;

BEGIN IMMEDIATE;

PRAGMA defer_foreign_keys=ON;

UPDATE "Bounty" SET "contractAddress" = lower("contractAddress");

UPDATE "IndexerState" SET "contractAddress" = lower("contractAddress");

CREATE TABLE "new_LinkedPullRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bountyId" TEXT NOT NULL,
    "bountyDbId" TEXT NOT NULL,
    "prUrl" TEXT NOT NULL,
    "author" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LinkedPullRequest_bountyDbId_fkey" FOREIGN KEY ("bountyDbId") REFERENCES "Bounty" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_LinkedPullRequest" ("id", "bountyId", "prUrl", "author", "createdAt", "bountyDbId") SELECT old."id", old."bountyId", old."prUrl", old."author", old."createdAt", (SELECT b."id" FROM "Bounty" b WHERE b."bountyId" = old."bountyId") FROM "LinkedPullRequest" old;

DROP TABLE "LinkedPullRequest";

ALTER TABLE "new_LinkedPullRequest" RENAME TO "LinkedPullRequest";

CREATE UNIQUE INDEX "LinkedPullRequest_bountyDbId_prUrl_key" ON "LinkedPullRequest"("bountyDbId", "prUrl");

CREATE INDEX "LinkedPullRequest_bountyDbId_idx" ON "LinkedPullRequest"("bountyDbId");

CREATE TABLE "new_BountyAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bountyId" TEXT NOT NULL,
    "bountyDbId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "escrowed" TEXT NOT NULL DEFAULT '0',
    "funded" TEXT NOT NULL DEFAULT '0',
    "paid" TEXT NOT NULL DEFAULT '0',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BountyAsset_bountyDbId_fkey" FOREIGN KEY ("bountyDbId") REFERENCES "Bounty" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_BountyAsset" ("id", "bountyId", "token", "escrowed", "funded", "paid", "updatedAt", "bountyDbId") SELECT old."id", old."bountyId", old."token", old."escrowed", old."funded", old."paid", old."updatedAt", (SELECT b."id" FROM "Bounty" b WHERE b."bountyId" = old."bountyId") FROM "BountyAsset" old;

DROP TABLE "BountyAsset";

ALTER TABLE "new_BountyAsset" RENAME TO "BountyAsset";

CREATE UNIQUE INDEX "BountyAsset_bountyDbId_token_key" ON "BountyAsset"("bountyDbId", "token");

CREATE INDEX "BountyAsset_bountyDbId_idx" ON "BountyAsset"("bountyDbId");

CREATE TABLE "new_Funding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bountyId" TEXT NOT NULL,
    "bountyDbId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "funder" TEXT NOT NULL,
    "amountWei" TEXT NOT NULL,
    "lockedUntil" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Funding_bountyDbId_fkey" FOREIGN KEY ("bountyDbId") REFERENCES "Bounty" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_Funding" ("id", "bountyId", "token", "funder", "amountWei", "lockedUntil", "txHash", "logIndex", "blockNumber", "createdAt", "bountyDbId") SELECT old."id", old."bountyId", old."token", old."funder", old."amountWei", old."lockedUntil", old."txHash", old."logIndex", old."blockNumber", old."createdAt", (SELECT b."id" FROM "Bounty" b WHERE b."bountyId" = old."bountyId") FROM "Funding" old;

DROP TABLE "Funding";

ALTER TABLE "new_Funding" RENAME TO "Funding";

CREATE UNIQUE INDEX "Funding_bountyDbId_txHash_logIndex_key" ON "Funding"("bountyDbId", "txHash", "logIndex");

CREATE INDEX "Funding_bountyDbId_idx" ON "Funding"("bountyDbId");

CREATE TABLE "new_Claim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bountyId" TEXT NOT NULL,
    "bountyDbId" TEXT NOT NULL,
    "claimId" INTEGER NOT NULL,
    "claimer" TEXT NOT NULL,
    "metadataURI" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Claim_bountyDbId_fkey" FOREIGN KEY ("bountyDbId") REFERENCES "Bounty" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_Claim" ("id", "bountyId", "claimId", "claimer", "metadataURI", "txHash", "logIndex", "blockNumber", "createdAt", "bountyDbId") SELECT old."id", old."bountyId", old."claimId", old."claimer", old."metadataURI", old."txHash", old."logIndex", old."blockNumber", old."createdAt", (SELECT b."id" FROM "Bounty" b WHERE b."bountyId" = old."bountyId") FROM "Claim" old;

DROP TABLE "Claim";

ALTER TABLE "new_Claim" RENAME TO "Claim";

CREATE UNIQUE INDEX "Claim_bountyDbId_claimId_key" ON "Claim"("bountyDbId", "claimId");

CREATE UNIQUE INDEX "Claim_bountyDbId_txHash_logIndex_key" ON "Claim"("bountyDbId", "txHash", "logIndex");

CREATE INDEX "Claim_bountyDbId_idx" ON "Claim"("bountyDbId");

CREATE TABLE "new_Payout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bountyId" TEXT NOT NULL,
    "bountyDbId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "amountWei" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payout_bountyDbId_fkey" FOREIGN KEY ("bountyDbId") REFERENCES "Bounty" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_Payout" ("id", "bountyId", "token", "recipient", "amountWei", "txHash", "logIndex", "blockNumber", "createdAt", "bountyDbId") SELECT old."id", old."bountyId", old."token", old."recipient", old."amountWei", old."txHash", old."logIndex", old."blockNumber", old."createdAt", (SELECT b."id" FROM "Bounty" b WHERE b."bountyId" = old."bountyId") FROM "Payout" old;

DROP TABLE "Payout";

ALTER TABLE "new_Payout" RENAME TO "Payout";

CREATE UNIQUE INDEX "Payout_bountyDbId_txHash_logIndex_key" ON "Payout"("bountyDbId", "txHash", "logIndex");

CREATE INDEX "Payout_bountyDbId_idx" ON "Payout"("bountyDbId");

CREATE TABLE "new_Refund" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bountyId" TEXT NOT NULL,
    "bountyDbId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "funder" TEXT NOT NULL,
    "amountWei" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Refund_bountyDbId_fkey" FOREIGN KEY ("bountyDbId") REFERENCES "Bounty" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_Refund" ("id", "bountyId", "token", "funder", "amountWei", "txHash", "logIndex", "blockNumber", "createdAt", "bountyDbId") SELECT old."id", old."bountyId", old."token", old."funder", old."amountWei", old."txHash", old."logIndex", old."blockNumber", old."createdAt", (SELECT b."id" FROM "Bounty" b WHERE b."bountyId" = old."bountyId") FROM "Refund" old;

DROP TABLE "Refund";

ALTER TABLE "new_Refund" RENAME TO "Refund";

CREATE UNIQUE INDEX "Refund_bountyDbId_txHash_logIndex_key" ON "Refund"("bountyDbId", "txHash", "logIndex");

CREATE INDEX "Refund_bountyDbId_idx" ON "Refund"("bountyDbId");

DROP INDEX "Bounty_bountyId_key";

CREATE UNIQUE INDEX "Bounty_bountyId_chainId_contractAddress_key" ON "Bounty"("bountyId", "chainId", "contractAddress");

CREATE TABLE "RepoDeployment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "repoHash" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "maintainerAddress" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RepoDeployment_repoHash_fkey" FOREIGN KEY ("repoHash") REFERENCES "Repo"("repoHash") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "RepoDeployment_repoHash_chainId_contractAddress_key" ON "RepoDeployment"("repoHash", "chainId", "contractAddress");

INSERT INTO "RepoDeployment" ("id", "repoHash", "chainId", "contractAddress", "maintainerAddress", "createdAt", "updatedAt")
SELECT 'legacy:' || r."id" || ':' || n."chainId" || ':' || n."contractAddress",
       r."repoHash", n."chainId", n."contractAddress", r."maintainerAddress", r."createdAt", r."updatedAt"
FROM "Repo" r JOIN (SELECT DISTINCT "repoHash", "chainId", "contractAddress" FROM "Bounty") n ON n."repoHash" = r."repoHash";

COMMIT;
