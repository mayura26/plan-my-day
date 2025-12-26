import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function addTimezoneColumn() {
  try {
    console.log("Adding timezone column to users table...");

    // Check if column already exists by trying to query it
    try {
      await turso.execute(`SELECT timezone FROM users LIMIT 1`);
      console.log("✅ Timezone column already exists");
      return;
    } catch (error) {
      // Column doesn't exist, proceed to add it
    }

    // Add timezone column with default value (UTC)
    await turso.execute(`
      ALTER TABLE users ADD COLUMN timezone TEXT DEFAULT 'UTC'
    `);
    console.log("✅ Added timezone column to users table");

    // Update existing users to have UTC as default if they don't have a timezone
    await turso.execute(`
      UPDATE users SET timezone = 'UTC' WHERE timezone IS NULL
    `);
    console.log("✅ Updated existing users with UTC timezone");

    console.log("✅ Timezone migration completed successfully!");
  } catch (error) {
    console.error("❌ Error adding timezone column:", error);
    process.exit(1);
  }
}

addTimezoneColumn();

