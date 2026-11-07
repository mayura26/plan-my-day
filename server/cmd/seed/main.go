package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"planmyday/server/internal/schedule"
	"planmyday/server/internal/store"
)

func main() {
	email := os.Getenv("SEED_EMAIL")
	if email == "" {
		fmt.Fprintln(os.Stderr, "SEED_EMAIL is required, for example SEED_EMAIL=you@example.com")
		os.Exit(1)
	}
	root := ".."
	if len(os.Args) > 1 {
		root = os.Args[1]
	}
	dir := filepath.Join(root, "dummy")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	for _, name := range []string{"next.db", "go.db"} {
		path := filepath.Join(dir, name)
		_ = os.Remove(path)
		if err := seed(path, email); err != nil {
			fmt.Fprintf(os.Stderr, "%s: %v\n", name, err)
			os.Exit(1)
		}
		fmt.Println("seeded", path)
	}
}

func seed(path, email string) error {
	db, err := store.OpenSQLite(path)
	if err != nil {
		return err
	}
	defer db.Close()
	loc, err := time.LoadLocation("Pacific/Auckland")
	if err != nil {
		return err
	}
	ctx := context.Background()
	const userID = "user_seed"
	now := time.Now()
	stamp := schedule.FormatStamp(now)
	awake := `{"monday":{"start":9,"end":17},"tuesday":{"start":9,"end":17},"wednesday":{"start":9,"end":17},"thursday":{"start":9,"end":17},"friday":{"start":9,"end":17},"saturday":{"start":9,"end":17},"sunday":{"start":9,"end":17}}`
	_, err = db.DB.ExecContext(ctx, `INSERT INTO users (
		id, name, email, timezone, awake_hours, auto_schedule_new_tasks, default_schedule_mode, ai_model,
		critical_reminder_enabled, critical_reminder_interval_minutes, created_at, updated_at
	) VALUES (?, 'Mayura', ?, 'Pacific/Auckland', ?, 0, 'now', 'mini', 1, 15, ?, ?)`,
		userID, email, awake, stamp, stamp)
	if err != nil {
		return err
	}
	groups := []struct{ id, name, color string }{
		{"group_family", "Family", "#f5a524"},
		{"group_grail", "Holy Grail Trading", "#7c3aed"},
		{"group_life", "Life Admin", "#3b82f6"},
		{"group_market", "Market Edge Admin", "#16a34a"},
		{"group_long", "Long Term Projects", "#d4a017"},
	}
	for _, group := range groups {
		if _, err := db.DB.ExecContext(ctx, `INSERT INTO task_groups (
			id, user_id, name, color, collapsed, is_parent_group, priority, auto_schedule_enabled, created_at, updated_at
		) VALUES (?, ?, ?, ?, 0, 0, 3, 0, ?, ?)`, group.id, userID, group.name, group.color, stamp, stamp); err != nil {
			return err
		}
	}
	monday := mondayOf(now.In(loc))
	type item struct {
		id, title, group, status string
		day, hour, dur, priority int
		dueDay                   int
		unscheduled              bool
	}
	items := []item{
		{"task_transfer", "Sort out transfer of Ireland", "group_family", "pending", 0, 12, 60, 2, 0, false},
		{"task_insurance", "Setup Life Insurance", "group_family", "pending", 0, 13, 45, 2, 1, false},
		{"task_mum", "Call mum", "group_family", "pending", 1, 13, 30, 3, 1, false},
		{"task_gap", "Review gap size and gaps", "group_grail", "pending", 2, 14, 60, 2, 2, false},
		{"task_entry", "Add displacement entry model", "group_grail", "pending", 3, 16, 75, 1, 3, false},
		{"task_displacement", "Implement displacement", "group_grail", "in_progress", 3, 17, 60, 1, 3, false},
		{"task_video", "Video - Bot setup", "group_grail", "pending", 4, 18, 90, 3, 4, false},
		{"task_eval", "Test and validate eval bot", "group_grail", "pending", 5, 18, 60, 2, 5, false},
		{"task_dashboard", "Record dashboard portal", "group_life", "pending", 5, 19, 45, 3, 5, false},
		{"task_sanctions", "Review Sanctions monitoring", "group_market", "pending", 3, 18, 60, 2, 4, false},
		{"task_parallax", "Tune parallax with changes", "group_grail", "pending", 4, 16, 60, 2, 4, false},
		{"task_merlin", "Look into Merlin strategy", "group_grail", "pending", 6, 16, 90, 2, 6, false},
		{"task_uptime", "Expose uptime data for ops", "group_market", "pending", 6, 18, 45, 3, 6, false},
		{"task_heartbeat", "Build heartbeat tool", "group_long", "pending", 5, 14, 120, 3, 6, false},
		{"task_ib", "Review 2pm IB bot", "group_grail", "pending", 5, 12, 60, 1, 5, false},
		{"task_overdue", "Renew the parking permit", "group_life", "pending", -1, 9, 30, 1, -2, false},
		{"task_bench", "Sketch the next quarter", "group_long", "pending", 0, 0, 60, 1, 3, true},
	}
	for _, task := range items {
		var start, end, due any
		if !task.unscheduled {
			begin := monday.AddDate(0, 0, task.day).Add(time.Duration(task.hour) * time.Hour)
			start = schedule.FormatStamp(begin)
			end = schedule.FormatStamp(begin.Add(time.Duration(task.dur) * time.Minute))
		}
		if task.dueDay != 0 || !task.unscheduled {
			dueAt := monday.AddDate(0, 0, task.dueDay).Add(17 * time.Hour)
			due = schedule.FormatStamp(dueAt)
		}
		if _, err := db.DB.ExecContext(ctx, `INSERT INTO tasks (
			id, user_id, title, priority, status, duration, scheduled_start, scheduled_end, due_date,
			locked, group_id, task_type, energy_level_required, ignored, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'task', 3, 0, ?, ?)`,
			task.id, userID, task.title, task.priority, task.status, task.dur, start, end, due, task.group, stamp, stamp); err != nil {
			return err
		}
	}
	return nil
}

func mondayOf(day time.Time) time.Time {
	offset := int(day.Weekday()) - int(time.Monday)
	if offset < 0 {
		offset += 7
	}
	y, m, d := day.Date()
	return time.Date(y, m, d-offset, 0, 0, 0, 0, day.Location())
}
