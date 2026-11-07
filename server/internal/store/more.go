package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"planmyday/server/internal/schedule"
)

func (s *Store) AddSubtask(ctx context.Context, userID, parentID, title string, duration *int) (Task, error) {
	if _, err := s.getOwned(ctx, s.DB, userID, parentID); err != nil {
		return Task{}, err
	}
	var next int
	_ = s.DB.QueryRowContext(ctx, `SELECT COALESCE(MAX(step_order), 0) + 1 FROM tasks WHERE parent_task_id = ? AND user_id = ?`, parentID, userID).Scan(&next)
	return s.InsertTask(ctx, s.DB, userID, TaskInput{
		Title: title, Duration: duration, TaskType: "subtask", ParentID: &parentID, StepOrder: &next, Priority: 3, Energy: 3,
	})
}

func (s *Store) ReorderSubtasks(ctx context.Context, userID, parentID string, ids []string) error {
	if _, err := s.getOwned(ctx, s.DB, userID, parentID); err != nil {
		return err
	}
	return s.withTx(ctx, func(tx *sql.Tx) error {
		for i, id := range ids {
			res, err := tx.ExecContext(ctx, `UPDATE tasks SET step_order = ?, updated_at = ? WHERE id = ? AND parent_task_id = ? AND user_id = ?`,
				i+1, nowStamp(), id, parentID, userID)
			if err != nil {
				return err
			}
			n, _ := res.RowsAffected()
			if n == 0 {
				return ErrNotFound
			}
		}
		return nil
	})
}

func (s *Store) UnscheduleSubtasks(ctx context.Context, userID, parentID string) error {
	if _, err := s.getOwned(ctx, s.DB, userID, parentID); err != nil {
		return err
	}
	_, err := s.DB.ExecContext(ctx, `UPDATE tasks SET scheduled_start = NULL, scheduled_end = NULL, updated_at = ? WHERE parent_task_id = ? AND user_id = ?`,
		nowStamp(), parentID, userID)
	return err
}

func (s *Store) AddDependency(ctx context.Context, userID, taskID, dependsOn string) error {
	if _, err := s.getOwned(ctx, s.DB, userID, taskID); err != nil {
		return err
	}
	if _, err := s.getOwned(ctx, s.DB, userID, dependsOn); err != nil {
		return err
	}
	if taskID == dependsOn {
		return errors.New("a task cannot depend on itself")
	}
	_, err := s.DB.ExecContext(ctx, `INSERT INTO task_dependencies (id, task_id, depends_on_task_id, created_at) VALUES (?, ?, ?, ?)`,
		newID("dep_"), taskID, dependsOn, nowStamp())
	if err != nil && strings.Contains(strings.ToLower(err.Error()), "unique") {
		return nil
	}
	if err != nil {
		return err
	}
	_, _ = s.DB.ExecContext(ctx, `UPDATE tasks SET depends_on_task_id = COALESCE(depends_on_task_id, ?), updated_at = ? WHERE id = ? AND user_id = ?`,
		dependsOn, nowStamp(), taskID, userID)
	return nil
}

func (s *Store) RemoveDependency(ctx context.Context, userID, taskID, dependsOn string) error {
	if _, err := s.getOwned(ctx, s.DB, userID, taskID); err != nil {
		return err
	}
	_, err := s.DB.ExecContext(ctx, `DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_task_id = ?`, taskID, dependsOn)
	return err
}

