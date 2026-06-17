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

    let sent = 0;
    const staleEndpoints: string[] = [];

    for (const row of result.rows) {
      try {
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
        sent++;
      } catch (error) {
        const statusCode = (error as { statusCode?: number })?.statusCode;
        if (statusCode === 410 || statusCode === 404) {
          staleEndpoints.push(row.endpoint as string);
          continue;
        }
        throw error;
      }
    }

    if (staleEndpoints.length > 0) {
      for (const endpoint of staleEndpoints) {
        await db.execute(
          "UPDATE push_subscriptions SET is_active = 0, updated_at = datetime('now') WHERE user_id = ? AND endpoint = ?",
          [session.user.id, endpoint]
        );
      }
    }

    if (sent === 0) {
      return NextResponse.json(
        {
          error: "No active push subscriptions available",
          staleRemoved: staleEndpoints.length,
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      devices: sent,
      staleRemoved: staleEndpoints.length,
    });
  } catch (error) {
    console.error("Error sending test notification:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
