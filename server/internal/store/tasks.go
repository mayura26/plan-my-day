package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"planmyday/server/internal/schedule"
)

var ErrNotFound = errors.New("not found")

const taskSelect = `SELECT id, user_id, title, description, priority, status, duration,
  scheduled_start, scheduled_end, due_date, locked, group_id, template_id, task_type,
  google_calendar_event_id, notification_sent, lead_reminder_sent, due_reminder_sent,
  critical_reminder_snoozed_until, critical_reminder_last_sent_at, depends_on_task_id,
  energy_level_required, parent_task_id, continued_from_task_id, step_order, ignored,
  created_at, updated_at FROM tasks`

func scanTask(sc interface{ Scan(dest ...any) error }, owned bool) (Task, error) {
	var t Task
	var desc, ss, se, due, group, template, gcal, snooze, last, dep, parent, cont sql.NullString
	var dur, step sql.NullInt64
	var locked, notif, lead, dueSent, ignored int
	var created, updated string
	err := sc.Scan(
		&t.ID, &t.UserID, &t.Title, &desc, &t.Priority, &t.Status, &dur,
		&ss, &se, &due, &locked, &group, &template, &t.TaskType,
		&gcal, &notif, &lead, &dueSent, &snooze, &last, &dep,
		&t.Energy, &parent, &cont, &step, &ignored, &created, &updated,
	)
	if err != nil {
		return Task{}, err
	}
	t.Description = ns(desc)
	t.Duration = ni(dur)
	t.ScheduledStart = normStamp(ss)
	t.ScheduledEnd = normStamp(se)
	t.DueDate = normStamp(due)
	t.Locked = asBool(locked)
	t.GroupID = ns(group)
	t.TaskType = defaultStr(t.TaskType, "task")
	t.NotificationSent = asBool(notif)
	t.LeadReminderSent = asBool(lead)
	t.DueReminderSent = asBool(dueSent)
	t.CriticalSnoozed = normStamp(snooze)
	t.CriticalLastSent = normStamp(last)
	t.DependsOnTaskID = ns(dep)
	t.ParentTaskID = ns(parent)
	t.ContinuedFrom = ns(cont)
	t.StepOrder = ni(step)
	t.Ignored = asBool(ignored)
	t.Owned = owned
	t.CreatedAt = normalizeLoose(created)
	t.UpdatedAt = normalizeLoose(updated)
	if t.Priority == 0 {
		t.Priority = 3
	}
	if t.Energy == 0 {
		t.Energy = 3
	}
	return t, nil
}

func defaultStr(v, fallback string) string {
	if strings.TrimSpace(v) == "" {
		return fallback
	}
	return v
}

func normalizeLoose(s string) string {
	if t, err := schedule.ParseStamp(s); err == nil {
		return schedule.FormatStamp(t)
	}
	return s
}

