package httpapi

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"planmyday/server/internal/ai"
	"planmyday/server/internal/push"
	"planmyday/server/internal/reminders"
	"planmyday/server/internal/store"
)

func (s *Server) getTimezone(w http.ResponseWriter, r *http.Request) {
	user, ok := s.current(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"timezone": user.Timezone})
}

func (s *Server) putTimezone(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var body struct {
		Timezone string `json:"timezone"`
	}
	if err := readJSONLoose(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if err := s.Store.UpdateTimezone(r.Context(), id, body.Timezone); err != nil {
		mapStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"timezone": body.Timezone})
}

func (s *Server) getAwake(w http.ResponseWriter, r *http.Request) {
	user, ok := s.current(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"awake_hours": user.AwakeHours})
}

func (s *Server) putAwake(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var body struct {
		Awake any `json:"awake_hours"`
	}
	if err := readJSONLoose(r, &body); err != nil || body.Awake == nil {
		writeError(w, http.StatusBadRequest, "awake_hours is required")
		return
	}
	if err := s.Store.UpdateAwakeHours(r.Context(), id, body.Awake); err != nil {
		mapStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"awake_hours": body.Awake})
}

func (s *Server) getPrefs(w http.ResponseWriter, r *http.Request) {
	user, ok := s.current(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, store.Preferences{
		AutoScheduleNewTasks: user.AutoScheduleNewTasks,
		DefaultScheduleMode:  user.DefaultScheduleMode,
		DefaultAIGroupID:     user.DefaultAIGroupID,
		AIModel:              user.AIModel,
		CriticalEnabled:      user.CriticalEnabled,
		CriticalInterval:     user.CriticalInterval,
	})
}

func (s *Server) putPrefs(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var body store.Preferences
	if err := readJSONLoose(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if err := s.Store.UpdatePreferences(r.Context(), id, body); err != nil {
		mapStoreError(w, err)
		return
	}
	user, _ := s.Store.GetUser(r.Context(), id)
	writeJSON(w, http.StatusOK, user)
}

func (s *Server) current(w http.ResponseWriter, r *http.Request) (store.User, bool) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return store.User{}, false
	}
	user, err := s.Store.GetUser(r.Context(), id)
	if err != nil {
		mapStoreError(w, err)
		return store.User{}, false
	}
	return user, true
}

func (s *Server) listGroups(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	groups, err := s.Store.ListGroups(r.Context(), id)
	if err != nil {
		mapStoreError(w, err)
		return
	}
	if groups == nil {
		groups = []store.Group{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"groups": groups})
}

func (s *Server) createGroup(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var body struct {
		Name          string  `json:"name"`
		Color         string  `json:"color"`
		ParentGroupID *string `json:"parent_group_id"`
		IsParent      bool    `json:"is_parent_group"`
	}
	if err := readJSONLoose(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	group, err := s.Store.CreateGroup(r.Context(), id, body.Name, body.Color, body.ParentGroupID, body.IsParent)
	if err != nil {
		mapStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"group": group})
}

func (s *Server) updateGroup(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var patch map[string]json.RawMessage
	if err := readJSONLoose(r, &patch); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	group, err := s.Store.UpdateGroup(r.Context(), id, r.PathValue("id"), patch)
	if err != nil {
		mapStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"group": group})
}

func (s *Server) deleteGroup(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if err := s.Store.DeleteGroup(r.Context(), id, r.PathValue("id")); err != nil {
		mapStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) getNote(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	date := r.URL.Query().Get("date")
	if date == "" {
		writeError(w, http.StatusBadRequest, "date is required")
		return
	}
	note, err := s.Store.GetNote(r.Context(), id, date)
	if err != nil {
		mapStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"note": note})
}

func (s *Server) putNote(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var body struct {
		NoteDate string `json:"note_date"`
		Content  string `json:"content"`
	}
	if err := readJSONLoose(r, &body); err != nil || body.NoteDate == "" {
		writeError(w, http.StatusBadRequest, "note_date is required")
		return
	}
	note, err := s.Store.SaveNote(r.Context(), id, body.NoteDate, body.Content)
	if err != nil {
		mapStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"note": note})
}

