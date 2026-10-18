# Plan My Day - External API Documentation

Token-based API for external apps. Authenticate with an API key to import tasks, poll a day-grouped agenda, complete tasks, and reschedule with the same modes as the in-app scheduler.

**Base URL**: Your Plan My Day application URL (e.g., `https://your-app.com`)

---

## Authentication

All requests must include a valid API key in the `Authorization` header.

**Format**:
```
Authorization: Bearer pmy_<your-api-key>
```
or
```
Authorization: pmy_<your-api-key>
```

**Getting an API Key**:
1. Log into your Plan My Day account
2. Navigate to API Keys section in settings
3. Create a new API key
4. **Important**: Copy the key immediately - it will only be shown once!

**API Key Format**: All keys start with `pmy_` followed by random characters.

**401 Unauthorized**:
```json
{
  "error": "Invalid or missing API key"
}
```

---

## Endpoints Overview

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/tasks/import` | Create one or many tasks |
| `GET` | `/api/tasks/agenda` | Day-grouped scheduled items for a date range |
| `POST` | `/api/tasks/{id}/complete` | Mark a task completed |
| `POST` | `/api/tasks/{id}/schedule` | Reschedule a task with a scheduling mode |

---

## Agenda API

**GET** `/api/tasks/agenda`

Returns all **scheduled** items owned by the API key user for an inclusive date range, grouped by day in the user's timezone. Quiet days are included with an empty `items` array so pollers can iterate the range without gaps.

Unscheduled tasks are omitted. Cancelled tasks are omitted. Pending, in-progress, and completed scheduled items are included.

### Query Parameters

| Param | Required | Description |
|-------|----------|-------------|
| `start` | Yes | Start date `YYYY-MM-DD` (inclusive) |
| `end` | Yes | End date `YYYY-MM-DD` (inclusive) |

**Limits**: `end` must be on or after `start`. Maximum range is **31 days**.

### Success Response (200)

```json
{
  "timezone": "Australia/Sydney",
  "start": "2026-05-01",
  "end": "2026-05-07",
  "days": [
    {
      "date": "2026-05-01",
      "items": [
        {
          "id": "task_…",
          "title": "Standup",
          "task_type": "event",
          "status": "pending",
          "priority": 3,
          "duration": 30,
          "scheduled_start": "2026-04-30T23:00:00.000Z",
          "scheduled_end": "2026-04-30T23:30:00.000Z",
          "due_date": null,
          "group_id": "group_…",
          "parent_task_id": null,
          "energy_level_required": 3,
          "locked": false
        }
      ]
    },
    {
      "date": "2026-05-02",
      "items": []
    }
  ]
}
```

Items within each day are sorted by `scheduled_start`.

### Example (cURL)

```bash
curl "https://your-app.com/api/tasks/agenda?start=2026-05-01&end=2026-05-07" \
  -H "Authorization: Bearer pmy_your-api-key-here"
```

### Common Errors

- Missing/invalid `start` or `end` → 400
- Range longer than 31 days → 400
- Invalid or missing API key → 401

---

## Complete Task API

**POST** `/api/tasks/{id}/complete`

Marks the task as completed. Idempotent if already completed.

Side effects match the in-app complete action:
- Completing a parent completes its subtasks
- Completing the last subtask may complete the parent
- Completing a carryover task completes the original

### Success Response (200)

```json
{
  "success": true,
  "task": {
    "id": "task_…",
    "status": "completed",
    "title": "…",
    "updated_at": "…"
  }
}
```

### Example (cURL)

```bash
curl -X POST https://your-app.com/api/tasks/task_abc123/complete \
  -H "Authorization: Bearer pmy_your-api-key-here"
