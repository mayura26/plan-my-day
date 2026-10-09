import assert from "node:assert/strict";
import { test } from "node:test";
import type { InStatement, ResultSet } from "@libsql/client";
import { executeTransactionStatement } from "./transaction-execute";

function remoteTransaction() {
  const statements: InStatement[] = [];
  const transaction = {
    async execute(...parameters: [InStatement]): Promise<ResultSet> {
      assert.equal(parameters.length, 1, "Remote transactions accept a single statement");
      const [statement] = parameters;
      statements.push(statement);
      return {
        columns: [],
        columnTypes: [],
        rows: [],
        rowsAffected: 1,
        lastInsertRowid: undefined,
        toJSON: () => ({}),
      };
    },
  };
  return { transaction, statements };
}

test("completion and parent completion queries retain their positional parameters", async () => {
  const { transaction, statements } = remoteTransaction();
  await executeTransactionStatement(
    transaction,
    "SELECT * FROM tasks WHERE id = ? AND user_id = ?",
    ["task", "user"]
  );
  await executeTransactionStatement(
    transaction,
    "UPDATE tasks SET status = ? WHERE id = ? AND user_id = ?",
    ["completed", "task", "user"]
  );
  await executeTransactionStatement(
    transaction,
    "SELECT status FROM tasks WHERE parent_task_id = ? AND user_id = ?",
    ["parent", "user"]
  );
  assert.deepEqual(statements, [
    { sql: "SELECT * FROM tasks WHERE id = ? AND user_id = ?", args: ["task", "user"] },
    {
      sql: "UPDATE tasks SET status = ? WHERE id = ? AND user_id = ?",
      args: ["completed", "task", "user"],
    },
    {
      sql: "SELECT status FROM tasks WHERE parent_task_id = ? AND user_id = ?",
      args: ["parent", "user"],
    },
  ]);
});

test("named parameters and existing statement objects are preserved", async () => {
  const { transaction, statements } = remoteTransaction();
  const statement = { sql: "SELECT :id", args: { id: "task" } };
  await executeTransactionStatement(transaction, "SELECT :id", { id: "task" });
  await executeTransactionStatement(transaction, statement);
  assert.deepEqual(statements[0], statement);
  assert.equal(statements[1], statement);
});

test("statements without parameters still execute remotely", async () => {
  const { transaction, statements } = remoteTransaction();
  await executeTransactionStatement(transaction, "SELECT 1");
  assert.deepEqual(statements, [{ sql: "SELECT 1", args: [] }]);
});
