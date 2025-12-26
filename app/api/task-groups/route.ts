import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/turso'
import { CreateTaskGroupRequest, TaskGroup } from '@/lib/types'
import { generateGroupId } from '@/lib/task-utils'

// GET /api/task-groups - Get all task groups for the authenticated user
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const result = await db.execute(
      'SELECT * FROM task_groups WHERE user_id = ? ORDER BY name ASC',
      [session.user.id]
    )

    const groups: TaskGroup[] = result.rows.map(row => ({
      id: row.id as string,
      user_id: row.user_id as string,
      name: row.name as string,
      color: row.color as string,
      collapsed: Boolean(row.collapsed),
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    }))

    return NextResponse.json({ groups })
  } catch (error) {
    console.error('Error fetching task groups:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/task-groups - Create a new task group
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: CreateTaskGroupRequest = await request.json()
    
    if (!body.name || body.name.trim().length === 0) {
      return NextResponse.json({ error: 'Group name is required' }, { status: 400 })
    }

    // Verify user exists in database, create if missing (handles edge cases)
    const userCheck = await db.execute(
      'SELECT id FROM users WHERE id = ?',
      [session.user.id]
    )

    if (userCheck.rows.length === 0) {
      // User doesn't exist in database, create them
      try {
        await db.execute(`
          INSERT INTO users (id, name, email, image, created_at, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
        `, [
          session.user.id,
          session.user.name || null,
          session.user.email || null,
          session.user.image || null
        ])
      } catch (userError) {
        console.error('Error creating user:', userError)
        // If user creation fails, still try to proceed (might be a race condition)
      }
    }

    const groupId = generateGroupId()
    const now = new Date().toISOString()

    const group: TaskGroup = {
      id: groupId,
      user_id: session.user.id,
      name: body.name.trim(),
      color: body.color || '#3B82F6',
      collapsed: false,
      created_at: now,
      updated_at: now,
    }

    await db.execute(`
      INSERT INTO task_groups (id, user_id, name, color, collapsed, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [group.id, group.user_id, group.name, group.color, group.collapsed, group.created_at, group.updated_at])

    return NextResponse.json({ group }, { status: 201 })
  } catch (error: any) {
    console.error('Error creating task group:', error)
    
    // Provide more specific error messages
    if (error?.code === 'SQLITE_CONSTRAINT' || error?.cause?.code === 'SQLITE_CONSTRAINT') {
      if (error.message?.includes('FOREIGN KEY')) {
        return NextResponse.json({ 
          error: 'User not found in database. Please sign out and sign in again.' 
        }, { status: 400 })
      }
    }
    
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
