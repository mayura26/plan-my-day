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

func (s *Store) loadUser(ctx context.Context, q execer, id string) (User, error) {
	row := q.QueryRowContext(ctx, `SELECT id, name, email, image, timezone, awake_hours,
		auto_schedule_new_tasks, default_schedule_mode, default_ai_group_id, ai_model,
		critical_reminder_enabled, critical_reminder_interval_minutes
		FROM users WHERE id = ?`, id)
	var u User
	var name, email, image, tz, awake, mode, aiGroup, model sql.NullString
	var auto, crit int
	var interval sql.NullInt64
	err := row.Scan(&u.ID, &name, &email, &image, &tz, &awake, &auto, &mode, &aiGroup, &model, &crit, &interval)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	if err != nil && (strings.Contains(err.Error(), "awake_hours") || strings.Contains(err.Error(), "no such column")) {
		return s.loadUserLegacy(ctx, q, id)
	}
	if err != nil {
		return User{}, err
	}
	u.Name = ns(name)
	u.Email = ns(email)
	u.Image = ns(image)
	u.Timezone = defaultStr(tz.String, "UTC")
	hours := ""
	if awake.Valid {
		hours = awake.String
	}
	if strings.TrimSpace(hours) == "" || hours == "{}" || hours == "null" {
		if legacy := s.legacyHours(ctx, q, id); legacy != "" {
			hours = legacy
		}
	}
	u.AwakeHours = decodeJSONOr(hours, defaultHours())
	u.AutoScheduleNewTasks = asBool(auto)
	u.DefaultScheduleMode = defaultStr(mode.String, "now")
	u.DefaultAIGroupID = ns(aiGroup)
	u.AIModel = defaultStr(model.String, "mini")
	u.CriticalEnabled = crit != 0 || !interval.Valid
	if crit == 0 && interval.Valid {
		u.CriticalEnabled = false
	}
	u.CriticalInterval = 15
	if interval.Valid && interval.Int64 > 0 {
		u.CriticalInterval = int(interval.Int64)
	}
	return u, nil
}

func (s *Store) loadUserLegacy(ctx context.Context, q execer, id string) (User, error) {
	row := q.QueryRowContext(ctx, `SELECT id, name, email, image, timezone FROM users WHERE id = ?`, id)
	var u User
	var name, email, image, tz sql.NullString
	if err := row.Scan(&u.ID, &name, &email, &image, &tz); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return User{}, ErrNotFound
		}
		return User{}, err
	}
	u.Name, u.Email, u.Image = ns(name), ns(email), ns(image)
	u.Timezone = defaultStr(tz.String, "UTC")
	u.AwakeHours = defaultHours()
	u.DefaultScheduleMode = "now"
	u.AIModel = "mini"
	u.CriticalEnabled = true
	u.CriticalInterval = 15
	return u, nil
}

func (s *Store) legacyHours(ctx context.Context, q execer, id string) string {
	var legacy sql.NullString
	err := q.QueryRowContext(ctx, `SELECT working_hours FROM users WHERE id = ?`, id).Scan(&legacy)
	if err != nil || !legacy.Valid {
		return ""
	}
	return legacy.String
}

func defaultHours() map[string]any {
	out := map[string]any{}
	for _, day := range []string{"sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"} {
		out[day] = map[string]int{"start": 9, "end": 17}
	}
	return out
}

func decodeJSONOr(raw string, fallback any) any {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "null" {
		return fallback
	}
	var v any
	if err := json.Unmarshal([]byte(raw), &v); err != nil {
		return fallback
	}
	return v
}

// GetUser loads the account the session points at.
func (s *Store) GetUser(ctx context.Context, id string) (User, error) {
	return s.loadUser(ctx, s.DB, id)
}

// UpsertOAuthUser matches an existing person by email before inserting anyone new.
func (s *Store) UpsertOAuthUser(ctx context.Context, provider, accountID, subject, email, name, image, accessToken string, expiresAt int64) (string, error) {
	email = strings.TrimSpace(strings.ToLower(email))
	var userID string
	err := s.withTx(ctx, func(tx *sql.Tx) error {
		if email != "" {
			err := tx.QueryRowContext(ctx, `SELECT id FROM users WHERE lower(email) = ?`, email).Scan(&userID)
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				return err
			}
		}
		if userID == "" && subject != "" {
			err := tx.QueryRowContext(ctx, `SELECT id FROM users WHERE id = ?`, subject).Scan(&userID)
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				return err
			}
		}
		stamp := nowStamp()
		if userID == "" {
			userID = subject
			if userID == "" {
				userID = newID("user_")
			}
			_, err := tx.ExecContext(ctx, `INSERT INTO users (id, name, email, image, timezone, created_at, updated_at)
				VALUES (?, ?, ?, ?, 'UTC', ?, ?)`, userID, emptyNil(name), emptyNil(email), emptyNil(image), stamp, stamp)
			if err != nil {
				return err
			}
		} else {
			_, err := tx.ExecContext(ctx, `UPDATE users SET name = COALESCE(?, name), image = COALESCE(?, image), updated_at = ? WHERE id = ?`,
				emptyNil(name), emptyNil(image), stamp, userID)
			if err != nil {
				return err
			}
		}
		accID := provider + "-" + accountID
		_, err := tx.ExecContext(ctx, `INSERT INTO accounts (
			id, user_id, type, provider, provider_account_id, access_token, expires_at, token_type
		) VALUES (?, ?, 'oauth', ?, ?, ?, ?, 'bearer')
		ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id, access_token = excluded.access_token, expires_at = excluded.expires_at`,
			accID, userID, provider, accountID, emptyNil(accessToken), expiresAt)
		return err
	})
	return userID, err
}

