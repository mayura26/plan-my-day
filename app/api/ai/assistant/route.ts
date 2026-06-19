import { NextResponse } from "next/server";
import {
  ASSISTANT_TURN_SCHEMA,
  buildCurrentDateContext,
  getOpenAIClient,
  resolveModel,
  runStructuredCompletion,
} from "@/lib/ai";
import { auth } from "@/lib/auth";
import { db } from "@/lib/turso";

interface ExistingTask {
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

/** Convert a UTC ISO string to a readable local time for the system prompt. */
function toLocalLabel(isoString: string | null | undefined, tz: string): string | null {
  if (!isoString) return null;
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
    return isoString;
  }
}

function formatTaskLine(t: ExistingTask, tz: string): string {
  const parts: string[] = [`id: "${t.id}"`, `"${t.title}"`];
  parts.push(`status: ${t.status}`);
  parts.push(`priority: ${t.priority}`);
  if (t.task_type) parts.push(`type: ${t.task_type}`);
  if (t.duration) parts.push(`${t.duration}min`);
  const start = toLocalLabel(t.scheduled_start, tz);
  const end = toLocalLabel(t.scheduled_end, tz);
  if (start) parts.push(`scheduled: ${start}${end ? ` to ${end}` : ""}`);
  const due = toLocalLabel(t.due_date, tz);
  if (due) parts.push(`due: ${due}`);
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
      ? `User's existing tasks (all datetimes shown in the user's timezone):\n${existingTasks.map((t) => formatTaskLine(t, tz)).join("\n")}`
      : "No existing tasks provided.";

  return `You are an AI assistant embedded in a task management app called "Plan My Day".
You act like a personal assistant. The user will either (a) describe things they need to do so you can build tasks, or (b) ask you to manage their existing schedule ("move my lunch to 1pm", "extend hanging out the washing to 2 hours", "reschedule my report to tomorrow morning").

Current date/time in user's timezone: ${currentDateStr}
Timezone: ${tz} (${utcOffset})

${groupSection}

${tasksSection}

How the app models a task — fill the right fields for each proposed action:
- "action": "create" for a brand new task, "update" to change an existing one.
- "id": for "update", the exact id of the existing task above; for "create", null.
- "title": short imperative title (required, never empty).
- "task_type": "event" (fixed-time meeting/appointment — REQUIRES scheduled_start AND scheduled_end), "todo" (quick item under 30 min — REQUIRES due_date), or "task" (default, schedulable work).
- "priority": 1=critical, 2=high, 3=normal (default), 4=low, 5=minimal.
- "energy_level_required": 1=low (passive) … 3=medium (default) … 5=high (deep focus).
- "duration": estimated minutes (meeting=60, deep work=90, quick todo=15, review=30, writing=120). null only if truly unknowable.
- "scheduled_start"/"scheduled_end"/"due_date": local datetimes "YYYY-MM-DDTHH:MM" in the user's timezone, anchored to the current date/time above. Use null when not applicable. NEVER convert to UTC and NEVER invent a time that the user did not imply.
- "group_id": one of the group ids above only if it clearly matches, otherwise null.
- "subtasks": for "create" actions only, an array of { "title", "duration" } steps. Use [] when the task does not need breaking down.

Behavior:
- Ask before assuming. If key information is missing or ambiguous (no time where one is implied, you cannot tell which existing task they mean, the scope is unclear), set "needs_clarification": true, ask ONE focused question in "message", and return an empty "proposed_actions" array.
- When breaking down work would help (a large/multi-step task), either propose "subtasks" on a create action or ask whether they'd like it split — judge from the request.
- When editing existing tasks, reuse their id and keep unrelated fields the same as the existing task; only change what the user asked for.
- Prefer updating existing tasks over creating duplicates when reorganising a day or week.
- When you have concrete changes, set "needs_clarification": false, summarise them briefly in "message", and populate "proposed_actions".
- Be concise and friendly. One question at a time.`;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const client = getOpenAIClient();
  if (!client) {
    return NextResponse.json({ error: "AI assistant is not configured" }, { status: 503 });
  }

  let tz = "UTC";
  let aiModel: string | null = null;
  try {
    const userResult = await db.execute({
      sql: "SELECT timezone, ai_model FROM users WHERE id = ?",
      args: [session.user.id],
    });
    tz = (userResult.rows[0]?.timezone as string) || "UTC";
    aiModel = (userResult.rows[0]?.ai_model as string) || null;
  } catch {
    // fall back to defaults
  }

  let body: {
    messages: ChatMessage[];
    groups?: { id: string; name: string }[];
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

  const cappedMessages = messages.slice(-20);
  const cappedTasks = existing_tasks.slice(0, 50);

  const { currentDateStr, utcOffset } = buildCurrentDateContext(tz);
  const systemPrompt = buildSystemPrompt(tz, currentDateStr, utcOffset, groups, cappedTasks);

  try {
    const parsed = await runStructuredCompletion<{
      message: string;
      needs_clarification: boolean;
      proposed_actions?: unknown[];
    }>(client, {
      model: resolveModel(aiModel),
      reasoningEffort: "medium",
      systemPrompt,
      messages: cappedMessages,
      schemaName: "assistant_turn",
      schema: ASSISTANT_TURN_SCHEMA,
      maxCompletionTokens: 6000,
    });

    const needsClarification = parsed.needs_clarification ?? false;
    const proposedActions =
      !needsClarification && Array.isArray(parsed.proposed_actions) ? parsed.proposed_actions : [];

    return NextResponse.json({
      message: parsed.message ?? "",
      needs_clarification: needsClarification,
      proposed_actions: proposedActions,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `AI service error: ${msg}` }, { status: 502 });
  }
}
