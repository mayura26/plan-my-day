import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/turso";

// GET /api/group-invites - Pending invites for current user (matched by email)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(_request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await db.execute(
      `SELECT gs.id, gs.group_id, gs.owner_id, gs.invited_email, gs.status, gs.created_at,
              tg.name as group_name, tg.color as group_color,
              u.name as owner_name, u.email as owner_email
       FROM group_shares gs
       JOIN task_groups tg ON tg.id = gs.group_id
       JOIN users u ON u.id = gs.owner_id
       WHERE gs.invited_email = ?
         AND gs.status = 'pending'
       ORDER BY gs.created_at DESC`,
      [session.user.email.toLowerCase()]
    );

    const invites = result.rows.map((row) => ({
      id: row.id as string,
      group_id: row.group_id as string,
      owner_id: row.owner_id as string,
      invited_email: row.invited_email as string,
      status: row.status as string,
      group_name: row.group_name as string,
      group_color: row.group_color as string,
      owner_name: (row.owner_name as string) || null,
      owner_email: (row.owner_email as string) || null,
      created_at: row.created_at as string,
    }));

    return NextResponse.json({ invites });
  } catch (error) {
    console.error("Error fetching group invites:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
