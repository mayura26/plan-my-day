import webpush from "web-push";

console.log("Generating VAPID keys for push notifications...\n");

const vapidKeys = webpush.generateVAPIDKeys();

console.log("VAPID Keys Generated Successfully!\n");
console.log("Add these to your .env.local file:\n");
console.log("NEXT_PUBLIC_VAPID_PUBLIC_KEY=" + vapidKeys.publicKey);
console.log("VAPID_PRIVATE_KEY=" + vapidKeys.privateKey);
console.log("\n");
console.log("VAPID_SUBJECT must be either:\n");
console.log("  - An https:// URL (https://your-website-url.com)");
console.log("  - A mailto: link (mailto:your-email@example.com)\n");
console.log("For production:");
console.log("  VAPID_SUBJECT=https://your-production-domain.com\n");
console.log("For local development:");
console.log("  VAPID_SUBJECT=mailto:your-email@example.com");
console.log("  OR (if using HTTPS): VAPID_SUBJECT=https://localhost:3000");
console.log("  To enable HTTPS in dev: next dev --experimental-https\n");

