import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/turso";
import type { TaskTodo } from "@/lib/types";

// Helper to map database row to TaskTodo object
function mapRowToTodo(row: any): TaskTodo {
  return {
    id: row.id as string,
    task_id: row.task_id as string,
    description: row.description as string,
    completed: Boolean(row.completed),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

// PUT /api/tasks/[id]/todos/[todoId] - Update a todo item
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; todoId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: taskId, todoId } = await params;
    const body: { description?: string; completed?: boolean } = await request.json();

    // Verify task exists and belongs to user
    const taskResult = await db.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", [
      taskId,
      session.user.id,
    ]);

    if (taskResult.rows.length === 0) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Verify todo exists and belongs to this task
    const todoResult = await db.execute(
      "SELECT * FROM task_todos WHERE id = ? AND task_id = ?",
      [todoId, taskId]
    );

    if (todoResult.rows.length === 0) {
      return NextResponse.json({ error: "Todo not found" }, { status: 404 });
    }

    // Validate description if provided
    if (body.description !== undefined) {
      if (!body.description || body.description.trim().length === 0) {
        return NextResponse.json({ error: "Description cannot be empty" }, { status: 400 });
      }
    }

    const now = new Date().toISOString();

    // Build dynamic update query
    const updateFields: string[] = [];
    const values: any[] = [];

    if (body.description !== undefined) {
      updateFields.push("description = ?");
      values.push(body.description.trim());
    }

    if (body.completed !== undefined) {
      updateFields.push("completed = ?");
      values.push(body.completed);
    }

    if (updateFields.length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    updateFields.push("updated_at = ?");
    values.push(now, todoId);

    await db.execute(
      `UPDATE task_todos SET ${updateFields.join(", ")} WHERE id = ?`,
      values
    );

    // Fetch updated todo
    const updatedResult = await db.execute("SELECT * FROM task_todos WHERE id = ?", [todoId]);
    const todo = mapRowToTodo(updatedResult.rows[0]);

    return NextResponse.json({ todo });
  } catch (error) {
    console.error("Error updating todo:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/tasks/[id]/todos/[todoId] - Delete a todo item
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; todoId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: taskId, todoId } = await params;

    // Verify task exists and belongs to user
    const taskResult = await db.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", [
      taskId,
      session.user.id,
    ]);

    if (taskResult.rows.length === 0) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Verify todo exists and belongs to this task
    const todoResult = await db.execute(
      "SELECT * FROM task_todos WHERE id = ? AND task_id = ?",
      [todoId, taskId]
    );

    if (todoResult.rows.length === 0) {
      return NextResponse.json({ error: "Todo not found" }, { status: 404 });
    }

    await db.execute("DELETE FROM task_todos WHERE id = ? AND task_id = ?", [todoId, taskId]);

    return NextResponse.json({ message: "Todo deleted successfully" });
  } catch (error) {
    console.error("Error deleting todo:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