func (s *Store) listTasks(ctx context.Context, q execer, userID string) ([]Task, error) {
	rows, err := q.QueryContext(ctx, taskSelect+`
		WHERE user_id = ?
		   OR group_id IN (
		     SELECT group_id FROM group_shares
		     WHERE shared_with_user_id = ? AND status = 'accepted'
		   )`, userID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Task
	for rows.Next() {
		t, err := scanTask(rows, false)
		if err != nil {
			return nil, err
		}
		t.Owned = t.UserID == userID
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := attachDeps(ctx, q, out); err != nil {
		return nil, err
	}
	return out, nil
}

func attachDeps(ctx context.Context, q execer, tasks []Task) error {
	if len(tasks) == 0 {
		return nil
	}
	index := map[string]int{}
	ids := make([]any, 0, len(tasks))
	for i, t := range tasks {
		index[t.ID] = i
		ids = append(ids, t.ID)
		if t.DependsOnTaskID != nil {
			tasks[i].DependsOn = append(tasks[i].DependsOn, *t.DependsOnTaskID)
		}
	}
	placeholders := strings.TrimRight(strings.Repeat("?,", len(ids)), ",")
	rows, err := q.QueryContext(ctx, `SELECT task_id, depends_on_task_id FROM task_dependencies WHERE task_id IN (`+placeholders+`)`, ids...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var taskID, dep string
		if err := rows.Scan(&taskID, &dep); err != nil {
			return err
		}
		i, ok := index[taskID]
		if !ok {
			continue
		}
		seen := false
		for _, existing := range tasks[i].DependsOn {
			if existing == dep {
				seen = true
				break
			}
		}
		if !seen {
			tasks[i].DependsOn = append(tasks[i].DependsOn, dep)
		}
	}
	return rows.Err()
}

// ListTasks returns the viewer's own tasks and tasks in groups shared with them.
// Events whose scheduled end has passed are marked completed first.
func (s *Store) ListTasks(ctx context.Context, userID string) ([]Task, error) {
	_, _ = s.DB.ExecContext(ctx, `UPDATE tasks SET status = 'completed', updated_at = ?
		WHERE user_id = ? AND task_type = 'event' AND status IN ('pending', 'in_progress')
		  AND scheduled_end IS NOT NULL AND scheduled_end < ?`, nowStamp(), userID, nowStamp())
	return s.listTasks(ctx, s.DB, userID)
}

func (s *Store) GetTask(ctx context.Context, userID, id string) (Task, error) {
	tasks, err := s.listTasks(ctx, s.DB, userID)
	if err != nil {
		return Task{}, err
	}
	for _, t := range tasks {
		if t.ID == id {
			return t, nil
		}
	}
	return Task{}, ErrNotFound
}

type TaskInput struct {
	Title       string
	Description *string
	Priority    int
	Duration    *int
	DueDate     *string
	GroupID     *string
	TaskType    string
	Energy      int
	ParentID    *string
	StepOrder   *int
	Locked      bool
	Status      string
	Start       *string
	End         *string
	Continued   *string
}

func (s *Store) InsertTask(ctx context.Context, q execer, userID string, in TaskInput) (Task, error) {
	if strings.TrimSpace(in.Title) == "" {
		return Task{}, errors.New("title is required")
	}
	if in.Priority < 1 || in.Priority > 5 {
		in.Priority = 3
	}
	if in.Energy < 1 || in.Energy > 5 {
		in.Energy = 3
	}
	if in.TaskType == "" {
		in.TaskType = "task"
	}
	if in.Status == "" {
		in.Status = "pending"
	}
	if in.TaskType == "event" || in.TaskType == "todo" {
		in.Locked = true
	}
	id := newID("task_")
	stamp := nowStamp()
	_, err := q.ExecContext(ctx, `INSERT INTO tasks (
		id, user_id, title, description, priority, status, duration, scheduled_start, scheduled_end,
		due_date, locked, group_id, task_type, energy_level_required, parent_task_id, continued_from_task_id,
		step_order, ignored, notification_sent, lead_reminder_sent, due_reminder_sent, created_at, updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?)`,
		id, userID, strings.TrimSpace(in.Title), in.Description, in.Priority, in.Status, in.Duration,
		in.Start, in.End, in.DueDate, boolInt(in.Locked), in.GroupID, in.TaskType, in.Energy,
		in.ParentID, in.Continued, in.StepOrder, stamp, stamp)
	if err != nil {
		return Task{}, err
	}
	return s.getOwned(ctx, q, userID, id)
}

func (s *Store) getOwned(ctx context.Context, q execer, userID, id string) (Task, error) {
	row := q.QueryRowContext(ctx, taskSelect+` WHERE id = ? AND user_id = ?`, id, userID)
	t, err := scanTask(row, true)
	if errors.Is(err, sql.ErrNoRows) {
		return Task{}, ErrNotFound
	}
	if err != nil {
		return Task{}, err
	}
	list := []Task{t}
	if err := attachDeps(ctx, q, list); err != nil {
		return Task{}, err
	}
	return list[0], nil
}

func boolInt(v bool) int {
	if v {
		return 1
	}
	return 0
}

// UpdateTask applies a partial JSON object. A scheduled time sent with locked
// true pins the task so later packing will not move it.
func (s *Store) UpdateTask(ctx context.Context, userID, id string, patch map[string]json.RawMessage) (Task, error) {
	current, err := s.getOwned(ctx, s.DB, userID, id)
	if err != nil {
		return Task{}, err
	}
	sets := []string{"updated_at = ?"}
	args := []any{nowStamp()}
	add := func(column string, value any) {
		sets = append(sets, column+" = ?")
		args = append(args, value)
	}
	if raw, ok := patch["title"]; ok {
		var v string
		if err := json.Unmarshal(raw, &v); err != nil || strings.TrimSpace(v) == "" {
			return Task{}, errors.New("title is required")
		}
		add("title", strings.TrimSpace(v))
	}
	stringCols := map[string]string{
		"description": "description", "status": "status", "task_type": "task_type",
		"group_id": "group_id", "scheduled_start": "scheduled_start", "scheduled_end": "scheduled_end",
		"due_date": "due_date",
	}
	for key, column := range stringCols {
		raw, ok := patch[key]
		if !ok {
			continue
		}
		if string(raw) == "null" {
			add(column, nil)
			continue
		}
		var v string
		if err := json.Unmarshal(raw, &v); err != nil {
			return Task{}, errors.New(key + " is invalid")
		}
		add(column, emptyNil(v))
	}
	intCols := map[string]string{"priority": "priority", "duration": "duration", "energy_level_required": "energy_level_required", "step_order": "step_order"}
	for key, column := range intCols {
		raw, ok := patch[key]
		if !ok {
			continue
		}
		if string(raw) == "null" {
			add(column, nil)
			continue
		}
		var v int
		if err := json.Unmarshal(raw, &v); err != nil {
			return Task{}, errors.New(key + " is invalid")
		}
		add(column, v)
	}
	for _, key := range []string{"locked", "ignored"} {
		raw, ok := patch[key]
		if !ok {
			continue
		}
		var v bool
		if err := json.Unmarshal(raw, &v); err != nil {
			return Task{}, errors.New(key + " is invalid")
		}
		add(key, boolInt(v))
	}
	// Dragging onto the grid sends a time and locked:true together.
	if _, hasStart := patch["scheduled_start"]; hasStart {
		if raw, ok := patch["locked"]; ok {
			var v bool
			_ = json.Unmarshal(raw, &v)
			if v {
				// already added
				_ = current
			}
		}
	}
	args = append(args, id, userID)
	_, err = s.DB.ExecContext(ctx, `UPDATE tasks SET `+strings.Join(sets, ", ")+` WHERE id = ? AND user_id = ?`, args...)
	if err != nil {
		return Task{}, err
	}
	if raw, ok := patch["status"]; ok {
		var status string
		_ = json.Unmarshal(raw, &status)
		if status == "completed" {
			return s.CompleteTask(ctx, userID, id)
		}
	}
	return s.getOwned(ctx, s.DB, userID, id)
}

func emptyNil(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func (s *Store) DeleteTask(ctx context.Context, userID, id string) error {
	res, err := s.DB.ExecContext(ctx, `DELETE FROM tasks WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	_, _ = s.DB.ExecContext(ctx, `DELETE FROM tasks WHERE parent_task_id = ? AND user_id = ?`, id, userID)
	_, _ = s.DB.ExecContext(ctx, `DELETE FROM task_todos WHERE task_id = ?`, id)
	_, _ = s.DB.ExecContext(ctx, `DELETE FROM task_dependencies WHERE task_id = ? OR depends_on_task_id = ?`, id, id)
	return nil
}

func (s *Store) CompleteTask(ctx context.Context, userID, id string) (Task, error) {
	var completed Task
	err := s.withTx(ctx, func(tx *sql.Tx) error {
		current, err := s.getOwned(ctx, tx, userID, id)
		if err != nil {
			return err
		}
		stamp := nowStamp()
		if current.Status != "completed" {
			if _, err := tx.ExecContext(ctx, `UPDATE tasks SET status = 'completed', updated_at = ? WHERE id = ? AND user_id = ?`, stamp, id, userID); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, `UPDATE tasks SET status = 'completed', updated_at = ? WHERE parent_task_id = ? AND user_id = ? AND status != 'completed'`, stamp, id, userID); err != nil {
			return err
		}
		if current.ParentTaskID != nil {
			var remaining int
			if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM tasks WHERE parent_task_id = ? AND user_id = ? AND status != 'completed'`, *current.ParentTaskID, userID).Scan(&remaining); err != nil {
				return err
			}
			if remaining == 0 {
				_, _ = tx.ExecContext(ctx, `UPDATE tasks SET status = 'completed', updated_at = ? WHERE id = ? AND user_id = ?`, stamp, *current.ParentTaskID, userID)
			}
		}
		if current.ContinuedFrom != nil {
			_, _ = tx.ExecContext(ctx, `UPDATE tasks SET status = 'completed', updated_at = ? WHERE id = ? AND user_id = ?`, stamp, *current.ContinuedFrom, userID)
		}
		completed, err = s.getOwned(ctx, tx, userID, id)
		return err
	})
	return completed, err
}

