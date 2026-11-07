package reminders

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/url"
	"time"

	"planmyday/server/internal/push"
	"planmyday/server/internal/store"
)

// Result counts what a reminder pass looked at and sent.
type Result struct {
	ScheduledChecked int `json:"scheduled_checked"`
	DueChecked       int `json:"due_checked"`
	CriticalChecked  int `json:"critical_checked"`
	Sent             int `json:"sent"`
	Errors           int `json:"errors"`
}

type settings struct {
	Enabled            bool `json:"enabled"`
	MinPriority        *int `json:"min_priority"`
	LeadTimeMinutes    *int `json:"lead_time_minutes"`
	OnTimeReminder     bool `json:"on_time_reminder"`
	DueDateLeadMinutes *int `json:"due_date_lead_minutes"`
}

// Process sends lead, on-time, due, and critical reminders. It is safe to run every few minutes.
func Process(ctx context.Context, st *store.Store, vapidPublic, vapidPrivate, subject, secret string) (Result, error) {
	var result Result
	now := time.Now()
	windowStart := now.Add(-2 * time.Minute).UTC().Format(time.RFC3339)
	windowEnd := now.Add(120 * time.Minute).UTC().Format(time.RFC3339)
	const slack = 3.0

	rows, err := st.DB.QueryContext(ctx, `SELECT t.id, t.user_id, t.title, t.priority, t.scheduled_start,
		t.notification_sent, t.lead_reminder_sent, tg.reminder_settings
		FROM tasks t JOIN task_groups tg ON t.group_id = tg.id
		WHERE t.scheduled_start IS NOT NULL AND t.scheduled_start >= ? AND t.scheduled_start <= ?
		  AND t.status IN ('pending', 'in_progress')
		  AND (t.notification_sent = 0 OR t.lead_reminder_sent = 0)
		  AND t.group_id IS NOT NULL`, windowStart, windowEnd)
	if err != nil {
		return result, err
	}
	type note struct {
		userID, title, taskID string
		priority              int
		body                  map[string]any
		lead, ontime          bool
	}
	var notes []note
	leadIDs := map[string]bool{}
	ontimeIDs := map[string]bool{}
	for rows.Next() {
		result.ScheduledChecked++
		var id, userID, title, start string
		var priority, notif, lead int
		var raw sql.NullString
		if err := rows.Scan(&id, &userID, &title, &priority, &start, &notif, &lead, &raw); err != nil {
			_ = rows.Close()
			return result, err
		}
		cfg := parseSettings(raw.String)
		if cfg == nil || !cfg.Enabled || priority > minPriority(cfg) {
			continue
		}
		when, err := time.Parse(time.RFC3339, start)
		if err != nil {
			continue
		}
		minutes := when.Sub(now).Minutes()
		if cfg.LeadTimeMinutes != nil && lead == 0 {
			diff := minutes - float64(*cfg.LeadTimeMinutes)
			if diff >= -slack && diff <= slack {
				notes = append(notes, note{userID, title, id, priority, map[string]any{
					"title": "Starting soon: " + title, "body": "Starts in a few minutes", "tag": "task-" + id + "-lead",
				}, true, false})
				leadIDs[id] = true
			}
		}
		if cfg.OnTimeReminder && notif == 0 && minutes >= -slack && minutes <= slack {
			notes = append(notes, note{userID, title, id, priority, map[string]any{
				"title": "Starting now: " + title, "body": "Your task is starting now", "tag": "task-" + id + "-ontime",
			}, false, true})
			ontimeIDs[id] = true
		}
	}
	_ = rows.Close()

	dueRows, err := st.DB.QueryContext(ctx, `SELECT t.id, t.user_id, t.title, t.priority, t.due_date, tg.reminder_settings
		FROM tasks t JOIN task_groups tg ON t.group_id = tg.id
		WHERE t.scheduled_start IS NULL AND t.due_date IS NOT NULL AND t.due_date >= ? AND t.due_date <= ?
		  AND t.status IN ('pending', 'in_progress') AND t.due_reminder_sent = 0 AND t.group_id IS NOT NULL`, windowStart, windowEnd)
	if err != nil {
		return result, err
	}
	dueIDs := map[string]bool{}
	for dueRows.Next() {
		result.DueChecked++
		var id, userID, title, due string
		var priority int
		var raw sql.NullString
		if err := dueRows.Scan(&id, &userID, &title, &priority, &due, &raw); err != nil {
			_ = dueRows.Close()
			return result, err
		}
		cfg := parseSettings(raw.String)
		if cfg == nil || !cfg.Enabled || cfg.DueDateLeadMinutes == nil || priority > minPriority(cfg) {
			continue
		}
		when, err := time.Parse(time.RFC3339, due)
		if err != nil {
			continue
		}
		diff := when.Sub(now).Minutes() - float64(*cfg.DueDateLeadMinutes)
		if diff >= -slack && diff <= slack {
			notes = append(notes, note{userID, title, id, priority, map[string]any{
				"title": "Due soon: " + title, "body": "This task is coming due", "tag": "task-" + id + "-due",
			}, false, false})
			dueIDs[id] = true
		}
	}
	_ = dueRows.Close()

	for _, n := range notes {
		if sendToUser(ctx, st, n.userID, n.taskID, n.body, vapidPublic, vapidPrivate, subject, secret, &result) {
			// counted inside
		}
	}
	for id := range leadIDs {
		_, _ = st.DB.ExecContext(ctx, `UPDATE tasks SET lead_reminder_sent = 1 WHERE id = ?`, id)
	}
	for id := range ontimeIDs {
		_, _ = st.DB.ExecContext(ctx, `UPDATE tasks SET notification_sent = 1 WHERE id = ?`, id)
	}
	for id := range dueIDs {
		_, _ = st.DB.ExecContext(ctx, `UPDATE tasks SET due_reminder_sent = 1 WHERE id = ?`, id)
	}

	crit, err := st.DB.QueryContext(ctx, `SELECT t.id, t.user_id, t.title, t.scheduled_start, t.due_date,
		t.critical_reminder_snoozed_until, t.critical_reminder_last_sent_at, tg.reminder_settings,
		COALESCE(u.critical_reminder_enabled, 1), COALESCE(u.critical_reminder_interval_minutes, 15)
		FROM tasks t
		JOIN task_groups tg ON t.group_id = tg.id
		JOIN users u ON t.user_id = u.id
		WHERE t.priority = 1 AND t.status IN ('pending', 'in_progress') AND t.group_id IS NOT NULL
		  AND COALESCE(u.critical_reminder_enabled, 1) = 1`)
	if err != nil {
		return result, nil
	}
	defer crit.Close()
	for crit.Next() {
		result.CriticalChecked++
		var id, userID, title string
		var start, due, snooze, last, raw sql.NullString
		var enabled, interval int
		if err := crit.Scan(&id, &userID, &title, &start, &due, &snooze, &last, &raw, &enabled, &interval); err != nil {
			return result, err
		}
		cfg := parseSettings(raw.String)
		if cfg == nil || !cfg.Enabled || enabled == 0 {
			continue
		}
		if snooze.Valid {
			if until, err := time.Parse(time.RFC3339, snooze.String); err == nil && now.Before(until) {
				continue
			}
		}
		late := false
		if start.Valid {
			if when, err := time.Parse(time.RFC3339, start.String); err == nil && when.Before(now) {
				late = true
			}
		} else if due.Valid {
			if when, err := time.Parse(time.RFC3339, due.String); err == nil && when.Before(now) {
				late = true
			}
		}
		if !late {
			continue
		}
		if interval < 1 {
			interval = 15
		}
		if interval > 120 {
			interval = 120
		}
		if last.Valid {
			if sent, err := time.Parse(time.RFC3339, last.String); err == nil && now.Sub(sent) < time.Duration(interval)*time.Minute {
				continue
			}
		}
		body := map[string]any{
			"title": "Overdue: " + title, "body": "This critical task is overdue.",
			"entityType": "task-critical", "entityId": id, "requireInteraction": true,
		}
		if sendToUser(ctx, st, userID, id, body, vapidPublic, vapidPrivate, subject, secret, &result) {
			_, _ = st.DB.ExecContext(ctx, `UPDATE tasks SET critical_reminder_last_sent_at = ? WHERE id = ?`, now.UTC().Format(time.RFC3339), id)
		}
	}
	return result, crit.Err()
}

