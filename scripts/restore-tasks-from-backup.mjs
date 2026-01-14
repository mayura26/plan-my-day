import { createClient } from "@libsql/client";
import dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

dotenv.config({ path: ".env.local" });

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function restoreTasks() {
  try {
    console.log("Restoring tasks from backup...");

    // Read the latest backup
    const backupPath = path.join(process.cwd(), "backups", "db-backup-latest.json");
    if (!fs.existsSync(backupPath)) {
      console.error("❌ Backup file not found:", backupPath);
      process.exit(1);
    }

    const backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));
    const tasks = backup.tables.tasks || [];

    if (tasks.length === 0) {
      console.log("⚠️  No tasks found in backup");
      return;
    }

    console.log(`Found ${tasks.length} tasks in backup`);

    // Check current task count
    const currentCount = await turso.execute("SELECT COUNT(*) as count FROM tasks");
    console.log(`Current tasks in database: ${currentCount.rows[0].count}`);

    if (currentCount.rows[0].count > 0) {
      console.log("⚠️  Database already has tasks. Skipping restore to avoid duplicates.");
      console.log("   If you want to restore anyway, delete existing tasks first.");
      return;
    }

    // Restore tasks in order: parent tasks first, then subtasks
    // This ensures foreign key constraints are satisfied
    console.log("Restoring tasks...");
    
    // Separate parent tasks and subtasks
    const parentTasks = tasks.filter((t) => !t.parent_task_id);
    const subtasks = tasks.filter((t) => t.parent_task_id);
    
    console.log(`  - ${parentTasks.length} parent tasks`);
    console.log(`  - ${subtasks.length} subtasks`);
    
    let restored = 0;
    let errors = 0;

    // Restore parent tasks first
    for (const task of parentTasks) {
      try {
        await turso.execute(
          `INSERT INTO tasks (
            id, user_id, title, description, priority, status, duration,
            scheduled_start, scheduled_end, due_date, locked, group_id, template_id,
            task_type, google_calendar_event_id, notification_sent,
            depends_on_task_id, energy_level_required, parent_task_id, continued_from_task_id,
            ignored, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            task.id,
            task.user_id,
            task.title,
            task.description || null,
            task.priority,
            task.status,
            task.duration || null,
            task.scheduled_start || null,
            task.scheduled_end || null,
            task.due_date || null,
            task.locked ? 1 : 0,
            task.group_id || null,
            task.template_id || null,
            task.task_type,
            task.google_calendar_event_id || null,
            task.notification_sent ? 1 : 0,
            task.depends_on_task_id || null,
            task.energy_level_required,
            task.parent_task_id || null,
            task.continued_from_task_id || null,
            task.ignored ? 1 : 0,
            task.created_at,
            task.updated_at,
          ]
        );
        restored++;
      } catch (error) {
        console.error(`Error restoring task ${task.id}:`, error.message);
        errors++;
      }
    }
    
    // Then restore subtasks
    for (const task of subtasks) {
      try {
        await turso.execute(
          `INSERT INTO tasks (
            id, user_id, title, description, priority, status, duration,
            scheduled_start, scheduled_end, due_date, locked, group_id, template_id,
            task_type, google_calendar_event_id, notification_sent,
            depends_on_task_id, energy_level_required, parent_task_id, continued_from_task_id,
            ignored, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            task.id,
            task.user_id,
            task.title,
            task.description || null,
            task.priority,
            task.status,
            task.duration || null,
            task.scheduled_start || null,
            task.scheduled_end || null,
            task.due_date || null,
            task.locked ? 1 : 0,
            task.group_id || null,
            task.template_id || null,
            task.task_type,
            task.google_calendar_event_id || null,
            task.notification_sent ? 1 : 0,
            task.depends_on_task_id || null,
            task.energy_level_required,
            task.parent_task_id || null,
            task.continued_from_task_id || null,
            task.ignored ? 1 : 0,
            task.created_at,
            task.updated_at,
          ]
        );
        restored++;
      } catch (error) {
        console.error(`Error restoring subtask ${task.id}:`, error.message);
        errors++;
      }
    }

    console.log(`✅ Restored ${restored} tasks`);
    if (errors > 0) {
      console.log(`⚠️  ${errors} tasks failed to restore`);
    }
  } catch (error) {
    console.error("❌ Error restoring tasks:", error);
    throw error;
  }
}

restoreTasks()
  .then(() => {
    console.log("Restore completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Restore failed:", error);
    process.exit(1);
  });

