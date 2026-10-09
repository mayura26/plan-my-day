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
  const { checkAndUpdateParentStatus, completeAllSubtasks, checkAndCompleteOriginalTask } =
    await import("./task-completion");
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
    await db.execute(
      "CREATE TABLE tasks (id TEXT PRIMARY KEY, user_id TEXT, parent_task_id TEXT, continued_from_task_id TEXT, status TEXT, updated_at TEXT)"
    );
    await withTaskTransaction(async () => {
      for (const [id, parent, original] of [
        ["parent", null, null],
        ["step", "parent", null],
        ["original", null, null],
        ["carryover", null, "original"],
      ]) {
        await db.execute(
          "INSERT INTO tasks (id, user_id, parent_task_id, continued_from_task_id, status) VALUES (?, ?, ?, ?, ?)",
          [id, "user", parent, original, "pending"]
        );
      }
      await db.execute("UPDATE tasks SET status = ? WHERE id = ? AND user_id = ?", [
        "completed",
        "step",
        "user",
      ]);
      await checkAndUpdateParentStatus("parent", "user");
      assert.equal(
        (await db.execute("SELECT status FROM tasks WHERE id = ?", ["parent"])).rows[0].status,
        "completed"
      );
      await db.execute("UPDATE tasks SET status = ? WHERE id = ?", ["pending", "step"]);
      await completeAllSubtasks("parent", "user");
      await checkAndCompleteOriginalTask("carryover", "user");
    });
    assert.equal(
      (await db.execute("SELECT status FROM tasks WHERE id = ?", ["step"])).rows[0].status,
      "completed"
    );
    assert.equal(
      (await db.execute("SELECT status FROM tasks WHERE id = ?", ["original"])).rows[0].status,
      "completed"
    );
  } finally {
    db.close();
  }
});