```

### Common Errors

- Invalid or missing API key → 401
- Task not found / not owned → 404

---

## Schedule / Reschedule API

**POST** `/api/tasks/{id}/schedule`

Reschedules a task using the same scheduling engine and modes as the app UI.

### Request Body

```json
{
  "mode": "today"
}
```

### Allowed Modes

| Mode | Behavior |
|------|----------|
| `now` | Earliest available slot from now |
| `today` | Fit into today |
| `tomorrow` | Fit into tomorrow |
| `next-week` | From next Monday onward |
| `this-weekend` | Upcoming Saturday/Sunday |
| `next-weekend` | Following weekend |
| `next-month` | From the start of next month |
| `asap` | Earliest slot; may shuffle other tasks |
| `due-date` | Work backward from the task's due date (requires `due_date`) |
| `smart` | Smart placement relative to due date (requires `due_date`) |

### Success Response (200)

```json
{
  "success": true,
  "mode": "today",
  "task": {
    "id": "task_…",
    "scheduled_start": "…",
    "scheduled_end": "…",
    "status": "pending"
  },
  "feedback": []
}
```

If the task has subtasks, subtasks are scheduled in order and the parent is left unscheduled (same as the app). The response still returns the parent as `task`.

### Example (cURL)

```bash
curl -X POST https://your-app.com/api/tasks/task_abc123/schedule \
  -H "Authorization: Bearer pmy_your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{"mode": "asap"}'
```

### Common Errors

- Invalid or missing `mode` → 400 (response includes `allowed` list)
- Task has no duration → 400
- `smart` / `due-date` without `due_date` → 400
- No available slot → 422
- Task not found → 404
- Invalid or missing API key → 401

---

## Task Import API

**POST** `/api/tasks/import`

Import tasks into Plan My Day. Supports both single task and batch imports.

### Request Format

#### Single Task Import

Send a JSON object directly in the request body.

#### Batch Import

Send a JSON object with a `tasks` array containing multiple task objects.

### Request Body Schema

#### Single Task Request

```json
{
  "title": "string (required)",
  "task_type": "string (optional, default: 'task')",
  "group": "string (optional)",
  "description": "string (optional)",
  "duration": "number (optional, in minutes)",
  "due_date": "string (optional)",
  "priority": "number (optional, 1-5, default: 3)",
  "energy_level_required": "number (optional, 1-5, default: 3)"
}
```

#### Batch Request

```json
{
  "tasks": [
    {
      "title": "string (required)",
      "task_type": "string (optional)"
    }
  ]
}
```

### Field Descriptions

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `title` | string | Yes | - | Task title/name |
| `task_type` | string | No | `"task"` | Must be: `"task"`, `"event"`, or `"todo"` (case-insensitive) |
| `group` | string | No | `null` | Task group name (created if it does not exist) |
| `description` | string | No | `null` | Task description/notes |
| `duration` | number | No | `30` for tasks/todos, `null` for events | Estimated duration in minutes |
| `due_date` | string | No | `null` | Due date/time (see formats below) |
| `priority` | number | No | `3` | Priority level (1 = most urgent, 5 = least urgent) |
| `energy_level_required` | number | No | `3` | Energy level needed (1 = low energy, 5 = high energy) |

### Due Date Formats

If no time is specified, defaults to **5:00 PM** in the user's timezone.

**Supported Formats**:
- `YYYY-MM-DD` (e.g., `2024-12-25`)
- `YYYY-MM-DDTHH:mm` (e.g., `2024-12-25T14:30`)
- `MM/DD/YYYY` (e.g., `12/25/2024`)
- `YYYY/MM/DD` (e.g., `2024/12/25`)
- Standard JavaScript Date formats

**Examples**:
- `"2024-12-25"` → December 25, 2024 at 5:00 PM (user's timezone)
- `"2024-12-25T14:30"` → December 25, 2024 at 2:30 PM
- `"12/25/2024"` → December 25, 2024 at 5:00 PM (user's timezone)

### Response Format

#### Single Task Success Response (200)

```json
{
  "success": true,
  "task": {
    "id": "string",
    "user_id": "string",
    "title": "string",
    "description": "string | null",
    "priority": 3,
    "status": "pending",
    "duration": 30,
    "due_date": "string | null",
    "task_type": "task",
    "energy_level_required": 3,
    "group_id": "string | null",
    "created_at": "ISO datetime string",
    "updated_at": "ISO datetime string"
  }
}
```

#### Batch Success Response (200)

```json
{
  "success": true,
  "created": [
    {
      "id": "string",
      "title": "string"
    }
  ],
  "failed": [
    {
      "task": {
        "title": "string"
      },
      "error": "Error message string"
    }
  ]
}
```

#### Error Responses

**400 Bad Request** (single task):
```json
{
  "success": false,
  "error": "Error message"
}
```

**500 Internal Server Error**:
```json
{
  "error": "Internal server error",
  "message": "Detailed error message"
}
```

### Example Requests

#### Single Task (cURL)

```bash
curl -X POST https://your-app.com/api/tasks/import \
  -H "Authorization: Bearer pmy_your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Review project proposal",
    "task_type": "task",
    "description": "Need to review the Q4 proposal document",
    "duration": 60,
    "due_date": "2024-12-20",
    "priority": 2,
    "energy_level_required": 4,
    "group": "Work"
  }'
