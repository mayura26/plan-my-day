import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import dotenv from "dotenv";

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

    const backup = {
      timestamp: new Date().toISOString(),
      migration: "migrate-add-is-parent-group",
      tables: {
        task_groups: groupsData,
      },
    };

    await writeFile(backupFile, JSON.stringify(backup, null, 2));
    console.log(`✅ Backup created: ${backupFile}`);
    console.log(`   - ${groupsData.length} task groups backed up`);

    return backupFile;
  } catch (error) {
    console.error("❌ Error creating backup:", error);
    throw error;
  }
}

async function migrateIsParentGroup() {
  let backupFile = null;
  try {
    console.log("Adding is_parent_group column to task_groups table...");

    // Create backup first
    backupFile = await backupDatabase();

    // Check if column already exists
    const tableInfo = await turso.execute("PRAGMA table_info(task_groups)");
    const hasIsParentGroup = tableInfo.rows.some((row) => row.name === "is_parent_group");

    if (hasIsParentGroup) {
      console.log("ℹ️ is_parent_group column already exists, skipping");
    } else {
      // Get current row count for verification
      const countResult = await turso.execute("SELECT COUNT(*) as count FROM task_groups");
      const originalCount = countResult.rows[0]?.count || 0;
      console.log(`📊 Found ${originalCount} existing task groups`);

      // Add the column with default false (existing groups are regular groups)
      // This is safe - SQLite ALTER TABLE ADD COLUMN is non-destructive
      await turso.execute(`
        ALTER TABLE task_groups ADD COLUMN is_parent_group BOOLEAN DEFAULT FALSE
      `);

      // Verify the column was added and all existing rows have the default value
      const verifyResult = await turso.execute(`
        SELECT COUNT(*) as count 
        FROM task_groups 
        WHERE is_parent_group IS NULL OR is_parent_group = 0
      `);
      const verifiedCount = verifyResult.rows[0]?.count || 0;

      if (verifiedCount !== originalCount) {
        console.warn(
          `⚠️  Warning: Expected ${originalCount} groups with is_parent_group=false, found ${verifiedCount}`
        );
      } else {
        console.log(
          `✅ Verified: All ${verifiedCount} existing groups set as regular groups (is_parent_group=false)`
        );
      }

      console.log("✅ Added is_parent_group column to task_groups table");
    }

    console.log("✅ Migration completed successfully!");
    if (backupFile) {
      console.log(`💾 Backup saved at: ${backupFile}`);
    }
  } catch (error) {
    console.error("❌ Error during migration:", error);
    if (error.message?.includes("duplicate column") || error.message?.includes("already exists")) {
      console.log("ℹ️ Column may already exist - this is safe to ignore");
      if (backupFile) {
        console.log(`💾 Backup saved at: ${backupFile}`);
      }
    } else {
      console.error("⚠️  Migration failed - database should be unchanged");
      if (backupFile) {
        console.error(`💾 Backup available at: ${backupFile}`);
        console.error("   You can restore from this backup if needed");
      }
      process.exit(1);
    }
  }
}

migrateIsParentGroup();
