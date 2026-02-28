import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/turso";
import type { QuickTag, UpdateQuickTagRequest } from "@/lib/types";

function mapRowToQuickTag(row: any): QuickTag {
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    name: row.name as string,
    task_title: row.task_title as string,
    task_description: row.task_description as string | null,
    task_type: row.task_type as "task" | "todo",
    priority: row.priority as number,
    duration_minutes: row.duration_minutes as number | null,
    energy_level: row.energy_level as number,
    schedule_offset_minutes: row.schedule_offset_minutes as number,
    group_id: row.group_id as string | null,
    auto_accept: Boolean(row.auto_accept),
    default_locked: Boolean(row.default_locked ?? 0),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

// GET /api/quick-tags/[id] - Get a single quick tag
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Any authenticated user can read a tag (supports shared NFC tags)
    const result = await db.execute({
      sql: "SELECT * FROM quick_tags WHERE id = ?",
      args: [id],
    });

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Quick tag not found" }, { status: 404 });
    }

    const tag = mapRowToQuickTag(result.rows[0]);
    return NextResponse.json({ tag, is_owner: tag.user_id === session.user.id });
  } catch (error) {
    console.error("Error fetching quick tag:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH /api/quick-tags/[id] - Update a quick tag
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body: UpdateQuickTagRequest = await request.json();

    // Check ownership
    const existing = await db.execute({
      sql: "SELECT * FROM quick_tags WHERE id = ? AND user_id = ?",
      args: [id, session.user.id],
    });

    if (existing.rows.length === 0) {
      return NextResponse.json({ error: "Quick tag not found" }, { status: 404 });
    }

    const updateFields: string[] = [];
    const values: any[] = [];

    if (body.name !== undefined) {
      if (!body.name.trim()) {
        return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
      }
      updateFields.push("name = ?");
      values.push(body.name.trim());
    }
    if (body.task_title !== undefined) {
      if (!body.task_title.trim()) {
        return NextResponse.json({ error: "Task title cannot be empty" }, { status: 400 });
      }
      updateFields.push("task_title = ?");
      values.push(body.task_title.trim());
    }
    if (body.task_description !== undefined) {
      updateFields.push("task_description = ?");
      values.push(body.task_description?.trim() || null);
    }
    if (body.task_type !== undefined) {
      if (body.task_type !== "task" && body.task_type !== "todo") {
        return NextResponse.json({ error: "Task type must be 'task' or 'todo'" }, { status: 400 });
      }
      updateFields.push("task_type = ?");
      values.push(body.task_type);
    }
    if (body.priority !== undefined) {
      if (body.priority < 1 || body.priority > 5) {
        return NextResponse.json({ error: "Priority must be between 1 and 5" }, { status: 400 });
      }
      updateFields.push("priority = ?");
      values.push(body.priority);
    }
    if (body.duration_minutes !== undefined) {
      updateFields.push("duration_minutes = ?");
      values.push(body.duration_minutes ?? null);
    }
    if (body.energy_level !== undefined) {
      if (body.energy_level < 1 || body.energy_level > 5) {
        return NextResponse.json(
          { error: "Energy level must be between 1 and 5" },
          { status: 400 }
        );
      }
      updateFields.push("energy_level = ?");
      values.push(body.energy_level);
    }
    if (body.schedule_offset_minutes !== undefined) {
      updateFields.push("schedule_offset_minutes = ?");
      values.push(body.schedule_offset_minutes);
    }
    if (body.group_id !== undefined) {
      updateFields.push("group_id = ?");
      values.push(body.group_id || null);
    }
    if (body.auto_accept !== undefined) {
      updateFields.push("auto_accept = ?");
      values.push(body.auto_accept ? 1 : 0);
    }
    if (body.default_locked !== undefined) {
      updateFields.push("default_locked = ?");
      values.push(body.default_locked ? 1 : 0);
    }

    if (updateFields.length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    updateFields.push("updated_at = ?");
    values.push(new Date().toISOString());
    values.push(id);
    values.push(session.user.id);

    await db.execute({
      sql: `UPDATE quick_tags SET ${updateFields.join(", ")} WHERE id = ? AND user_id = ?`,
      args: values,
    });

    const result = await db.execute({
      sql: "SELECT * FROM quick_tags WHERE id = ?",
      args: [id],
    });

    const tag = mapRowToQuickTag(result.rows[0]);
    return NextResponse.json({ tag });
  } catch (error) {
    console.error("Error updating quick tag:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/quick-tags/[id] - Delete a quick tag
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const result = await db.execute({
      sql: "DELETE FROM quick_tags WHERE id = ? AND user_id = ?",
      args: [id, session.user.id],
    });

    if (result.rowsAffected === 0) {
      return NextResponse.json({ error: "Quick tag not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting quick tag:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
