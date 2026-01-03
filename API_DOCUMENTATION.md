# Plan My Day - External API Documentation

## Task Import API

Import tasks into Plan My Day using API key authentication. This endpoint supports both single task and batch imports.

---

## Endpoint

**POST** `/api/tasks/import`

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

**API Key Format**: All keys start with `pmy_` followed by 32 random characters.

---

## Request Format

### Single Task Import

Send a JSON object directly in the request body.

### Batch Import

Send a JSON object with a `tasks` array containing multiple task objects.

---

## Request Body Schema

### Single Task Request

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

### Batch Request

```json
{
  "tasks": [
    {
      "title": "string (required)",
      "task_type": "string (optional)",
      // ... other fields
    },
    // ... more tasks
  ]
}
```

---

## Field Descriptions

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `title` | string | ✅ Yes | - | Task title/name |
| `task_type` | string | No | `"task"` | Must be: `"task"`, `"event"`, or `"todo"` (case-insensitive) |
| `group` | string | No | `null` | Task group name (will be created if it doesn't exist) |
| `description` | string | No | `null` | Task description/notes |
| `duration` | number | No | `30` for tasks/todos, `null` for events | Estimated duration in minutes |
| `due_date` | string | No | `null` | Due date/time (see formats below) |
| `priority` | number | No | `3` | Priority level (1 = most urgent, 5 = least urgent) |
| `energy_level_required` | number | No | `3` | Energy level needed (1 = low energy, 5 = high energy) |

---

## Due Date Formats

The API supports multiple date formats. If no time is specified, it defaults to **5:00 PM** in your user's timezone.

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

---

## Response Format

### Single Task Success Response (200)

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
    "updated_at": "ISO datetime string",
    // ... other fields
  }
}
```

### Batch Success Response (200)

```json
{
  "success": true,
  "created": [
    {
      "id": "string",
      "title": "string",
      // ... full task object
    }
    // ... more successfully created tasks
  ],
  "failed": [
    {
      "task": {
        "title": "string",
        // ... original task data
      },
      "error": "Error message string"
    }
    // ... tasks that failed to create
  ]
}
```

### Error Responses

**401 Unauthorized**:
```json
{
  "error": "Invalid or missing API key"
}
```

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

---

## Example Requests

### Example 1: Single Task (cURL)

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

### Example 2: Batch Import (cURL)

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

### Example 3: JavaScript/Fetch

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

// Single task
const result = await importTask('pmy_your-api-key-here', {
  title: 'Complete documentation',
  task_type: 'task',
  duration: 120,
  due_date: '2024-12-25',
  priority: 2,
});

// Batch import
const batchResult = await importTask('pmy_your-api-key-here', {
  tasks: [
    { title: 'Task 1', task_type: 'task' },
    { title: 'Task 2', task_type: 'todo' },
  ],
});
```

### Example 4: Python

```python
import requests

API_KEY = "pmy_your-api-key-here"
BASE_URL = "https://your-app.com"

# Single task
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

result = response.json()
print(result)

# Batch import
batch_response = requests.post(
    f"{BASE_URL}/api/tasks/import",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    },
    json={
        "tasks": [
            {"title": "Task 1", "task_type": "task"},
            {"title": "Task 2", "task_type": "todo"},
        ]
    }
)

batch_result = batch_response.json()
print(f"Created: {len(batch_result['created'])}")
print(f"Failed: {len(batch_result['failed'])}")
```

---

## Validation Rules

1. **Title**: Required, cannot be empty
2. **Task Type**: Must be one of: `"task"`, `"event"`, `"todo"` (case-insensitive)
3. **Priority**: Must be between 1 and 5 (inclusive)
4. **Energy Level**: Must be between 1 and 5 (inclusive)
5. **Due Date**: Must be in a valid format (see formats above)
6. **Duration**: Must be a positive number (in minutes)

---

## Special Behaviors

1. **Group Creation**: If a `group` name is provided that doesn't exist, it will be automatically created with a default blue color.

2. **Default Duration**: 
   - Tasks and todos default to 30 minutes if not specified
   - Events default to `null` (no duration) if not specified

3. **Task Status**: All imported tasks are created with status `"pending"`

4. **Timezone Handling**: Due dates are interpreted in the user's configured timezone. If no timezone is set, UTC is used.

---

## Error Handling

When importing batches, some tasks may succeed while others fail. The batch response includes both `created` and `failed` arrays so you can handle partial successes appropriately.

**Common Errors**:
- Missing or invalid API key → 401 Unauthorized
- Missing `title` field → Validation error
- Invalid `task_type` → Validation error
- Invalid `priority` or `energy_level_required` range → Validation error
- Invalid `due_date` format → Validation error

---

## Rate Limiting

Check with your application administrator for rate limiting policies. It's recommended to:
- Batch multiple tasks when possible
- Add appropriate delays between requests if making many API calls
- Handle 429 (Too Many Requests) responses appropriately

---

## Support

For issues or questions, please contact your Plan My Day administrator or refer to the application's support documentation.

