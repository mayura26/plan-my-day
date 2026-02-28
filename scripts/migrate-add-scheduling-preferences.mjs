import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function migrate() {
  try {
    console.log("Adding scheduling preference columns to users table...");

    try {
      await turso.execute(`SELECT auto_schedule_new_tasks FROM users LIMIT 1`);
      console.log("✅ auto_schedule_new_tasks column already exists");
    } catch (_e) {
      await turso.execute(`
        ALTER TABLE users ADD COLUMN auto_schedule_new_tasks INTEGER DEFAULT 0
      `);
      console.log("✅ Added auto_schedule_new_tasks column");
    }

    try {
      await turso.execute(`SELECT default_schedule_mode FROM users LIMIT 1`);
      console.log("✅ default_schedule_mode column already exists");
    } catch (_e) {
      await turso.execute(`
        ALTER TABLE users ADD COLUMN default_schedule_mode TEXT DEFAULT 'now'
      `);
      console.log("✅ Added default_schedule_mode column");
    }

    await turso.execute(`
      UPDATE users SET default_schedule_mode = 'now' WHERE default_schedule_mode IS NULL
    `);
    console.log("✅ Scheduling preferences migration completed successfully!");
  } catch (error) {
    console.error("❌ Error running scheduling preferences migration:", error);
    process.exit(1);
  }
}

migrate();
