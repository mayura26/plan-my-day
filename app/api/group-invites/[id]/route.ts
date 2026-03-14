import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/turso";

// POST /api/group-invites/[id] - Accept or decline an invite
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body: { action: "accept" | "decline" } = await request.json();

    if (!body.action || !["accept", "decline"].includes(body.action)) {
      return NextResponse.json({ error: 'action must be "accept" or "decline"' }, { status: 400 });
    }

    // Load invite where invited_email matches current user and status is pending
    const inviteResult = await db.execute(
      "SELECT * FROM group_shares WHERE id = ? AND invited_email = ? AND status = 'pending'",
      [id, session.user.email.toLowerCase()]
    );

    if (inviteResult.rows.length === 0) {
      return NextResponse.json({ error: "Invite not found or already processed" }, { status: 404 });
    }

    const now = new Date().toISOString();

    if (body.action === "accept") {
      await db.execute(
        "UPDATE group_shares SET status = 'accepted', shared_with_user_id = ?, updated_at = ? WHERE id = ?",
        [session.user.id, now, id]
      );
    } else {
      await db.execute("UPDATE group_shares SET status = 'declined', updated_at = ? WHERE id = ?", [
        now,
        id,
      ]);
    }

    const updatedResult = await db.execute("SELECT * FROM group_shares WHERE id = ?", [id]);
    const share = updatedResult.rows[0];

    return NextResponse.json({
      share: {
        id: share.id,
        group_id: share.group_id,
        owner_id: share.owner_id,
        shared_with_user_id: share.shared_with_user_id || null,
        invited_email: share.invited_email,
        status: share.status,
        created_at: share.created_at,
        updated_at: share.updated_at,
      },
    });
  } catch (error) {
    console.error("Error processing group invite:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