// CreateSession stores a row in the existing sessions table.
func (s *Store) CreateSession(ctx context.Context, userID string, ttl time.Duration) (string, time.Time, error) {
	token := newID("")
	expires := time.Now().Add(ttl).UTC()
	_, err := s.DB.ExecContext(ctx, `INSERT INTO sessions (id, session_token, user_id, expires) VALUES (?, ?, ?, ?)`,
		newID("ses_"), token, userID, schedule.FormatStamp(expires))
	if err != nil {
		return "", time.Time{}, err
	}
	return token, expires, nil
}

// UserForSession returns the user id for a cookie that has not expired.
func (s *Store) UserForSession(ctx context.Context, token string) (string, error) {
	var userID, expires string
	err := s.DB.QueryRowContext(ctx, `SELECT user_id, expires FROM sessions WHERE session_token = ?`, token).Scan(&userID, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	exp, err := schedule.ParseStamp(expires)
	if err != nil || time.Now().After(exp) {
		_, _ = s.DB.ExecContext(ctx, `DELETE FROM sessions WHERE session_token = ?`, token)
		return "", ErrNotFound
	}
	return userID, nil
}

func (s *Store) DeleteSession(ctx context.Context, token string) error {
	_, err := s.DB.ExecContext(ctx, `DELETE FROM sessions WHERE session_token = ?`, token)
	return err
}

// EnsureDevUser finds or creates a local-only account for the development sign-in.
func (s *Store) EnsureDevUser(ctx context.Context, email, name string) (string, error) {
	return s.UpsertOAuthUser(ctx, "dev", email, "", email, name, "", "", 0)
}

func (s *Store) UpdateTimezone(ctx context.Context, userID, tz string) error {
	if _, err := time.LoadLocation(tz); err != nil {
		return errors.New("unknown timezone")
	}
	res, err := s.DB.ExecContext(ctx, `UPDATE users SET timezone = ?, updated_at = ? WHERE id = ?`, tz, nowStamp(), userID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) UpdateAwakeHours(ctx context.Context, userID string, hours any) error {
	raw, err := json.Marshal(hours)
	if err != nil {
		return err
	}
	_, err = s.DB.ExecContext(ctx, `UPDATE users SET awake_hours = ?, updated_at = ? WHERE id = ?`, string(raw), nowStamp(), userID)
	return err
}

type Preferences struct {
	AutoScheduleNewTasks bool    `json:"auto_schedule_new_tasks"`
	DefaultScheduleMode  string  `json:"default_schedule_mode"`
	DefaultAIGroupID     *string `json:"default_ai_group_id"`
	AIModel              string  `json:"ai_model"`
	CriticalEnabled      bool    `json:"critical_reminder_enabled"`
	CriticalInterval     int     `json:"critical_reminder_interval_minutes"`
}

func (s *Store) UpdatePreferences(ctx context.Context, userID string, p Preferences) error {
	if p.DefaultScheduleMode == "" || !schedule.ValidMode(p.DefaultScheduleMode) {
		p.DefaultScheduleMode = "now"
	}
	if p.AIModel != "full" && p.AIModel != "mini" {
		p.AIModel = "mini"
	}
	if p.CriticalInterval < 1 {
		p.CriticalInterval = 15
	}
	if p.CriticalInterval > 120 {
		p.CriticalInterval = 120
	}
	_, err := s.DB.ExecContext(ctx, `UPDATE users SET auto_schedule_new_tasks = ?, default_schedule_mode = ?,
		default_ai_group_id = ?, ai_model = ?, critical_reminder_enabled = ?, critical_reminder_interval_minutes = ?,
		updated_at = ? WHERE id = ?`,
		boolInt(p.AutoScheduleNewTasks), p.DefaultScheduleMode, p.DefaultAIGroupID, p.AIModel,
		boolInt(p.CriticalEnabled), p.CriticalInterval, nowStamp(), userID)
	return err
}
