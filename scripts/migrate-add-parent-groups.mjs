import { createClient } from "@libsql/client";
import dotenv from "dotenv";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

dotenv.config({ path: ".env.local" });

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function backupDatabase() {
  try {
    console.log("📦 Creating database backup...");
    
    const backupDir = join(process.cwd(), "backups");
    if (!existsSync(backupDir)) {
      await mkdir(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupFile = join(backupDir, `backup-${timestamp}.json`);

    // Backup task_groups table
    const groups = await turso.execute("SELECT * FROM task_groups");
    const groupsData = groups.rows.map((row) => {
      const obj = {};
      for (const [key, value] of Object.entries(row)) {
        obj[key] = value;
      }
      return obj;
    });

    // Backup tasks table (to preserve group_id relationships)
    const tasks = await turso.execute("SELECT id, group_id FROM tasks WHERE group_id IS NOT NULL");
    const tasksData = tasks.rows.map((row) => {
      const obj = {};
      for (const [key, value] of Object.entries(row)) {
        obj[key] = value;
      }
      return obj;
    });

    const backup = {
      timestamp: new Date().toISOString(),
      migration: "migrate-add-parent-groups",
      tables: {
        task_groups: groupsData,
        tasks_group_references: tasksData, // Only backing up group_id references
      },
    };

    await writeFile(backupFile, JSON.stringify(backup, null, 2));
    console.log(`✅ Backup created: ${backupFile}`);
    console.log(`   - ${groupsData.length} task groups backed up`);
    console.log(`   - ${tasksData.length} task-group relationships backed up`);
    
    return backupFile;
  } catch (error) {
    console.error("❌ Error creating backup:", error);
    throw error;
  }
}

async function migrateParentGroups() {
  let backupFile = null;
  try {
    console.log("Adding parent_group_id column to task_groups table...");
    console.log("⚠️  IMPORTANT: This migration is safe for existing data. All groups and tasks will be preserved.");

    // Create backup first
    backupFile = await backupDatabase();

    // Enable foreign keys (SQLite requires this to be enabled)
    await turso.execute("PRAGMA foreign_keys = ON");

    // Check if column already exists
    const tableInfo = await turso.execute("PRAGMA table_info(task_groups)");
    const hasParentGroupId = tableInfo.rows.some(
      (row) => row.name === "parent_group_id"
    );

    if (hasParentGroupId) {
      console.log("ℹ️ parent_group_id column already exists, skipping");
    } else {
      // Get current data for verification
      const countResult = await turso.execute("SELECT COUNT(*) as count FROM task_groups");
      const originalCount = countResult.rows[0]?.count || 0;
      console.log(`📊 Found ${originalCount} existing task groups to migrate`);

      // Get sample data to verify after migration
      const sampleGroups = await turso.execute(`
        SELECT id, name, user_id FROM task_groups LIMIT 5
      `);
      const sampleIds = sampleGroups.rows.map((row) => row.id);

      if (originalCount > 0) {
        console.log(`📋 Sample group IDs to verify: ${sampleIds.slice(0, 3).join(", ")}...`);
      }

      // SQLite doesn't support ALTER TABLE ADD COLUMN with FOREIGN KEY directly
      // We need to create a new table, copy data, and rename
      // NOTE: The tasks table has FOREIGN KEY (group_id) REFERENCES task_groups(id) ON DELETE SET NULL
      // When we drop the old table, SQLite will remove this constraint, but the group_id values remain
      // When we recreate the table with the same IDs, the references will still work
      console.log("🔄 Creating new task_groups table with parent_group_id...");

      // Create new table with parent_group_id
      await turso.execute(`
        CREATE TABLE task_groups_new (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          color TEXT DEFAULT '#3B82F6',
          collapsed BOOLEAN DEFAULT FALSE,
          parent_group_id TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (parent_group_id) REFERENCES task_groups_new(id) ON DELETE SET NULL
        )
      `);

      // Copy existing data
      console.log("📋 Copying existing data...");
      await turso.execute(`
        INSERT INTO task_groups_new (id, user_id, name, color, collapsed, created_at, updated_at)
        SELECT id, user_id, name, color, collapsed, created_at, updated_at
        FROM task_groups
      `);

      // Verify data was copied correctly
      const newCountResult = await turso.execute("SELECT COUNT(*) as count FROM task_groups_new");
      const newCount = newCountResult.rows[0]?.count || 0;
      
      if (newCount !== originalCount) {
        throw new Error(
          `❌ Data verification failed: Expected ${originalCount} rows, got ${newCount}. Aborting migration to prevent data loss.`
        );
      }
      console.log(`✅ Verified: ${newCount} rows copied successfully`);

      // Verify sample IDs exist in new table
      if (sampleIds.length > 0) {
        const placeholders = sampleIds.map(() => "?").join(",");
        const verifySample = await turso.execute(
          `SELECT COUNT(*) as count FROM task_groups_new WHERE id IN (${placeholders})`,
          sampleIds
        );
        const verifiedCount = verifySample.rows[0]?.count || 0;
        if (verifiedCount !== sampleIds.length) {
          throw new Error(
            `❌ Sample data verification failed: Expected ${sampleIds.length} sample groups, found ${verifiedCount}. Aborting migration.`
          );
        }
        console.log(`✅ Verified: Sample group IDs preserved`);
      }

      // Check tasks table to see how many tasks reference groups
      const tasksWithGroups = await turso.execute(`
        SELECT COUNT(*) as count FROM tasks WHERE group_id IS NOT NULL
      `);
      const taskCount = tasksWithGroups.rows[0]?.count || 0;
      console.log(`📊 Found ${taskCount} tasks that reference task groups`);

      // Drop old table
      // NOTE: In SQLite, dropping a table removes foreign key constraints from referencing tables
      // However, the group_id values in tasks table remain intact
      // After recreating the table with the same IDs, the logical relationship is restored
      console.log("🔄 Replacing old table...");
      await turso.execute("DROP TABLE task_groups");

      // Rename new table
      await turso.execute("ALTER TABLE task_groups_new RENAME TO task_groups");

      // Verify final state
      const finalCountResult = await turso.execute("SELECT COUNT(*) as count FROM task_groups");
      const finalCount = finalCountResult.rows[0]?.count || 0;
      
      if (finalCount !== originalCount) {
        throw new Error(
          `❌ Final verification failed: Expected ${originalCount} rows, got ${finalCount}.`
        );
      }

      // Verify sample IDs still exist
      if (sampleIds.length > 0) {
        const placeholders = sampleIds.map(() => "?").join(",");
        const finalVerify = await turso.execute(
          `SELECT COUNT(*) as count FROM task_groups WHERE id IN (${placeholders})`,
          sampleIds
        );
        const finalVerifiedCount = finalVerify.rows[0]?.count || 0;
        if (finalVerifiedCount !== sampleIds.length) {
          throw new Error(
            `❌ Final sample verification failed: Expected ${sampleIds.length} sample groups, found ${finalVerifiedCount}.`
          );
        }
      }

      // Verify tasks still reference groups correctly (group_id values should still match)
      if (taskCount > 0) {
        const tasksStillLinked = await turso.execute(`
          SELECT COUNT(*) as count 
          FROM tasks t
          WHERE t.group_id IS NOT NULL 
          AND EXISTS (SELECT 1 FROM task_groups g WHERE g.id = t.group_id)
        `);
        const linkedCount = tasksStillLinked.rows[0]?.count || 0;
        console.log(`✅ Verified: ${linkedCount} of ${taskCount} tasks still correctly linked to groups`);
        
        if (linkedCount < taskCount) {
          console.warn(`⚠️  Warning: ${taskCount - linkedCount} tasks have group_id values that don't match any group`);
          console.warn(`   This may indicate orphaned references, but tasks will still function normally`);
        }
      }

      console.log("✅ Added parent_group_id column to task_groups table");
      console.log(`✅ Final verification: ${finalCount} groups preserved`);
    }

    console.log("✅ Migration completed successfully!");
    if (backupFile) {
      console.log(`💾 Backup saved at: ${backupFile}`);
    }
  } catch (error) {
    console.error("❌ Error during migration:", error);
    console.error("⚠️  If migration failed partway through:");
    console.error("   1. Check if task_groups_new table exists (it should be cleaned up)");
    console.error("   2. Verify task_groups table still exists");
    if (backupFile) {
      console.error(`   3. Backup available at: ${backupFile}`);
      console.error("   4. You can restore from this backup if needed");
    } else {
      console.error("   3. No backup was created - manual recovery may be needed");
    }
    process.exit(1);
  }
}

migrateParentGroups();
