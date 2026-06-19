import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function migrate() {
  try {
    console.log("Adding ai_model preference column to users table...");

    try {
      await turso.execute(`SELECT ai_model FROM users LIMIT 1`);
      console.log("✅ ai_model column already exists");
    } catch (_e) {
      await turso.execute(`
        ALTER TABLE users ADD COLUMN ai_model TEXT DEFAULT 'mini'
      `);
      console.log("✅ Added ai_model column (default 'mini')");
    }

    console.log("✅ AI model preference migration completed successfully!");
  } catch (error) {
    console.error("❌ Error running AI model preference migration:", error);
    process.exit(1);
  }
}

migrate();