```

#### Batch Import (cURL)

```bash
curl -X POST https://your-app.com/api/tasks/import \
  -H "Authorization: Bearer pmy_your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      {
        "title": "Buy groceries",
        "task_type": "todo",
        "due_date": "2024-12-18",
        "priority": 3
      },
      {
        "title": "Team meeting",
        "task_type": "event",
        "duration": 60,
        "due_date": "2024-12-19T10:00",
        "group": "Work",
        "priority": 1
      },
      {
        "title": "Read book chapter",
        "task_type": "task",
        "duration": 45,
        "priority": 4,
        "energy_level_required": 2
      }
    ]
  }'
```

#### JavaScript / Fetch

```javascript
async function importTask(apiKey, taskData) {
  const response = await fetch('https://your-app.com/api/tasks/import', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(taskData),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to import task');
  }

  return await response.json();
}

const result = await importTask('pmy_your-api-key-here', {
  title: 'Complete documentation',
  task_type: 'task',
  duration: 120,
  due_date: '2024-12-25',
  priority: 2,
});
```

#### Python

```python
import requests

API_KEY = "pmy_your-api-key-here"
BASE_URL = "https://your-app.com"

response = requests.post(
    f"{BASE_URL}/api/tasks/import",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    },
    json={
        "title": "Finish report",
        "task_type": "task",
        "duration": 90,
        "due_date": "2024-12-20T17:00",
        "priority": 2,
        "group": "Work"
    }
)

print(response.json())
```

### Validation Rules

1. **Title**: Required, cannot be empty
2. **Task Type**: Must be one of: `"task"`, `"event"`, `"todo"` (case-insensitive)
3. **Priority**: Must be between 1 and 5 (inclusive)
4. **Energy Level**: Must be between 1 and 5 (inclusive)
5. **Due Date**: Must be in a valid format (see formats above)
6. **Duration**: Must be a positive number (in minutes)

### Special Behaviors

1. **Group Creation**: If a `group` name is provided that does not exist, it is created with a default blue color.
2. **Default Duration**: Tasks and todos default to 30 minutes; events default to `null`.
3. **Task Status**: Imported tasks are created with status `"pending"`.
4. **Timezone Handling**: Due dates are interpreted in the user's configured timezone (UTC if unset).

When importing batches, some tasks may succeed while others fail. The batch response includes both `created` and `failed` arrays.

---

## Rate Limiting

Check with your application administrator for rate limiting policies. It is recommended to:
- Batch multiple tasks when possible
- Add appropriate delays between requests if making many API calls
- Handle 429 (Too Many Requests) responses appropriately

---

## Support

For issues or questions, contact your Plan My Day administrator or refer to the application's support documentation.
