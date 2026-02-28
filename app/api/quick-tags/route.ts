import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateQuickTagId } from "@/lib/task-utils";
import { db } from "@/lib/turso";
import type { CreateQuickTagRequest, QuickTag } from "@/lib/types";

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

// GET /api/quick-tags - List user's quick tags
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await db.execute({
      sql: "SELECT * FROM quick_tags WHERE user_id = ? ORDER BY created_at DESC",
      args: [session.user.id],
    });

    const tags = result.rows.map(mapRowToQuickTag);
    return NextResponse.json({ tags });
  } catch (error) {
    console.error("Error fetching quick tags:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/quick-tags - Create a new quick tag
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: CreateQuickTagRequest = await request.json();

    if (!body.name || !body.name.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    if (!body.task_title || !body.task_title.trim()) {
      return NextResponse.json({ error: "Task title is required" }, { status: 400 });
    }

    const taskType = body.task_type || "task";
    if (taskType !== "task" && taskType !== "todo") {
      return NextResponse.json({ error: "Task type must be 'task' or 'todo'" }, { status: 400 });
    }

    const priority = body.priority ?? 3;
    if (priority < 1 || priority > 5) {
      return NextResponse.json({ error: "Priority must be between 1 and 5" }, { status: 400 });
    }

    const energyLevel = body.energy_level ?? 3;
    if (energyLevel < 1 || energyLevel > 5) {
      return NextResponse.json({ error: "Energy level must be between 1 and 5" }, { status: 400 });
    }

    const id = generateQuickTagId();
    const now = new Date().toISOString();

    await db.execute({
      sql: `INSERT INTO quick_tags (
        id, user_id, name, task_title, task_description, task_type,
        priority, duration_minutes, energy_level, schedule_offset_minutes,
        group_id, auto_accept, default_locked, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        session.user.id,
        body.name.trim(),
        body.task_title.trim(),
        body.task_description?.trim() || null,
        taskType,
        priority,
        body.duration_minutes ?? null,
        energyLevel,
        body.schedule_offset_minutes ?? 60,
        body.group_id || null,
        body.auto_accept ? 1 : 0,
        body.default_locked ? 1 : 0,
        now,
        now,
      ],
    });

    const result = await db.execute({
      sql: "SELECT * FROM quick_tags WHERE id = ?",
      args: [id],
    });

    const tag = mapRowToQuickTag(result.rows[0]);
    return NextResponse.json({ tag }, { status: 201 });
  } catch (error) {
    console.error("Error creating quick tag:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
