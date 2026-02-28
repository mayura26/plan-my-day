// Core data types for Plan My Day app

export interface User {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  timezone?: string | null;
  awake_hours?: GroupScheduleHours | null;
  auto_schedule_new_tasks?: boolean;
  default_schedule_mode?: SchedulingMode;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  user_id: string;
  title: string;
  description?: string | null;
  priority: number; // 1-5 scale (1 = most urgent, 5 = least urgent)
  status: TaskStatus;
  duration?: number | null; // in minutes (estimated time to complete)
  scheduled_start?: string | null; // ISO datetime
  scheduled_end?: string | null; // ISO datetime
  due_date?: string | null; // ISO datetime - when task must be completed by
  locked: boolean;
  group_id?: string | null;
  template_id?: string | null;
  task_type: TaskType;
  google_calendar_event_id?: string | null;
  notification_sent: boolean;
  lead_reminder_sent: boolean;
  due_reminder_sent: boolean;
  depends_on_task_id?: string | null; // Legacy single dependency (kept for backward compatibility)
  energy_level_required: number; // 1-5 scale (1 = low energy, 5 = high energy)
  parent_task_id?: string | null; // For subtasks - links to parent task
  continued_from_task_id?: string | null; // For carryover tasks - links to original task
  step_order?: number | null; // For subtasks - order within parent task (1, 2, 3, etc.)
  subtask_count?: number; // Number of subtasks (for filtering - parent tasks with subtasks should be hidden in unscheduled view)
  ignored: boolean; // Whether this task has been ignored in overdue processing
  created_at: string;
  updated_at: string;
}

export type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled" | "rescheduled";
export type TaskType = "task" | "event" | "todo" | "subtask";

/**
 * Scheduling modes available in the UI and API
 * All modes are user-facing and can be selected from various dialogs
 */
export type SchedulingMode =
  | "now"
  | "today"
  | "tomorrow"
  | "next-week"
  | "next-month"
  | "asap"
  | "due-date";

// Task with additional computed properties for UI
export interface TaskWithSubtasks extends Task {
  subtasks?: Task[];
  subtask_count?: number;
  completed_subtask_count?: number;
}

// Task dependency for multiple dependency support
export interface TaskDependency {
  id: string;
  task_id: string;
  depends_on_task_id: string;
  created_at: string;
}

// Task with its dependencies loaded
export interface TaskWithDependencies extends Task {
  dependencies?: TaskDependency[];
  blocked_by?: Task[]; // Tasks that must be completed before this one
}

export interface GroupScheduleHours {
  monday?: { start: number; end: number } | null;
  tuesday?: { start: number; end: number } | null;
  wednesday?: { start: number; end: number } | null;
  thursday?: { start: number; end: number } | null;
  friday?: { start: number; end: number } | null;
  saturday?: { start: number; end: number } | null;
  sunday?: { start: number; end: number } | null;
}

export interface ReminderSettings {
  enabled: boolean;
  min_priority: number; // 1–5; tasks with priority <= this get reminders
  lead_time_minutes: number | null; // null = disabled; minutes before scheduled_start
  on_time_reminder: boolean; // fire at scheduled_start
  due_date_lead_minutes: number | null; // null = disabled; minutes before due_date (unscheduled tasks only)
}

export interface TaskGroup {
  id: string;
  user_id: string;
  name: string;
  color: string;
  collapsed: boolean;
  parent_group_id?: string | null;
  is_parent_group?: boolean;
  auto_schedule_enabled?: boolean;
  auto_schedule_hours?: GroupScheduleHours | null;
  priority?: number; // 1-10 scale (1 = highest priority, 10 = lowest priority)
  reminder_settings?: ReminderSettings | null;
  created_at: string;
  updated_at: string;
}

export interface TaskTemplate {
  id: string;
  user_id: string;
  name: string;
  description?: string | null;
  estimated_duration?: number | null; // in minutes
  default_priority: number; // 1-5 scale
  tags?: string | null; // JSON string array
  created_at: string;
  updated_at: string;
}

