import webpush from "web-push";

console.log("Generating VAPID keys for push notifications...\n");

const vapidKeys = webpush.generateVAPIDKeys();

console.log("VAPID Keys Generated Successfully!\n");
console.log("Add these to your .env.local file:\n");
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${vapidKeys.privateKey}`);
console.log("VAPID_SUBJECT=mailto:your-email@example.com\n");
console.log("Note: VAPID_SUBJECT can be either:");
console.log("  - mailto:your-email@example.com (recommended, works everywhere)");
console.log("  - https://your-website-url.com (for production)\n");
