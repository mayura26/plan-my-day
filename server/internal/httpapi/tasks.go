package httpapi

import (
	"encoding/json"
	"net/http"
	"time"

	"planmyday/server/internal/schedule"
	"planmyday/server/internal/store"
)

func (s *Server) listTasks(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	tasks, err := s.Store.ListTasks(r.Context(), id)
	if err != nil {
		mapStoreError(w, err)
		return
	}
	if tasks == nil {
		tasks = []store.Task{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"tasks": tasks})
}

func (s *Server) getTask(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	task, err := s.Store.GetTask(r.Context(), id, r.PathValue("id"))
	if err != nil {
		mapStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"task": task})
}

func (s *Server) createTask(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var body struct {
		Title          string  `json:"title"`
		Description    *string `json:"description"`
		Priority       int     `json:"priority"`
		Duration       *int    `json:"duration"`
		DueDate        *string `json:"due_date"`
		GroupID        *string `json:"group_id"`
		TaskType       string  `json:"task_type"`
		Energy         int     `json:"energy_level_required"`
		ScheduleMode   string  `json:"schedule_mode"`
		ScheduledStart *string `json:"scheduled_start"`
		ScheduledEnd   *string `json:"scheduled_end"`
		Locked         bool    `json:"locked"`
	}
	if err := readJSONLoose(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	task, err := s.Store.InsertTask(r.Context(), s.Store.DB, id, store.TaskInput{
		Title: body.Title, Description: body.Description, Priority: body.Priority, Duration: body.Duration,
		DueDate: body.DueDate, GroupID: body.GroupID, TaskType: body.TaskType, Energy: body.Energy,
		Locked: body.Locked, Start: body.ScheduledStart, End: body.ScheduledEnd,
	})
	if err != nil {
		mapStoreError(w, err)
		return
	}
	mode := body.ScheduleMode
	if mode == "" && body.ScheduledStart == nil {
		if user, err := s.Store.GetUser(r.Context(), id); err == nil && user.AutoScheduleNewTasks && schedule.ValidMode(user.DefaultScheduleMode) {
			mode = user.DefaultScheduleMode
		}
	}
	if mode != "" {
		placed, changes, err := s.Store.PlaceTask(r.Context(), id, task.ID, mode, time.Now())
		if err != nil {
			_ = s.Store.DeleteTask(r.Context(), id, task.ID)
			mapStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"task": placed, "changes": changes})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"task": task})
}

func (s *Server) updateTask(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var patch map[string]json.RawMessage
	if err := readJSONLoose(r, &patch); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	task, err := s.Store.UpdateTask(r.Context(), id, r.PathValue("id"), patch)
	if err != nil {
		mapStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"task": task})
}

func (s *Server) deleteTask(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if err := s.Store.DeleteTask(r.Context(), id, r.PathValue("id")); err != nil {
		mapStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) scheduleTask(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUserOrKey(w, r)
	if !ok {
		return
	}
	var body struct {
		Mode string `json:"mode"`
	}
	if err := readJSONLoose(r, &body); err != nil || !schedule.ValidMode(body.Mode) {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Invalid or missing mode", "allowed": schedule.Modes})
		return
	}
	task, changes, err := s.Store.PlaceTask(r.Context(), id, r.PathValue("id"), body.Mode, time.Now())
	if err != nil {
		mapStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "mode": body.Mode, "task": task, "changes": changes, "feedback": []any{}})
}

func (s *Server) completeTask(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUserOrKey(w, r)
	if !ok {
		return
	}
	task, err := s.Store.CompleteTask(r.Context(), id, r.PathValue("id"))
	if err != nil {
		mapStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "task": task})
}

func (s *Server) shuffle(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	changes, err := s.Store.CompressToday(r.Context(), id, time.Now())
	if err != nil {
		mapStoreError(w, err)
		return
	}
	tasks, _ := s.Store.ListTasks(r.Context(), id)
	writeJSON(w, http.StatusOK, map[string]any{"changes": changes, "tasks": tasks})
}

func (s *Server) pullForward(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var body struct {
		GroupID string `json:"group_id"`
	}
	if err := readJSONLoose(r, &body); err != nil || body.GroupID == "" {
		writeError(w, http.StatusBadRequest, "group_id is required")
		return
	}
	changes, err := s.Store.FillGroup(r.Context(), id, body.GroupID, time.Now())
	if err != nil {
		mapStoreError(w, err)
		return
	}
	tasks, _ := s.Store.ListTasks(r.Context(), id)
	writeJSON(w, http.StatusOK, map[string]any{"changes": changes, "tasks": tasks})
}

func (s *Server) carryover(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var body struct {
		AutoSchedule bool `json:"auto_schedule"`
	}
	_ = readJSONLoose(r, &body)
	task, err := s.Store.Carryover(r.Context(), id, r.PathValue("id"), body.AutoSchedule, time.Now())
	if err != nil {
		mapStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"task": task})
}