export interface Team {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface TeamMember {
  id: string;
  team_id: string;
  user_id: string;
  role: "admin" | "member";
  joined_at: string;
}

export interface TaskNote {
  id: string;
  task_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface TaskTodo {
  id: string;
  task_id: string;
  description: string;
  completed: boolean;
  created_at: string;
  updated_at: string;
}

export interface NotificationSubscription {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh_key: string;
  auth_key: string;
  created_at: string;
}

export interface GoogleCalendarToken {
  id: string;
  user_id: string;
  access_token: string;
  refresh_token?: string | null;
  expires_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DayNote {
  id: string;
  user_id: string;
  note_date: string; // ISO date string (YYYY-MM-DD)
  content: string;
  created_at: string;
  updated_at: string;
}

// API Request/Response types
export interface CreateTaskRequest {
  title: string;
  description?: string;
  priority?: number;
  duration?: number; // estimated time in minutes
  task_type?: TaskType;
  group_id?: string;
  template_id?: string;
  energy_level_required?: number;
  depends_on_task_id?: string; // Legacy single dependency
  dependency_ids?: string[]; // Multiple dependencies - tasks this depends on
  parent_task_id?: string; // For creating subtasks
  scheduled_start?: string;
  scheduled_end?: string;
  due_date?: string; // when task must be completed by
  auto_schedule?: boolean; // If true, automatically schedule to next available slot for today
  schedule_mode?: SchedulingMode; // Scheduling mode when auto_schedule is enabled
  locked?: boolean; // Lock task to prevent shuffle/auto-scheduling from moving it
}

export interface UpdateTaskRequest extends Partial<CreateTaskRequest> {
  status?: TaskStatus;
  scheduled_start?: string;
  scheduled_end?: string;
  locked?: boolean;
  ignored?: boolean;
}

// API Key types
export interface APIKey {
  id: string;
  user_id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

export interface CreateAPIKeyRequest {
  name: string;
}

export interface APIKeyResponse {
  id: string;
  name: string;
  key_prefix: string;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
  key?: string; // Only present when creating a new key
}

// Request for creating a carryover task from an incomplete task
export interface CreateCarryoverTaskRequest {
  additional_duration: number; // Extra time needed in minutes
  notes?: string; // Optional notes about what's left to do
  auto_schedule?: boolean; // If true, automatically schedule the carryover task to the next available slot
  extend_parent_duration?: boolean; // For subtask carryovers: if true, automatically expand parent task duration if needed
}

// Request for rescheduling a task
export interface RescheduleTaskRequest {
  mode: "next-available" | "asap-shuffle";
  auto_schedule?: boolean; // For next-available mode
}

export interface CreateTaskGroupRequest {
  name: string;
  color?: string;
  parent_group_id?: string;
  is_parent_group?: boolean;
  auto_schedule_enabled?: boolean;
  auto_schedule_hours?: GroupScheduleHours | null;
  priority?: number; // 1-10 scale (1 = highest priority, 10 = lowest priority)
}

export interface CreateTaskTemplateRequest {
  name: string;
  description?: string;
  estimated_duration?: number;
  default_priority?: number;
  tags?: string[];
}

// Calendar view types
export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  type: TaskType | "google_calendar";
  priority?: number;
  status?: TaskStatus;
  locked?: boolean;
  color?: string;
  group_name?: string;
}

// Filter and search types
export interface TaskFilters {
  status?: TaskStatus[];
  priority?: number[];
  task_type?: TaskType[];
  group_id?: string[];
  date_range?: {
    start: string;
    end: string;
  };
}

export interface TaskSearchParams {
  query?: string;
  filters?: TaskFilters;
  sort_by?: "priority" | "created_at" | "scheduled_start" | "title";
  sort_order?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

// Day notes API request/response types
export interface CreateDayNoteRequest {
  note_date: string; // YYYY-MM-DD
  content: string;
}

export interface UpdateDayNoteRequest {
  content: string;
}

// Quick Tag types (NFC tag-based quick task creation)
export interface QuickTag {
  id: string;
  user_id: string;
  name: string;
  task_title: string;
  task_description?: string | null;
  task_type: "task" | "todo";
  priority: number;
  duration_minutes?: number | null;
  energy_level: number;
  schedule_offset_minutes: number;
  group_id?: string | null;
  auto_accept: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateQuickTagRequest {
  name: string;
  task_title: string;
  task_description?: string;
  task_type?: "task" | "todo";
  priority?: number;
  duration_minutes?: number;
  energy_level?: number;
  schedule_offset_minutes?: number;
  group_id?: string;
  auto_accept?: boolean;
}

export interface UpdateQuickTagRequest extends Partial<CreateQuickTagRequest> {}
