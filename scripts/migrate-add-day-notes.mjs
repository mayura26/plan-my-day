import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function migrateDayNotes() {
  try {
    console.log("Adding day_notes table...");

    // Check if table already exists
    const tables = await turso.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='day_notes'"
    );

    if (tables.rows.length > 0) {
      console.log("ℹ️ day_notes table already exists, skipping");
    } else {
      await turso.execute(`
        CREATE TABLE IF NOT EXISTS day_notes (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          note_date DATE NOT NULL,
          content TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          UNIQUE(user_id, note_date)
        )
      `);
      console.log("✅ Added day_notes table");
    }

    console.log("✅ Migration completed successfully!");
  } catch (error) {
    console.error("❌ Error during migration:", error);
    process.exit(1);
  }
}

migrateDayNotes();
