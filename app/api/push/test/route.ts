import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { shouldUseSingleReminderAction } from "@/lib/notification-platform";
import { isStalePushSubscriptionError, sendPushNotification } from "@/lib/push-notification";
import { buildReminderActionPaths } from "@/lib/reminder-action-urls";
import { db } from "@/lib/turso";

// biome-ignore lint/correctness/noUnusedFunctionParameters: Next.js route handler requires request parameter
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await db.execute(
      "SELECT id, endpoint, p256dh_key, auth_key, platform FROM push_subscriptions WHERE user_id = ? AND is_active = 1",
      [session.user.id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "No push subscription found" }, { status: 404 });
    }

    let sent = 0;
    const staleEndpoints: string[] = [];

    for (const row of result.rows) {
      const subscriptionId = row.id as string;
      const platform = row.platform as string | null;
      const actionUrls = buildReminderActionPaths({
        entityType: "test",
        entityId: "test",
        userId: session.user.id,
        subscriptionId,
      });
      const singleAction = shouldUseSingleReminderAction(platform);

      const payload = {
        title: "Test Reminder",
        body: "Tap Done to verify notification actions work.",
        icon: "/web-app-manifest-192x192.png",
        tag: `test-notification-${Date.now()}`,
        url: actionUrls.complete,
        entityType: "test" as const,
        entityId: "test",
        actionUrls,
        singleAction,
        requireInteraction: true,
      };

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
        if (isStalePushSubscriptionError(error)) {
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
