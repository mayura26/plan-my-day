# Claude Code Guide for Plan My Day

## Project Overview

Plan My Day is a **full-stack Progressive Web App (PWA)** built with Next.js for task management and scheduling. It features an AI-powered scheduling system, offline-first architecture, and calendar-based task visualization.

**Core Purpose**: Help users manage tasks with intelligent scheduling based on priorities, energy levels, dependencies, and time constraints.

## Tech Stack

| Category | Technology |
|----------|------------|
| Framework | Next.js 16 (App Router) |
| UI | React 19, Tailwind CSS 4, Radix UI |
| Database | Turso (LibSQL/SQLite) |
| Auth | NextAuth 5 (Google, GitHub OAuth) |
| Offline | IndexedDB (idb), Custom Service Worker |
| Dates | date-fns |
| Linting | Biome |
| Icons | Lucide React |
| Drag & Drop | @dnd-kit |
| Notifications | web-push |

## Project Structure

```
plan-my-day/
├── app/                    # Next.js App Router
│   ├── api/                # 31 API routes (tasks, auth, push, etc.)
│   ├── calendar/           # Main calendar view page
│   ├── tasks/              # Tasks management page
│   ├── settings/           # User settings page
│   ├── auth/               # Authentication pages
│   ├── layout.tsx          # Root layout with providers
│   ├── page.tsx            # Landing page
│   └── globals.css         # Global styles & CSS variables
├── components/             # React components
│   └── ui/                 # Radix UI-based reusable components
├── contexts/               # React Context providers
├── hooks/                  # Custom React hooks
├── lib/                    # Utilities and services
│   ├── auth.ts             # NextAuth configuration
│   ├── turso.ts            # Database client
│   ├── types.ts            # TypeScript interfaces (~294 lines)
│   ├── scheduler-utils.ts  # Task scheduling algorithm
│   ├── timezone-utils.ts   # Timezone handling
│   ├── task-utils.ts       # Task helpers
│   ├── offline-storage.ts  # IndexedDB operations
│   └── sync-manager.ts     # Offline sync queue
├── public/
│   ├── sw.js               # Service worker (manual)
│   └── manifest.json       # PWA manifest
└── scripts/                # DB migrations & utilities
```

## Key Files to Know

| File | Purpose |
|------|---------|
| [lib/types.ts](lib/types.ts) | All TypeScript interfaces (Task, User, TaskGroup, etc.) |
| [lib/scheduler-utils.ts](lib/scheduler-utils.ts) | Core scheduling algorithm |
| [lib/auth.ts](lib/auth.ts) | NextAuth config with OAuth callbacks |
| [lib/turso.ts](lib/turso.ts) | Database client initialization |
| [lib/timezone-utils.ts](lib/timezone-utils.ts) | Timezone conversion utilities |
| [lib/task-utils.ts](lib/task-utils.ts) | Task validation, sorting, helpers |
| [app/layout.tsx](app/layout.tsx) | Root layout with provider tree |
| [components/providers.tsx](components/providers.tsx) | Provider composition |
| [contexts/user-timezone-context.tsx](contexts/user-timezone-context.tsx) | Timezone state management |

## Architecture Patterns

### 1. Server/Client Component Split
- Server components by default
- Add `"use client"` only for interactive features
- API routes handle backend operations

### 2. Data Flow
```
Server Components → fetch data → pass as props → Client Components
Client Components → API routes → Turso DB
Offline → IndexedDB → Sync Queue → API routes (when online)
```

### 3. State Management
- **UserTimezoneProvider**: Centralized timezone management
- **SessionProvider**: NextAuth authentication state
- **ThemeProvider**: Dark mode (next-themes)
- **ConfirmDialogProvider**: Confirmation dialogs

### 4. API Response Pattern
```typescript
// Success
return NextResponse.json({ task }, { status: 200 });

// Error
return NextResponse.json({ error: "Message" }, { status: 400 });
```

### 5. Database Query Pattern
```typescript
const result = await turso.execute({
  sql: "SELECT * FROM tasks WHERE user_id = ?",
  args: [userId]
});
const tasks = result.rows.map(mapRowToTask);
```

## Coding Conventions

### Naming
- **Components**: PascalCase (`TaskCard.tsx`)
- **Files**: kebab-case (`task-utils.ts`)
- **Functions**: camelCase (`scheduleTask()`)
- **Constants**: UPPER_SNAKE_CASE (`PRIORITY_LABELS`)
- **Types/Interfaces**: PascalCase (`Task`, `TaskGroup`)

