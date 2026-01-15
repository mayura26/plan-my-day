import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateDependencyId } from "@/lib/task-utils";
import { db } from "@/lib/turso";
import type { Task, TaskDependency, TaskStatus, TaskType } from "@/lib/types";

// Helper to map database row to Task object
function mapRowToTask(row: any): Task {
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    title: row.title as string,
    description: row.description as string | null,
    priority: row.priority as number,
    status: row.status as TaskStatus,
    duration: row.duration as number | null,
    scheduled_start: row.scheduled_start as string | null,
    scheduled_end: row.scheduled_end as string | null,
    due_date: row.due_date as string | null,
    locked: Boolean(row.locked),
    group_id: row.group_id as string | null,
    template_id: row.template_id as string | null,
    task_type: row.task_type as TaskType,
    google_calendar_event_id: row.google_calendar_event_id as string | null,
    notification_sent: Boolean(row.notification_sent),
    depends_on_task_id: row.depends_on_task_id as string | null,
    energy_level_required: row.energy_level_required as number,
    parent_task_id: row.parent_task_id as string | null,
    continued_from_task_id: row.continued_from_task_id as string | null,
    step_order: row.step_order !== null && row.step_order !== undefined ? Number(row.step_order) : null,
    ignored: Boolean(row.ignored ?? false),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

// Helper to map database row to TaskDependency object
function mapRowToDependency(row: any): TaskDependency {
  return {
    id: row.id as string,
    task_id: row.task_id as string,
    depends_on_task_id: row.depends_on_task_id as string,
    created_at: row.created_at as string,
  };
}

// Check for circular dependencies using DFS
async function wouldCreateCircularDependency(
  taskId: string,
  newDependencyId: string,
  userId: string
): Promise<boolean> {
  const visited = new Set<string>();
  const stack: string[] = [newDependencyId];

  while (stack.length > 0) {
    const currentId = stack.pop();
    if (!currentId) {
      continue;
    }

    if (currentId === taskId) {
      // Found a path back to the original task - circular dependency!
      return true;
    }

    if (visited.has(currentId)) {
      continue;
    }
    visited.add(currentId);

    // Get all dependencies of the current task
    const depsResult = await db.execute(
      `SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ?`,
      [currentId]
    );

    for (const row of depsResult.rows) {
      const depId = row.depends_on_task_id as string;
      if (!visited.has(depId)) {
        stack.push(depId);
      }
    }

    // Also check legacy depends_on_task_id
    const taskResult = await db.execute(
      `SELECT depends_on_task_id FROM tasks WHERE id = ? AND user_id = ?`,
      [currentId, userId]
    );
    if (taskResult.rows.length > 0 && taskResult.rows[0].depends_on_task_id) {
      const legacyDep = taskResult.rows[0].depends_on_task_id as string;
      if (!visited.has(legacyDep)) {
        stack.push(legacyDep);
      }
    }
  }

  return false;
}

// Sync subtask dependencies: when Task A depends on Task B,
// all subtasks of A must depend on all subtasks of B (all-to-all)
async function syncSubtaskDependencies(
  taskId: string,
  dependsOnTaskId: string,
  userId: string
): Promise<void> {
  // Get all subtasks of the task
  const taskSubtasksResult = await db.execute(
    `SELECT id FROM tasks WHERE parent_task_id = ? AND user_id = ?`,
    [taskId, userId]
  );
  const taskSubtasks = taskSubtasksResult.rows.map((row) => row.id as string);

  // Get all subtasks of the dependency task
  const depSubtasksResult = await db.execute(
    `SELECT id FROM tasks WHERE parent_task_id = ? AND user_id = ?`,
    [dependsOnTaskId, userId]
  );
  const depSubtasks = depSubtasksResult.rows.map((row) => row.id as string);

  // If either task has no subtasks, nothing to sync
  if (taskSubtasks.length === 0 || depSubtasks.length === 0) {
    return;
  }

  // Create all-to-all dependencies: every subtask of taskId depends on every subtask of dependsOnTaskId
  for (const taskSubtaskId of taskSubtasks) {
    for (const depSubtaskId of depSubtasks) {
      // Check if dependency already exists
      const existingDep = await db.execute(
        `SELECT id FROM task_dependencies WHERE task_id = ? AND depends_on_task_id = ?`,
        [taskSubtaskId, depSubtaskId]
      );

      if (existingDep.rows.length === 0) {
        // Check for circular dependency before creating
        const wouldBeCircular = await wouldCreateCircularDependency(
          taskSubtaskId,
          depSubtaskId,
          userId
        );
        if (!wouldBeCircular) {
          await db.execute(
            `INSERT INTO task_dependencies (id, task_id, depends_on_task_id) VALUES (?, ?, ?)`,
            [generateDependencyId(), taskSubtaskId, depSubtaskId]
          );
        }
      }
    }
  }
}

// Remove subtask dependencies when parent dependency is removed
async function removeSubtaskDependencies(
  taskId: string,
  dependsOnTaskId: string,
  userId: string
): Promise<void> {
  // Get all subtasks of the task
  const taskSubtasksResult = await db.execute(
    `SELECT id FROM tasks WHERE parent_task_id = ? AND user_id = ?`,
    [taskId, userId]
  );
  const taskSubtasks = taskSubtasksResult.rows.map((row) => row.id as string);

  // Get all subtasks of the dependency task
  const depSubtasksResult = await db.execute(
    `SELECT id FROM tasks WHERE parent_task_id = ? AND user_id = ?`,
    [dependsOnTaskId, userId]
  );
  const depSubtasks = depSubtasksResult.rows.map((row) => row.id as string);

  // Remove all dependencies between subtasks
  for (const taskSubtaskId of taskSubtasks) {
    for (const depSubtaskId of depSubtasks) {
      await db.execute(
        `DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_task_id = ?`,
        [taskSubtaskId, depSubtaskId]
      );
    }
  }
}

// GET /api/tasks/[id]/dependencies - Get all dependencies for a task
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

    // Get all dependencies from task_dependencies table
    const depsResult = await db.execute(
      `SELECT td.*, t.title as dependency_title, t.status as dependency_status 
       FROM task_dependencies td 
       JOIN tasks t ON td.depends_on_task_id = t.id 
       WHERE td.task_id = ?`,
      [id]
    );

    const dependencies = depsResult.rows.map((row) => ({
      ...mapRowToDependency(row),
      dependency_title: row.dependency_title as string,
      dependency_status: row.dependency_status as TaskStatus,
    }));

    // Get the tasks this depends on (for full task data)
    const blockedByResult = await db.execute(
      `SELECT t.* FROM tasks t 
       JOIN task_dependencies td ON t.id = td.depends_on_task_id 
       WHERE td.task_id = ?`,
      [id]
    );

    const blockedBy = blockedByResult.rows.map(mapRowToTask);

    // Check if task is blocked (has incomplete dependencies)
    const isBlocked = blockedBy.some((t) => t.status !== "completed");

    // Also get tasks that depend on this task
    const dependentsResult = await db.execute(
      `SELECT t.* FROM tasks t 
       JOIN task_dependencies td ON t.id = td.task_id 
       WHERE td.depends_on_task_id = ?`,
      [id]
    );

    const dependents = dependentsResult.rows.map(mapRowToTask);

    return NextResponse.json({
      dependencies,
      blocked_by: blockedBy,
      dependents,
      is_blocked: isBlocked,
    });
  } catch (error) {
    console.error("Error fetching dependencies:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/tasks/[id]/dependencies - Set dependencies for a task (replaces existing)
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body: { dependency_ids: string[] } = await request.json();

    if (!Array.isArray(body.dependency_ids)) {
      return NextResponse.json({ error: "dependency_ids must be an array" }, { status: 400 });
    }

    // Verify task exists and belongs to user
    const taskResult = await db.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", [
      id,
      session.user.id,
    ]);

    if (taskResult.rows.length === 0) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Validate all dependency IDs and check for circular dependencies
    for (const depId of body.dependency_ids) {
      // Can't depend on itself
      if (depId === id) {
        return NextResponse.json({ error: "Task cannot depend on itself" }, { status: 400 });
      }

      // Verify dependency task exists and belongs to user
      const depResult = await db.execute("SELECT id FROM tasks WHERE id = ? AND user_id = ?", [
        depId,
        session.user.id,
      ]);

      if (depResult.rows.length === 0) {
        return NextResponse.json({ error: `Dependency task not found: ${depId}` }, { status: 404 });
      }

      // Check for circular dependency
      const wouldBeCircular = await wouldCreateCircularDependency(id, depId, session.user.id);
      if (wouldBeCircular) {
        return NextResponse.json(
          { error: `Adding dependency ${depId} would create a circular dependency` },
          { status: 400 }
        );
      }
    }

    // Get old dependencies before deleting them (for subtask cleanup)
    const oldDepsResult = await db.execute(
      `SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ?`,
      [id]
    );
    const oldDepIds = oldDepsResult.rows.map((row) => row.depends_on_task_id as string);

    // Delete existing dependencies
    await db.execute(`DELETE FROM task_dependencies WHERE task_id = ?`, [id]);

    // Remove old subtask dependencies for dependencies that are being removed
    for (const oldDepId of oldDepIds) {
      if (!body.dependency_ids.includes(oldDepId)) {
        await removeSubtaskDependencies(id, oldDepId, session.user.id);
      }
    }

    // Insert new dependencies
    for (const depId of body.dependency_ids) {
      await db.execute(
        `INSERT INTO task_dependencies (id, task_id, depends_on_task_id) VALUES (?, ?, ?)`,
        [generateDependencyId(), id, depId]
      );
      // Sync subtask dependencies for this new dependency
      await syncSubtaskDependencies(id, depId, session.user.id);
    }

    // Return updated dependencies
    const depsResult = await db.execute(
      `SELECT td.*, t.title as dependency_title, t.status as dependency_status 
       FROM task_dependencies td 
       JOIN tasks t ON td.depends_on_task_id = t.id 
       WHERE td.task_id = ?`,
      [id]
    );

    const dependencies = depsResult.rows.map((row) => ({
      ...mapRowToDependency(row),
      dependency_title: row.dependency_title as string,
      dependency_status: row.dependency_status as TaskStatus,
    }));

    return NextResponse.json({ dependencies });
  } catch (error) {
    console.error("Error updating dependencies:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/tasks/[id]/dependencies - Add a single dependency
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body: { depends_on_task_id: string } = await request.json();

    if (!body.depends_on_task_id) {
      return NextResponse.json({ error: "depends_on_task_id is required" }, { status: 400 });
    }

    // Can't depend on itself
    if (body.depends_on_task_id === id) {
      return NextResponse.json({ error: "Task cannot depend on itself" }, { status: 400 });
    }

    // Verify task exists and belongs to user
    const taskResult = await db.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", [
      id,
      session.user.id,
    ]);

    if (taskResult.rows.length === 0) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Verify dependency task exists and belongs to user
    const depResult = await db.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", [
      body.depends_on_task_id,
      session.user.id,
    ]);

    if (depResult.rows.length === 0) {
      return NextResponse.json({ error: "Dependency task not found" }, { status: 404 });
    }

    // Check if dependency already exists
    const existingDep = await db.execute(
      `SELECT id FROM task_dependencies WHERE task_id = ? AND depends_on_task_id = ?`,
      [id, body.depends_on_task_id]
    );

    if (existingDep.rows.length > 0) {
      return NextResponse.json({ error: "Dependency already exists" }, { status: 400 });
    }

    // Check for circular dependency
    const wouldBeCircular = await wouldCreateCircularDependency(
      id,
      body.depends_on_task_id,
      session.user.id
    );

    if (wouldBeCircular) {
      return NextResponse.json(
        { error: "Adding this dependency would create a circular dependency" },
        { status: 400 }
      );
    }

    // Create the dependency
    const depId = generateDependencyId();
    await db.execute(
      `INSERT INTO task_dependencies (id, task_id, depends_on_task_id) VALUES (?, ?, ?)`,
      [depId, id, body.depends_on_task_id]
    );

    // Sync subtask dependencies for this new dependency
    await syncSubtaskDependencies(id, body.depends_on_task_id, session.user.id);

    const dependency: TaskDependency = {
      id: depId,
      task_id: id,
      depends_on_task_id: body.depends_on_task_id,
      created_at: new Date().toISOString(),
    };

    return NextResponse.json({ dependency }, { status: 201 });
  } catch (error) {
    console.error("Error adding dependency:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/tasks/[id]/dependencies - Remove a dependency
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const dependencyId = searchParams.get("dependency_id");
    const dependsOnTaskId = searchParams.get("depends_on_task_id");

    if (!dependencyId && !dependsOnTaskId) {
      return NextResponse.json(
        { error: "Either dependency_id or depends_on_task_id is required" },
        { status: 400 }
      );
    }

    // Verify task exists and belongs to user
    const taskResult = await db.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", [
      id,
      session.user.id,
    ]);

    if (taskResult.rows.length === 0) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    let removedDependsOnTaskId: string | null = null;

    if (dependencyId) {
      // Get the depends_on_task_id before deleting
      const depResult = await db.execute(
        `SELECT depends_on_task_id FROM task_dependencies WHERE id = ? AND task_id = ?`,
        [dependencyId, id]
      );
      if (depResult.rows.length > 0) {
        removedDependsOnTaskId = depResult.rows[0].depends_on_task_id as string;
      }
      // Delete by dependency ID
      await db.execute(`DELETE FROM task_dependencies WHERE id = ? AND task_id = ?`, [
        dependencyId,
        id,
      ]);
    } else if (dependsOnTaskId) {
      removedDependsOnTaskId = dependsOnTaskId;
      // Delete by depends_on_task_id
      await db.execute(
        `DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_task_id = ?`,
        [id, dependsOnTaskId]
      );
    }

    // Remove subtask dependencies if we removed a parent dependency
    if (removedDependsOnTaskId) {
      await removeSubtaskDependencies(id, removedDependsOnTaskId, session.user.id);
    }

    return NextResponse.json({ message: "Dependency removed successfully" });
  } catch (error) {
    console.error("Error removing dependency:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