func sendToUser(ctx context.Context, st *store.Store, userID, taskID string, body map[string]any, pub, priv, subject, secret string, result *Result) bool {
	subs, err := st.ListPush(ctx, userID)
	if err != nil || len(subs) == 0 {
		return false
	}
	ok := false
	for _, sub := range subs {
		payload := map[string]any{}
		for k, v := range body {
			payload[k] = v
		}
		if secret != "" {
			exp := time.Now().Add(7 * 24 * time.Hour)
			complete, _ := push.Sign(secret, userID, "task-critical", taskID, "complete", sub.ID, exp)
			snooze, _ := push.Sign(secret, userID, "task-critical", taskID, "snooze", sub.ID, exp)
			payload["actionUrls"] = map[string]string{
				"complete": actionURL(taskID, "complete", complete),
				"snooze":   actionURL(taskID, "snooze", snooze),
			}
			payload["url"] = actionURL(taskID, "complete", complete)
		}
		raw, _ := json.Marshal(payload)
		err := push.Send(sub.Endpoint, sub.P256dh, sub.AuthKey, raw, pub, priv, subject)
		if err != nil {
			result.Errors++
			if push.Stale(err) {
				_ = st.DeactivatePush(ctx, sub.Endpoint)
			}
			continue
		}
		result.Sent++
		ok = true
	}
	return ok
}

func actionURL(taskID, action, token string) string {
	q := url.Values{}
	q.Set("entityType", "task-critical")
	q.Set("entityId", taskID)
	q.Set("action", action)
	q.Set("actionToken", token)
	return "/reminder/action?" + q.Encode()
}

func parseSettings(raw string) *settings {
	if raw == "" {
		return nil
	}
	var cfg settings
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return nil
	}
	return &cfg
}

func minPriority(cfg *settings) int {
	if cfg.MinPriority == nil {
		return 5
	}
	return *cfg.MinPriority
}
