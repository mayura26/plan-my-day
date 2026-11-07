package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"planmyday/server/internal/schedule"
	"planmyday/server/internal/store"
)

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func readJSON(r *http.Request, dest any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(dest)
}

func readJSONLoose(r *http.Request, dest any) error {
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(dest)
}

func (s *Server) requireUser(w http.ResponseWriter, r *http.Request) (string, bool) {
	if id, ok := s.sessionUser(r); ok {
		return id, true
	}
	writeError(w, http.StatusUnauthorized, "Unauthorized")
	return "", false
}

func (s *Server) requireUserOrKey(w http.ResponseWriter, r *http.Request) (string, bool) {
	if id, ok := s.sessionUser(r); ok {
		return id, true
	}
	if id, ok := s.apiKeyUser(r); ok {
		return id, true
	}
	writeError(w, http.StatusUnauthorized, "Unauthorized")
	return "", false
}

func (s *Server) requireKey(w http.ResponseWriter, r *http.Request) (string, bool) {
	if id, ok := s.apiKeyUser(r); ok {
		return id, true
	}
	writeError(w, http.StatusUnauthorized, "Invalid or missing API key")
	return "", false
}

func (s *Server) apiKeyUser(r *http.Request) (string, bool) {
	h := strings.TrimSpace(r.Header.Get("Authorization"))
	if h == "" {
		return "", false
	}
	if strings.HasPrefix(strings.ToLower(h), "bearer ") {
		h = strings.TrimSpace(h[7:])
	}
	if !strings.HasPrefix(h, "pmy_") {
		return "", false
	}
	id, err := s.Store.UserForAPIKey(r.Context(), h)
	if err != nil {
		return "", false
	}
	return id, true
}

func mapStoreError(w http.ResponseWriter, err error) {
	if err == nil {
		return
	}
	var fail *schedule.Failure
	if errors.As(err, &fail) {
		switch fail.Code {
		case "no_slot":
			writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": fail.Msg, "allowed": schedule.Modes})
		case "blocked", "locked_subtask":
			writeError(w, http.StatusConflict, fail.Msg)
		case "needs_due", "no_duration", "bad_mode", "bad_request":
			extra := map[string]any{"error": fail.Msg}
			if fail.Code == "bad_mode" {
				extra["allowed"] = schedule.Modes
			}
			writeJSON(w, http.StatusBadRequest, extra)
		default:
			writeError(w, http.StatusBadRequest, fail.Msg)
		}
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "Not found")
		return
	}
	writeError(w, http.StatusBadRequest, err.Error())
}
