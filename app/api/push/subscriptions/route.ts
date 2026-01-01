import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/turso";

// biome-ignore lint/correctness/noUnusedFunctionParameters: Next.js route handler requires request parameter
export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get all push subscriptions for the user
    const result = await db.execute(
      `
      SELECT 
        id,
        endpoint,
        device_name,
        user_agent,
        last_seen,
        is_active,
        created_at,
        updated_at
      FROM push_subscriptions 
      WHERE user_id = ? 
      ORDER BY last_seen DESC
    `,
      [session.user.id]
    );

    const subscriptions = result.rows.map((row) => ({
      id: row.id as string,
      endpoint: row.endpoint as string,
      deviceName: (row.device_name as string) || "Unknown Device",
      userAgent: (row.user_agent as string) || "Unknown Browser",
      lastSeen: row.last_seen as string,
      isActive: Boolean(row.is_active),
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }));

    return NextResponse.json({ subscriptions });
  } catch (error) {
    console.error("Error fetching push subscriptions:", error);
    return NextResponse.json({ error: "Failed to fetch push subscriptions" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { subscriptionId } = await request.json();

    if (!subscriptionId) {
      return NextResponse.json({ error: "Subscription ID is required" }, { status: 400 });
    }

    // Delete the specific subscription
    await db.execute("DELETE FROM push_subscriptions WHERE user_id = ? AND id = ?", [
      session.user.id,
      subscriptionId,
    ]);

    return NextResponse.json({
      message: "Push subscription removed successfully",
    });
  } catch (error) {
    console.error("Error removing push subscription:", error);
    return NextResponse.json({ error: "Failed to remove push subscription" }, { status: 500 });
  }
}
