"""Exercise the actual SQLite upgrade, preservation, isolation and rollback."""
import sqlite3
import unittest
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[1] / "prisma/migrations"
UPGRADE = MIGRATIONS / "20261024000000_multi_network/migration.sql"
CHILDREN = ("LinkedPullRequest", "BountyAsset", "Funding", "Claim", "Payout", "Refund")


def legacy_database():
    db = sqlite3.connect(":memory:")
    for path in sorted(MIGRATIONS.glob("*/migration.sql")):
        if path != UPGRADE:
            db.executescript(path.read_text())
    db.execute("INSERT INTO Repo VALUES ('repo', 'hash', 'maintainer', '2026-01-01', '2026-01-01')")
    db.execute("""INSERT INTO Bounty (id,bountyId,repoHash,issueNumber,metadataURI,status,chainId,contractAddress,updatedAt)
                  VALUES ('old-id','same-hash','hash',12,'https://github.com/a/b/issues/12','OPEN',1,'0xAbCd','2026-01-01')""")
    values = dict(id="child-id", bountyId="same-hash", prUrl="https://github.com/a/b/pull/1", author="author",
                  token="0x0", escrowed="900719925474099312345", funded="900719925474099312346", paid="1",
                  funder="funder", recipient="recipient", claimer="claimer", claimId=7, metadataURI="claim-uri",
                  amountWei="900719925474099312346", lockedUntil=1900000000, txHash="same-tx", logIndex=5,
                  blockNumber=123, createdAt="2026-01-01", updatedAt="2026-01-01")
    for table in CHILDREN:
        columns = [row[1] for row in db.execute(f'PRAGMA table_info("{table}")')]
        db.execute(f'INSERT INTO "{table}" ({",".join(columns)}) VALUES ({",".join("?" for _ in columns)})',
                   [values[column] for column in columns])
    db.execute("INSERT INTO IndexerState VALUES ('state',1,'0xAbCd',123,'2026-01-01')")
    db.commit()
    db.execute("PRAGMA foreign_keys=ON")
    return db


class MigrationTests(unittest.TestCase):
    def test_preserves_every_child_column_and_large_integer_string(self):
        db = legacy_database()
        before = {table: db.execute(f'SELECT * FROM "{table}"').fetchall() for table in CHILDREN}
        columns = {table: [row[1] for row in db.execute(f'PRAGMA table_info("{table}")')] for table in CHILDREN}
        db.executescript(UPGRADE.read_text())
        for table in CHILDREN:
            self.assertEqual(before[table], db.execute(f'SELECT {",".join(columns[table])} FROM "{table}"').fetchall())
            self.assertEqual([("old-id",)], db.execute(f'SELECT bountyDbId FROM "{table}"').fetchall())
        self.assertEqual([], db.execute("PRAGMA foreign_key_check").fetchall())
        self.assertEqual([(1, "0xabcd", "maintainer")], db.execute("SELECT chainId,contractAddress,maintainerAddress FROM RepoDeployment").fetchall())
        self.assertEqual([("0xabcd", 123)], db.execute("SELECT contractAddress,lastBlock FROM IndexerState").fetchall())

    def test_same_bounty_and_transaction_ids_on_two_chains_and_two_contracts(self):
        db = legacy_database()
        db.executescript(UPGRADE.read_text())
        for ident, chain, contract in [("other-chain", 11155111, "0xabcd"), ("other-contract", 1, "0x2222")]:
            db.execute("""INSERT INTO Bounty (id,bountyId,repoHash,issueNumber,metadataURI,status,chainId,contractAddress,updatedAt)
                          SELECT ?,bountyId,repoHash,issueNumber,metadataURI,status,?,?,updatedAt FROM Bounty WHERE id='old-id'""",
                       (ident, chain, contract))
            for table in CHILDREN:
                columns = [row[1] for row in db.execute(f'PRAGMA table_info("{table}")')]
                select = ",".join("?" if column in ("id", "bountyDbId") else column for column in columns)
                db.execute(f'INSERT INTO "{table}" ({",".join(columns)}) SELECT {select} FROM "{table}" WHERE bountyDbId=\'old-id\'',
                           (ident, ident))
        self.assertEqual(3, db.execute("SELECT count(*) FROM Bounty WHERE bountyId='same-hash'").fetchone()[0])
        for table in CHILDREN:
            self.assertEqual(3, db.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0])
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO Bounty SELECT 'duplicate',bountyId,repoHash,issueNumber,metadataURI,status,chainId,contractAddress,createdAt,updatedAt FROM Bounty WHERE id='old-id'")

    def test_orphan_rejects_upgrade_without_silently_dropping_data(self):
        db = legacy_database()
        db.execute("PRAGMA foreign_keys=OFF")
        db.execute("UPDATE Funding SET bountyId='missing'")
        db.commit()
        with self.assertRaises(sqlite3.IntegrityError):
            db.executescript(UPGRADE.read_text())
        db.rollback()
        self.assertEqual([("missing",)], db.execute("SELECT bountyId FROM Funding").fetchall())
        self.assertNotIn("bountyDbId", [row[1] for row in db.execute("PRAGMA table_info(Funding)")])
        self.assertEqual(1, db.execute("SELECT count(*) FROM sqlite_master WHERE name='Bounty_bountyId_key'").fetchone()[0])


if __name__ == "__main__":
    unittest.main()
