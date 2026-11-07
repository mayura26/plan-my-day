package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

var groupPalette = []string{"#23466a", "#c4552a", "#2f6f4e", "#8a5a12", "#6b3f69", "#3d6f8a"}

func (s *Store) listGroups(ctx context.Context, q execer, userID string) ([]Group, error) {
	rows, err := q.QueryContext(ctx, `SELECT id, user_id, name, color, collapsed, parent_group_id, is_parent_group,
		priority, auto_schedule_enabled, auto_schedule_hours, reminder_settings, created_at, updated_at
		FROM task_groups WHERE user_id = ?
		UNION
		SELECT g.id, g.user_id, g.name, g.color, g.collapsed, g.parent_group_id, g.is_parent_group,
		g.priority, g.auto_schedule_enabled, g.auto_schedule_hours, g.reminder_settings, g.created_at, g.updated_at
		FROM task_groups g
		JOIN group_shares s ON s.group_id = g.id
		WHERE s.shared_with_user_id = ? AND s.status = 'accepted'`, userID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Group
	seen := map[string]bool{}
	for rows.Next() {
		g, err := scanGroup(rows)
		if err != nil {
			return nil, err
		}
		if seen[g.ID] {
			continue
		}
		seen[g.ID] = true
		out = append(out, g)
	}
	return out, rows.Err()
}

func scanGroup(sc interface{ Scan(dest ...any) error }) (Group, error) {
	var g Group
	var color, parent, hours, reminders, created, updated sql.NullString
	var collapsed, isParent, auto int
	var priority sql.NullInt64
	err := sc.Scan(&g.ID, &g.UserID, &g.Name, &color, &collapsed, &parent, &isParent, &priority, &auto, &hours, &reminders, &created, &updated)
	if err != nil {
		return Group{}, err
	}
	g.Color = defaultStr(color.String, "#23466a")
	g.Collapsed = asBool(collapsed)
	g.ParentGroupID = ns(parent)
	g.IsParentGroup = asBool(isParent)
	g.Priority = 3
	if priority.Valid {
		g.Priority = int(priority.Int64)
	}
	g.AutoScheduleEnabled = asBool(auto)
	if hours.Valid && strings.TrimSpace(hours.String) != "" {
		g.AutoScheduleHours = decodeJSONOr(hours.String, nil)
	}
	if reminders.Valid && strings.TrimSpace(reminders.String) != "" {
		g.ReminderSettings = decodeJSONOr(reminders.String, nil)
	}
	g.CreatedAt = normalizeLoose(created.String)
	g.UpdatedAt = normalizeLoose(updated.String)
	return g, nil
}

func (s *Store) ListGroups(ctx context.Context, userID string) ([]Group, error) {
	return s.listGroups(ctx, s.DB, userID)
}

func (s *Store) getOwnedGroup(ctx context.Context, q execer, userID, id string) (Group, error) {
	row := q.QueryRowContext(ctx, `SELECT id, user_id, name, color, collapsed, parent_group_id, is_parent_group,
		priority, auto_schedule_enabled, auto_schedule_hours, reminder_settings, created_at, updated_at
		FROM task_groups WHERE id = ? AND user_id = ?`, id, userID)
	g, err := scanGroup(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Group{}, ErrNotFound
	}
	return g, err
}

func (s *Store) CreateGroup(ctx context.Context, userID, name, color string, parent *string, isParent bool) (Group, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Group{}, errors.New("name is required")
	}
	if color == "" {
		groups, _ := s.ListGroups(ctx, userID)
		color = groupPalette[len(groups)%len(groupPalette)]
	}
	id := newID("group_")
	stamp := nowStamp()
	_, err := s.DB.ExecContext(ctx, `INSERT INTO task_groups (
		id, user_id, name, color, collapsed, parent_group_id, is_parent_group, priority, created_at, updated_at
	) VALUES (?, ?, ?, ?, 0, ?, ?, 3, ?, ?)`, id, userID, name, color, parent, boolInt(isParent), stamp, stamp)
	if err != nil {
		return Group{}, err
	}
	return s.getOwnedGroup(ctx, s.DB, userID, id)
}

