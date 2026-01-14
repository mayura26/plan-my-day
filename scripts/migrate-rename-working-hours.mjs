import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

async function migrate() {
  try {
    console.log("Renaming working_hours to awake_hours in users table...");

    // Check if awake_hours already exists
    try {
      await turso.execute("SELECT awake_hours FROM users LIMIT 1");
      console.log("✅ Column awake_hours already exists");
      
      // Check if working_hours still exists
      try {
        await turso.execute("SELECT working_hours FROM users LIMIT 1");
        console.log("⚠️  Both columns exist. Migrating data from working_hours to awake_hours...");
        
        // Copy data from working_hours to awake_hours where awake_hours is null
        await turso.execute(`
          UPDATE users 
          SET awake_hours = working_hours 
          WHERE working_hours IS NOT NULL AND awake_hours IS NULL
        `);
        
        console.log("✅ Data migrated from working_hours to awake_hours");
        console.log("⚠️  Note: working_hours column still exists. You may want to drop it manually after verifying the migration.");
      } catch (e) {
        console.log("✅ working_hours column does not exist, migration complete");
      }
      return;
    } catch (e) {
      // awake_hours doesn't exist, continue with migration
    }

    // SQLite doesn't support RENAME COLUMN directly, so we need to:
    // 1. Create new table with awake_hours
    // 2. Copy data
    // 3. Drop old table
    // 4. Rename new table

    // Check if working_hours exists
    let hasWorkingHours = false;
    try {
      await turso.execute("SELECT working_hours FROM users LIMIT 1");
      hasWorkingHours = true;
    } catch (e) {
      console.log("⚠️  working_hours column does not exist, nothing to migrate");
      return;
    }

    console.log("Creating new users table with awake_hours...");
    
    // Get table structure
    const tableInfo = await turso.execute("PRAGMA table_info(users)");
    
    // Create new table with awake_hours instead of working_hours
    await turso.execute(`
      CREATE TABLE users_new (
        id TEXT PRIMARY KEY,
        name TEXT,
        email TEXT UNIQUE,
        image TEXT,
        timezone TEXT,
        awake_hours TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Copy data from old table to new table
    console.log("Copying data to new table...");
    await turso.execute(`
      INSERT INTO users_new (id, name, email, image, timezone, awake_hours, created_at, updated_at)
      SELECT id, name, email, image, timezone, working_hours, created_at, updated_at
      FROM users
    `);

    // Drop old table
    console.log("Dropping old table...");
    await turso.execute("DROP TABLE users");

    // Rename new table
    console.log("Renaming new table...");
    await turso.execute("ALTER TABLE users_new RENAME TO users");

    console.log("✅ Successfully renamed working_hours to awake_hours");
  } catch (error) {
    console.error("❌ Error during migration:", error);
    throw error;
  }
}

migrate()
  .then(() => {
    console.log("Migration completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
  });

