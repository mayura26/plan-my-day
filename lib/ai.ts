import OpenAI from "openai";

/**
 * Centralized AI configuration for Plan My Day.
 *
 * Both AI surfaces (Quick add and the conversational Assistant) share this module so
 * the model IDs, reasoning settings, structured-output schemas, and timezone context
 * stay consistent. The literal model IDs live here so they're trivial to update.
 */

export const AI_MODELS = {
  full: "gpt-5.4",
  mini: "gpt-5.4-mini",
} as const;

export type AiModelChoice = keyof typeof AI_MODELS;

export const DEFAULT_AI_MODEL: AiModelChoice = "mini";

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

/** Resolve a stored preference (possibly null/garbage) into a concrete OpenAI model id. */
export function resolveModel(choice: string | null | undefined): string {
  if (choice === "full" || choice === "mini") {
    return AI_MODELS[choice];
  }
  return AI_MODELS[DEFAULT_AI_MODEL];
}

/** Returns an OpenAI client, or null when no API key is configured. */
export function getOpenAIClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

/**
 * Build a human-readable "now" string and UTC offset label for the given IANA timezone.
 * Used to anchor relative phrases like "tomorrow at 8am" to the user's local clock.
 */
export function buildCurrentDateContext(tz: string): {
  currentDateStr: string;
  utcOffset: string;
} {
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

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface StructuredCompletionOptions {
  model: string;
  reasoningEffort: ReasoningEffort;
  systemPrompt: string;
  messages: ChatMessage[];
  /** JSON schema name (no spaces). */
  schemaName: string;
  /** A strict JSON schema describing the expected response object. */
  schema: Record<string, unknown>;
  maxCompletionTokens?: number;
}

/**
 * Run a chat completion against a GPT-5 reasoning model and parse the structured
 * JSON response.
 *
 * GPT-5 series specifics handled here:
 * - `reasoning_effort` enables thinking.
 * - `max_completion_tokens` is used (not `max_tokens`).
 * - no custom `temperature` is sent (these models only accept the default).
 * - `response_format` uses a strict json_schema for reliable parsing.
 */
export async function runStructuredCompletion<T = Record<string, unknown>>(
  client: OpenAI,
  opts: StructuredCompletionOptions
): Promise<T> {
  const completion = await client.chat.completions.create({
    model: opts.model,
    reasoning_effort: opts.reasoningEffort,
    max_completion_tokens: opts.maxCompletionTokens ?? 4000,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: opts.schemaName,
        strict: true,
        schema: opts.schema,
      },
    },
    messages: [
      { role: "system", content: opts.systemPrompt },
      ...opts.messages.map((m) => ({ role: m.role, content: m.content })),
    ],
  });

  const rawJson = completion.choices[0]?.message?.content;
  if (!rawJson) {
    throw new Error("Empty response from AI");
  }
  return JSON.parse(rawJson) as T;
}

/** Strict JSON schema for the Quick-add single-task parser. */
export const QUICK_ADD_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    description: { type: ["string", "null"] },
    task_type: { type: "string", enum: ["task", "event", "todo"] },
    priority: { type: "integer", enum: [1, 2, 3, 4, 5] },
    duration: { type: ["integer", "null"] },
    energy_level_required: { type: "integer", enum: [1, 2, 3, 4, 5] },
    scheduled_start: { type: ["string", "null"] },
    scheduled_end: { type: ["string", "null"] },
    due_date: { type: ["string", "null"] },
    group_id: { type: ["string", "null"] },
    subtasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          duration: { type: ["integer", "null"] },
        },
        required: ["title", "duration"],
      },
    },
  },
  required: [
    "title",
    "description",
    "task_type",
    "priority",
    "duration",
    "energy_level_required",
    "scheduled_start",
    "scheduled_end",
    "due_date",
    "group_id",
    "subtasks",
  ],
};

/** Strict JSON schema for one proposed assistant action (create or update). */
const PROPOSED_ACTION_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: { type: "string", enum: ["create", "update"] },
    id: { type: ["string", "null"] },
    title: { type: "string" },
    description: { type: ["string", "null"] },
    task_type: { type: "string", enum: ["task", "event", "todo"] },
    priority: { type: "integer", enum: [1, 2, 3, 4, 5] },
    duration: { type: ["integer", "null"] },
    energy_level_required: { type: "integer", enum: [1, 2, 3, 4, 5] },
    scheduled_start: { type: ["string", "null"] },
    scheduled_end: { type: ["string", "null"] },
    due_date: { type: ["string", "null"] },
    group_id: { type: ["string", "null"] },
    subtasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          duration: { type: ["integer", "null"] },
        },
        required: ["title", "duration"],
      },
    },
  },
  required: [
    "action",
    "id",
    "title",
    "description",
    "task_type",
    "priority",
    "duration",
    "energy_level_required",
    "scheduled_start",
    "scheduled_end",
    "due_date",
    "group_id",
    "subtasks",
  ],
};

/** Strict JSON schema for a full assistant conversational turn. */
export const ASSISTANT_TURN_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    message: { type: "string" },
    needs_clarification: { type: "boolean" },
    proposed_actions: {
      type: "array",
      items: PROPOSED_ACTION_SCHEMA,
    },
  },
  required: ["message", "needs_clarification", "proposed_actions"],
};
