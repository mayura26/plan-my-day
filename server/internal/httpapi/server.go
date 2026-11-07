package httpapi

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"planmyday/server/internal/store"
)

const sessionCookie = "pmd_session"

// Server is the HTTP API and the static web app.
type Server struct {
	Store        *store.Store
	PublicURL    string
	DevLogin     bool
	GoogleID     string
	GoogleSecret string
	GitHubID     string
	GitHubSecret string
	OpenAIKey    string
	VAPIDPublic  string
	VAPIDPrivate string
	VAPIDSubject string
	PushSecret   string
	CronSecret   string
	WebRoot      string
}

// Handler routes the API and falls back to the web app.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", s.health)
	mux.HandleFunc("GET /api/auth/config", s.authConfig)
	mux.HandleFunc("POST /api/auth/dev-login", s.devLogin)
	mux.HandleFunc("POST /api/auth/logout", s.logout)
	mux.HandleFunc("GET /auth/google", s.startGoogle)
	mux.HandleFunc("GET /auth/github", s.startGitHub)
	mux.HandleFunc("GET /auth/callback/google", s.callbackGoogle)
	mux.HandleFunc("GET /auth/callback/github", s.callbackGitHub)

	mux.HandleFunc("GET /api/me", s.me)
	mux.HandleFunc("GET /api/user/timezone", s.getTimezone)
	mux.HandleFunc("PUT /api/user/timezone", s.putTimezone)
	mux.HandleFunc("GET /api/user/awake-hours", s.getAwake)
	mux.HandleFunc("PUT /api/user/awake-hours", s.putAwake)
	mux.HandleFunc("GET /api/user/scheduling-preferences", s.getPrefs)
	mux.HandleFunc("PUT /api/user/scheduling-preferences", s.putPrefs)

	mux.HandleFunc("GET /api/task-groups", s.listGroups)
	mux.HandleFunc("POST /api/task-groups", s.createGroup)
	mux.HandleFunc("PUT /api/task-groups/{id}", s.updateGroup)
	mux.HandleFunc("DELETE /api/task-groups/{id}", s.deleteGroup)
	mux.HandleFunc("GET /api/task-groups/{id}/share", s.listShares)
	mux.HandleFunc("POST /api/task-groups/{id}/share", s.createShare)
	mux.HandleFunc("DELETE /api/task-groups/{id}/share/{shareId}", s.deleteShare)
	mux.HandleFunc("GET /api/group-invites", s.listInvites)
	mux.HandleFunc("POST /api/group-invites/{id}", s.respondInvite)

	mux.HandleFunc("GET /api/tasks", s.listTasks)
	mux.HandleFunc("POST /api/tasks", s.createTask)
	mux.HandleFunc("GET /api/tasks/agenda", s.agenda)
	mux.HandleFunc("POST /api/tasks/import", s.importTasks)
	mux.HandleFunc("POST /api/tasks/shuffle", s.shuffle)
	mux.HandleFunc("POST /api/tasks/pull-forward", s.pullForward)
	mux.HandleFunc("GET /api/tasks/overdue", s.overdue)
	mux.HandleFunc("POST /api/tasks/overdue", s.processOverdue)
	mux.HandleFunc("GET /api/tasks/{id}", s.getTask)
	mux.HandleFunc("PUT /api/tasks/{id}", s.updateTask)
	mux.HandleFunc("DELETE /api/tasks/{id}", s.deleteTask)
	mux.HandleFunc("POST /api/tasks/{id}/schedule", s.scheduleTask)
	mux.HandleFunc("POST /api/tasks/{id}/complete", s.completeTask)
	mux.HandleFunc("POST /api/tasks/{id}/carryover", s.carryover)
	mux.HandleFunc("GET /api/tasks/{id}/subtasks", s.listSubtasks)
	mux.HandleFunc("POST /api/tasks/{id}/subtasks", s.addSubtask)
	mux.HandleFunc("PUT /api/tasks/{id}/subtasks/reorder", s.reorderSubtasks)
	mux.HandleFunc("POST /api/tasks/{id}/subtasks/unschedule-all", s.unscheduleSubtasks)
	mux.HandleFunc("POST /api/tasks/{id}/dependencies", s.addDependency)
	mux.HandleFunc("DELETE /api/tasks/{id}/dependencies", s.removeDependency)
	mux.HandleFunc("GET /api/tasks/{id}/todos", s.listTodos)
	mux.HandleFunc("POST /api/tasks/{id}/todos", s.addTodo)
	mux.HandleFunc("PUT /api/tasks/{id}/todos/{todoId}", s.updateTodo)
	mux.HandleFunc("DELETE /api/tasks/{id}/todos/{todoId}", s.deleteTodo)

	mux.HandleFunc("GET /api/day-notes", s.getNote)
	mux.HandleFunc("PUT /api/day-notes", s.putNote)
	mux.HandleFunc("DELETE /api/day-notes", s.deleteNote)

	mux.HandleFunc("GET /api/quick-tags", s.listTags)
	mux.HandleFunc("POST /api/quick-tags", s.createTag)
	mux.HandleFunc("GET /api/quick-tags/{id}", s.getTag)
	mux.HandleFunc("PUT /api/quick-tags/{id}", s.updateTag)
	mux.HandleFunc("DELETE /api/quick-tags/{id}", s.deleteTag)
	mux.HandleFunc("POST /api/quick-tags/{id}/execute", s.executeTag)

	mux.HandleFunc("GET /api/api-keys", s.listKeys)
	mux.HandleFunc("POST /api/api-keys", s.createKey)
	mux.HandleFunc("DELETE /api/api-keys", s.revokeKey)

	mux.HandleFunc("POST /api/ai/parse-task", s.parseTask)
	mux.HandleFunc("POST /api/ai/assistant", s.assistant)
	mux.HandleFunc("POST /api/ai/transcribe", s.transcribe)

	mux.HandleFunc("GET /api/push/vapid-key", s.vapidKey)
	mux.HandleFunc("POST /api/push/subscribe", s.subscribe)
	mux.HandleFunc("DELETE /api/push/subscribe", s.unsubscribe)
	mux.HandleFunc("POST /api/push/unsubscribe", s.unsubscribe)
	mux.HandleFunc("GET /api/push/subscriptions", s.listSubs)
	mux.HandleFunc("DELETE /api/push/subscriptions", s.deleteSub)
	mux.HandleFunc("POST /api/push/test", s.testPush)
	mux.HandleFunc("POST /api/push/cleanup", s.cleanupPush)
	mux.HandleFunc("POST /api/push/actions", s.pushAction)
	mux.HandleFunc("GET /api/cron/process-reminders", s.cronReminders)

	mux.HandleFunc("/", s.frontend)
	return mux
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	if s.Store == nil {
		writeError(w, http.StatusServiceUnavailable, "database is not configured")
		return
	}
	if err := s.Store.Ping(r.Context()); err != nil {
		writeError(w, http.StatusServiceUnavailable, "database unreachable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "db": "up"})
}

func (s *Server) frontend(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" && (strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/auth/")) {
		http.NotFound(w, r)
		return
	}
	rel := strings.TrimPrefix(r.URL.Path, "/")
	if rel == "" {
		http.ServeFile(w, r, filepath.Join(s.WebRoot, "index.html"))
		return
	}
	clean := filepath.Clean(rel)
	full := filepath.Join(s.WebRoot, clean)
	root, _ := filepath.Abs(s.WebRoot)
	abs, err := filepath.Abs(full)
	if err != nil || !strings.HasPrefix(strings.ToLower(abs), strings.ToLower(root)) {
		http.NotFound(w, r)
		return
	}
	info, err := os.Stat(abs)
	if err == nil && !info.IsDir() {
		http.ServeFile(w, r, abs)
		return
	}
	http.ServeFile(w, r, filepath.Join(s.WebRoot, "index.html"))
}

func (s *Server) sessionUser(r *http.Request) (string, bool) {
	c, err := r.Cookie(sessionCookie)
	if err != nil || c.Value == "" || s.Store == nil {
		return "", false
	}
	id, err := s.Store.UserForSession(r.Context(), c.Value)
	if err != nil {
		return "", false
	}
	return id, true
}

func (s *Server) setSession(w http.ResponseWriter, r *http.Request, userID string) error {
	token, exp, err := s.Store.CreateSession(r.Context(), userID, 30*24*time.Hour)
	if err != nil {
		return err
	}
	secure := r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: token, Path: "/", HttpOnly: true,
		SameSite: http.SameSiteLaxMode, Secure: secure, Expires: exp,
	})
	return nil
}

func clearSession(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: "", Path: "/", HttpOnly: true,
		Expires: time.Unix(0, 0), MaxAge: -1, SameSite: http.SameSiteLaxMode,
	})
}
