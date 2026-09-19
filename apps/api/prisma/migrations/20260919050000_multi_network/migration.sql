-- Stop API/indexers and back up SQLite before applying this atomic migration.

PRAGMA foreign_keys=OFF;

BEGIN TRANSACTION;

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

INSERT INTO "new_BountyAsset" ("id", "bountyId", "token", "escrowed", "funded", "paid", "updatedAt", "bountyDbId") SELECT "id", "bountyId", "token", "escrowed", "funded", "paid", "updatedAt", (SELECT "id" FROM "Bounty" WHERE "Bounty"."bountyId" = "BountyAsset"."bountyId") FROM "BountyAsset";

DROP TABLE "BountyAsset";

ALTER TABLE "new_BountyAsset" RENAME TO "BountyAsset";

CREATE UNIQUE INDEX "BountyAsset_bountyDbId_token_key" ON "BountyAsset" ("bountyDbId", "token");

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

INSERT INTO "new_Funding" ("id", "bountyId", "token", "funder", "amountWei", "lockedUntil", "txHash", "logIndex", "blockNumber", "createdAt", "bountyDbId") SELECT "id", "bountyId", "token", "funder", "amountWei", "lockedUntil", "txHash", "logIndex", "blockNumber", "createdAt", (SELECT "id" FROM "Bounty" WHERE "Bounty"."bountyId" = "Funding"."bountyId") FROM "Funding";

DROP TABLE "Funding";

ALTER TABLE "new_Funding" RENAME TO "Funding";

CREATE UNIQUE INDEX "Funding_bountyDbId_txHash_logIndex_key" ON "Funding" ("bountyDbId", "txHash", "logIndex");

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

INSERT INTO "new_Claim" ("id", "bountyId", "claimId", "claimer", "metadataURI", "txHash", "logIndex", "blockNumber", "createdAt", "bountyDbId") SELECT "id", "bountyId", "claimId", "claimer", "metadataURI", "txHash", "logIndex", "blockNumber", "createdAt", (SELECT "id" FROM "Bounty" WHERE "Bounty"."bountyId" = "Claim"."bountyId") FROM "Claim";

DROP TABLE "Claim";

ALTER TABLE "new_Claim" RENAME TO "Claim";

CREATE UNIQUE INDEX "Claim_bountyDbId_claimId_key" ON "Claim" ("bountyDbId", "claimId");

CREATE UNIQUE INDEX "Claim_bountyDbId_txHash_logIndex_key" ON "Claim" ("bountyDbId", "txHash", "logIndex");

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

INSERT INTO "new_Payout" ("id", "bountyId", "token", "recipient", "amountWei", "txHash", "logIndex", "blockNumber", "createdAt", "bountyDbId") SELECT "id", "bountyId", "token", "recipient", "amountWei", "txHash", "logIndex", "blockNumber", "createdAt", (SELECT "id" FROM "Bounty" WHERE "Bounty"."bountyId" = "Payout"."bountyId") FROM "Payout";

DROP TABLE "Payout";

ALTER TABLE "new_Payout" RENAME TO "Payout";

CREATE UNIQUE INDEX "Payout_bountyDbId_txHash_logIndex_key" ON "Payout" ("bountyDbId", "txHash", "logIndex");

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

INSERT INTO "new_Refund" ("id", "bountyId", "token", "funder", "amountWei", "txHash", "logIndex", "blockNumber", "createdAt", "bountyDbId") SELECT "id", "bountyId", "token", "funder", "amountWei", "txHash", "logIndex", "blockNumber", "createdAt", (SELECT "id" FROM "Bounty" WHERE "Bounty"."bountyId" = "Refund"."bountyId") FROM "Refund";

DROP TABLE "Refund";

ALTER TABLE "new_Refund" RENAME TO "Refund";

CREATE UNIQUE INDEX "Refund_bountyDbId_txHash_logIndex_key" ON "Refund" ("bountyDbId", "txHash", "logIndex");

CREATE TABLE "new_LinkedPullRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bountyId" TEXT NOT NULL,
    "bountyDbId" TEXT NOT NULL,
    "prUrl" TEXT NOT NULL,
    "author" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LinkedPullRequest_bountyDbId_fkey" FOREIGN KEY ("bountyDbId") REFERENCES "Bounty" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_LinkedPullRequest" ("id", "bountyId", "prUrl", "author", "createdAt", "bountyDbId") SELECT "id", "bountyId", "prUrl", "author", "createdAt", (SELECT "id" FROM "Bounty" WHERE "Bounty"."bountyId" = "LinkedPullRequest"."bountyId") FROM "LinkedPullRequest";

DROP TABLE "LinkedPullRequest";

ALTER TABLE "new_LinkedPullRequest" RENAME TO "LinkedPullRequest";

CREATE UNIQUE INDEX "LinkedPullRequest_bountyDbId_prUrl_key" ON "LinkedPullRequest" ("bountyDbId", "prUrl");

DROP INDEX "Bounty_bountyId_key";

UPDATE "Bounty" SET "contractAddress" = lower("contractAddress");

UPDATE "IndexerState" SET "contractAddress" = lower("contractAddress");

CREATE UNIQUE INDEX "Bounty_bountyId_chainId_contractAddress_key" ON "Bounty" ("bountyId", "chainId", "contractAddress");

CREATE TABLE "RepoDeployment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "repoHash" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "maintainerAddress" TEXT NOT NULL,
    CONSTRAINT "RepoDeployment_repoHash_fkey" FOREIGN KEY ("repoHash") REFERENCES "Repo" ("repoHash") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "RepoDeployment_repoHash_chainId_contractAddress_key" ON "RepoDeployment" ("repoHash", "chainId", "contractAddress");

INSERT INTO "RepoDeployment" ("id", "repoHash", "chainId", "contractAddress", "maintainerAddress")
SELECT 'legacy:' || r."id" || ':' || b."chainId" || ':' || b."contractAddress", r."repoHash", b."chainId", b."contractAddress", r."maintainerAddress"
FROM "Repo" r JOIN "Bounty" b ON b."repoHash" = r."repoHash"
GROUP BY r."repoHash", b."chainId", b."contractAddress";

COMMIT;

PRAGMA foreign_keys=ON;
