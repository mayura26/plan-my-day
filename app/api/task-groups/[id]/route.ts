import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/turso'
import { TaskGroup } from '@/lib/types'

// GET /api/task-groups/[id] - Get a specific task group
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
      'SELECT * FROM task_groups WHERE id = ? AND user_id = ?',
      [id, session.user.id]
    )

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Task group not found' }, { status: 404 })
    }

    const row = result.rows[0]
    const group: TaskGroup = {
      id: row.id as string,
      user_id: row.user_id as string,
      name: row.name as string,
      color: row.color as string,
      collapsed: Boolean(row.collapsed),
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    }

    return NextResponse.json({ group })
  } catch (error) {
    console.error('Error fetching task group:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/task-groups/[id] - Update a specific task group
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
    const body: { name?: string; color?: string; collapsed?: boolean } = await request.json()

    // Check if group exists and belongs to user
    const existingGroup = await db.execute(
      'SELECT * FROM task_groups WHERE id = ? AND user_id = ?',
      [id, session.user.id]
    )

    if (existingGroup.rows.length === 0) {
      return NextResponse.json({ error: 'Task group not found' }, { status: 404 })
    }

    if (body.name !== undefined && body.name.trim().length === 0) {
      return NextResponse.json({ error: 'Group name cannot be empty' }, { status: 400 })
    }

    const now = new Date().toISOString()

    // Build dynamic update query
    const updateFields: string[] = []
    const values: any[] = []

    if (body.name !== undefined) {
      updateFields.push('name = ?')
      values.push(body.name.trim())
    }
    if (body.color !== undefined) {
      updateFields.push('color = ?')
      values.push(body.color)
    }
    if (body.collapsed !== undefined) {
      updateFields.push('collapsed = ?')
      values.push(body.collapsed)
    }

    updateFields.push('updated_at = ?')
    values.push(now)

    values.push(id, session.user.id)

    await db.execute(
      `UPDATE task_groups SET ${updateFields.join(', ')} WHERE id = ? AND user_id = ?`,
      values
    )

    // Fetch updated group
    const result = await db.execute(
      'SELECT * FROM task_groups WHERE id = ? AND user_id = ?',
      [id, session.user.id]
    )

    const row = result.rows[0]
    const group: TaskGroup = {
      id: row.id as string,
      user_id: row.user_id as string,
      name: row.name as string,
      color: row.color as string,
      collapsed: Boolean(row.collapsed),
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    }

    return NextResponse.json({ group })
  } catch (error) {
    console.error('Error updating task group:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/task-groups/[id] - Delete a specific task group
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
    // Check if group exists and belongs to user
    const existingGroup = await db.execute(
      'SELECT * FROM task_groups WHERE id = ? AND user_id = ?',
      [id, session.user.id]
    )

    if (existingGroup.rows.length === 0) {
      return NextResponse.json({ error: 'Task group not found' }, { status: 404 })
    }

    // Delete group (cascade will handle related tasks)
    await db.execute(
      'DELETE FROM task_groups WHERE id = ? AND user_id = ?',
      [id, session.user.id]
    )

    return NextResponse.json({ message: 'Task group deleted successfully' })
  } catch (error) {
    console.error('Error deleting task group:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