func (s *Store) UpdateGroup(ctx context.Context, userID, id string, patch map[string]json.RawMessage) (Group, error) {
	if _, err := s.getOwnedGroup(ctx, s.DB, userID, id); err != nil {
		return Group{}, err
	}
	sets := []string{"updated_at = ?"}
	args := []any{nowStamp()}
	add := func(col string, v any) {
		sets = append(sets, col+" = ?")
		args = append(args, v)
	}
	if raw, ok := patch["name"]; ok {
		var v string
		if err := json.Unmarshal(raw, &v); err != nil || strings.TrimSpace(v) == "" {
			return Group{}, errors.New("name is required")
		}
		add("name", strings.TrimSpace(v))
	}
	if raw, ok := patch["color"]; ok {
		var v string
		if err := json.Unmarshal(raw, &v); err != nil {
			return Group{}, err
		}
		add("color", v)
	}
	for _, key := range []string{"collapsed", "is_parent_group", "auto_schedule_enabled"} {
		raw, ok := patch[key]
		if !ok {
			continue
		}
		var v bool
		if err := json.Unmarshal(raw, &v); err != nil {
			return Group{}, err
		}
		add(key, boolInt(v))
	}
	if raw, ok := patch["priority"]; ok {
		var v int
		if err := json.Unmarshal(raw, &v); err != nil {
			return Group{}, err
		}
		add("priority", v)
	}
	if raw, ok := patch["parent_group_id"]; ok {
		if string(raw) == "null" {
			add("parent_group_id", nil)
		} else {
			var v string
			if err := json.Unmarshal(raw, &v); err != nil {
				return Group{}, err
			}
			add("parent_group_id", emptyNil(v))
		}
	}
	for _, key := range []string{"auto_schedule_hours", "reminder_settings"} {
		raw, ok := patch[key]
		if !ok {
			continue
		}
		if string(raw) == "null" {
			add(key, nil)
			continue
		}
		add(key, string(raw))
	}
	args = append(args, id, userID)
	_, err := s.DB.ExecContext(ctx, `UPDATE task_groups SET `+strings.Join(sets, ", ")+` WHERE id = ? AND user_id = ?`, args...)
	if err != nil {
		return Group{}, err
	}
	return s.getOwnedGroup(ctx, s.DB, userID, id)
}

func (s *Store) DeleteGroup(ctx context.Context, userID, id string) error {
	if _, err := s.getOwnedGroup(ctx, s.DB, userID, id); err != nil {
		return err
	}
	_, _ = s.DB.ExecContext(ctx, `UPDATE tasks SET group_id = NULL, updated_at = ? WHERE group_id = ? AND user_id = ?`, nowStamp(), id, userID)
	_, err := s.DB.ExecContext(ctx, `DELETE FROM task_groups WHERE id = ? AND user_id = ?`, id, userID)
	return err
}

func (s *Store) FindOrCreateGroupByName(ctx context.Context, q execer, userID, name string) (string, error) {
	name = strings.TrimSpace(name)
	var id string
	err := q.QueryRowContext(ctx, `SELECT id FROM task_groups WHERE user_id = ? AND lower(name) = lower(?)`, userID, name).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	id = newID("group_")
	stamp := nowStamp()
	_, err = q.ExecContext(ctx, `INSERT INTO task_groups (id, user_id, name, color, collapsed, priority, created_at, updated_at)
		VALUES (?, ?, ?, '#23466a', 0, 3, ?, ?)`, id, userID, name, stamp, stamp)
	return id, err
}

