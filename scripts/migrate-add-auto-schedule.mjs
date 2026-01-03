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
      migration: "migrate-add-auto-schedule",
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

async function migrateAutoSchedule() {
  let backupFile = null;
  try {
    console.log("Adding auto_schedule_enabled and auto_schedule_hours columns to task_groups table...");

    // Create backup first
    backupFile = await backupDatabase();

    // Check if columns already exist
    const tableInfo = await turso.execute("PRAGMA table_info(task_groups)");
    const hasAutoScheduleEnabled = tableInfo.rows.some((row) => row.name === "auto_schedule_enabled");
    const hasAutoScheduleHours = tableInfo.rows.some((row) => row.name === "auto_schedule_hours");

    if (hasAutoScheduleEnabled && hasAutoScheduleHours) {
      console.log("ℹ️ auto_schedule columns already exist, skipping");
    } else {
      // Get current row count for verification
      const countResult = await turso.execute("SELECT COUNT(*) as count FROM task_groups");
      const originalCount = countResult.rows[0]?.count || 0;
      console.log(`📊 Found ${originalCount} existing task groups`);

      // Add auto_schedule_enabled column with default false
      if (!hasAutoScheduleEnabled) {
        await turso.execute(`
          ALTER TABLE task_groups ADD COLUMN auto_schedule_enabled BOOLEAN DEFAULT FALSE
        `);
        console.log("✅ Added auto_schedule_enabled column");
      }

      // Add auto_schedule_hours column with default NULL
      if (!hasAutoScheduleHours) {
        await turso.execute(`
          ALTER TABLE task_groups ADD COLUMN auto_schedule_hours TEXT DEFAULT NULL
        `);
        console.log("✅ Added auto_schedule_hours column");
      }

      // Verify the columns were added and all existing rows have the default values
      const verifyResult = await turso.execute(`
        SELECT COUNT(*) as count 
        FROM task_groups 
        WHERE (auto_schedule_enabled IS NULL OR auto_schedule_enabled = 0)
          AND (auto_schedule_hours IS NULL)
      `);
      const verifiedCount = verifyResult.rows[0]?.count || 0;

      if (verifiedCount !== originalCount) {
        console.warn(
          `⚠️  Warning: Expected ${originalCount} groups with default values, found ${verifiedCount}`
        );
      } else {
        console.log(
          `✅ Verified: All ${verifiedCount} existing groups have default auto-schedule settings (disabled)`
        );
      }
    }

    console.log("✅ Migration completed successfully!");
    if (backupFile) {
      console.log(`💾 Backup saved at: ${backupFile}`);
    }
  } catch (error) {
    console.error("❌ Error during migration:", error);
    if (error.message?.includes("duplicate column") || error.message?.includes("already exists")) {
      console.log("ℹ️ Columns may already exist - this is safe to ignore");
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

migrateAutoSchedule();

