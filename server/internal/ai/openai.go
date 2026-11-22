package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"time"

	"planmyday/server/internal/store"
)

// GroupHint is a group the model may assign.
type GroupHint struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Message is one turn in the assistant conversation.
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

func resolveModel(choice string) string {
	if choice == "full" {
		return "gpt-5.4"
	}
	return "gpt-5.4-mini"
}

// ParseTask turns a sentence into one task object.
func ParseTask(ctx context.Context, apiKey, modelChoice, tz, text string, groups []GroupHint, subtasks bool, defaultGroup *string) (map[string]any, error) {
	if apiKey == "" {
		return nil, errors.New("AI parsing is not configured")
	}
	if len(text) > 500 {
		text = text[:500]
	}
	dateStr, offset := clock(tz)
	system := parsePrompt(groups, subtasks, defaultGroup)
	user := fmt.Sprintf("Current date/time in user's timezone: %s\nTimezone: %s (%s)\n\nParse this task description:\n\"%s\"", dateStr, tz, offset, text)
	var parsed map[string]any
	if err := complete(ctx, apiKey, resolveModel(modelChoice), "low", system, []Message{{Role: "user", Content: user}}, "quick_add_task", quickAddSchema, 2000, &parsed); err != nil {
		return nil, err
	}
	title, _ := parsed["title"].(string)
	if strings.TrimSpace(title) == "" {
		return nil, errors.New("could not extract a task title")
	}
	return parsed, nil
}

// Assist runs one conversational planning turn.
func Assist(ctx context.Context, apiKey, modelChoice, tz string, messages []Message, groups []GroupHint, tasks []store.Task, defaultGroup *string) (map[string]any, error) {
	if apiKey == "" {
		return nil, errors.New("AI assistant is not configured")
	}
	if len(messages) > 20 {
		messages = messages[len(messages)-20:]
	}
	if len(tasks) > 100 {
		tasks = tasks[:100]
	}
	dateStr, offset := clock(tz)
	system := assistPrompt(tz, dateStr, offset, groups, tasks, defaultGroup)
	var turn map[string]any
	if err := complete(ctx, apiKey, resolveModel(modelChoice), "low", system, messages, "assistant_turn", assistantSchema, 4000, &turn); err != nil {
		return nil, err
	}
	return turn, nil
}

// Transcribe sends audio to Whisper.
func Transcribe(ctx context.Context, apiKey, filename string, audio []byte) (string, error) {
	if apiKey == "" {
		return "", errors.New("AI transcription is not configured")
	}
	if filename == "" {
		filename = "audio.webm"
	}
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	_ = w.WriteField("model", "whisper-1")
	part, err := w.CreateFormFile("file", filename)
	if err != nil {
		return "", err
	}
	if _, err := part.Write(audio); err != nil {
		return "", err
	}
	_ = w.Close()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.openai.com/v1/audio/transcriptions", &buf)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", w.FormDataContentType())
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode >= 300 {
		return "", fmt.Errorf("transcription failed")
	}
	var out struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return "", err
	}
	return out.Text, nil
}

func complete(ctx context.Context, apiKey, model, effort, system string, messages []Message, schemaName string, schema json.RawMessage, maxTokens int, dest any) error {
	payload := map[string]any{
		"model":                 model,
		"reasoning_effort":      effort,
		"max_completion_tokens": maxTokens,
		"response_format": map[string]any{
			"type": "json_schema",
			"json_schema": map[string]any{
				"name": schemaName, "strict": true, "schema": json.RawMessage(schema),
			},
		},
	}
	msgs := []map[string]string{{"role": "system", "content": system}}
	for _, m := range messages {
		role := m.Role
		if role != "assistant" {
			role = "user"
		}
		msgs = append(msgs, map[string]string{"role": role, "content": m.Content})
	}
	payload["messages"] = msgs
	raw, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.openai.com/v1/chat/completions", bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode >= 300 {
		return errors.New("the model did not answer")
	}
	var wrapped struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(body, &wrapped); err != nil || len(wrapped.Choices) == 0 || wrapped.Choices[0].Message.Content == "" {
		return errors.New("empty response from AI")
	}
	return json.Unmarshal([]byte(wrapped.Choices[0].Message.Content), dest)
}

func clock(tz string) (string, string) {
	loc, err := time.LoadLocation(tz)
	if err != nil {
		loc = time.UTC
		tz = "UTC"
	}
	now := time.Now().In(loc)
	_, offset := now.Zone()
	hours := offset / 3600
	sign := "+"
	if hours < 0 {
		sign = ""
	}
	return now.Format("Monday, 2006-01-02 15:04"), fmt.Sprintf("UTC%s%d", sign, hours)
}

