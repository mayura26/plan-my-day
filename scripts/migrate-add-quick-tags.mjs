import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function migrateAddQuickTags() {
  try {
    // Check if table already exists
    const tables = await turso.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='quick_tags'"
    );
    if (tables.rows.length > 0) {
      console.log("ℹ️  quick_tags table already exists, skipping migration.");
      return;
    }

    await turso.execute(`
      CREATE TABLE IF NOT EXISTS quick_tags (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        task_title TEXT NOT NULL,
        task_description TEXT,
        task_type TEXT NOT NULL DEFAULT 'task',
        priority INTEGER NOT NULL DEFAULT 3,
        duration_minutes INTEGER,
        energy_level INTEGER NOT NULL DEFAULT 3,
        schedule_offset_minutes INTEGER NOT NULL DEFAULT 60,
        group_id TEXT,
        auto_accept INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    console.log("✅ quick_tags table created successfully!");

    // Verify
    const verify = await turso.execute("PRAGMA table_info(quick_tags)");
    console.log(`✅ Verified: quick_tags has ${verify.rows.length} columns`);
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

migrateAddQuickTags();
