import { NextResponse } from "next/server";
import OpenAI from "openai";
import { auth } from "@/lib/auth";
import { db } from "@/lib/turso";

function buildCurrentDateStr(tz: string): { currentDateStr: string; utcOffset: string } {
  const now = new Date();
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
    const currentDateStr = `${p("weekday")}, ${p("year")}-${p("month")}-${p("day")} ${p("hour")}:${p("minute")}`;
    const offsetMs =
      now.getTime() - new Date(now.toLocaleString("en-US", { timeZone: tz })).getTime();
    const offsetHrs = -Math.round(offsetMs / 60000 / 60);
    const utcOffset = `UTC${offsetHrs >= 0 ? "+" : ""}${offsetHrs}`;
    return { currentDateStr, utcOffset };
  } catch {
    return { currentDateStr: now.toISOString(), utcOffset: "UTC" };
  }
}

export interface ExistingTask {
  id: string;
  title: string;
  status: string;
  priority: number;
  task_type?: string | null;
  duration?: number | null;
  scheduled_start?: string | null;
  scheduled_end?: string | null;
  due_date?: string | null;
  group_id?: string | null;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function formatTaskLine(t: ExistingTask): string {
  const parts: string[] = [`id: "${t.id}"`, `"${t.title}"`];
  parts.push(`status: ${t.status}`);
  parts.push(`priority: ${t.priority}`);
  if (t.task_type) parts.push(`type: ${t.task_type}`);
  if (t.duration) parts.push(`${t.duration}min`);
  if (t.scheduled_start) parts.push(`scheduled: ${t.scheduled_start}`);
  if (t.due_date) parts.push(`due: ${t.due_date}`);
  return `- ${parts.join(", ")}`;
}

function buildSystemPrompt(
  tz: string,
  currentDateStr: string,
  utcOffset: string,
  groups: { id: string; name: string }[],
  existingTasks: ExistingTask[]
): string {
  const groupSection =
    groups.length > 0
      ? `Available task groups:\n${groups.map((g) => `- id: "${g.id}", name: "${g.name}"`).join("\n")}`
      : "No task groups available.";

  const tasksSection =
    existingTasks.length > 0
      ? `User's existing tasks (all statuses, includes scheduling info):\n${existingTasks.map(formatTaskLine).join("\n")}`
      : "No existing tasks provided.";

  return `You are a planning assistant embedded in a task management app called "Plan My Day".
Your role is to help the user plan and reorganise their tasks through conversation.

Current date/time in user's timezone: ${currentDateStr}
Timezone: ${tz} (${utcOffset})

${groupSection}

${tasksSection}

Guidelines:
- Ask ONE focused clarifying question at a time to gather what you need.
- Be concise and friendly. Don't overwhelm with multiple questions at once.
- You can propose both NEW tasks (action: "create") and UPDATES to existing tasks (action: "update").
- For updates, use the existing task's id from the list above and only include the fields you want to change.
- When reorganising a day or week, prefer updating existing tasks (reschedule them) rather than creating duplicates.
- When you have enough information to propose concrete changes, set "ready": true and populate "proposed_tasks".
- Until you're ready, set "ready": false and leave "proposed_tasks" as an empty array.
- For all datetime strings use the user's timezone (format: YYYY-MM-DDTHH:MM).
- Assign group_id only if it clearly matches one of the available groups, otherwise null.
- Estimate realistic durations and appropriate priority/energy levels.

Always respond with valid JSON matching this exact schema:
{
  "message": string,
  "ready": boolean,
  "proposed_tasks": [
    {
      "action": "create" | "update",
      "id": string | null,           // existing task id — required when action is "update", null for creates
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
    return NextResponse.json({ error: "AI planning is not configured" }, { status: 503 });
  }

  let tz = "UTC";
  try {
    const userResult = await db.execute({
      sql: "SELECT timezone FROM users WHERE id = ?",
      args: [session.user.id],
    });
    tz = (userResult.rows[0]?.timezone as string) || "UTC";
  } catch {
    // fall back to UTC
  }

  let body: {
    messages: ChatMessage[];
    groups: { id: string; name: string }[];
    existing_tasks?: ExistingTask[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { messages, groups = [], existing_tasks = [] } = body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages array is required" }, { status: 400 });
  }

  // Cap context — keep more tasks since they're needed for reorg use cases
  const cappedMessages = messages.slice(-20);
  const cappedTasks = existing_tasks.slice(0, 50);

  const { currentDateStr, utcOffset } = buildCurrentDateStr(tz);
  const systemPrompt = buildSystemPrompt(tz, currentDateStr, utcOffset, groups, cappedTasks);

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        ...cappedMessages.map((m) => ({ role: m.role, content: m.content })),
      ],
      temperature: 0.4,
      max_tokens: 1500,
    });

    const rawJson = completion.choices[0]?.message?.content;
    if (!rawJson) {
      return NextResponse.json({ error: "Empty response from AI" }, { status: 502 });
    }

    let parsed: { message: string; ready: boolean; proposed_tasks?: unknown[] };
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      return NextResponse.json({ error: "Invalid JSON from AI" }, { status: 502 });
    }

    return NextResponse.json({
      message: parsed.message ?? "",
      ready: parsed.ready ?? false,
      proposed_tasks: parsed.ready ? (parsed.proposed_tasks ?? null) : null,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `AI service error: ${msg}` }, { status: 502 });
  }
}