func parsePrompt(groups []GroupHint, subtasks bool, defaultGroup *string) string {
	groupSection := `- "group_id": null (no groups available)`
	if len(groups) > 0 {
		var lines []string
		for _, g := range groups {
			lines = append(lines, fmt.Sprintf(`  - %s (%s)`, g.Name, g.ID))
		}
		hint := "otherwise null"
		if defaultGroup != nil {
			hint = "otherwise the preferred group " + *defaultGroup
		}
		groupSection = "- \"group_id\": pick the best matching group id, " + hint + ".\n" + strings.Join(lines, "\n")
	}
	sub := `- "subtasks": []`
	if subtasks {
		sub = `- "subtasks": break the task into 2-5 concrete steps with title and duration minutes.`
	}
	return `You are a task parsing assistant for an app called "Plan My Day". Extract one structured task from a natural language description.

Field rules (every field must be present; use null where a value is genuinely unknown):
- "title": REQUIRED, never null.
- "task_type": "event" for fixed-time meetings, "todo" for quick items under 30 minutes, "task" otherwise.
- "priority": 1=critical, 2=high, 3=normal, 4=low, 5=minimal.
- "energy_level_required": 1=low through 5=deep work. 3 is the default.
- "duration" in minutes. Estimate when it is not stated. Null only if truly unknowable.
- "scheduled_start" and "scheduled_end": local "YYYY-MM-DDTHH:MM" only when the user named a time. Never invent one.
- "due_date": local "YYYY-MM-DDTHH:MM" when a deadline is mentioned, else null.
- Times stay in the user's local timezone. Do not convert to UTC.
` + groupSection + "\n" + sub
}

func assistPrompt(tz, dateStr, offset string, groups []GroupHint, tasks []store.Task, defaultGroup *string) string {
	groupSection := "No groups."
	if len(groups) > 0 {
		var lines []string
		for _, g := range groups {
			lines = append(lines, g.Name+" ("+g.ID+")")
		}
		groupSection = "Groups: " + strings.Join(lines, ", ")
		if defaultGroup != nil {
			groupSection += ". Preferred default group: " + *defaultGroup
		}
	}
	taskSection := "No existing tasks provided."
	if len(tasks) > 0 {
		var lines []string
		for _, t := range tasks {
			when := "unscheduled"
			if t.ScheduledStart != nil {
				when = *t.ScheduledStart
			}
			lines = append(lines, fmt.Sprintf("- %s | %s | %s | %s", t.ID, t.Title, t.Status, when))
		}
		taskSection = "User's existing tasks:\n" + strings.Join(lines, "\n")
	}
	return fmt.Sprintf(`You are an AI assistant embedded in a task management app called "Plan My Day".
The user describes work to capture, or asks you to change the schedule they already have.

Current date/time in the user's timezone: %s
Timezone: %s (%s)

%s

%s

Fill proposed actions with action "create" or "update", the existing id for updates, a title, task_type, priority, energy_level_required, duration, local scheduled_start, scheduled_end, due_date, group_id, and subtasks.
Ask one focused question and return no actions when the request is ambiguous.
Do not invent a clock time the user did not imply.
Do not ask whether an unscheduled task should be scheduled. Confirm briefly what you proposed.
Be concise.`, dateStr, tz, offset, groupSection, taskSection)
}

var quickAddSchema = json.RawMessage(`{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "title": {"type": "string"},
    "description": {"type": ["string", "null"]},
    "task_type": {"type": "string", "enum": ["task", "event", "todo"]},
    "priority": {"type": "integer", "enum": [1, 2, 3, 4, 5]},
    "duration": {"type": ["integer", "null"]},
    "energy_level_required": {"type": "integer", "enum": [1, 2, 3, 4, 5]},
    "scheduled_start": {"type": ["string", "null"]},
    "scheduled_end": {"type": ["string", "null"]},
    "due_date": {"type": ["string", "null"]},
    "group_id": {"type": ["string", "null"]},
    "subtasks": {"type": "array", "items": {"type": "object", "additionalProperties": false, "properties": {"title": {"type": "string"}, "duration": {"type": ["integer", "null"]}}, "required": ["title", "duration"]}}
  },
  "required": ["title", "description", "task_type", "priority", "duration", "energy_level_required", "scheduled_start", "scheduled_end", "due_date", "group_id", "subtasks"]
}`)

var assistantSchema = json.RawMessage(`{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "message": {"type": "string"},
    "needs_clarification": {"type": "boolean"},
    "proposed_actions": {"type": "array", "items": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "action": {"type": "string", "enum": ["create", "update"]},
        "id": {"type": ["string", "null"]},
        "title": {"type": "string"},
        "description": {"type": ["string", "null"]},
        "task_type": {"type": "string", "enum": ["task", "event", "todo"]},
        "priority": {"type": "integer", "enum": [1, 2, 3, 4, 5]},
        "duration": {"type": ["integer", "null"]},
        "energy_level_required": {"type": "integer", "enum": [1, 2, 3, 4, 5]},
        "scheduled_start": {"type": ["string", "null"]},
        "scheduled_end": {"type": ["string", "null"]},
        "due_date": {"type": ["string", "null"]},
        "group_id": {"type": ["string", "null"]},
        "subtasks": {"type": "array", "items": {"type": "object", "additionalProperties": false, "properties": {"title": {"type": "string"}, "duration": {"type": ["integer", "null"]}}, "required": ["title", "duration"]}}
      },
      "required": ["action", "id", "title", "description", "task_type", "priority", "duration", "energy_level_required", "scheduled_start", "scheduled_end", "due_date", "group_id", "subtasks"]
    }}
  },
  "required": ["message", "needs_clarification", "proposed_actions"]
}`)