func (s *Server) listSubtasks(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	parent := r.PathValue("id")
	tasks, err := s.Store.ListTasks(r.Context(), id)
	if err != nil {
		mapStoreError(w, err)
		return
	}
	var kids []store.Task
	for _, t := range tasks {
		if t.ParentTaskID != nil && *t.ParentTaskID == parent {
			kids = append(kids, t)
		}
	}
	if kids == nil {
		kids = []store.Task{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"subtasks": kids})
}

func (s *Server) addSubtask(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var body struct {
		Title    string `json:"title"`
		Duration *int   `json:"duration"`
	}
	if err := readJSONLoose(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	task, err := s.Store.AddSubtask(r.Context(), id, r.PathValue("id"), body.Title, body.Duration)
	if err != nil {
		mapStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"task": task})
}

func (s *Server) reorderSubtasks(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var body struct {
		IDs []string `json:"ids"`
	}
	if err := readJSONLoose(r, &body); err != nil || len(body.IDs) == 0 {
		writeError(w, http.StatusBadRequest, "ids are required")
		return
	}
	if err := s.Store.ReorderSubtasks(r.Context(), id, r.PathValue("id"), body.IDs); err != nil {
		mapStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) unscheduleSubtasks(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if err := s.Store.UnscheduleSubtasks(r.Context(), id, r.PathValue("id")); err != nil {
		mapStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) addDependency(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var body struct {
		DependsOn string `json:"depends_on_task_id"`
	}
	if err := readJSONLoose(r, &body); err != nil || body.DependsOn == "" {
		writeError(w, http.StatusBadRequest, "depends_on_task_id is required")
		return
	}
	if err := s.Store.AddDependency(r.Context(), id, r.PathValue("id"), body.DependsOn); err != nil {
		mapStoreError(w, err)
		return
	}
	task, _ := s.Store.GetTask(r.Context(), id, r.PathValue("id"))
	writeJSON(w, http.StatusOK, map[string]any{"task": task})
}

func (s *Server) removeDependency(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	dep := r.URL.Query().Get("depends_on_task_id")
	if dep == "" {
		writeError(w, http.StatusBadRequest, "depends_on_task_id is required")
		return
	}
	if err := s.Store.RemoveDependency(r.Context(), id, r.PathValue("id"), dep); err != nil {
		mapStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listTodos(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	todos, err := s.Store.ListTodos(r.Context(), id, r.PathValue("id"))
	if err != nil {
		mapStoreError(w, err)
		return
	}
	if todos == nil {
		todos = []store.Todo{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"todos": todos})
}

func (s *Server) addTodo(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var body struct {
		Description string `json:"description"`
	}
	if err := readJSONLoose(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	todo, err := s.Store.AddTodo(r.Context(), id, r.PathValue("id"), body.Description)
	if err != nil {
		mapStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"todo": todo})
}

func (s *Server) updateTodo(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var body struct {
		Description *string `json:"description"`
		Completed   *bool   `json:"completed"`
	}
	if err := readJSONLoose(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if err := s.Store.UpdateTodo(r.Context(), id, r.PathValue("id"), r.PathValue("todoId"), body.Description, body.Completed); err != nil {
		mapStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) deleteTodo(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if err := s.Store.DeleteTodo(r.Context(), id, r.PathValue("id"), r.PathValue("todoId")); err != nil {
		mapStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) overdue(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	tasks, err := s.Store.OverdueTasks(r.Context(), id, time.Now())
	if err != nil {
		mapStoreError(w, err)
		return
	}
	if tasks == nil {
		tasks = []store.Task{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"tasks": tasks})
}

func (s *Server) processOverdue(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var body struct {
		Actions []struct {
			ID     string `json:"id"`
			Action string `json:"action"`
			Mode   string `json:"mode"`
		} `json:"actions"`
	}
	if err := readJSONLoose(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	for _, action := range body.Actions {
		switch action.Action {
		case "ignore":
			raw, _ := json.Marshal(true)
			_, err := s.Store.UpdateTask(r.Context(), id, action.ID, map[string]json.RawMessage{"ignored": raw})
			if err != nil {
				mapStoreError(w, err)
				return
			}
		case "complete":
			if _, err := s.Store.CompleteTask(r.Context(), id, action.ID); err != nil {
				mapStoreError(w, err)
				return
			}
		case "schedule":
			mode := action.Mode
			if !schedule.ValidMode(mode) {
				mode = "now"
			}
			if _, _, err := s.Store.PlaceTask(r.Context(), id, action.ID, mode, time.Now()); err != nil {
				mapStoreError(w, err)
				return
			}
		default:
			writeError(w, http.StatusBadRequest, "action must be ignore, complete, or schedule")
			return
		}
	}
	tasks, _ := s.Store.ListTasks(r.Context(), id)
	writeJSON(w, http.StatusOK, map[string]any{"tasks": tasks})
}
