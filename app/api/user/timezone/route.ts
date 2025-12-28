import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/turso";

/**
 * GET /api/user/timezone
 * Get the current user's timezone preference
 */
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await db.execute({
      sql: "SELECT timezone FROM users WHERE id = ?",
      args: [session.user.id],
    });

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const timezone = (result.rows[0].timezone as string) || "UTC";

    return NextResponse.json({ timezone });
  } catch (error) {
    console.error("Error fetching user timezone:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PUT /api/user/timezone
 * Update the current user's timezone preference
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { timezone } = body;

    if (!timezone || typeof timezone !== "string") {
      return NextResponse.json(
        { error: "Timezone is required and must be a string" },
        { status: 400 }
      );
    }

    // Validate timezone by trying to use it
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    } catch (_error) {
      return NextResponse.json({ error: "Invalid timezone" }, { status: 400 });
    }

    await db.execute({
      sql: 'UPDATE users SET timezone = ?, updated_at = datetime("now") WHERE id = ?',
      args: [timezone, session.user.id],
    });

    return NextResponse.json({
      success: true,
      timezone,
    });
  } catch (error) {
    console.error("Error updating user timezone:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
