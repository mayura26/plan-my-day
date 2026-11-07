CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT,
  email TEXT UNIQUE,
  image TEXT,
  timezone TEXT DEFAULT 'UTC',
  awake_hours TEXT,
  working_hours TEXT,
  auto_schedule_new_tasks INTEGER DEFAULT 0,
  default_schedule_mode TEXT DEFAULT 'now',
  default_ai_group_id TEXT,
  ai_model TEXT DEFAULT 'mini',
  critical_reminder_enabled INTEGER DEFAULT 1,
  critical_reminder_interval_minutes INTEGER DEFAULT 15,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  expires_at INTEGER,
  token_type TEXT,
  scope TEXT,
  id_token TEXT,
  session_state TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  session_token TEXT UNIQUE NOT NULL,
  user_id TEXT NOT NULL,
  expires DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_groups (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  collapsed INTEGER DEFAULT 0,
  parent_group_id TEXT,
  is_parent_group INTEGER DEFAULT 0,
  priority INTEGER DEFAULT 3,
  auto_schedule_enabled INTEGER DEFAULT 0,
  auto_schedule_hours TEXT,
  reminder_settings TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  priority INTEGER DEFAULT 3,
  status TEXT DEFAULT 'pending',
  duration INTEGER,
  scheduled_start DATETIME,
  scheduled_end DATETIME,
  due_date DATETIME,
  locked INTEGER DEFAULT 0,
  group_id TEXT,
  template_id TEXT,
  task_type TEXT DEFAULT 'task',
  google_calendar_event_id TEXT,
  notification_sent INTEGER DEFAULT 0,
  lead_reminder_sent INTEGER DEFAULT 0,
  due_reminder_sent INTEGER DEFAULT 0,
  critical_reminder_snoozed_until DATETIME,
  critical_reminder_last_sent_at DATETIME,
  depends_on_task_id TEXT,
  energy_level_required INTEGER DEFAULT 3,
  parent_task_id TEXT,
  continued_from_task_id TEXT,
  step_order INTEGER,
  ignored INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_dependencies (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  depends_on_task_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (task_id, depends_on_task_id)
);

CREATE TABLE IF NOT EXISTS task_todos (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  description TEXT NOT NULL,
  completed INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS day_notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  note_date DATE NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, note_date)
);

CREATE TABLE IF NOT EXISTS quick_tags (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  task_title TEXT NOT NULL,
  task_description TEXT,
  task_type TEXT DEFAULT 'task',
  priority INTEGER DEFAULT 3,
  duration_minutes INTEGER,
  energy_level INTEGER DEFAULT 3,
  schedule_offset_minutes INTEGER DEFAULT 0,
  group_id TEXT,
  auto_accept INTEGER DEFAULT 0,
  default_locked INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS group_shares (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  shared_with_user_id TEXT,
  invited_email TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (group_id, invited_email)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  last_used_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  revoked_at DATETIME
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT UNIQUE NOT NULL,
  p256dh_key TEXT NOT NULL,
  auth_key TEXT NOT NULL,
  subscription_data TEXT,
  device_name TEXT,
  user_agent TEXT,
  platform TEXT,
  last_seen DATETIME,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
