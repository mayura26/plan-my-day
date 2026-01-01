import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { initializePushNotifications, sendPushNotification } from "@/lib/push-notification";
import { db } from "@/lib/turso";

// biome-ignore lint/correctness/noUnusedFunctionParameters: Next.js route handler requires request parameter
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    initializePushNotifications();

    // Get all push subscriptions for the user
    const subscriptionsResult = await db.execute(
      "SELECT id, endpoint, p256dh_key, auth_key FROM push_subscriptions WHERE user_id = ?",
      [session.user.id]
    );

    const validSubscriptions = [];
    const invalidSubscriptions = [];

    // Test each subscription by sending a test notification
    for (const row of subscriptionsResult.rows) {
      try {
        const subscription = {
          endpoint: row.endpoint as string,
          keys: {
            p256dh: row.p256dh_key as string,
            auth: row.auth_key as string,
          },
        };

        // Send a test notification to validate the subscription
        await sendPushNotification(subscription, {
          title: "Test",
          body: "Validating subscription...",
          icon: "/web-app-manifest-192x192.png",
          tag: "validation",
        });

        validSubscriptions.push(row.id);
      } catch (error: any) {
        console.error("Invalid subscription detected:", error);
        invalidSubscriptions.push(row.id);
      }
    }

    // Remove invalid subscriptions
    if (invalidSubscriptions.length > 0) {
      const placeholders = invalidSubscriptions.map(() => "?").join(",");
      await db.execute(
        `DELETE FROM push_subscriptions WHERE user_id = ? AND id IN (${placeholders})`,
        [session.user.id, ...invalidSubscriptions]
      );
    }

    return NextResponse.json({
      message: "Cleanup completed",
      validSubscriptions: validSubscriptions.length,
      removedSubscriptions: invalidSubscriptions.length,
      removedIds: invalidSubscriptions,
    });
  } catch (error) {
    console.error("Error cleaning up push subscriptions:", error);
    return NextResponse.json({ error: "Failed to cleanup push subscriptions" }, { status: 500 });
  }
}
