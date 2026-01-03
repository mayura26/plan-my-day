import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateTodoId } from "@/lib/task-utils";
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

// GET /api/tasks/[id]/todos - Get all todos for a task
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Verify task exists and belongs to user
    const taskResult = await db.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", [
      id,
      session.user.id,
    ]);

    if (taskResult.rows.length === 0) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Get all todos for this task
    const result = await db.execute(
      `SELECT * FROM task_todos WHERE task_id = ? ORDER BY created_at ASC`,
      [id]
    );

    const todos = result.rows.map(mapRowToTodo);
    const completedCount = todos.filter((todo) => todo.completed).length;

    return NextResponse.json({
      todos,
      total: todos.length,
      completed: completedCount,
    });
  } catch (error) {
    console.error("Error fetching todos:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/tasks/[id]/todos - Create a new todo item
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: taskId } = await params;
    const body: { description: string } = await request.json();

    // Validate description
    if (!body.description || body.description.trim().length === 0) {
      return NextResponse.json({ error: "Description is required" }, { status: 400 });
    }

    // Verify task exists and belongs to user
    const taskResult = await db.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", [
      taskId,
      session.user.id,
    ]);

    if (taskResult.rows.length === 0) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const todoId = generateTodoId();
    const now = new Date().toISOString();

    const todo: TaskTodo = {
      id: todoId,
      task_id: taskId,
      description: body.description.trim(),
      completed: false,
      created_at: now,
      updated_at: now,
    };

    await db.execute(
      `INSERT INTO task_todos (id, task_id, description, completed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [todo.id, todo.task_id, todo.description, todo.completed, todo.created_at, todo.updated_at]
    );

    return NextResponse.json({ todo }, { status: 201 });
  } catch (error) {
    console.error("Error creating todo:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
