import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function migrate() {
  try {
    console.log("Adding default_locked column to quick_tags table...");

    try {
      await turso.execute("SELECT default_locked FROM quick_tags LIMIT 1");
      console.log("✅ default_locked column already exists");
    } catch (_e) {
      await turso.execute(`
        ALTER TABLE quick_tags ADD COLUMN default_locked INTEGER NOT NULL DEFAULT 0
      `);
      console.log("✅ Added default_locked column");
    }

    console.log("✅ Quick tag default_locked migration completed successfully!");
  } catch (error) {
    console.error("❌ Error running quick tag default_locked migration:", error);
    process.exit(1);
  }
}

migrate();
