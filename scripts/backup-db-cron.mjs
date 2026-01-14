#!/usr/bin/env node

/**
 * Database Backup Script for Cron
 *
 * This script backs up the database to a local backups directory.
 * Designed to be run via cron job.
 *
 * Usage:
 *   node scripts/backup-db-cron.mjs
 *
 * Cron example (daily at 2 AM):
 *   0 2 * * * cd /path/to/plan-my-day && node scripts/backup-db-cron.mjs >> /var/log/plan-my-day-backup.log 2>&1
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createClient } from "@libsql/client";
import dotenv from "dotenv";

// Load environment variables
dotenv.config({ path: ".env.local" });

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Configuration
const BACKUPS_DIR = process.env.BACKUPS_DIR || path.join(process.cwd(), "backups");
const MAX_BACKUPS = parseInt(process.env.MAX_BACKUPS || "30", 10); // Keep last 30 backups by default
const _COMPRESS_BACKUPS = process.env.COMPRESS_BACKUPS === "true"; // Optional: compress old backups

async function backupDatabase() {
  const startTime = Date.now();
  let backupPath = null;

  try {
    console.log(`[${new Date().toISOString()}] Starting database backup...`);

    // Ensure backups directory exists
    if (!fs.existsSync(BACKUPS_DIR)) {
      fs.mkdirSync(BACKUPS_DIR, { recursive: true });
      console.log(`Created backups directory: ${BACKUPS_DIR}`);
    }

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
      version: "1.0",
      tables: {},
    };

    // Backup each table
    let totalRows = 0;
    for (const tableName of tables) {
      try {
        const rows = await turso.execute(`SELECT * FROM ${tableName}`);
        backup.tables[tableName] = rows.rows.map((row) => {
          const rowObj = {};
          for (const key in row) {
            rowObj[key] = row[key];
          }
          return rowObj;
        });
        totalRows += rows.rows.length;
        console.log(`  ✓ Backed up ${rows.rows.length} rows from ${tableName}`);
      } catch (error) {
        console.error(`  ✗ Error backing up table ${tableName}:`, error.message);
        // Continue with other tables even if one fails
      }
    }

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `db-backup-${timestamp}.json`;
    backupPath = path.join(BACKUPS_DIR, filename);

    // Write backup to file
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), "utf8");

    const fileSize = fs.statSync(backupPath).size;
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`✅ Database backup created successfully!`);
    console.log(`   Location: ${backupPath}`);
    console.log(`   Size: ${(fileSize / 1024).toFixed(2)} KB`);
    console.log(`   Total rows: ${totalRows}`);
    console.log(`   Duration: ${duration}s`);

    // Update latest backup symlink/copy
    const latestBackupPath = path.join(BACKUPS_DIR, "db-backup-latest.json");
    fs.copyFileSync(backupPath, latestBackupPath);
    console.log(`   Latest backup: ${latestBackupPath}`);

    // Cleanup old backups
    await cleanupOldBackups();

    return {
      success: true,
      path: backupPath,
      size: fileSize,
      rows: totalRows,
      duration: parseFloat(duration),
    };
  } catch (error) {
    console.error(`❌ Error creating database backup:`, error);
    throw error;
  }
}

/**
 * Clean up old backups, keeping only the most recent MAX_BACKUPS
 */
async function cleanupOldBackups() {
  try {
    const files = fs
      .readdirSync(BACKUPS_DIR)
      .filter((file) => file.startsWith("db-backup-") && file.endsWith(".json"))
      .filter((file) => file !== "db-backup-latest.json") // Don't delete latest
      .map((file) => {
        const filePath = path.join(BACKUPS_DIR, file);
        const stats = fs.statSync(filePath);
        return {
          name: file,
          path: filePath,
          mtime: stats.mtime.getTime(),
        };
      })
      .sort((a, b) => b.mtime - a.mtime); // Sort by modification time, newest first

    if (files.length <= MAX_BACKUPS) {
      console.log(`   Keeping ${files.length} backup(s) (within limit of ${MAX_BACKUPS})`);
      return;
    }

    // Delete oldest backups
    const toDelete = files.slice(MAX_BACKUPS);
    let deletedCount = 0;
    let freedSpace = 0;

    for (const file of toDelete) {
      try {
        const stats = fs.statSync(file.path);
        freedSpace += stats.size;
        fs.unlinkSync(file.path);
        deletedCount++;
      } catch (error) {
        console.error(`   ⚠️  Error deleting old backup ${file.name}:`, error.message);
      }
    }

    if (deletedCount > 0) {
      console.log(
        `   🗑️  Deleted ${deletedCount} old backup(s), freed ${(freedSpace / 1024 / 1024).toFixed(2)} MB`
      );
    }
  } catch (error) {
    console.error(`   ⚠️  Error during cleanup:`, error.message);
    // Don't throw - cleanup failure shouldn't fail the backup
  }
}

// Main execution
backupDatabase()
  .then((_result) => {
    console.log(`[${new Date().toISOString()}] Backup completed successfully`);
    process.exit(0);
  })
  .catch((error) => {
    console.error(`[${new Date().toISOString()}] Backup failed:`, error);
    process.exit(1);
  });
