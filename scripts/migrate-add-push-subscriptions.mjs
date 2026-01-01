import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function migrate() {
  try {
    console.log("Adding push_subscriptions table...");

    await turso.execute(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh_key TEXT NOT NULL,
        auth_key TEXT NOT NULL,
        subscription_data TEXT,
        device_name TEXT,
        user_agent TEXT,
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT TRUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Add new columns if table already exists (migration)
    try {
      await turso.execute(`
        ALTER TABLE push_subscriptions ADD COLUMN subscription_data TEXT
      `);
      console.log("✅ Added subscription_data column");
    } catch (error) {
      if (!error.message.includes("duplicate column") && !error.message.includes("already exists")) {
        console.log("ℹ️ subscription_data column may already exist");
      }
    }

    try {
      await turso.execute(`
        ALTER TABLE push_subscriptions ADD COLUMN device_name TEXT
      `);
      console.log("✅ Added device_name column");
    } catch (error) {
      if (!error.message.includes("duplicate column") && !error.message.includes("already exists")) {
        console.log("ℹ️ device_name column may already exist");
      }
    }

    try {
      await turso.execute(`
        ALTER TABLE push_subscriptions ADD COLUMN user_agent TEXT
      `);
      console.log("✅ Added user_agent column");
    } catch (error) {
      if (!error.message.includes("duplicate column") && !error.message.includes("already exists")) {
        console.log("ℹ️ user_agent column may already exist");
      }
    }

    try {
      await turso.execute(`
        ALTER TABLE push_subscriptions ADD COLUMN last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
      `);
      console.log("✅ Added last_seen column");
    } catch (error) {
      if (!error.message.includes("duplicate column") && !error.message.includes("already exists")) {
        console.log("ℹ️ last_seen column may already exist");
      }
    }

    try {
      await turso.execute(`
        ALTER TABLE push_subscriptions ADD COLUMN is_active BOOLEAN DEFAULT TRUE
      `);
      console.log("✅ Added is_active column");
    } catch (error) {
      if (!error.message.includes("duplicate column") && !error.message.includes("already exists")) {
        console.log("ℹ️ is_active column may already exist");
      }
    }

    console.log("✅ Push subscriptions table created successfully!");
  } catch (error) {
    console.error("❌ Error creating push_subscriptions table:", error);
    process.exit(1);
  }
}

migrate();

