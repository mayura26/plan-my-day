import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/turso";
import { sendPushNotification } from "@/lib/push-notification";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get user's push subscription
    const result = await db.execute(
      "SELECT endpoint, p256dh_key, auth_key FROM push_subscriptions WHERE user_id = ? LIMIT 1",
      [session.user.id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: "No push subscription found" },
        { status: 404 }
      );
    }

    const subscription = result.rows[0];

    // Send test notification
    await sendPushNotification(
      {
        endpoint: subscription.endpoint as string,
        keys: {
          p256dh: subscription.p256dh_key as string,
          auth: subscription.auth_key as string,
        },
      },
      {
        title: "Test Notification",
        body: "This is a test notification from Plan My Day!",
        icon: "/web-app-manifest-192x192.png",
        tag: "test-notification",
        data: {
          type: "test",
        },
      }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error sending test notification:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

