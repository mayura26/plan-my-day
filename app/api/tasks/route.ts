import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/turso'
import { CreateTaskRequest, Task } from '@/lib/types'
import { generateTaskId, validateTaskData } from '@/lib/task-utils'

// GET /api/tasks - Get all tasks for the authenticated user
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const priority = searchParams.get('priority')
    const task_type = searchParams.get('task_type')
    const group_id = searchParams.get('group_id')
    const limit = searchParams.get('limit')
    const offset = searchParams.get('offset')

    let query = `
      SELECT * FROM tasks 
      WHERE user_id = ?
    `
    const params: any[] = [session.user.id]

    if (status) {
      query += ` AND status = ?`
      params.push(status)
    }

    if (priority) {
      query += ` AND priority = ?`
      params.push(parseInt(priority))
    }

    if (task_type) {
      query += ` AND task_type = ?`
      params.push(task_type)
    }

    if (group_id) {
      query += ` AND group_id = ?`
      params.push(group_id)
    }

    query += ` ORDER BY priority ASC, scheduled_start ASC, created_at DESC`

    if (limit) {
      query += ` LIMIT ?`
      params.push(parseInt(limit))
    }

    if (offset) {
      query += ` OFFSET ?`
      params.push(parseInt(offset))
    }

    const result = await db.execute(query, params)
    const tasks = result.rows.map(row => ({
      id: row.id as string,
      user_id: row.user_id as string,
      title: row.title as string,
      description: row.description as string | null,
      priority: row.priority as number,
      status: row.status as string,
      duration: row.duration as number | null,
      scheduled_start: row.scheduled_start as string | null,
      scheduled_end: row.scheduled_end as string | null,
      locked: Boolean(row.locked),
      group_id: row.group_id as string | null,
      template_id: row.template_id as string | null,
      task_type: row.task_type as string,
      google_calendar_event_id: row.google_calendar_event_id as string | null,
      notification_sent: Boolean(row.notification_sent),
      depends_on_task_id: row.depends_on_task_id as string | null,
      energy_level_required: row.energy_level_required as number,
      estimated_completion_time: row.estimated_completion_time as number | null,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    }))

    return NextResponse.json({ tasks })
  } catch (error) {
    console.error('Error fetching tasks:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/tasks - Create a new task
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: CreateTaskRequest = await request.json()
    
    // Validate task data
    const errors = validateTaskData(body)
    if (errors.length > 0) {
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 })
    }

    const taskId = generateTaskId()
    const now = new Date().toISOString()

    const task: Task = {
      id: taskId,
      user_id: session.user.id,
      title: body.title,
      description: body.description || null,
      priority: body.priority || 3,
      status: 'pending',
      duration: body.duration || null,
      scheduled_start: null,
      scheduled_end: null,
      locked: false,
      group_id: body.group_id || null,
      template_id: body.template_id || null,
      task_type: body.task_type || 'task',
      google_calendar_event_id: null,
      notification_sent: false,
      depends_on_task_id: body.depends_on_task_id || null,
      energy_level_required: body.energy_level_required || 3,
      estimated_completion_time: body.estimated_completion_time || null,
      created_at: now,
      updated_at: now,
    }

    await db.execute(`
      INSERT INTO tasks (
        id, user_id, title, description, priority, status, duration,
        scheduled_start, scheduled_end, locked, group_id, template_id,
        task_type, google_calendar_event_id, notification_sent,
        depends_on_task_id, energy_level_required, estimated_completion_time,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      task.id, task.user_id, task.title, task.description, task.priority,
      task.status, task.duration, task.scheduled_start, task.scheduled_end,
      task.locked, task.group_id, task.template_id, task.task_type,
      task.google_calendar_event_id, task.notification_sent, task.depends_on_task_id,
      task.energy_level_required, task.estimated_completion_time, task.created_at, task.updated_at
    ])

    return NextResponse.json({ task }, { status: 201 })
  } catch (error) {
    console.error('Error creating task:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