func (s *Store) userLocation(ctx context.Context, q execer, userID string) (*time.Location, schedule.Week, User, error) {
	u, err := s.loadUser(ctx, q, userID)
	if err != nil {
		return nil, schedule.Week{}, User{}, err
	}
	loc, err := time.LoadLocation(u.Timezone)
	if err != nil {
		loc = time.UTC
		u.Timezone = "UTC"
	}
	raw, _ := json.Marshal(u.AwakeHours)
	return loc, schedule.ParseHours(string(raw)), u, nil
}

func (s *Store) buildRequest(ctx context.Context, q execer, userID string, now time.Time) (schedule.Request, error) {
	loc, awake, _, err := s.userLocation(ctx, q, userID)
	if err != nil {
		return schedule.Request{}, err
	}
	tasks, err := s.listTasks(ctx, q, userID)
	if err != nil {
		return schedule.Request{}, err
	}
	groups, err := s.listGroups(ctx, q, userID)
	if err != nil {
		return schedule.Request{}, err
	}
	hours := map[string]schedule.Week{}
	for _, g := range groups {
		if !g.AutoScheduleEnabled || g.AutoScheduleHours == nil {
			continue
		}
		raw, _ := json.Marshal(g.AutoScheduleHours)
		hours[g.ID] = schedule.ParseHours(string(raw))
	}
	items := make([]schedule.Item, 0, len(tasks))
	for _, t := range tasks {
		items = append(items, t.asItem())
	}
	return schedule.Request{
		Now: now, Loc: loc, Awake: awake, GroupHours: hours, Items: items,
	}, nil
}

