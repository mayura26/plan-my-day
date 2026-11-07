package store

import (
	"crypto/rand"
	"encoding/base64"
	"strings"
	"time"

	"planmyday/server/internal/schedule"
)

// Task is the JSON shape shared with the web app and the external API.
type Task struct {
	ID               string   `json:"id"`
	UserID           string   `json:"user_id"`
	Title            string   `json:"title"`
	Description      *string  `json:"description"`
	Priority         int      `json:"priority"`
	Status           string   `json:"status"`
	Duration         *int     `json:"duration"`
	ScheduledStart   *string  `json:"scheduled_start"`
	ScheduledEnd     *string  `json:"scheduled_end"`
	DueDate          *string  `json:"due_date"`
	Locked           bool     `json:"locked"`
	GroupID          *string  `json:"group_id"`
	TaskType         string   `json:"task_type"`
	Energy           int      `json:"energy_level_required"`
	ParentTaskID     *string  `json:"parent_task_id"`
	ContinuedFrom    *string  `json:"continued_from_task_id"`
	StepOrder        *int     `json:"step_order"`
	Ignored          bool     `json:"ignored"`
	DependsOnTaskID  *string  `json:"depends_on_task_id"`
	DependsOn        []string `json:"depends_on,omitempty"`
	NotificationSent bool     `json:"notification_sent"`
	LeadReminderSent bool     `json:"lead_reminder_sent"`
	DueReminderSent  bool     `json:"due_reminder_sent"`
	CriticalSnoozed  *string  `json:"critical_reminder_snoozed_until"`
	CriticalLastSent *string  `json:"critical_reminder_last_sent_at"`
	Owned            bool     `json:"owned"`
	CreatedAt        string   `json:"created_at"`
	UpdatedAt        string   `json:"updated_at"`
}

func (t Task) asItem() schedule.Item {
	return schedule.Item{
		ID:        t.ID,
		Duration:  deref(t.Duration),
		Start:     parsePtr(t.ScheduledStart),
		End:       parsePtr(t.ScheduledEnd),
		Due:       parsePtr(t.DueDate),
		Locked:    t.Locked,
		Status:    t.Status,
		Priority:  t.Priority,
		GroupID:   derefStr(t.GroupID),
		ParentID:  derefStr(t.ParentTaskID),
		StepOrder: deref(t.StepOrder),
		DependsOn: t.DependsOn,
		Owned:     t.Owned,
	}
}

func deref(n *int) int {
	if n == nil {
		return 0
	}
	return *n
}

func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func parsePtr(s *string) *time.Time {
	if s == nil || strings.TrimSpace(*s) == "" {
		return nil
	}
	t, err := schedule.ParseStamp(*s)
	if err != nil {
		return nil
	}
	return &t
}

// User is the signed-in account plus the preferences the planner reads.
type User struct {
	ID                   string  `json:"id"`
	Name                 *string `json:"name"`
	Email                *string `json:"email"`
	Image                *string `json:"image"`
	Timezone             string  `json:"timezone"`
	AwakeHours           any     `json:"awake_hours"`
	AutoScheduleNewTasks bool    `json:"auto_schedule_new_tasks"`
	DefaultScheduleMode  string  `json:"default_schedule_mode"`
	DefaultAIGroupID     *string `json:"default_ai_group_id"`
	AIModel              string  `json:"ai_model"`
	CriticalEnabled      bool    `json:"critical_reminder_enabled"`
	CriticalInterval     int     `json:"critical_reminder_interval_minutes"`
}

// Group is a task group, including one shared with the viewer.
type Group struct {
	ID                  string  `json:"id"`
	UserID              string  `json:"user_id"`
	Name                string  `json:"name"`
	Color               string  `json:"color"`
	Collapsed           bool    `json:"collapsed"`
	ParentGroupID       *string `json:"parent_group_id"`
	IsParentGroup       bool    `json:"is_parent_group"`
	Priority            int     `json:"priority"`
	AutoScheduleEnabled bool    `json:"auto_schedule_enabled"`
	AutoScheduleHours   any     `json:"auto_schedule_hours"`
	ReminderSettings    any     `json:"reminder_settings"`
	ShareID             *string `json:"share_id,omitempty"`
	SharedByEmail       *string `json:"shared_by_email,omitempty"`
	CreatedAt           string  `json:"created_at"`
	UpdatedAt           string  `json:"updated_at"`
}

// DayNote is one civil day's note.
type DayNote struct {
	ID        string `json:"id"`
	UserID    string `json:"user_id"`
	NoteDate  string `json:"note_date"`
	Content   string `json:"content"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

// Todo is a checklist row on a task.
type Todo struct {
	ID          string `json:"id"`
	TaskID      string `json:"task_id"`
	Description string `json:"description"`
	Completed   bool   `json:"completed"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

// QuickTag is a reusable capture preset.
type QuickTag struct {
	ID              string  `json:"id"`
	UserID          string  `json:"user_id"`
	Name            string  `json:"name"`
	TaskTitle       string  `json:"task_title"`
	TaskDescription *string `json:"task_description"`
	TaskType        string  `json:"task_type"`
	Priority        int     `json:"priority"`
	DurationMinutes *int    `json:"duration_minutes"`
	EnergyLevel     int     `json:"energy_level"`
	ScheduleOffset  int     `json:"schedule_offset_minutes"`
	GroupID         *string `json:"group_id"`
	AutoAccept      bool    `json:"auto_accept"`
	DefaultLocked   bool    `json:"default_locked"`
	CreatedAt       string  `json:"created_at"`
	UpdatedAt       string  `json:"updated_at"`
}

// GroupShare is an invitation to see a group.
type GroupShare struct {
	ID               string  `json:"id"`
	GroupID          string  `json:"group_id"`
	OwnerID          string  `json:"owner_id"`
	SharedWithUserID *string `json:"shared_with_user_id"`
	InvitedEmail     string  `json:"invited_email"`
	Status           string  `json:"status"`
	GroupName        string  `json:"group_name,omitempty"`
	GroupColor       string  `json:"group_color,omitempty"`
	OwnerName        *string `json:"owner_name,omitempty"`
	OwnerEmail       *string `json:"owner_email,omitempty"`
	CreatedAt        string  `json:"created_at"`
	UpdatedAt        string  `json:"updated_at"`
}

// APIKey is a stored key. The secret is only returned at creation.
type APIKey struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	KeyPrefix  string  `json:"key_prefix"`
	LastUsedAt *string `json:"last_used_at"`
	CreatedAt  string  `json:"created_at"`
	RevokedAt  *string `json:"revoked_at"`
	Plaintext  string  `json:"key,omitempty"`
}

// PushSub is a browser push subscription.
type PushSub struct {
	ID        string  `json:"id"`
	Endpoint  string  `json:"endpoint"`
	P256dh    string  `json:"-"`
	AuthKey   string  `json:"-"`
	Platform  *string `json:"platform"`
	UserAgent *string `json:"user_agent"`
	IsActive  bool    `json:"is_active"`
	CreatedAt string  `json:"created_at"`
}

func newID(prefix string) string {
	buf := make([]byte, 12)
	_, _ = rand.Read(buf)
	return prefix + base64.RawURLEncoding.EncodeToString(buf)
}
