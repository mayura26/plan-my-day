import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function migrate() {
  try {
    console.log("Adding working_hours column to users table...");

    // Check if column already exists by trying to select it
    try {
      await turso.execute("SELECT working_hours FROM users LIMIT 1");
      console.log("✅ Column working_hours already exists");
      return;
    } catch (error) {
      // Column doesn't exist, continue with migration
    }

    // Add working_hours column as TEXT (will store JSON)
    await turso.execute(`
      ALTER TABLE users ADD COLUMN working_hours TEXT
    `);

    console.log("✅ Added working_hours column to users table");
    console.log("✅ Migration completed successfully!");
  } catch (error) {
    console.error("❌ Error during migration:", error);
    process.exit(1);
  }
}

migrate();

