import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  const { processReminders } = await import("../lib/reminder-processor");
  await processReminders();
}

main().catch((err) => {
  console.error("❌ process-reminders failed:", err);
  process.exit(1);
});
