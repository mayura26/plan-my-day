import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function migrate() {
  try {
    console.log("Adding AI preferences columns to users table...");

    try {
      await turso.execute(`SELECT default_ai_group_id FROM users LIMIT 1`);
      console.log("✅ default_ai_group_id column already exists");
    } catch (_e) {
      await turso.execute(`
        ALTER TABLE users ADD COLUMN default_ai_group_id TEXT DEFAULT NULL
      `);
      console.log("✅ Added default_ai_group_id column");
    }

    console.log("✅ AI preferences migration completed successfully!");
  } catch (error) {
    console.error("❌ Error running AI preferences migration:", error);
    process.exit(1);
  }
}

migrate();
