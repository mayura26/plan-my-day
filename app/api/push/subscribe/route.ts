import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/turso";

interface PushSubscriptionData {
  subscription?: {
    endpoint: string;
    keys: {
      p256dh: string;
      auth: string;
    };
  };
  endpoint?: string;
  keys?: {
    p256dh: string;
    auth: string;
  };
  deviceName?: string;
  userAgent?: string;
}

function generateDeviceName(userAgent: string): string {
  let deviceType = "Unknown";
  let browser = "Unknown";

  if (userAgent.includes("Mobile")) {
    deviceType = "Mobile";
  } else if (userAgent.includes("Tablet")) {
    deviceType = "Tablet";
  } else {
    deviceType = "Desktop";
  }

  if (userAgent.includes("Chrome")) {
    browser = "Chrome";
  } else if (userAgent.includes("Firefox")) {
    browser = "Firefox";
  } else if (userAgent.includes("Safari") && !userAgent.includes("Chrome")) {
    browser = "Safari";
  } else if (userAgent.includes("Edge")) {
    browser = "Edge";
  }

  return `${deviceType} - ${browser}`;
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: PushSubscriptionData = await request.json();

    // Support both formats: {subscription: {...}} and {endpoint, keys}
    let subscription = body.subscription;
    if (!subscription) {
      if (!body.endpoint || !body.keys) {
        return NextResponse.json({ error: "Invalid subscription data" }, { status: 400 });
      }
      subscription = {
        endpoint: body.endpoint,
        keys: body.keys,
      };
    }

    if (!subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
      return NextResponse.json({ error: "Invalid subscription data" }, { status: 400 });
    }

    const userAgent = body.userAgent || request.headers.get("user-agent") || "";
    const deviceName = body.deviceName || generateDeviceName(userAgent);
    const subscriptionData = JSON.stringify(subscription);

    // Check if subscription already exists
    const existing = await db.execute("SELECT id FROM push_subscriptions WHERE endpoint = ?", [
      subscription.endpoint,
    ]);

    if (existing.rows.length > 0) {
      // Update existing subscription
      await db.execute(
        `
        UPDATE push_subscriptions
        SET user_id = ?, p256dh_key = ?, auth_key = ?, subscription_data = ?, 
            device_name = ?, user_agent = ?, last_seen = datetime('now'), 
            is_active = TRUE, updated_at = datetime('now')
        WHERE endpoint = ?
      `,
        [
          session.user.id,
          subscription.keys.p256dh,
          subscription.keys.auth,
          subscriptionData,
          deviceName,
          userAgent,
          subscription.endpoint,
        ]
      );
    } else {
      // Create new subscription
      const subscriptionId = `push-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      await db.execute(
        `
        INSERT INTO push_subscriptions (
          id, user_id, endpoint, p256dh_key, auth_key, subscription_data,
          device_name, user_agent, last_seen, is_active, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), TRUE, datetime('now'), datetime('now'))
      `,
        [
          subscriptionId,
          session.user.id,
          subscription.endpoint,
          subscription.keys.p256dh,
          subscription.keys.auth,
          subscriptionData,
          deviceName,
          userAgent,
        ]
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error subscribing to push notifications:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