func (s *Store) applyChanges(ctx context.Context, q execer, changes []schedule.Change) error {
	stamp := nowStamp()
	for _, ch := range changes {
		if ch.Clear {
			_, err := q.ExecContext(ctx, `UPDATE tasks SET scheduled_start = NULL, scheduled_end = NULL,
				notification_sent = 0, lead_reminder_sent = 0, updated_at = ? WHERE id = ?`, stamp, ch.ID)
			if err != nil {
				return err
			}
			continue
		}
		_, err := q.ExecContext(ctx, `UPDATE tasks SET scheduled_start = ?, scheduled_end = ?,
			notification_sent = 0, lead_reminder_sent = 0, updated_at = ? WHERE id = ?`,
			schedule.FormatStamp(ch.Start), schedule.FormatStamp(ch.End), stamp, ch.ID)
		if err != nil {
			return err
		}
	}
	return nil
}

// PlaceTask runs one scheduling mode and writes every moved task in the same transaction.
func (s *Store) PlaceTask(ctx context.Context, userID, taskID, mode string, now time.Time) (Task, []schedule.Change, error) {
	var focal Task
	var changes []schedule.Change
	err := s.withTx(ctx, func(tx *sql.Tx) error {
		owned, err := s.getOwned(ctx, tx, userID, taskID)
		if err != nil {
			return err
		}
		req, err := s.buildRequest(ctx, tx, userID, now)
		if err != nil {
			return err
		}
		req.Mode = mode
		req.FocalID = owned.ID
		res, err := schedule.Place(req)
		if err != nil {
			return err
		}
		if err := s.applyChanges(ctx, tx, res.Changes); err != nil {
			return err
		}
		changes = res.Changes
		focal, err = s.getOwned(ctx, tx, userID, taskID)
		return err
	})
	return focal, changes, err
}

