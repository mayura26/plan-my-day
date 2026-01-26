import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function migrateLockEventsTodos() {
  try {
    console.log("Starting lock events/todos migration...");

    const result = await turso.execute({
      sql: `UPDATE tasks SET locked = TRUE, updated_at = ? WHERE task_type IN ('event', 'todo') AND locked = FALSE`,
      args: [new Date().toISOString()],
    });

    console.log(`✅ Updated ${result.rowsAffected} events/todos to locked=true`);
    console.log("✅ Migration completed successfully!");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

migrateLockEventsTodos();
