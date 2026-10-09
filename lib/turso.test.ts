import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

test("task writes commit together and roll back when ordering fails", async () => {
  // Use a temporary local database shared by the client's transaction connections.
  const directory = mkdtempSync(join(tmpdir(), "plan-my-day-order-"));
  const databasePath = join(directory, "test.db");
  process.env.TURSO_DATABASE_URL = pathToFileURL(databasePath).href;
  process.env.TURSO_AUTH_TOKEN = "local-test";
  const { db, withTaskTransaction } = await import("./turso");
  try {
    await db.execute("CREATE TABLE task_order_test (id TEXT PRIMARY KEY, start INTEGER)");
    await withTaskTransaction(async () => {
      await db.execute("INSERT INTO task_order_test VALUES ('first', 9)");
      await db.execute("INSERT INTO task_order_test VALUES ('second', 10)");
    });
    await assert.rejects(
      withTaskTransaction(async () => {
        await db.execute("UPDATE task_order_test SET start = 12 WHERE id = 'first'");
        await db.execute("UPDATE task_order_test SET start = 13 WHERE id = 'second'");
        throw new Error("Locked step prevents ordering");
      }),
      /Locked step/
    );
    assert.deepEqual(
      (await db.execute("SELECT start FROM task_order_test ORDER BY id")).rows.map(
        (row) => row.start
      ),
      [9, 10]
    );
    await withTaskTransaction(async () => {
      await db.execute("UPDATE task_order_test SET start = 12 WHERE id = 'first'");
      await db.execute("UPDATE task_order_test SET start = 13 WHERE id = 'second'");
    });
    assert.deepEqual(
      (await db.execute("SELECT start FROM task_order_test ORDER BY id")).rows.map(
        (row) => row.start
      ),
      [12, 13]
    );
  } finally {
    db.close();
  }
});
