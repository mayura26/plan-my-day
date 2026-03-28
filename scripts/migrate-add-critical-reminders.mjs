import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function migrate() {
  try {
    console.log("Adding critical reminder columns...");

    const userCols = await turso.execute("PRAGMA table_info(users)");
    const userNames = userCols.rows.map((r) => r.name);

    if (!userNames.includes("critical_reminder_enabled")) {
      await turso.execute(`
        ALTER TABLE users ADD COLUMN critical_reminder_enabled INTEGER NOT NULL DEFAULT 1
      `);
      console.log("✅ Added critical_reminder_enabled to users");
    } else {
      console.log("ℹ️  critical_reminder_enabled already exists on users");
    }

    if (!userNames.includes("critical_reminder_interval_minutes")) {
      await turso.execute(`
        ALTER TABLE users ADD COLUMN critical_reminder_interval_minutes INTEGER NOT NULL DEFAULT 15
      `);
      console.log("✅ Added critical_reminder_interval_minutes to users");
    } else {
      console.log("ℹ️  critical_reminder_interval_minutes already exists on users");
    }

    const taskCols = await turso.execute("PRAGMA table_info(tasks)");
    const taskNames = taskCols.rows.map((r) => r.name);

    if (!taskNames.includes("critical_reminder_snoozed_until")) {
      await turso.execute(`
        ALTER TABLE tasks ADD COLUMN critical_reminder_snoozed_until DATETIME
      `);
      console.log("✅ Added critical_reminder_snoozed_until to tasks");
    } else {
      console.log("ℹ️  critical_reminder_snoozed_until already exists on tasks");
    }

    if (!taskNames.includes("critical_reminder_last_sent_at")) {
      await turso.execute(`
        ALTER TABLE tasks ADD COLUMN critical_reminder_last_sent_at DATETIME
      `);
      console.log("✅ Added critical_reminder_last_sent_at to tasks");
    } else {
      console.log("ℹ️  critical_reminder_last_sent_at already exists on tasks");
    }

    console.log("✅ Critical reminders migration completed.");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

migrate();
