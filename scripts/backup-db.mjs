import * as fs from "node:fs";
import * as path from "node:path";
import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function backupDatabase() {
  try {
    console.log("Creating database backup...");

    // Get all tables
    const tablesResult = await turso.execute(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `);

    const tables = tablesResult.rows.map((row) => row.name);

    console.log(`Found ${tables.length} tables: ${tables.join(", ")}`);

    // Create backup object
    const backup = {
      timestamp: new Date().toISOString(),
      date: new Date().toISOString().split("T")[0],
      tables: {},
    };

    // Backup each table
    for (const tableName of tables) {
      console.log(`Backing up table: ${tableName}...`);
      const rows = await turso.execute(`SELECT * FROM ${tableName}`);
      backup.tables[tableName] = rows.rows.map((row) => {
        const rowObj = {};
        for (const key in row) {
          rowObj[key] = row[key];
        }
        return rowObj;
      });
      console.log(`  ✓ Backed up ${rows.rows.length} rows from ${tableName}`);
    }

    // Create backups directory if it doesn't exist
    const backupsDir = path.join(process.cwd(), "backups");
    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
    }

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `db-backup-${timestamp}.json`;
    const filepath = path.join(backupsDir, filename);

    // Write backup to file
    fs.writeFileSync(filepath, JSON.stringify(backup, null, 2), "utf8");

    console.log(`✅ Database backup created successfully!`);
    console.log(`   Location: ${filepath}`);
    console.log(`   Size: ${(fs.statSync(filepath).size / 1024).toFixed(2)} KB`);

    // Also create a latest backup symlink/copy
    const latestBackupPath = path.join(backupsDir, "db-backup-latest.json");
    fs.copyFileSync(filepath, latestBackupPath);
    console.log(`   Latest backup: ${latestBackupPath}`);

    return filepath;
  } catch (error) {
    console.error("❌ Error creating database backup:", error);
    throw error;
  }
}

backupDatabase()
  .then(() => {
    console.log("Backup completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Backup failed:", error);
    process.exit(1);
  });
