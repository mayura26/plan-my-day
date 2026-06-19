import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function migrate() {
  try {
    console.log("Adding platform column to push_subscriptions...");
    await turso.execute(`
      ALTER TABLE push_subscriptions ADD COLUMN platform TEXT
    `);
    console.log("✅ Added platform column");
  } catch (error) {
    if (error.message?.includes("duplicate column") || error.message?.includes("already exists")) {
      console.log("ℹ️ platform column may already exist");
    } else {
      console.error("❌ Error adding platform column:", error);
      process.exit(1);
    }
  }
}

migrate();
