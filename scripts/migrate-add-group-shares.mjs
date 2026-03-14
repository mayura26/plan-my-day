import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function migrateAddGroupShares() {
  try {
    // Check if group_shares table already exists
    const tables = await turso.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='group_shares'"
    );
    const tableExists = tables.rows.length > 0;

    if (!tableExists) {
      await turso.execute(`
        CREATE TABLE IF NOT EXISTS group_shares (
          id                  TEXT PRIMARY KEY,
          group_id            TEXT NOT NULL,
          owner_id            TEXT NOT NULL,
          shared_with_user_id TEXT,
          invited_email       TEXT NOT NULL,
          status              TEXT NOT NULL DEFAULT 'pending',
          created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (group_id)            REFERENCES task_groups(id) ON DELETE CASCADE,
          FOREIGN KEY (owner_id)            REFERENCES users(id)       ON DELETE CASCADE,
          FOREIGN KEY (shared_with_user_id) REFERENCES users(id)       ON DELETE SET NULL,
          UNIQUE(group_id, invited_email)
        )
      `);
      console.log("✅ Created group_shares table");
    } else {
      console.log("ℹ️  group_shares table already exists, skipping.");
    }

    console.log("✅ Group shares migration complete!");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

migrateAddGroupShares();
