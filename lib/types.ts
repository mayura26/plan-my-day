// Core data types for Plan My Day app

export interface User {
  id: string
  name?: string | null
  email?: string | null
  image?: string | null
  created_at: string
  updated_at: string
}

export interface Task {
  id: string
  user_id: string
  title: string
  description?: string | null
  priority: number // 1-5 scale (1 = most urgent, 5 = least urgent)
  status: TaskStatus
  duration?: number | null // in minutes
  scheduled_start?: string | null // ISO datetime
  scheduled_end?: string | null // ISO datetime
  locked: boolean
  group_id?: string | null
  template_id?: string | null
  task_type: TaskType
  google_calendar_event_id?: string | null
  notification_sent: boolean
  depends_on_task_id?: string | null
  energy_level_required: number // 1-5 scale (1 = low energy, 5 = high energy)
  estimated_completion_time?: number | null // in minutes
  created_at: string
  updated_at: string
}

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'
export type TaskType = 'task' | 'event'

export interface TaskGroup {
  id: string
  user_id: string
  name: string
  color: string
  collapsed: boolean
  created_at: string
  updated_at: string
}

export interface TaskTemplate {
  id: string
  user_id: string
  name: string
  description?: string | null
  estimated_duration?: number | null // in minutes
  default_priority: number // 1-5 scale
  tags?: string | null // JSON string array
  created_at: string
  updated_at: string
}

export interface Team {
  id: string
  name: string
  created_by: string
  created_at: string
  updated_at: string
}

export interface TeamMember {
  id: string
  team_id: string
  user_id: string
  role: 'admin' | 'member'
  joined_at: string
}

export interface TaskNote {
  id: string
  task_id: string
  content: string
  created_at: string
  updated_at: string
}

export interface TaskTodo {
  id: string
  task_id: string
  description: string
  completed: boolean
  created_at: string
  updated_at: string
}

export interface NotificationSubscription {
  id: string
  user_id: string
  endpoint: string
  p256dh_key: string
  auth_key: string
  created_at: string
}

export interface GoogleCalendarToken {
  id: string
  user_id: string
  access_token: string
  refresh_token?: string | null
  expires_at?: string | null
  created_at: string
  updated_at: string
}

// API Request/Response types
export interface CreateTaskRequest {
  title: string
  description?: string
  priority?: number
  duration?: number
  task_type?: TaskType
  group_id?: string
  template_id?: string
  energy_level_required?: number
  estimated_completion_time?: number
  depends_on_task_id?: string
  scheduled_start?: string
  scheduled_end?: string
}

export interface UpdateTaskRequest extends Partial<CreateTaskRequest> {
  status?: TaskStatus
  scheduled_start?: string
  scheduled_end?: string
  locked?: boolean
}

export interface CreateTaskGroupRequest {
  name: string
  color?: string
}

export interface CreateTaskTemplateRequest {
  name: string
  description?: string
  estimated_duration?: number
  default_priority?: number
  tags?: string[]
}

// Calendar view types
export interface CalendarEvent {
  id: string
  title: string
  start: Date
  end: Date
  type: 'task' | 'event' | 'google_calendar'
  priority?: number
  status?: TaskStatus
  locked?: boolean
  color?: string
  group_name?: string
}

// Filter and search types
export interface TaskFilters {
  status?: TaskStatus[]
  priority?: number[]
  task_type?: TaskType[]
  group_id?: string[]
  date_range?: {
    start: string
    end: string
  }
}

export interface TaskSearchParams {
  query?: string
  filters?: TaskFilters
  sort_by?: 'priority' | 'created_at' | 'scheduled_start' | 'title'
  sort_order?: 'asc' | 'desc'
  limit?: number
  offset?: number
}
