import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function migrateAddStepOrder() {
  try {
    console.log("Starting step_order migration...");

    // Add step_order column for subtasks
    console.log("Adding step_order column...");
    try {
      await turso.execute(`
        ALTER TABLE tasks ADD COLUMN step_order INTEGER
      `);
      console.log("✅ Added step_order column");
    } catch (error) {
      if (error.message.includes("duplicate column")) {
        console.log("ℹ️ step_order column already exists");
      } else {
        throw error;
      }
    }

    // Populate step_order for existing subtasks based on current order (priority ASC, created_at ASC)
    console.log("Populating step_order for existing subtasks...");
    const subtasksResult = await turso.execute(`
      SELECT id, parent_task_id 
      FROM tasks 
      WHERE parent_task_id IS NOT NULL 
      ORDER BY parent_task_id, priority ASC, created_at ASC
    `);

    if (subtasksResult.rows.length > 0) {
      // Group subtasks by parent_task_id
      const subtasksByParent = new Map();
      for (const row of subtasksResult.rows) {
        const parentId = row.parent_task_id;
        if (!subtasksByParent.has(parentId)) {
          subtasksByParent.set(parentId, []);
        }
        subtasksByParent.get(parentId).push(row.id);
      }

      // Update step_order for each group
      let updatedCount = 0;
      for (const [_parentId, subtaskIds] of subtasksByParent.entries()) {
        for (let i = 0; i < subtaskIds.length; i++) {
          await turso.execute(`UPDATE tasks SET step_order = ? WHERE id = ?`, [
            i + 1,
            subtaskIds[i],
          ]);
          updatedCount++;
        }
      }
      console.log(`✅ Updated step_order for ${updatedCount} existing subtasks`);
    } else {
      console.log("ℹ️ No existing subtasks to update");
    }

    // Create index for faster lookups
    console.log("Creating index...");
    try {
      await turso.execute(`
        CREATE INDEX IF NOT EXISTS idx_tasks_step_order ON tasks(parent_task_id, step_order)
      `);
      console.log("✅ Created index");
    } catch (error) {
      console.log("ℹ️ Index may already exist:", error.message);
    }

    console.log("\n✅ step_order migration completed successfully!");
  } catch (error) {
    console.error("❌ Error during migration:", error);
    process.exit(1);
  }
}

migrateAddStepOrder();