// CompressToday packs the user's civil today.
func (s *Store) CompressToday(ctx context.Context, userID string, now time.Time) ([]schedule.Change, error) {
	var changes []schedule.Change
	err := s.withTx(ctx, func(tx *sql.Tx) error {
		req, err := s.buildRequest(ctx, tx, userID, now)
		if err != nil {
			return err
		}
		res, err := schedule.CompressDay(req, now.In(req.Loc))
		if err != nil {
			return err
		}
		changes = res.Changes
		return s.applyChanges(ctx, tx, res.Changes)
	})
	return changes, err
}

// FillGroup packs one group forward from now and stops at the first wall.
func (s *Store) FillGroup(ctx context.Context, userID, groupID string, now time.Time) ([]schedule.Change, error) {
	var changes []schedule.Change
	err := s.withTx(ctx, func(tx *sql.Tx) error {
		if _, err := s.getOwnedGroup(ctx, tx, userID, groupID); err != nil {
			return err
		}
		req, err := s.buildRequest(ctx, tx, userID, now)
		if err != nil {
			return err
		}
		req.GroupID = groupID
		res, err := schedule.FillGroup(req)
		if err != nil {
			return err
		}
		changes = res.Changes
		return s.applyChanges(ctx, tx, res.Changes)
	})
	return changes, err
}

// Carryover closes the original as rescheduled and inserts a successor.
func (s *Store) Carryover(ctx context.Context, userID, taskID string, auto bool, now time.Time) (Task, error) {
	var created Task
	err := s.withTx(ctx, func(tx *sql.Tx) error {
		orig, err := s.getOwned(ctx, tx, userID, taskID)
		if err != nil {
			return err
		}
		stamp := nowStamp()
		if _, err := tx.ExecContext(ctx, `UPDATE tasks SET status = 'rescheduled', updated_at = ? WHERE id = ? AND user_id = ?`, stamp, orig.ID, userID); err != nil {
			return err
		}
		taskType := orig.TaskType
		if taskType == "event" {
			taskType = "task"
		}
		parent := orig.ParentTaskID
		if orig.TaskType == "subtask" {
			parent = orig.ParentTaskID
		}
		created, err = s.InsertTask(ctx, tx, userID, TaskInput{
			Title: orig.Title, Description: orig.Description, Priority: orig.Priority,
			Duration: orig.Duration, DueDate: orig.DueDate, GroupID: orig.GroupID,
			TaskType: taskType, Energy: orig.Energy, ParentID: parent, Continued: &orig.ID,
			StepOrder: orig.StepOrder,
		})
		if err != nil {
			return err
		}
		if !auto {
			return nil
		}
		req, err := s.buildRequest(ctx, tx, userID, now)
		if err != nil {
			return err
		}
		mode := "now"
		if u, err := s.loadUser(ctx, tx, userID); err == nil && schedule.ValidMode(u.DefaultScheduleMode) {
			mode = u.DefaultScheduleMode
		}
		req.Mode = mode
		req.FocalID = created.ID
		res, err := schedule.Place(req)
		if err != nil {
			return err
		}
		return s.applyChanges(ctx, tx, res.Changes)
	})
	if err != nil {
		return Task{}, err
	}
	return s.getOwned(ctx, s.DB, userID, created.ID)
}
