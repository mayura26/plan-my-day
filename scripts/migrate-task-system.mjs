import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function migrateTaskSystem() {
  try {
    console.log("Starting task system migration...");

    // Add parent_task_id column for subtasks
    console.log("Adding parent_task_id column...");
    try {
      await turso.execute(`
        ALTER TABLE tasks ADD COLUMN parent_task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE
      `);
      console.log("✅ Added parent_task_id column");
    } catch (error) {
      if (error.message.includes("duplicate column")) {
        console.log("ℹ️ parent_task_id column already exists");
      } else {
        throw error;
      }
    }

    // Add continued_from_task_id column for carryover tasks
    console.log("Adding continued_from_task_id column...");
    try {
      await turso.execute(`
        ALTER TABLE tasks ADD COLUMN continued_from_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL
      `);
      console.log("✅ Added continued_from_task_id column");
    } catch (error) {
      if (error.message.includes("duplicate column")) {
        console.log("ℹ️ continued_from_task_id column already exists");
      } else {
        throw error;
      }
    }

    // Create task_dependencies table for multiple dependencies
    console.log("Creating task_dependencies table...");
    await turso.execute(`
      CREATE TABLE IF NOT EXISTS task_dependencies (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        depends_on_task_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        UNIQUE(task_id, depends_on_task_id)
      )
    `);
    console.log("✅ Created task_dependencies table");

    // Create index for faster lookups
    console.log("Creating indexes...");
    try {
      await turso.execute(`
        CREATE INDEX IF NOT EXISTS idx_task_dependencies_task_id ON task_dependencies(task_id)
      `);
      await turso.execute(`
        CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends_on ON task_dependencies(depends_on_task_id)
      `);
      await turso.execute(`
        CREATE INDEX IF NOT EXISTS idx_tasks_parent_task_id ON tasks(parent_task_id)
      `);
      await turso.execute(`
        CREATE INDEX IF NOT EXISTS idx_tasks_continued_from ON tasks(continued_from_task_id)
      `);
      console.log("✅ Created indexes");
    } catch (error) {
      console.log("ℹ️ Some indexes may already exist:", error.message);
    }

    console.log("\n✅ Task system migration completed successfully!");
  } catch (error) {
    console.error("❌ Error during migration:", error);
    process.exit(1);
  }
}

migrateTaskSystem();