func (s *Server) deleteNote(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	date := r.URL.Query().Get("date")
	if date == "" {
		writeError(w, http.StatusBadRequest, "date is required")
		return
	}
	if err := s.Store.DeleteNote(r.Context(), id, date); err != nil {
		mapStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listTags(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	tags, err := s.Store.ListTags(r.Context(), id)
	if err != nil {
		mapStoreError(w, err)
		return
	}
	if tags == nil {
		tags = []store.QuickTag{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"tags": tags})
}

func (s *Server) getTag(w http.ResponseWriter, r *http.Request) {
	_, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	tag, err := s.Store.GetTag(r.Context(), r.PathValue("id"))
	if err != nil {
		mapStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tag": tag})
}

func tagInput(body store.TagInput) store.TagInput { return body }

func (s *Server) createTag(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var body store.TagInput
	if err := readJSONLoose(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	tag, err := s.Store.CreateTag(r.Context(), id, tagInput(body))
	if err != nil {
		mapStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tag": tag})
}

func (s *Server) updateTag(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var body store.TagInput
	if err := readJSONLoose(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	tag, err := s.Store.UpdateTag(r.Context(), id, r.PathValue("id"), body)
	if err != nil {
		mapStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tag": tag})
}

func (s *Server) deleteTag(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if err := s.Store.DeleteTag(r.Context(), id, r.PathValue("id")); err != nil {
		mapStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) executeTag(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	task, err := s.Store.ExecuteTag(r.Context(), id, r.PathValue("id"), time.Now())
	if err != nil {
		mapStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"task": task})
}

func (s *Server) listShares(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	shares, err := s.Store.ListShares(r.Context(), id, r.PathValue("id"))
	if err != nil {
		mapStoreError(w, err)
		return
	}
	if shares == nil {
		shares = []store.GroupShare{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"shares": shares})
}

func (s *Server) createShare(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var body struct {
		Email string `json:"email"`
	}
	if err := readJSONLoose(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	share, err := s.Store.CreateShare(r.Context(), id, r.PathValue("id"), body.Email)
	if err != nil {
		mapStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"share": share})
}

func (s *Server) deleteShare(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if err := s.Store.DeleteShare(r.Context(), id, r.PathValue("id"), r.PathValue("shareId")); err != nil {
		mapStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listInvites(w http.ResponseWriter, r *http.Request) {
	user, ok := s.current(w, r)
	if !ok {
		return
	}
	email := ""
	if user.Email != nil {
		email = *user.Email
	}
	invites, err := s.Store.ListInvites(r.Context(), email)
	if err != nil {
		mapStoreError(w, err)
		return
	}
	if invites == nil {
		invites = []store.GroupShare{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"invites": invites})
}

func (s *Server) respondInvite(w http.ResponseWriter, r *http.Request) {
	user, ok := s.current(w, r)
	if !ok {
		return
	}
	var body struct {
		Action string `json:"action"`
	}
	if err := readJSONLoose(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	email := ""
	if user.Email != nil {
		email = *user.Email
	}
	if err := s.Store.RespondInvite(r.Context(), user.ID, email, r.PathValue("id"), body.Action); err != nil {
		mapStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listKeys(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	keys, err := s.Store.ListAPIKeys(r.Context(), id)
	if err != nil {
		mapStoreError(w, err)
		return
	}
	if keys == nil {
		keys = []store.APIKey{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"keys": keys})
}

func (s *Server) createKey(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	_ = readJSONLoose(r, &body)
	key, err := s.Store.CreateAPIKey(r.Context(), id, body.Name)
	if err != nil {
		mapStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"key": key})
}

func (s *Server) revokeKey(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	keyID := r.URL.Query().Get("id")
	if keyID == "" {
		var body struct {
			ID string `json:"id"`
		}
		_ = readJSONLoose(r, &body)
		keyID = body.ID
	}
	if keyID == "" {
		writeError(w, http.StatusBadRequest, "id is required")
		return
	}
	if err := s.Store.RevokeAPIKey(r.Context(), id, keyID); err != nil {
		mapStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) agenda(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireKey(w, r)
	if !ok {
		return
	}
	tz, days, err := s.Store.Agenda(r.Context(), id, r.URL.Query().Get("start"), r.URL.Query().Get("end"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"timezone": tz, "start": r.URL.Query().Get("start"), "end": r.URL.Query().Get("end"), "days": days,
	})
}

func (s *Server) importTasks(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireKey(w, r)
	if !ok {
		return
	}
	var raw map[string]json.RawMessage
	if err := readJSONLoose(r, &raw); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	type item struct {
		Title       string `json:"title"`
		TaskType    string `json:"task_type"`
		Group       string `json:"group"`
		Description string `json:"description"`
		Duration    *int   `json:"duration"`
		DueDate     string `json:"due_date"`
		Priority    int    `json:"priority"`
		Energy      int    `json:"energy_level_required"`
	}
	var items []item
	if batch, ok := raw["tasks"]; ok {
		if err := json.Unmarshal(batch, &items); err != nil {
			writeError(w, http.StatusBadRequest, "tasks must be an array")
			return
		}
	} else {
		b, _ := json.Marshal(raw)
		var one item
		if err := json.Unmarshal(b, &one); err != nil {
			writeError(w, http.StatusBadRequest, "Invalid request body")
			return
		}
		items = []item{one}
	}
	if len(items) == 0 {
		writeError(w, http.StatusBadRequest, "No tasks provided")
		return
	}
	user, err := s.Store.GetUser(r.Context(), id)
	if err != nil {
		mapStoreError(w, err)
		return
	}
	loc, err := time.LoadLocation(user.Timezone)
	if err != nil {
		loc = time.UTC
	}
	type result struct {
		Task  *store.Task `json:"task,omitempty"`
		Error string      `json:"error,omitempty"`
	}
	results := make([]result, 0, len(items))
	for _, it := range items {
		task, err := s.Store.ImportTask(r.Context(), id, it.Title, it.TaskType, it.Group, it.Description, it.DueDate, it.Duration, it.Priority, it.Energy, loc)
		if err != nil {
			results = append(results, result{Error: err.Error()})
			continue
		}
		results = append(results, result{Task: &task})
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

func (s *Server) parseTask(w http.ResponseWriter, r *http.Request) {
	user, ok := s.current(w, r)
	if !ok {
		return
	}
	var body struct {
		Text             string         `json:"text"`
		Groups           []ai.GroupHint `json:"groups"`
		GenerateSubtasks bool           `json:"generate_subtasks"`
	}
	if err := readJSONLoose(r, &body); err != nil || strings.TrimSpace(body.Text) == "" {
		writeError(w, http.StatusBadRequest, "text is required")
		return
	}
	parsed, err := ai.ParseTask(r.Context(), s.OpenAIKey, user.AIModel, user.Timezone, body.Text, body.Groups, body.GenerateSubtasks, user.DefaultAIGroupID)
	if err != nil {
		writeError(w, aiStatus(err), err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"task": parsed})
}

func (s *Server) assistant(w http.ResponseWriter, r *http.Request) {
	user, ok := s.current(w, r)
	if !ok {
		return
	}
	var body struct {
		Messages []ai.Message   `json:"messages"`
		Groups   []ai.GroupHint `json:"groups"`
		Tasks    []store.Task   `json:"existing_tasks"`
	}
	if err := readJSONLoose(r, &body); err != nil || len(body.Messages) == 0 {
		writeError(w, http.StatusBadRequest, "messages array is required")
		return
	}
	turn, err := ai.Assist(r.Context(), s.OpenAIKey, user.AIModel, user.Timezone, body.Messages, body.Groups, body.Tasks, user.DefaultAIGroupID)
	if err != nil {
		writeError(w, aiStatus(err), err.Error())
		return
	}
	writeJSON(w, http.StatusOK, turn)
}

func (s *Server) transcribe(w http.ResponseWriter, r *http.Request) {
	_, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if err := r.ParseMultipartForm(20 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "audio file is required")
		return
	}
	file, header, err := r.FormFile("audio")
	if err != nil {
		file, header, err = r.FormFile("file")
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, "audio file is required")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, 20<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, "could not read audio")
		return
	}
	text, err := ai.Transcribe(r.Context(), s.OpenAIKey, header.Filename, data)
	if err != nil {
		writeError(w, aiStatus(err), err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"text": text})
}

func aiStatus(err error) int {
	if err == nil {
		return http.StatusOK
	}
	if strings.Contains(err.Error(), "not configured") {
		return http.StatusServiceUnavailable
	}
	return http.StatusBadGateway
}

func (s *Server) vapidKey(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"publicKey": s.VAPIDPublic})
}

func (s *Server) subscribe(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var body struct {
		Endpoint string `json:"endpoint"`
		Keys     struct {
			P256dh string `json:"p256dh"`
			Auth   string `json:"auth"`
		} `json:"keys"`
		Platform string `json:"platform"`
	}
	if err := readJSONLoose(r, &body); err != nil || body.Endpoint == "" {
		writeError(w, http.StatusBadRequest, "subscription is required")
		return
	}
	if err := s.Store.SavePush(r.Context(), id, body.Endpoint, body.Keys.P256dh, body.Keys.Auth, body.Platform, r.UserAgent(), body); err != nil {
		mapStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) unsubscribe(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var body struct {
		Endpoint string `json:"endpoint"`
	}
	_ = readJSONLoose(r, &body)
	if body.Endpoint == "" {
		body.Endpoint = r.URL.Query().Get("endpoint")
	}
	if body.Endpoint == "" {
		writeError(w, http.StatusBadRequest, "endpoint is required")
		return
	}
	if err := s.Store.DeletePush(r.Context(), id, body.Endpoint); err != nil {
		mapStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listSubs(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	subs, err := s.Store.ListPush(r.Context(), id)
	if err != nil {
		mapStoreError(w, err)
		return
	}
	if subs == nil {
		subs = []store.PushSub{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"subscriptions": subs})
}

func (s *Server) deleteSub(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	subID := r.URL.Query().Get("id")
	if subID == "" {
		writeError(w, http.StatusBadRequest, "id is required")
		return
	}
	if err := s.Store.DeletePush(r.Context(), id, subID); err != nil {
		mapStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) testPush(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	subs, err := s.Store.ListPush(r.Context(), id)
	if err != nil {
		mapStoreError(w, err)
		return
	}
	payload, _ := json.Marshal(map[string]any{
		"title": "Plan My Day", "body": "Push is working on this device.", "url": "/settings",
	})
	sent := 0
	for _, sub := range subs {
		err := push.Send(sub.Endpoint, sub.P256dh, sub.AuthKey, payload, s.VAPIDPublic, s.VAPIDPrivate, s.vapidSubject())
		if err != nil {
			if push.Stale(err) {
				_ = s.Store.DeactivatePush(r.Context(), sub.Endpoint)
			}
			continue
		}
		sent++
	}
	writeJSON(w, http.StatusOK, map[string]any{"sent": sent})
}

func (s *Server) cleanupPush(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	subs, err := s.Store.ListPush(r.Context(), id)
	if err != nil {
		mapStoreError(w, err)
		return
	}
	removed := 0
	for _, sub := range subs {
		err := push.Send(sub.Endpoint, sub.P256dh, sub.AuthKey, []byte(`{"title":"Plan My Day","body":""}`), s.VAPIDPublic, s.VAPIDPrivate, s.vapidSubject())
		if push.Stale(err) {
			_ = s.Store.DeactivatePush(r.Context(), sub.Endpoint)
			removed++
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"deactivated": removed})
}

func (s *Server) pushAction(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("actionToken")
	if token == "" {
		token = r.URL.Query().Get("token")
	}
	var body struct {
		ActionToken string `json:"actionToken"`
		Token       string `json:"token"`
	}
	_ = readJSONLoose(r, &body)
	if token == "" {
		token = body.ActionToken
	}
	if token == "" {
		token = body.Token
	}
	action, err := push.Verify(token, s.pushSecret())
	if err != nil {
		writeError(w, http.StatusUnauthorized, "This reminder link is no longer valid")
		return
	}
	switch action.Action {
	case "complete":
		if _, err := s.Store.CompleteTask(r.Context(), action.UserID, action.EntityID); err != nil {
			mapStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "action": "complete"})
	case "snooze":
		if err := s.Store.SnoozeCritical(r.Context(), action.UserID, action.EntityID, time.Now().Add(15*time.Minute)); err != nil {
			mapStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "action": "snooze"})
	default:
		writeError(w, http.StatusBadRequest, "unknown action")
	}
}

func (s *Server) cronReminders(w http.ResponseWriter, r *http.Request) {
	if s.CronSecret == "" || r.Header.Get("Authorization") != "Bearer "+s.CronSecret {
		writeError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	result, err := reminders.Process(r.Context(), s.Store, s.VAPIDPublic, s.VAPIDPrivate, s.vapidSubject(), s.pushSecret())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) vapidSubject() string {
	if s.VAPIDSubject != "" {
		return s.VAPIDSubject
	}
	return "mailto:plan@localhost"
}

func (s *Server) pushSecret() string {
	if s.PushSecret != "" {
		return s.PushSecret
	}
	return ""
}
