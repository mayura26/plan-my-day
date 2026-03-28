import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sendPushNotification } from "@/lib/push-notification";
import { db } from "@/lib/turso";

// biome-ignore lint/correctness/noUnusedFunctionParameters: Next.js route handler requires request parameter
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await db.execute(
      "SELECT endpoint, p256dh_key, auth_key FROM push_subscriptions WHERE user_id = ? AND is_active = 1",
      [session.user.id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "No push subscription found" }, { status: 404 });
    }

    const payload = {
      title: "Test Notification",
      body: "This is a test notification from Plan My Day!",
      icon: "/web-app-manifest-192x192.png",
      tag: `test-notification-${Date.now()}`,
      data: {
        type: "test",
      },
    };

    for (const row of result.rows) {
      await sendPushNotification(
        {
          endpoint: row.endpoint as string,
          keys: {
            p256dh: row.p256dh_key as string,
            auth: row.auth_key as string,
          },
        },
        payload
      );
    }

    return NextResponse.json({ success: true, devices: result.rows.length });
  } catch (error) {
    console.error("Error sending test notification:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
