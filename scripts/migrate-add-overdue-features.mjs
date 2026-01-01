import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function migrateOverdueFeatures() {
  try {
    console.log("Starting overdue features migration...");

    // Add ignored column to tasks table
    console.log("Adding ignored column...");
    try {
      await turso.execute(`
        ALTER TABLE tasks ADD COLUMN ignored BOOLEAN DEFAULT FALSE
      `);
      console.log("✅ Added ignored column");
    } catch (error) {
      if (error.message.includes("duplicate column") || error.message.includes("already exists")) {
        console.log("ℹ️ ignored column already exists");
      } else {
        throw error;
      }
    }

    console.log("✅ Migration completed successfully!");
  } catch (error) {
    console.error("❌ Error during migration:", error);
    process.exit(1);
  }
}

migrateOverdueFeatures();

