import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

async function migrate() {
  try {
    console.log("Adding priority column to task_groups table...");

    // Check if column already exists
    try {
      await turso.execute("SELECT priority FROM task_groups LIMIT 1");
      console.log("✅ Column priority already exists");
      return;
    } catch (e) {
      // Column doesn't exist, continue with migration
    }

    // Add priority column as INTEGER with default value of 5
    await turso.execute(`
      ALTER TABLE task_groups ADD COLUMN priority INTEGER DEFAULT 5
    `);

    console.log("✅ Added priority column to task_groups table");
  } catch (error) {
    console.error("❌ Error during migration:", error);
    throw error;
  }
}

migrate()
  .then(() => {
    console.log("Migration completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
  });

