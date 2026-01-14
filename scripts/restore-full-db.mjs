import * as fs from "node:fs";
import * as path from "node:path";
import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function restoreFullDatabase() {
  try {
    console.log("Restoring full database from backup...");

    // Read the latest backup
    const backupPath = path.join(process.cwd(), "backups", "db-backup-latest.json");
    if (!fs.existsSync(backupPath)) {
      console.error("❌ Backup file not found:", backupPath);
      process.exit(1);
    }

    const backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));

    // Restore in order: users, groups, then tasks (parent tasks first, then subtasks)

    // 1. Restore users (but skip if they already exist)
    console.log("\n1. Restoring users...");
    const currentUsers = await turso.execute("SELECT id FROM users");
    const existingUserIds = new Set(currentUsers.rows.map((r) => r.id));

    const users = backup.tables.users || [];
    let usersRestored = 0;
    for (const user of users) {
      if (existingUserIds.has(user.id)) {
        console.log(`  ✓ User ${user.id} already exists, skipping`);
        continue;
      }
      try {
        await turso.execute(
          `INSERT INTO users (id, name, email, image, timezone, awake_hours, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            user.id,
            user.name || null,
            user.email || null,
            user.image || null,
            user.timezone || null,
            user.awake_hours || user.working_hours || null, // Support both old and new field names
            user.created_at,
            user.updated_at,
          ]
        );
        usersRestored++;
      } catch (error) {
        console.error(`  ✗ Error restoring user ${user.id}:`, error.message);
      }
    }
    console.log(`  ✅ Restored ${usersRestored} users`);

    // 2. Restore groups
    console.log("\n2. Restoring task groups...");
    const currentGroups = await turso.execute("SELECT id FROM task_groups");
    const existingGroupIds = new Set(currentGroups.rows.map((r) => r.id));

    const groups = backup.tables.task_groups || [];
    let groupsRestored = 0;
    for (const group of groups) {
      if (existingGroupIds.has(group.id)) {
        continue;
      }
      try {
        let autoScheduleHours = null;
        if (group.auto_schedule_hours) {
          try {
            autoScheduleHours = JSON.parse(group.auto_schedule_hours);
          } catch (_e) {
            // Already an object
            autoScheduleHours = group.auto_schedule_hours;
          }
        }

        await turso.execute(
          `INSERT INTO task_groups (
            id, user_id, name, color, collapsed, parent_group_id, is_parent_group,
            auto_schedule_enabled, auto_schedule_hours, priority, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            group.id,
            group.user_id,
            group.name,
            group.color,
            group.collapsed ? 1 : 0,
            group.parent_group_id || null,
            group.is_parent_group ? 1 : 0,
            group.auto_schedule_enabled ? 1 : 0,
            autoScheduleHours ? JSON.stringify(autoScheduleHours) : null,
            group.priority || 5, // Default to 5 if not set
            group.created_at,
            group.updated_at,
          ]
        );
        groupsRestored++;
      } catch (error) {
        console.error(`  ✗ Error restoring group ${group.id}:`, error.message);
      }
    }
    console.log(`  ✅ Restored ${groupsRestored} groups`);

    // 3. Restore tasks (parent tasks first, then subtasks)
    console.log("\n3. Restoring tasks...");
    const tasks = backup.tables.tasks || [];
    const parentTasks = tasks.filter((t) => !t.parent_task_id);
    const subtasks = tasks.filter((t) => t.parent_task_id);

    console.log(`  - ${parentTasks.length} parent tasks`);
    console.log(`  - ${subtasks.length} subtasks`);

    let tasksRestored = 0;
    let taskErrors = 0;

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
        tasksRestored++;
      } catch (error) {
        console.error(`  ✗ Error restoring task ${task.id}:`, error.message);
        taskErrors++;
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
        tasksRestored++;
      } catch (error) {
        console.error(`  ✗ Error restoring subtask ${task.id}:`, error.message);
        taskErrors++;
      }
    }

    console.log(`  ✅ Restored ${tasksRestored} tasks`);
    if (taskErrors > 0) {
      console.log(`  ⚠️  ${taskErrors} tasks failed to restore`);
    }

    console.log("\n✅ Full database restore completed!");
  } catch (error) {
    console.error("❌ Error restoring database:", error);
    throw error;
  }
}

restoreFullDatabase()
  .then(() => {
    console.log("Restore completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Restore failed:", error);
    process.exit(1);
  });
