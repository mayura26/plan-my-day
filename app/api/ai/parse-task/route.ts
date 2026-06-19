import { NextResponse } from "next/server";
import {
  buildCurrentDateContext,
  getOpenAIClient,
  QUICK_ADD_SCHEMA,
  resolveModel,
  runStructuredCompletion,
} from "@/lib/ai";
import { auth } from "@/lib/auth";
import { db } from "@/lib/turso";

/** Convert a UTC ISO string to datetime-local format in the given IANA timezone. */
function utcToDateTimeLocal(isoString: string | null | undefined, tz: string): string | undefined {
  if (!isoString) return undefined;
  try {
    const date = new Date(isoString);
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const p = (type: string) => parts.find((x) => x.type === type)?.value ?? "00";
    return `${p("year")}-${p("month")}-${p("day")}T${p("hour")}:${p("minute")}`;
  } catch {
    return undefined;
  }
}

function buildSystemPrompt(
  groups: { id: string; name: string }[],
  generateSubtasks: boolean,
  defaultGroup?: { id: string; name: string } | null
): string {
  let groupSection: string;
  if (groups.length > 0) {
    const defaultHint = defaultGroup
      ? `If you cannot confidently match a group, use the user's preferred default: id: "${defaultGroup.id}", name: "${defaultGroup.name}".`
      : `If you cannot confidently match a group, return null.`;
    groupSection = `Available task groups:
${groups.map((g) => `- id: "${g.id}", name: "${g.name}"`).join("\n")}
- "group_id": assign the best matching group id using these rules:
  - Only assign a "Work", "Professional" or similar group for explicitly work-related tasks (job deliverables, work meetings, professional responsibilities).
  - Personal/domestic tasks (cooking, cleaning, shopping, errands, appointments, leisure) → life/personal/admin groups
  - Health, exercise, wellbeing tasks → health/fitness groups
  - ${defaultHint}`;
  } else {
    groupSection = `- "group_id": null (no groups available)`;
  }

  const subtaskSection = generateSubtasks
    ? `- "subtasks": break the task into 2-5 concrete, actionable steps. Each has "title" (string) and "duration" (number in minutes, or null). Return as an array.`
    : `- "subtasks": [] (do not generate subtasks)`;

  return `You are a task parsing assistant for an app called "Plan My Day". Extract one structured task from a natural language description.

Field rules (every field must be present; use null where a value is genuinely unknown):
- "title": REQUIRED, never null. Use the core subject if unclear.
- "task_type": "event" for meetings/appointments/calls at a fixed time, "todo" for quick items under 30 minutes, "task" for everything else (default).
- "priority": 1=critical/urgent/ASAP, 2=high, 3=normal (default), 4=low, 5=minimal. Infer from words like "urgent", "asap", "whenever".
- "energy_level_required": 1=low (passive/watching/listening), 2=low-medium (admin/email/reviews), 3=medium (meetings/calls, default), 4=medium-high (presentations/planning), 5=high (deep work/coding/writing/complex analysis).
- "duration" in minutes: estimate when not stated — meeting/call=60, deep work=90, quick todo=15, review=30, report/writing=120. Use explicit mentions if given. May be null only if truly unknowable.
- "scheduled_start": local datetime "YYYY-MM-DDTHH:MM" in the user's timezone if a specific time is mentioned, else null. Never invent a time.
- "scheduled_end": local datetime "YYYY-MM-DDTHH:MM", only set when scheduled_start is set (start + duration), else null.
- "due_date": local datetime "YYYY-MM-DDTHH:MM" if a deadline is mentioned (e.g. "by Friday 5pm", "end of day"), else null.
- Output all times in the user's LOCAL timezone exactly as anchored by the current date/time context below. Do NOT convert to UTC. Do NOT fabricate times.
${groupSection}
${subtaskSection}`;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const client = getOpenAIClient();
  if (!client) {
    return NextResponse.json({ error: "AI parsing is not configured" }, { status: 503 });
  }

  // Fetch timezone, AI group preference, and model preference in one query
  let tz = "UTC";
  let defaultAiGroupId: string | null = null;
  let aiModel: string | null = null;
  try {
    const userResult = await db.execute({
      sql: "SELECT timezone, default_ai_group_id, ai_model FROM users WHERE id = ?",
      args: [session.user.id],
    });
    tz = (userResult.rows[0]?.timezone as string) || "UTC";
    defaultAiGroupId = (userResult.rows[0]?.default_ai_group_id as string) || null;
    aiModel = (userResult.rows[0]?.ai_model as string) || null;
  } catch {
    // fall back to defaults
  }

  let body: {
    text: string;
    groups?: { id: string; name: string }[];
    generate_subtasks?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { text, groups = [], generate_subtasks = false } = body;

  // Resolve the default group object from the groups array (if it's still valid)
  const defaultGroup = defaultAiGroupId
    ? (groups.find((g) => g.id === defaultAiGroupId) ?? null)
    : null;

  if (!text || typeof text !== "string") {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const cappedText = text.slice(0, 500);

  const { currentDateStr, utcOffset } = buildCurrentDateContext(tz);

  const userPrompt = `Current date/time in user's timezone: ${currentDateStr}
Timezone: ${tz} (${utcOffset})

Parse this task description:
"${cappedText}"`;

  try {
    const parsed = await runStructuredCompletion<Record<string, unknown>>(client, {
      model: resolveModel(aiModel),
      reasoningEffort: "low",
      systemPrompt: buildSystemPrompt(groups, generate_subtasks, defaultGroup),
      messages: [{ role: "user", content: userPrompt }],
      schemaName: "quick_add_task",
      schema: QUICK_ADD_SCHEMA,
      maxCompletionTokens: 2000,
    });

    if (!parsed.title || typeof parsed.title !== "string") {
      return NextResponse.json({ error: "Could not extract a task title" }, { status: 422 });
    }

    // Map to form-ready fields — convert any datetimes to datetime-local in user's timezone
    const result: Record<string, unknown> = { title: parsed.title };
    if (parsed.description) result.description = parsed.description;
    if (parsed.task_type) result.task_type = parsed.task_type;
    if (parsed.priority) result.priority = parsed.priority;
    if (parsed.duration) result.duration = parsed.duration;
    if (parsed.energy_level_required) result.energy_level_required = parsed.energy_level_required;
    if (parsed.group_id) {
      result.group_id = parsed.group_id;
    } else if (defaultAiGroupId) {
      result.group_id = defaultAiGroupId;
    }

    // AI outputs local datetime strings directly (YYYY-MM-DDTHH:MM).
    // If it still returns a UTC ISO string (with Z), fall back to server-side conversion.
    const toLocal = (raw: unknown): string | undefined => {
      if (!raw || typeof raw !== "string") return undefined;
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return raw;
      return utcToDateTimeLocal(raw, tz);
    };

    const scheduledStart = toLocal(parsed.scheduled_start);
    const scheduledEnd = toLocal(parsed.scheduled_end);
    const dueDate = toLocal(parsed.due_date);

    if (scheduledStart) result.scheduled_start = scheduledStart;
    if (scheduledEnd) result.scheduled_end = scheduledEnd;
    if (dueDate) result.due_date = dueDate;

    if (generate_subtasks && Array.isArray(parsed.subtasks) && parsed.subtasks.length > 0) {
      result.subtasks = parsed.subtasks;
    }

    const hasTimeInfo = scheduledStart || scheduledEnd || dueDate;
    const confidence = hasTimeInfo ? "full" : "partial";
    const unparsedHints = hasTimeInfo ? [] : ["scheduled time", "due date"];

    return NextResponse.json({
      parsed: result,
      confidence,
      ...(unparsedHints.length > 0 ? { unparsed_hints: unparsedHints } : {}),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `AI service error: ${msg}` }, { status: 502 });
  }
}
