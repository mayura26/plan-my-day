import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/turso'
import { UpdateTaskRequest, Task, TaskType, TaskStatus } from '@/lib/types'
import { validateTaskData } from '@/lib/task-utils'

// GET /api/tasks/[id] - Get a specific task
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const result = await db.execute(
      'SELECT * FROM tasks WHERE id = ? AND user_id = ?',
      [id, session.user.id]
    )

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const row = result.rows[0]
    const task: Task = {
      id: row.id as string,
      user_id: row.user_id as string,
      title: row.title as string,
      description: row.description as string | null,
      priority: row.priority as number,
      status: row.status as TaskStatus,
      duration: row.duration as number | null,
      scheduled_start: row.scheduled_start as string | null,
      scheduled_end: row.scheduled_end as string | null,
      locked: Boolean(row.locked),
      group_id: row.group_id as string | null,
      template_id: row.template_id as string | null,
      task_type: row.task_type as TaskType,
      google_calendar_event_id: row.google_calendar_event_id as string | null,
      notification_sent: Boolean(row.notification_sent),
      depends_on_task_id: row.depends_on_task_id as string | null,
      energy_level_required: row.energy_level_required as number,
      estimated_completion_time: row.estimated_completion_time as number | null,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    }

    return NextResponse.json({ task })
  } catch (error) {
    console.error('Error fetching task:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/tasks/[id] - Update a specific task
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const body: UpdateTaskRequest = await request.json()
    
    // Validate task data (only validate provided fields for partial updates)
    const errors: string[] = []
    
    // Only validate title if it's being updated
    if (body.title !== undefined) {
      if (!body.title || body.title.trim().length === 0) {
        errors.push('Title is required')
      }
    }
    
    if (body.priority !== undefined && (body.priority < 1 || body.priority > 5)) {
      errors.push('Priority must be between 1 and 5')
    }
    
    if (body.energy_level_required !== undefined && (body.energy_level_required < 1 || body.energy_level_required > 5)) {
      errors.push('Energy level must be between 1 and 5')
    }
    
    if (body.duration !== undefined && body.duration < 0) {
      errors.push('Duration must be positive')
    }
    
    if (body.scheduled_start && body.scheduled_end) {
      const start = new Date(body.scheduled_start)
      const end = new Date(body.scheduled_end)
      if (start >= end) {
        errors.push('End time must be after start time')
      }
    }
    
    if (errors.length > 0) {
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 })
    }

    // Check if task exists and belongs to user
    const existingTask = await db.execute(
      'SELECT * FROM tasks WHERE id = ? AND user_id = ?',
      [id, session.user.id]
    )

    if (existingTask.rows.length === 0) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const now = new Date().toISOString()

    // Build dynamic update query
    const updateFields: string[] = []
    const values: any[] = []

    if (body.title !== undefined) {
      updateFields.push('title = ?')
      values.push(body.title)
    }
    if (body.description !== undefined) {
      updateFields.push('description = ?')
      values.push(body.description)
    }
    if (body.priority !== undefined) {
      updateFields.push('priority = ?')
      values.push(body.priority)
    }
    if (body.status !== undefined) {
      updateFields.push('status = ?')
      values.push(body.status)
    }
    if (body.duration !== undefined) {
      updateFields.push('duration = ?')
      values.push(body.duration)
    }
    if (body.scheduled_start !== undefined) {
      updateFields.push('scheduled_start = ?')
      values.push(body.scheduled_start)
    }
    if (body.scheduled_end !== undefined) {
      updateFields.push('scheduled_end = ?')
      values.push(body.scheduled_end)
    }
    if (body.locked !== undefined) {
      updateFields.push('locked = ?')
      values.push(body.locked)
    }
    if (body.group_id !== undefined) {
      updateFields.push('group_id = ?')
      values.push(body.group_id)
    }
    if (body.template_id !== undefined) {
      updateFields.push('template_id = ?')
      values.push(body.template_id)
    }
    if (body.energy_level_required !== undefined) {
      updateFields.push('energy_level_required = ?')
      values.push(body.energy_level_required)
    }
    if (body.estimated_completion_time !== undefined) {
      updateFields.push('estimated_completion_time = ?')
      values.push(body.estimated_completion_time)
    }
    if (body.task_type !== undefined) {
      updateFields.push('task_type = ?')
      values.push(body.task_type)
    }
    if (body.depends_on_task_id !== undefined) {
      updateFields.push('depends_on_task_id = ?')
      values.push(body.depends_on_task_id)
    }

    updateFields.push('updated_at = ?')
    values.push(now)

    values.push(id, session.user.id)

    await db.execute(
      `UPDATE tasks SET ${updateFields.join(', ')} WHERE id = ? AND user_id = ?`,
      values
    )

    // Fetch updated task
    const result = await db.execute(
      'SELECT * FROM tasks WHERE id = ? AND user_id = ?',
      [id, session.user.id]
    )

    const row = result.rows[0]
    const task: Task = {
      id: row.id as string,
      user_id: row.user_id as string,
      title: row.title as string,
      description: row.description as string | null,
      priority: row.priority as number,
      status: row.status as TaskStatus,
      duration: row.duration as number | null,
      scheduled_start: row.scheduled_start as string | null,
      scheduled_end: row.scheduled_end as string | null,
      locked: Boolean(row.locked),
      group_id: row.group_id as string | null,
      template_id: row.template_id as string | null,
      task_type: row.task_type as TaskType,
      google_calendar_event_id: row.google_calendar_event_id as string | null,
      notification_sent: Boolean(row.notification_sent),
      depends_on_task_id: row.depends_on_task_id as string | null,
      energy_level_required: row.energy_level_required as number,
      estimated_completion_time: row.estimated_completion_time as number | null,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    }

    return NextResponse.json({ task })
  } catch (error) {
    console.error('Error updating task:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/tasks/[id] - Delete a specific task
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    // Check if task exists and belongs to user
    const existingTask = await db.execute(
      'SELECT * FROM tasks WHERE id = ? AND user_id = ?',
      [id, session.user.id]
    )

    if (existingTask.rows.length === 0) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    // Delete task (cascade will handle related records)
    await db.execute(
      'DELETE FROM tasks WHERE id = ? AND user_id = ?',
      [id, session.user.id]
    )

    return NextResponse.json({ message: 'Task deleted successfully' })
  } catch (error) {
    console.error('Error deleting task:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
