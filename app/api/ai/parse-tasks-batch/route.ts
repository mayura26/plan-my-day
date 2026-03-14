import { NextResponse } from "next/server";
import OpenAI from "openai";
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

function buildBatchSystemPrompt(
  groups: { id: string; name: string }[],
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

  return `You are a task parsing assistant. Analyse a brain dump and extract 2–10 distinct, actionable tasks from it.

Rules for each task:
- "title" is REQUIRED and must never be null. Use the core subject if unclear.
- "task_type": use "event" for meetings/appointments/calls, "todo" for quick items under 30 minutes, "task" for everything else (default)
- "priority": ALWAYS set — 1=critical/urgent/ASAP, 2=high, 3=normal (default), 4=low, 5=minimal. Infer from words like "urgent", "asap", "whenever", etc.
- "energy_level_required": ALWAYS set — 1=low energy (passive/watching/listening), 2=low-medium (admin/email/reviews), 3=medium (meetings/calls, default), 4=medium-high (presentations/planning), 5=high energy (deep work/coding/writing/complex analysis).
- "duration" in minutes: ALWAYS estimate — meeting/call=60, deep work=90, quick todo=15, review=30, report/writing=120. Use explicit mentions if given.
- "scheduled_start": local datetime string in format "YYYY-MM-DDTHH:MM" in the user's timezone if a specific time is mentioned, else null.
- "scheduled_end": local datetime string in format "YYYY-MM-DDTHH:MM", only set if scheduled_start is set (start + duration).
- "due_date": local datetime string in format "YYYY-MM-DDTHH:MM" if a deadline is mentioned, else null.
- Output times in the user's LOCAL timezone. Do NOT convert to UTC.
- Do NOT fabricate times that weren't mentioned by the user.
- Do NOT create subtasks — each item in the array is a top-level task.
- Identify 2–10 distinct, independently actionable tasks. Do not lump everything into one task.
${groupSection}

Return a JSON object with exactly this shape:
{
  "tasks": [
    {
      "title": string,
      "description": string | null,
      "task_type": "task" | "event" | "todo",
      "priority": 1 | 2 | 3 | 4 | 5,
      "duration": number,
      "energy_level_required": 1 | 2 | 3 | 4 | 5,
      "scheduled_start": string | null,
      "scheduled_end": string | null,
      "due_date": string | null,
      "group_id": string | null
    }
  ]
}`;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "AI parsing is not configured" }, { status: 503 });
  }

  // Fetch timezone and AI group preference
  let tz = "UTC";
  let defaultAiGroupId: string | null = null;
  try {
    const userResult = await db.execute({
      sql: "SELECT timezone, default_ai_group_id FROM users WHERE id = ?",
      args: [session.user.id],
    });
    tz = (userResult.rows[0]?.timezone as string) || "UTC";
    defaultAiGroupId = (userResult.rows[0]?.default_ai_group_id as string) || null;
  } catch {
    // fall back to UTC
  }

  let body: { text: string; groups?: { id: string; name: string }[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { text, groups = [] } = body;

  const defaultGroup = defaultAiGroupId
    ? (groups.find((g) => g.id === defaultAiGroupId) ?? null)
    : null;

  if (!text || typeof text !== "string") {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const cappedText = text.slice(0, 1000);

  // Build current datetime context in the user's timezone
  const now = new Date();
  let currentDateStr: string;
  let utcOffset: string;
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      weekday: "long",
    });
    const parts = formatter.formatToParts(now);
    const p = (type: string) => parts.find((x) => x.type === type)?.value ?? "";
    currentDateStr = `${p("weekday")}, ${p("year")}-${p("month")}-${p("day")} ${p("hour")}:${p("minute")}`;

    const offsetMs =
      now.getTime() - new Date(now.toLocaleString("en-US", { timeZone: tz })).getTime();
    const offsetHrs = -Math.round(offsetMs / 60000 / 60);
    utcOffset = `UTC${offsetHrs >= 0 ? "+" : ""}${offsetHrs}`;
  } catch {
    currentDateStr = now.toISOString();
    utcOffset = "UTC";
  }

  const userPrompt = `Current date/time in user's timezone: ${currentDateStr}
Timezone: ${tz} (${utcOffset})

Brain dump to parse into tasks:
"${cappedText}"`;

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildBatchSystemPrompt(groups, defaultGroup) },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 2500,
    });

    const rawJson = completion.choices[0]?.message?.content;
    if (!rawJson) {
      return NextResponse.json({ error: "Empty response from AI" }, { status: 502 });
    }

    let parsed: { tasks?: unknown[] };
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      return NextResponse.json({ error: "Invalid JSON from AI" }, { status: 502 });
    }

    if (!Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
      return NextResponse.json({ error: "Could not extract any tasks" }, { status: 422 });
    }

    const toLocal = (raw: unknown): string | undefined => {
      if (!raw || typeof raw !== "string") return undefined;
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return raw;
      return utcToDateTimeLocal(raw, tz);
    };

    const tasks = parsed.tasks
      .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
      .filter((t) => t.title && typeof t.title === "string")
      .map((t) => {
        const result: Record<string, unknown> = { title: t.title };
        if (t.description) result.description = t.description;
        if (t.task_type) result.task_type = t.task_type;
        if (t.priority) result.priority = t.priority;
        if (t.duration) result.duration = t.duration;
        if (t.energy_level_required) result.energy_level_required = t.energy_level_required;
        if (t.group_id) {
          result.group_id = t.group_id;
        } else if (defaultAiGroupId) {
          result.group_id = defaultAiGroupId;
        }

        const scheduledStart = toLocal(t.scheduled_start);
        const scheduledEnd = toLocal(t.scheduled_end);
        const dueDate = toLocal(t.due_date);
        if (scheduledStart) result.scheduled_start = scheduledStart;
        if (scheduledEnd) result.scheduled_end = scheduledEnd;
        if (dueDate) result.due_date = dueDate;

        return result;
      });

    if (tasks.length === 0) {
      return NextResponse.json({ error: "Could not extract any valid tasks" }, { status: 422 });
    }

    return NextResponse.json({ tasks });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `AI service error: ${msg}` }, { status: 502 });
  }
}
