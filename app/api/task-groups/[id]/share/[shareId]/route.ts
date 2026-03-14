import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/turso";

// DELETE /api/task-groups/[id]/share/[shareId] - Remove a share (owner or shared user)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; shareId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, shareId } = await params;

    // Load the share row
    const shareResult = await db.execute(
      "SELECT * FROM group_shares WHERE id = ? AND group_id = ?",
      [shareId, id]
    );

    if (shareResult.rows.length === 0) {
      return NextResponse.json({ error: "Share not found" }, { status: 404 });
    }

    const share = shareResult.rows[0];
    const isOwner = share.owner_id === session.user.id;
    const isSharedUser = share.shared_with_user_id === session.user.id;

    if (!isOwner && !isSharedUser) {
      return NextResponse.json({ error: "Not authorized to remove this share" }, { status: 403 });
    }

    await db.execute("DELETE FROM group_shares WHERE id = ?", [shareId]);

    return NextResponse.json({ message: "Share removed successfully" });
  } catch (error) {
    console.error("Error removing group share:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
