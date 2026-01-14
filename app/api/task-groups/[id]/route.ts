import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/turso";
import type { TaskGroup } from "@/lib/types";

// GET /api/task-groups/[id] - Get a specific task group
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const result = await db.execute("SELECT * FROM task_groups WHERE id = ? AND user_id = ?", [
      id,
      session.user.id,
    ]);

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Task group not found" }, { status: 404 });
    }

    const row = result.rows[0];
    let autoScheduleHours = null;
    if (row.auto_schedule_hours) {
      try {
        autoScheduleHours = JSON.parse(row.auto_schedule_hours as string);
      } catch (e) {
        console.error("Error parsing auto_schedule_hours JSON:", e);
        autoScheduleHours = null;
      }
    }
    const group: TaskGroup = {
      id: row.id as string,
      user_id: row.user_id as string,
      name: row.name as string,
      color: row.color as string,
      collapsed: Boolean(row.collapsed),
      parent_group_id: (row.parent_group_id as string) || null,
      is_parent_group: Boolean(row.is_parent_group),
      auto_schedule_enabled: Boolean(row.auto_schedule_enabled ?? false),
      auto_schedule_hours: autoScheduleHours,
      priority: row.priority ? (row.priority as number) : undefined,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };

    return NextResponse.json({ group });
  } catch (error) {
    console.error("Error fetching task group:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/task-groups/[id] - Update a specific task group
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body: {
      name?: string;
      color?: string;
      collapsed?: boolean;
      parent_group_id?: string | null;
      is_parent_group?: boolean;
      auto_schedule_enabled?: boolean;
      auto_schedule_hours?: import("@/lib/types").GroupScheduleHours | null;
      priority?: number;
    } = await request.json();

    // Check if group exists and belongs to user
    const existingGroup = await db.execute(
      "SELECT * FROM task_groups WHERE id = ? AND user_id = ?",
      [id, session.user.id]
    );

    if (existingGroup.rows.length === 0) {
      return NextResponse.json({ error: "Task group not found" }, { status: 404 });
    }

    const existingGroupData = existingGroup.rows[0];
    const isParentGroup = Boolean(existingGroupData.is_parent_group);

    // Validate that auto-schedule settings can only be set for non-parent groups
    if (
      (body.auto_schedule_enabled !== undefined || body.auto_schedule_hours !== undefined) &&
      isParentGroup
    ) {
      return NextResponse.json(
        { error: "Auto-schedule settings cannot be set for parent groups" },
        { status: 400 }
      );
    }

    if (body.name !== undefined && body.name.trim().length === 0) {
      return NextResponse.json({ error: "Group name cannot be empty" }, { status: 400 });
    }

    // Validate priority if provided (1-10, 1 is highest)
    if (body.priority !== undefined && body.priority !== null) {
      if (typeof body.priority !== "number" || body.priority < 1 || body.priority > 10) {
        return NextResponse.json(
          { error: "Priority must be a number between 1 and 10 (1 is highest priority)" },
          { status: 400 }
        );
      }
    }

    // Validate auto_schedule_hours structure if provided
    if (body.auto_schedule_hours !== undefined && body.auto_schedule_hours !== null) {
      const validDays = [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
      ];
      const scheduleHours = body.auto_schedule_hours;

      for (const day of validDays) {
        const daySchedule = scheduleHours[day as keyof typeof scheduleHours];
        if (daySchedule !== undefined && daySchedule !== null) {
          if (
            typeof daySchedule.start !== "number" ||
            typeof daySchedule.end !== "number" ||
            daySchedule.start < 0 ||
            daySchedule.start > 23 ||
            daySchedule.end < 0 ||
            daySchedule.end > 23 ||
            daySchedule.start >= daySchedule.end
          ) {
            return NextResponse.json(
              {
                error: `Invalid time range for ${day}. Start and end must be valid hours (0-23) and start must be before end.`,
              },
              { status: 400 }
            );
          }
        }
      }
    }

    // Validate parent_group_id if provided
    if (body.parent_group_id !== undefined) {
      // Prevent setting a group as its own parent
      if (body.parent_group_id === id) {
        return NextResponse.json({ error: "A group cannot be its own parent" }, { status: 400 });
      }

      // If parent_group_id is provided (not null), validate it exists
      if (body.parent_group_id) {
        const parentGroup = await db.execute(
          "SELECT id FROM task_groups WHERE id = ? AND user_id = ?",
          [body.parent_group_id, session.user.id]
        );

        if (parentGroup.rows.length === 0) {
          return NextResponse.json(
            { error: "Parent group not found or does not belong to user" },
            { status: 400 }
          );
        }

        // Check for circular references: ensure the new parent is not a descendant of this group
        const checkCircularReference = async (
          groupId: string,
          potentialParentId: string
        ): Promise<boolean> => {
          // Get all descendants of the current group
          const descendants = new Set<string>();
          const queue = [groupId];

          while (queue.length > 0) {
            const currentId = queue.shift();
            if (!currentId) break;
            const children = await db.execute(
              "SELECT id FROM task_groups WHERE parent_group_id = ? AND user_id = ?",
              [currentId, session.user.id]
            );

            for (const child of children.rows) {
              const childId = child.id as string;
              if (!descendants.has(childId)) {
                descendants.add(childId);
                queue.push(childId);
              }
            }
          }

          // Check if the potential parent is a descendant
          return descendants.has(potentialParentId);
        };

        const isCircular = await checkCircularReference(id, body.parent_group_id);
        if (isCircular) {
          return NextResponse.json(
            { error: "Cannot set parent group: would create a circular reference" },
            { status: 400 }
          );
        }
      }
    }

    const now = new Date().toISOString();

    // Build dynamic update query
    const updateFields: string[] = [];
    const values: any[] = [];

    if (body.name !== undefined) {
      updateFields.push("name = ?");
      values.push(body.name.trim());
    }
    if (body.color !== undefined) {
      updateFields.push("color = ?");
      values.push(body.color);
    }
    if (body.collapsed !== undefined) {
      updateFields.push("collapsed = ?");
      values.push(body.collapsed);
    }
    if (body.parent_group_id !== undefined) {
      updateFields.push("parent_group_id = ?");
      values.push(body.parent_group_id);
    }
    if (body.is_parent_group !== undefined) {
      updateFields.push("is_parent_group = ?");
      values.push(body.is_parent_group);
    }
    if (body.auto_schedule_enabled !== undefined) {
      updateFields.push("auto_schedule_enabled = ?");
      values.push(body.auto_schedule_enabled);
    }
    if (body.auto_schedule_hours !== undefined) {
      updateFields.push("auto_schedule_hours = ?");
      values.push(
        body.auto_schedule_hours === null ? null : JSON.stringify(body.auto_schedule_hours)
      );
    }
    if (body.priority !== undefined) {
      updateFields.push("priority = ?");
      values.push(body.priority);
    }

    updateFields.push("updated_at = ?");
    values.push(now);

    values.push(id, session.user.id);

    await db.execute(
      `UPDATE task_groups SET ${updateFields.join(", ")} WHERE id = ? AND user_id = ?`,
      values
    );

    // Fetch updated group
    const result = await db.execute("SELECT * FROM task_groups WHERE id = ? AND user_id = ?", [
      id,
      session.user.id,
    ]);

    const row = result.rows[0];
    let autoScheduleHours = null;
    if (row.auto_schedule_hours) {
      try {
        autoScheduleHours = JSON.parse(row.auto_schedule_hours as string);
      } catch (e) {
        console.error("Error parsing auto_schedule_hours JSON:", e);
        autoScheduleHours = null;
      }
    }
    const group: TaskGroup = {
      id: row.id as string,
      user_id: row.user_id as string,
      name: row.name as string,
      color: row.color as string,
      collapsed: Boolean(row.collapsed),
      parent_group_id: (row.parent_group_id as string) || null,
      is_parent_group: Boolean(row.is_parent_group),
      auto_schedule_enabled: Boolean(row.auto_schedule_enabled ?? false),
      auto_schedule_hours: autoScheduleHours,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };

    return NextResponse.json({ group });
  } catch (error) {
    console.error("Error updating task group:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/task-groups/[id] - Delete a specific task group
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
    // Check if group exists and belongs to user
    const existingGroup = await db.execute(
      "SELECT * FROM task_groups WHERE id = ? AND user_id = ?",
      [id, session.user.id]
    );

    if (existingGroup.rows.length === 0) {
      return NextResponse.json({ error: "Task group not found" }, { status: 404 });
    }

    // Delete group (cascade will handle related tasks)
    await db.execute("DELETE FROM task_groups WHERE id = ? AND user_id = ?", [id, session.user.id]);

    return NextResponse.json({ message: "Task group deleted successfully" });
  } catch (error) {
    console.error("Error deleting task group:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
