import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function migrateDueDate() {
  try {
    console.log("Adding due_date column to tasks table...");

    // Add due_date column if it doesn't exist
    // SQLite doesn't support IF NOT EXISTS for columns, so we check first
    const tableInfo = await turso.execute("PRAGMA table_info(tasks)");
    const columns = tableInfo.rows.map((row) => row.name);

    if (!columns.includes("due_date")) {
      await turso.execute(`ALTER TABLE tasks ADD COLUMN due_date DATETIME`);
      console.log("✅ Added due_date column to tasks table");
    } else {
      console.log("ℹ️ due_date column already exists, skipping");
    }

    console.log("✅ Migration completed successfully!");
  } catch (error) {
    console.error("❌ Error during migration:", error);
    process.exit(1);
  }
}

migrateDueDate();