func (s *Store) GetNote(ctx context.Context, userID, date string) (*DayNote, error) {
	row := s.DB.QueryRowContext(ctx, `SELECT id, user_id, note_date, content, created_at, updated_at FROM day_notes WHERE user_id = ? AND note_date = ?`, userID, date)
	var n DayNote
	var created, updated string
	err := row.Scan(&n.ID, &n.UserID, &n.NoteDate, &n.Content, &created, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	n.CreatedAt = normalizeLoose(created)
	n.UpdatedAt = normalizeLoose(updated)
	return &n, nil
}

func (s *Store) SaveNote(ctx context.Context, userID, date, content string) (DayNote, error) {
	existing, err := s.GetNote(ctx, userID, date)
	if err != nil {
		return DayNote{}, err
	}
	stamp := nowStamp()
	if existing == nil {
		id := newID("note_")
		_, err = s.DB.ExecContext(ctx, `INSERT INTO day_notes (id, user_id, note_date, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
			id, userID, date, content, stamp, stamp)
	} else {
		_, err = s.DB.ExecContext(ctx, `UPDATE day_notes SET content = ?, updated_at = ? WHERE user_id = ? AND note_date = ?`, content, stamp, userID, date)
	}
	if err != nil {
		return DayNote{}, err
	}
	n, err := s.GetNote(ctx, userID, date)
	if n == nil || err != nil {
		return DayNote{}, err
	}
	return *n, nil
}

func (s *Store) DeleteNote(ctx context.Context, userID, date string) error {
	_, err := s.DB.ExecContext(ctx, `DELETE FROM day_notes WHERE user_id = ? AND note_date = ?`, userID, date)
	return err
}

func (s *Store) ListTags(ctx context.Context, userID string) ([]QuickTag, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT id, user_id, name, task_title, task_description, task_type, priority,
		duration_minutes, energy_level, schedule_offset_minutes, group_id, auto_accept, default_locked, created_at, updated_at
		FROM quick_tags WHERE user_id = ? ORDER BY name`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []QuickTag
	for rows.Next() {
		t, err := scanTag(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func scanTag(sc interface{ Scan(...any) error }) (QuickTag, error) {
	var t QuickTag
	var desc, group, created, updated sql.NullString
	var dur sql.NullInt64
	var auto, locked int
	err := sc.Scan(&t.ID, &t.UserID, &t.Name, &t.TaskTitle, &desc, &t.TaskType, &t.Priority, &dur, &t.EnergyLevel, &t.ScheduleOffset, &group, &auto, &locked, &created, &updated)
	if err != nil {
		return QuickTag{}, err
	}
	t.TaskDescription = ns(desc)
	t.DurationMinutes = ni(dur)
	t.GroupID = ns(group)
	t.AutoAccept = asBool(auto)
	t.DefaultLocked = asBool(locked)
	t.CreatedAt = normalizeLoose(created.String)
	t.UpdatedAt = normalizeLoose(updated.String)
	if t.TaskType == "" {
		t.TaskType = "task"
	}
	return t, nil
}

func (s *Store) GetTag(ctx context.Context, id string) (QuickTag, error) {
	row := s.DB.QueryRowContext(ctx, `SELECT id, user_id, name, task_title, task_description, task_type, priority,
		duration_minutes, energy_level, schedule_offset_minutes, group_id, auto_accept, default_locked, created_at, updated_at
		FROM quick_tags WHERE id = ?`, id)
	t, err := scanTag(row)
	if errors.Is(err, sql.ErrNoRows) {
		return QuickTag{}, ErrNotFound
	}
	return t, err
}

type TagInput struct {
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
}

func (s *Store) CreateTag(ctx context.Context, userID string, in TagInput) (QuickTag, error) {
	if strings.TrimSpace(in.Name) == "" || strings.TrimSpace(in.TaskTitle) == "" {
		return QuickTag{}, errors.New("name and task title are required")
	}
	if in.TaskType == "" {
		in.TaskType = "task"
	}
	if in.Priority < 1 || in.Priority > 5 {
		in.Priority = 3
	}
	if in.EnergyLevel < 1 || in.EnergyLevel > 5 {
		in.EnergyLevel = 3
	}
	id := newID("tag_")
	stamp := nowStamp()
	_, err := s.DB.ExecContext(ctx, `INSERT INTO quick_tags (
		id, user_id, name, task_title, task_description, task_type, priority, duration_minutes, energy_level,
		schedule_offset_minutes, group_id, auto_accept, default_locked, created_at, updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, userID, strings.TrimSpace(in.Name), strings.TrimSpace(in.TaskTitle), in.TaskDescription, in.TaskType,
		in.Priority, in.DurationMinutes, in.EnergyLevel, in.ScheduleOffset, in.GroupID, boolInt(in.AutoAccept), boolInt(in.DefaultLocked), stamp, stamp)
	if err != nil {
		return QuickTag{}, err
	}
	return s.GetTag(ctx, id)
}

func (s *Store) UpdateTag(ctx context.Context, userID, id string, in TagInput) (QuickTag, error) {
	tag, err := s.GetTag(ctx, id)
	if err != nil {
		return QuickTag{}, err
	}
	if tag.UserID != userID {
		return QuickTag{}, ErrNotFound
	}
	stamp := nowStamp()
	_, err = s.DB.ExecContext(ctx, `UPDATE quick_tags SET name = ?, task_title = ?, task_description = ?, task_type = ?,
		priority = ?, duration_minutes = ?, energy_level = ?, schedule_offset_minutes = ?, group_id = ?,
		auto_accept = ?, default_locked = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
		in.Name, in.TaskTitle, in.TaskDescription, in.TaskType, in.Priority, in.DurationMinutes, in.EnergyLevel,
		in.ScheduleOffset, in.GroupID, boolInt(in.AutoAccept), boolInt(in.DefaultLocked), stamp, id, userID)
	if err != nil {
		return QuickTag{}, err
	}
	return s.GetTag(ctx, id)
}

func (s *Store) DeleteTag(ctx context.Context, userID, id string) error {
	res, err := s.DB.ExecContext(ctx, `DELETE FROM quick_tags WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) ExecuteTag(ctx context.Context, userID, id string, now time.Time) (Task, error) {
	tag, err := s.GetTag(ctx, id)
	if err != nil {
		return Task{}, err
	}
	if tag.UserID != userID {
		return Task{}, ErrNotFound
	}
	locked := tag.DefaultLocked || tag.TaskType == "event" || tag.TaskType == "todo"
	var start, end *string
	if tag.DurationMinutes != nil && *tag.DurationMinutes > 0 {
		st := now.Add(time.Duration(tag.ScheduleOffset) * time.Minute)
		en := st.Add(time.Duration(*tag.DurationMinutes) * time.Minute)
		ss, ee := st.UTC().Format(time.RFC3339), en.UTC().Format(time.RFC3339)
		start, end = &ss, &ee
	}
	return s.InsertTask(ctx, s.DB, userID, TaskInput{
		Title: tag.TaskTitle, Description: tag.TaskDescription, Priority: tag.Priority,
		Duration: tag.DurationMinutes, GroupID: tag.GroupID, TaskType: tag.TaskType,
		Energy: tag.EnergyLevel, Locked: locked, Start: start, End: end,
	})
}

func (s *Store) CreateShare(ctx context.Context, ownerID, groupID, email string) (GroupShare, error) {
	if _, err := s.getOwnedGroup(ctx, s.DB, ownerID, groupID); err != nil {
		return GroupShare{}, err
	}
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" || !strings.Contains(email, "@") {
		return GroupShare{}, errors.New("a valid email is required")
	}
	var sharedUser sql.NullString
	_ = s.DB.QueryRowContext(ctx, `SELECT id FROM users WHERE lower(email) = ?`, email).Scan(&sharedUser)
	id := newID("share_")
	stamp := nowStamp()
	_, err := s.DB.ExecContext(ctx, `INSERT INTO group_shares (id, group_id, owner_id, shared_with_user_id, invited_email, status, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`, id, groupID, ownerID, ns(sharedUser), email, stamp, stamp)
	if err != nil {
		return GroupShare{}, err
	}
	return s.getShare(ctx, id)
}

func (s *Store) getShare(ctx context.Context, id string) (GroupShare, error) {
	row := s.DB.QueryRowContext(ctx, `SELECT id, group_id, owner_id, shared_with_user_id, invited_email, status, created_at, updated_at FROM group_shares WHERE id = ?`, id)
	var sh GroupShare
	var shared sql.NullString
	var created, updated string
	err := row.Scan(&sh.ID, &sh.GroupID, &sh.OwnerID, &shared, &sh.InvitedEmail, &sh.Status, &created, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return GroupShare{}, ErrNotFound
	}
	if err != nil {
		return GroupShare{}, err
	}
	sh.SharedWithUserID = ns(shared)
	sh.CreatedAt = normalizeLoose(created)
	sh.UpdatedAt = normalizeLoose(updated)
	return sh, nil
}

func (s *Store) ListShares(ctx context.Context, ownerID, groupID string) ([]GroupShare, error) {
	if _, err := s.getOwnedGroup(ctx, s.DB, ownerID, groupID); err != nil {
		return nil, err
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT id, group_id, owner_id, shared_with_user_id, invited_email, status, created_at, updated_at
		FROM group_shares WHERE group_id = ? AND owner_id = ?`, groupID, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []GroupShare
	for rows.Next() {
		var sh GroupShare
		var shared sql.NullString
		var created, updated string
		if err := rows.Scan(&sh.ID, &sh.GroupID, &sh.OwnerID, &shared, &sh.InvitedEmail, &sh.Status, &created, &updated); err != nil {
			return nil, err
		}
		sh.SharedWithUserID = ns(shared)
		sh.CreatedAt = normalizeLoose(created)
		sh.UpdatedAt = normalizeLoose(updated)
		out = append(out, sh)
	}
	return out, rows.Err()
}

func (s *Store) DeleteShare(ctx context.Context, ownerID, groupID, shareID string) error {
	res, err := s.DB.ExecContext(ctx, `DELETE FROM group_shares WHERE id = ? AND group_id = ? AND owner_id = ?`, shareID, groupID, ownerID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) ListInvites(ctx context.Context, email string) ([]GroupShare, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	rows, err := s.DB.QueryContext(ctx, `SELECT s.id, s.group_id, s.owner_id, s.shared_with_user_id, s.invited_email, s.status,
		s.created_at, s.updated_at, g.name, g.color, u.name, u.email
		FROM group_shares s
		JOIN task_groups g ON g.id = s.group_id
		JOIN users u ON u.id = s.owner_id
		WHERE lower(s.invited_email) = ? AND s.status = 'pending'`, email)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []GroupShare
	for rows.Next() {
		var sh GroupShare
		var shared, ownerName, ownerEmail sql.NullString
		var created, updated string
		if err := rows.Scan(&sh.ID, &sh.GroupID, &sh.OwnerID, &shared, &sh.InvitedEmail, &sh.Status, &created, &updated, &sh.GroupName, &sh.GroupColor, &ownerName, &ownerEmail); err != nil {
			return nil, err
		}
		sh.SharedWithUserID = ns(shared)
		sh.OwnerName = ns(ownerName)
		sh.OwnerEmail = ns(ownerEmail)
		sh.CreatedAt = normalizeLoose(created)
		sh.UpdatedAt = normalizeLoose(updated)
		out = append(out, sh)
	}
	return out, rows.Err()
}

func (s *Store) RespondInvite(ctx context.Context, userID, email, shareID, action string) error {
	sh, err := s.getShare(ctx, shareID)
	if err != nil {
		return err
	}
	if !strings.EqualFold(sh.InvitedEmail, email) {
		return ErrNotFound
	}
	status := "declined"
	if action == "accept" {
		status = "accepted"
	} else if action != "decline" {
		return errors.New("action must be accept or decline")
	}
	_, err = s.DB.ExecContext(ctx, `UPDATE group_shares SET status = ?, shared_with_user_id = ?, updated_at = ? WHERE id = ?`,
		status, userID, nowStamp(), shareID)
	return err
}

func (s *Store) CreateAPIKey(ctx context.Context, userID, name string) (APIKey, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "API key"
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return APIKey{}, err
	}
	plain := "pmy_" + base64.RawURLEncoding.EncodeToString(buf)
	hash, err := bcrypt.GenerateFromPassword([]byte(plain), 10)
	if err != nil {
		return APIKey{}, err
	}
	prefix := plain
	if len(prefix) > 8 {
		prefix = prefix[:8]
	}
	id := newID("key_")
	stamp := nowStamp()
	_, err = s.DB.ExecContext(ctx, `INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		id, userID, name, string(hash), prefix, stamp)
	if err != nil {
		return APIKey{}, err
	}
	return APIKey{ID: id, Name: name, KeyPrefix: prefix, CreatedAt: stamp, Plaintext: plain}, nil
}

func (s *Store) ListAPIKeys(ctx context.Context, userID string) ([]APIKey, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT id, name, key_prefix, last_used_at, created_at, revoked_at FROM api_keys WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []APIKey
	for rows.Next() {
		var k APIKey
		var last, revoked sql.NullString
		var created string
		if err := rows.Scan(&k.ID, &k.Name, &k.KeyPrefix, &last, &created, &revoked); err != nil {
			return nil, err
		}
		k.LastUsedAt = normStamp(last)
		k.RevokedAt = normStamp(revoked)
		k.CreatedAt = normalizeLoose(created)
		out = append(out, k)
	}
	return out, rows.Err()
}

func (s *Store) RevokeAPIKey(ctx context.Context, userID, id string) error {
	res, err := s.DB.ExecContext(ctx, `UPDATE api_keys SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL`, nowStamp(), id, userID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// UserForAPIKey checks a pmy_ secret the same way the Next.js app does:
// first 8 characters narrow the lookup, then bcrypt compares the full secret.
func (s *Store) UserForAPIKey(ctx context.Context, key string) (string, error) {
	key = strings.TrimSpace(key)
	if !strings.HasPrefix(key, "pmy_") || len(key) < 8 {
		return "", ErrNotFound
	}
	prefix := key[:8]
	rows, err := s.DB.QueryContext(ctx, `SELECT id, user_id, key_hash FROM api_keys WHERE key_prefix = ? AND revoked_at IS NULL`, prefix)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	for rows.Next() {
		var id, userID, hash string
		if err := rows.Scan(&id, &userID, &hash); err != nil {
			return "", err
		}
		if bcrypt.CompareHashAndPassword([]byte(hash), []byte(key)) == nil {
			_, _ = s.DB.ExecContext(ctx, `UPDATE api_keys SET last_used_at = ? WHERE id = ?`, nowStamp(), id)
			return userID, nil
		}
	}
	return "", ErrNotFound
}

func (s *Store) SavePush(ctx context.Context, userID, endpoint, p256, authKey, platform, ua string, data any) error {
	raw, _ := json.Marshal(data)
	stamp := nowStamp()
	_, err := s.DB.ExecContext(ctx, `INSERT INTO push_subscriptions (
		id, user_id, endpoint, p256dh_key, auth_key, subscription_data, platform, user_agent, is_active, last_seen, created_at, updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
	ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh_key = excluded.p256dh_key, auth_key = excluded.auth_key,
		subscription_data = excluded.subscription_data, platform = excluded.platform, user_agent = excluded.user_agent,
		is_active = 1, last_seen = excluded.last_seen, updated_at = excluded.updated_at`,
		newID("push_"), userID, endpoint, p256, authKey, string(raw), emptyNil(platform), emptyNil(ua), stamp, stamp, stamp)
	return err
}

func (s *Store) ListPush(ctx context.Context, userID string) ([]PushSub, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT id, endpoint, p256dh_key, auth_key, platform, user_agent, is_active, created_at
		FROM push_subscriptions WHERE user_id = ? AND is_active = 1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PushSub
	for rows.Next() {
		var p PushSub
		var platform, ua, created sql.NullString
		var active int
		if err := rows.Scan(&p.ID, &p.Endpoint, &p.P256dh, &p.AuthKey, &platform, &ua, &active, &created); err != nil {
			return nil, err
		}
		p.Platform = ns(platform)
		p.UserAgent = ns(ua)
		p.IsActive = asBool(active)
		p.CreatedAt = normalizeLoose(created.String)
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) DeletePush(ctx context.Context, userID, endpointOrID string) error {
	_, err := s.DB.ExecContext(ctx, `DELETE FROM push_subscriptions WHERE user_id = ? AND (endpoint = ? OR id = ?)`, userID, endpointOrID, endpointOrID)
	return err
}

func (s *Store) DeactivatePush(ctx context.Context, endpoint string) error {
	_, err := s.DB.ExecContext(ctx, `UPDATE push_subscriptions SET is_active = 0, updated_at = ? WHERE endpoint = ?`, nowStamp(), endpoint)
	return err
}