func (s *Store) ListTodos(ctx context.Context, userID, taskID string) ([]Todo, error) {
	if _, err := s.GetTask(ctx, userID, taskID); err != nil {
		return nil, err
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT id, task_id, description, completed, created_at, updated_at FROM task_todos WHERE task_id = ? ORDER BY created_at`, taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Todo
	for rows.Next() {
		var td Todo
		var done int
		var created, updated string
		if err := rows.Scan(&td.ID, &td.TaskID, &td.Description, &done, &created, &updated); err != nil {
			return nil, err
		}
		td.Completed = asBool(done)
		td.CreatedAt = normalizeLoose(created)
		td.UpdatedAt = normalizeLoose(updated)
		out = append(out, td)
	}
	return out, rows.Err()
}

func (s *Store) AddTodo(ctx context.Context, userID, taskID, description string) (Todo, error) {
	if _, err := s.getOwned(ctx, s.DB, userID, taskID); err != nil {
		return Todo{}, err
	}
	description = strings.TrimSpace(description)
	if description == "" {
		return Todo{}, errors.New("description is required")
	}
	id := newID("todo_")
	stamp := nowStamp()
	_, err := s.DB.ExecContext(ctx, `INSERT INTO task_todos (id, task_id, description, completed, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)`,
		id, taskID, description, stamp, stamp)
	if err != nil {
		return Todo{}, err
	}
	return Todo{ID: id, TaskID: taskID, Description: description, CreatedAt: stamp, UpdatedAt: stamp}, nil
}

func (s *Store) UpdateTodo(ctx context.Context, userID, taskID, todoID string, description *string, completed *bool) error {
	if _, err := s.getOwned(ctx, s.DB, userID, taskID); err != nil {
		return err
	}
	if description != nil {
		_, err := s.DB.ExecContext(ctx, `UPDATE task_todos SET description = ?, updated_at = ? WHERE id = ? AND task_id = ?`, strings.TrimSpace(*description), nowStamp(), todoID, taskID)
		if err != nil {
			return err
		}
	}
	if completed != nil {
		_, err := s.DB.ExecContext(ctx, `UPDATE task_todos SET completed = ?, updated_at = ? WHERE id = ? AND task_id = ?`, boolInt(*completed), nowStamp(), todoID, taskID)
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) DeleteTodo(ctx context.Context, userID, taskID, todoID string) error {
	if _, err := s.getOwned(ctx, s.DB, userID, taskID); err != nil {
		return err
	}
	_, err := s.DB.ExecContext(ctx, `DELETE FROM task_todos WHERE id = ? AND task_id = ?`, todoID, taskID)
	return err
}

func (s *Store) SnoozeCritical(ctx context.Context, userID, taskID string, until time.Time) error {
	res, err := s.DB.ExecContext(ctx, `UPDATE tasks SET critical_reminder_snoozed_until = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
		schedule.FormatStamp(until), nowStamp(), taskID, userID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// AgendaItems are the external day-grouped read. Cancelled and unscheduled rows are omitted.
func (s *Store) Agenda(ctx context.Context, userID, start, end string) (string, []AgendaDay, error) {
	loc, _, u, err := s.userLocation(ctx, s.DB, userID)
	if err != nil {
		return "", nil, err
	}
	from, err := time.ParseInLocation("2006-01-02", start, loc)
	if err != nil {
		return "", nil, errors.New("start must be YYYY-MM-DD")
	}
	to, err := time.ParseInLocation("2006-01-02", end, loc)
	if err != nil {
		return "", nil, errors.New("end must be YYYY-MM-DD")
	}
	if to.Before(from) {
		return "", nil, errors.New("end is before start")
	}
	if to.Sub(from).Hours()/24 > 31 {
		return "", nil, errors.New("range cannot exceed 31 days")
	}
	tasks, err := s.listTasks(ctx, s.DB, userID)
	if err != nil {
		return "", nil, err
	}
	days := []AgendaDay{}
	index := map[string]int{}
	for d := from; !d.After(to); d = d.AddDate(0, 0, 1) {
		key := d.Format("2006-01-02")
		index[key] = len(days)
		days = append(days, AgendaDay{Date: key, Items: []AgendaItem{}})
	}
	until := to.AddDate(0, 0, 1)
	for _, t := range tasks {
		if !t.Owned || t.ScheduledStart == nil || t.Status == "cancelled" {
			continue
		}
		st := parsePtr(t.ScheduledStart)
		if st == nil {
			continue
		}
		local := st.In(loc)
		if local.Before(from) || !local.Before(until) {
			continue
		}
		key := local.Format("2006-01-02")
		i, ok := index[key]
		if !ok {
			continue
		}
		days[i].Items = append(days[i].Items, AgendaItem{
			ID: t.ID, Title: t.Title, TaskType: t.TaskType, Status: t.Status, Priority: t.Priority,
			Duration: t.Duration, ScheduledStart: t.ScheduledStart, ScheduledEnd: t.ScheduledEnd,
			DueDate: t.DueDate, GroupID: t.GroupID, ParentTaskID: t.ParentTaskID, Energy: t.Energy, Locked: t.Locked,
		})
	}
	return u.Timezone, days, nil
}

// AgendaDay is one civil day in the external agenda, including quiet days.
type AgendaDay struct {
	Date  string       `json:"date"`
	Items []AgendaItem `json:"items"`
}

// AgendaItem is the external task projection.
type AgendaItem struct {
	ID             string  `json:"id"`
	Title          string  `json:"title"`
	TaskType       string  `json:"task_type"`
	Status         string  `json:"status"`
	Priority       int     `json:"priority"`
	Duration       *int    `json:"duration"`
	ScheduledStart *string `json:"scheduled_start"`
	ScheduledEnd   *string `json:"scheduled_end"`
	DueDate        *string `json:"due_date"`
	GroupID        *string `json:"group_id"`
	ParentTaskID   *string `json:"parent_task_id"`
	Energy         int     `json:"energy_level_required"`
	Locked         bool    `json:"locked"`
}

// ImportTask creates one task, creating a group by name when needed.
func (s *Store) ImportTask(ctx context.Context, userID string, title, taskType, groupName, description, dueRaw string, duration *int, priority, energy int, loc *time.Location) (Task, error) {
	var groupID *string
	if strings.TrimSpace(groupName) != "" {
		id, err := s.FindOrCreateGroupByName(ctx, s.DB, userID, groupName)
		if err != nil {
			return Task{}, err
		}
		groupID = &id
	}
	var due *string
	if strings.TrimSpace(dueRaw) != "" {
		parsed, err := parseDue(dueRaw, loc)
		if err != nil {
			return Task{}, err
		}
		stamp := schedule.FormatStamp(parsed)
		due = &stamp
	}
	if taskType == "" {
		taskType = "task"
	}
	var desc *string
	if strings.TrimSpace(description) != "" {
		desc = &description
	}
	return s.InsertTask(ctx, s.DB, userID, TaskInput{
		Title: title, Description: desc, Priority: priority, Duration: duration, DueDate: due,
		GroupID: groupID, TaskType: taskType, Energy: energy,
	})
}

func parseDue(raw string, loc *time.Location) (time.Time, error) {
	if loc == nil {
		loc = time.UTC
	}
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		return t, nil
	}
	if t, err := time.ParseInLocation("2006-01-02T15:04", raw, loc); err == nil {
		return t, nil
	}
	if t, err := time.ParseInLocation("2006-01-02", raw, loc); err == nil {
		return time.Date(t.Year(), t.Month(), t.Day(), 17, 0, 0, 0, loc), nil
	}
	return time.Time{}, errors.New("unrecognized due_date")
}

// OverdueTasks are pending work past its due time that has not been ignored.
func (s *Store) OverdueTasks(ctx context.Context, userID string, now time.Time) ([]Task, error) {
	tasks, err := s.listTasks(ctx, s.DB, userID)
	if err != nil {
		return nil, err
	}
	var out []Task
	for _, t := range tasks {
		if !t.Owned || t.Ignored || t.DueDate == nil {
			continue
		}
		if t.Status != "pending" && t.Status != "in_progress" {
			continue
		}
		due := parsePtr(t.DueDate)
		if due != nil && due.Before(now) {
			out = append(out, t)
		}
	}
	return out, nil
}