### TypeScript
- Strict mode enabled
- Use interfaces for object shapes
- Define props interfaces for components
- Type all function parameters and returns

### Styling
- Tailwind CSS utility classes
- Use `cn()` from [lib/utils.ts](lib/utils.ts) for conditional classes
- Dark mode via `dark:` prefix
- CSS variables in [globals.css](app/globals.css)

### Component Structure
```typescript
"use client"; // if needed

import { ... } from "...";

interface ComponentProps {
  // props
}

export function Component({ prop }: ComponentProps) {
  // hooks
  // handlers
  // render
}
```

## Key Domain Concepts

### Task Types
- `task`: Standard schedulable task
- `event`: Fixed-time occurrence (auto-completes)
- `todo`: Quick action item
- `subtask`: Child of another task (one level deep)

### Task Fields
- `priority`: 1-5 (1 = highest)
- `energy_level`: 1-5 (energy required)
- `duration_minutes`: Estimated time
- `scheduled_date` / `scheduled_time`: When scheduled
- `due_date` / `due_time`: Deadline
- `is_locked`: Prevents auto-scheduling changes
- `completed_at`: Completion timestamp

### Scheduling Modes
- `schedule-now`: Schedule immediately
- `schedule-today`: Fit in today's schedule
- `schedule-next-week`: Schedule for next week
- `schedule-next-month`: Schedule for next month
- `schedule-asap`: Find earliest available slot

## Common Development Tasks

### Adding a New API Route
1. Create file in `app/api/[endpoint]/route.ts`
2. Export async functions: `GET`, `POST`, `PUT`, `DELETE`, `PATCH`
3. Get session with `await auth()`
4. Use `turso.execute()` for DB queries
5. Return `NextResponse.json()`

### Adding a New Component
1. Create in `components/` (or `components/ui/` for primitives)
2. Use `"use client"` if interactive
3. Define props interface
4. Use `cn()` for conditional Tailwind classes
5. Import from Radix UI for accessible primitives

### Database Migrations
1. Add SQL to `scripts/` directory
2. Add npm script in `package.json`
3. Run with `npm run db:migrate:[name]`

### Modifying Task Types
1. Update interface in [lib/types.ts](lib/types.ts)
2. Update `mapRowToTask()` in relevant API routes
3. Update any affected components
4. Consider offline storage schema ([lib/offline-storage.ts](lib/offline-storage.ts))

## Important Utilities

### `cn()` - Class Name Utility
```typescript
import { cn } from "@/lib/utils";
cn("base-class", condition && "conditional-class", className);
```

### `mapRowToTask()` - DB Row to Task
Converts raw database rows to typed `Task` objects. Used in API routes.

### Timezone Functions
```typescript
import {
  formatInTimezone,
  convertToTimezone,
  getTimezoneOffset
} from "@/lib/timezone-utils";
```

### Task Utilities
```typescript
import {
  validateTask,
  sortTasksByPriority,
  isTaskOverdue
} from "@/lib/task-utils";
```

## Environment Variables Required

```env
# Database
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=

# Auth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
NEXTAUTH_SECRET=

# Push Notifications (optional)
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
```

## Development Commands

```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run lint         # Check with Biome
npm run lint:fix     # Fix lint issues
npm run format       # Format code
npm run db:init      # Initialize database
```

## Gotchas & Tips

1. **Timezone Handling**: Always use timezone utilities. Never use raw `Date` comparisons - use `date-fns` with timezone context.

2. **Offline Support**: Changes must be reflected in both API routes AND [offline-storage.ts](lib/offline-storage.ts) / [sync-manager.ts](lib/sync-manager.ts).

3. **Service Worker**: Manually managed in [public/sw.js](public/sw.js). Disabled in development mode.

4. **Subtasks**: Only one level deep. Subtasks cannot have their own subtasks.

5. **Task Dependencies**: Stored in separate `task_dependencies` table. A task can depend on multiple other tasks.

6. **Task Locking**: `is_locked` prevents auto-scheduling from moving a task. Respect this in scheduling algorithms.

7. **Auto-complete Events**: Events auto-complete when their scheduled time passes. Check [scheduler-utils.ts](lib/scheduler-utils.ts).

8. **Auth Required**: Most API routes require authentication. Check session at route start:
   ```typescript
   const session = await auth();
   if (!session?.user?.id) {
     return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
   }
   ```

## Related Documentation

- [API_DOCUMENTATION.md](API_DOCUMENTATION.md) - External API for task import
- [DEVELOPMENT_TRACKER.md](DEVELOPMENT_TRACKER.md) - Feature roadmap and progress
