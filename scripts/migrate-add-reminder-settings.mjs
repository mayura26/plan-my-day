import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function migrateAddReminderSettings() {
  try {
    // Check if reminder_settings column already exists on task_groups
    const groupCols = await turso.execute("PRAGMA table_info(task_groups)");
    const hasReminderSettings = groupCols.rows.some((r) => r.name === "reminder_settings");

    if (!hasReminderSettings) {
      await turso.execute("ALTER TABLE task_groups ADD COLUMN reminder_settings TEXT DEFAULT NULL");
      console.log("✅ Added reminder_settings column to task_groups");
    } else {
      console.log("ℹ️  reminder_settings column already exists on task_groups, skipping.");
    }

    // Check if lead_reminder_sent column already exists on tasks
    const taskCols = await turso.execute("PRAGMA table_info(tasks)");
    const hasLeadSent = taskCols.rows.some((r) => r.name === "lead_reminder_sent");
    const hasDueSent = taskCols.rows.some((r) => r.name === "due_reminder_sent");

    if (!hasLeadSent) {
      await turso.execute(
        "ALTER TABLE tasks ADD COLUMN lead_reminder_sent INTEGER NOT NULL DEFAULT 0"
      );
      console.log("✅ Added lead_reminder_sent column to tasks");
    } else {
      console.log("ℹ️  lead_reminder_sent column already exists on tasks, skipping.");
    }

    if (!hasDueSent) {
      await turso.execute(
        "ALTER TABLE tasks ADD COLUMN due_reminder_sent INTEGER NOT NULL DEFAULT 0"
      );
      console.log("✅ Added due_reminder_sent column to tasks");
    } else {
      console.log("ℹ️  due_reminder_sent column already exists on tasks, skipping.");
    }

    console.log("✅ Reminder settings migration complete!");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

migrateAddReminderSettings();
