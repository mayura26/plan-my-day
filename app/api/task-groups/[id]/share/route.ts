import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sendPushNotification } from "@/lib/push-notification";
import { generateShareId } from "@/lib/task-utils";
import { db } from "@/lib/turso";

// GET /api/task-groups/[id]/share - List shares for a group (owner only)
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Verify ownership
    const groupResult = await db.execute(
      "SELECT id FROM task_groups WHERE id = ? AND user_id = ?",
      [id, session.user.id]
    );
    if (groupResult.rows.length === 0) {
      return NextResponse.json({ error: "Task group not found" }, { status: 404 });
    }

    const result = await db.execute(
      `SELECT gs.*, u.name as shared_with_name
       FROM group_shares gs
       LEFT JOIN users u ON u.id = gs.shared_with_user_id
       WHERE gs.group_id = ? AND gs.owner_id = ?
       ORDER BY gs.created_at DESC`,
      [id, session.user.id]
    );

    const shares = result.rows.map((row) => ({
      id: row.id as string,
      group_id: row.group_id as string,
      owner_id: row.owner_id as string,
      shared_with_user_id: (row.shared_with_user_id as string) || null,
      invited_email: row.invited_email as string,
      status: row.status as string,
      shared_with_name: (row.shared_with_name as string) || null,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    }));

    return NextResponse.json({ shares });
  } catch (error) {
    console.error("Error fetching group shares:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/task-groups/[id]/share - Create invite (owner only)
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body: { email: string } = await request.json();

    if (!body.email || !body.email.trim()) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(body.email.trim())) {
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
    }

    const invitedEmail = body.email.trim().toLowerCase();

    // Verify group belongs to current user
    const groupResult = await db.execute(
      "SELECT id, name FROM task_groups WHERE id = ? AND user_id = ?",
      [id, session.user.id]
    );
    if (groupResult.rows.length === 0) {
      return NextResponse.json({ error: "Task group not found" }, { status: 404 });
    }

    const groupName = groupResult.rows[0].name as string;

    // Prevent sharing with yourself
    if (invitedEmail === session.user.email?.toLowerCase()) {
      return NextResponse.json({ error: "Cannot share a group with yourself" }, { status: 400 });
    }

    // Look up user by email to get shared_with_user_id (may be NULL if not registered)
    const userResult = await db.execute("SELECT id FROM users WHERE LOWER(email) = ?", [
      invitedEmail,
    ]);
    const sharedWithUserId = userResult.rows.length > 0 ? (userResult.rows[0].id as string) : null;

    // Check for existing non-declined share
    const existingResult = await db.execute(
      "SELECT id, status FROM group_shares WHERE group_id = ? AND invited_email = ?",
      [id, invitedEmail]
    );

    const now = new Date().toISOString();

    if (existingResult.rows.length > 0) {
      const existing = existingResult.rows[0];
      if (existing.status !== "declined") {
        return NextResponse.json(
          { error: "An active invite already exists for this email" },
          { status: 409 }
        );
      }
      // Re-invite declined shares by updating to pending
      await db.execute(
        "UPDATE group_shares SET status = 'pending', shared_with_user_id = ?, updated_at = ? WHERE id = ?",
        [sharedWithUserId, now, existing.id as string]
      );

      const updatedResult = await db.execute("SELECT * FROM group_shares WHERE id = ?", [
        existing.id as string,
      ]);
      const share = updatedResult.rows[0];

      return NextResponse.json(
        {
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
        },
        { status: 201 }
      );
    }

    // Insert new share row
    const shareId = generateShareId();

    await db.execute(
      `INSERT INTO group_shares (id, group_id, owner_id, shared_with_user_id, invited_email, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [shareId, id, session.user.id, sharedWithUserId, invitedEmail, now, now]
    );

    // If resolved user has push subscriptions, send notification
    if (sharedWithUserId) {
      try {
        const subscriptionsResult = await db.execute(
          "SELECT endpoint, p256dh_key, auth_key FROM notification_subscriptions WHERE user_id = ?",
          [sharedWithUserId]
        );
        for (const sub of subscriptionsResult.rows) {
          await sendPushNotification(
            {
              endpoint: sub.endpoint as string,
              keys: {
                p256dh: sub.p256dh_key as string,
                auth: sub.auth_key as string,
              },
            },
            {
              title: "Group Shared With You",
              body: `${session.user.name || session.user.email} shared the group "${groupName}" with you`,
              tag: `group-invite-${shareId}`,
            }
          );
        }
      } catch (err) {
        // Non-fatal: notification failure shouldn't block the invite
        console.error("Failed to send push notification for group invite:", err);
      }
    }

    return NextResponse.json(
      {
        share: {
          id: shareId,
          group_id: id,
          owner_id: session.user.id,
          shared_with_user_id: sharedWithUserId,
          invited_email: invitedEmail,
          status: "pending",
          created_at: now,
          updated_at: now,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating group share:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
