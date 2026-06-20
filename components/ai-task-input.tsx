"use client";

import { Check, Lock, MessageCircle, Mic, MicOff, Pencil, Sparkles, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useUserTimezone } from "@/hooks/use-user-timezone";
import { formatDateTimeLocalForTimezone, parseDateTimeLocalToUTC } from "@/lib/timezone-utils";
import type { TaskGroup, TaskType } from "@/lib/types";
import { cn } from "@/lib/utils";
import { type CreateTaskRequestWithSubtasks, TaskForm } from "./task-form";

interface ExistingTaskContext {
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
  description?: string | null;
  energy_level_required?: number;
}

interface AITaskInputProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Quick add: opens the task form prefilled with a single parsed task. */
  onParsed: (data: Partial<CreateTaskRequestWithSubtasks>) => void;
  /** Called after the assistant applies (creates/updates) a task, to refresh the list. */
  onApplied?: () => void | Promise<void>;
  groups?: TaskGroup[];
  existingTasks?: ExistingTaskContext[];
}

type Mode = "quick" | "assistant";

interface ProposedAction {
  _id: string;
  action: "create" | "update";
  id?: string | null;
  title: string;
  description?: string | null;
  task_type?: string;
  priority?: number;
  duration?: number | null;
  energy_level_required?: number;
  scheduled_start?: string | null;
  scheduled_end?: string | null;
  due_date?: string | null;
  group_id?: string | null;
  subtasks?: { title: string; duration?: number | null }[];
}

interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions?: ProposedAction[];
}

type ActionStatus = "applying" | "applied" | "rejected" | "error" | "editing";

const LOCK_THRESHOLD = 60; // px upward drag to lock recording

const PRIORITY_CHIP: Record<number, string> = {
  1: "Critical",
  2: "High",
  3: "Normal",
  4: "Low",
  5: "Minimal",
};

const TYPE_CHIP: Record<string, string> = {
  task: "Task",
  event: "Event",
  todo: "To-Do",
};

export function AITaskInput({
  open,
  onOpenChange,
  onParsed,
  onApplied,
  groups = [],
  existingTasks,
}: AITaskInputProps) {
  const { timezone } = useUserTimezone();

  const [mode, setMode] = useState<Mode>("quick");

  // Quick add state
  const [text, setText] = useState("");
  const [generateSubtasks, setGenerateSubtasks] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [partialWarning, setPartialWarning] = useState<string[] | null>(null);

  // Voice state (shared)
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [dragProgress, setDragProgress] = useState(0);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  // Assistant state
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [assistantInput, setAssistantInput] = useState("");
  const [isAssistantLoading, setIsAssistantLoading] = useState(false);
  const [actionStatus, setActionStatus] = useState<Record<string, ActionStatus>>({});

  // Edit-review queue: actions marked with the pencil, walked through the full task form
  const [reviewQueue, setReviewQueue] = useState<ProposedAction[]>([]);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [isReviewSubmitting, setIsReviewSubmitting] = useState(false);
  const isReviewing = reviewQueue.length > 0;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const assistantTextareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerStartYRef = useRef<number>(0);
  const modeRef = useRef<Mode>(mode);
  modeRef.current = mode;

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      if (isRecording) mediaRecorderRef.current?.stop();
      setText("");
      setParseError(null);
      setPartialWarning(null);
      setIsParsing(false);
      setIsRecording(false);
      setIsTranscribing(false);
      setIsLocked(false);
      setDragProgress(0);
      setRecordingSeconds(0);
      setMessages([]);
      setAssistantInput("");
      setIsAssistantLoading(false);
      setActionStatus({});
      setReviewQueue([]);
      setReviewIndex(0);
      setIsReviewSubmitting(false);
    } else {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [open, isRecording]);

  // Scroll assistant chat to bottom on new messages or loading change
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll must run when message list or loading changes
  useEffect(() => {
    if (mode === "assistant") {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [mode, messages.length, isAssistantLoading]);

  // Frequency-bar visualizer — runs while recording
  useEffect(() => {
    if (!isRecording) return;

    const drawFrame = () => {
      const canvas = canvasRef.current;
      const analyser = analyserRef.current;
      if (!canvas || !analyser) {
        animationFrameRef.current = requestAnimationFrame(drawFrame);
        return;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      analyser.getByteFrequencyData(dataArray);

      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      const barWidth = width / bufferLength;
      const gap = 2;
      for (let i = 0; i < bufferLength; i++) {
        const value = dataArray[i];
        const barHeight = Math.max(2, (value / 255) * height);
        ctx.fillStyle = `rgba(239, 68, 68, ${0.35 + (value / 255) * 0.65})`;
        ctx.fillRect(i * barWidth + gap / 2, height - barHeight, barWidth - gap, barHeight);
      }

      animationFrameRef.current = requestAnimationFrame(drawFrame);
    };

    drawFrame();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isRecording]);

  // Recording duration timer
  useEffect(() => {
    if (!isRecording) {
      setRecordingSeconds(0);
      return;
    }
    const interval = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [isRecording]);

  const switchMode = (next: Mode) => {
    setMode(next);
    setParseError(null);
    setPartialWarning(null);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];

      try {
        const audioContext = new AudioContext();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.8;
        audioContext.createMediaStreamSource(stream).connect(analyser);
        audioContextRef.current = audioContext;
        analyserRef.current = analyser;
      } catch {
        // Visualizer not critical
      }

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => {
          t.stop();
        });
        audioContextRef.current?.close();
        audioContextRef.current = null;
        analyserRef.current = null;
        setIsRecording(false);
        setIsLocked(false);
        setDragProgress(0);
        setIsTranscribing(true);
        try {
          const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
          const fd = new FormData();
          fd.append("audio", blob, "recording.webm");
          const res = await fetch("/api/ai/transcribe", { method: "POST", body: fd });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Transcription failed");
          if (modeRef.current === "assistant") {
            setAssistantInput((prev) => (prev ? `${prev} ${data.text}` : data.text));
          } else {
            setText((prev) => (prev ? `${prev} ${data.text}` : data.text));
          }
        } catch (err) {
          setParseError(err instanceof Error ? err.message : "Transcription failed");
        } finally {
          setIsTranscribing(false);
        }
      };

      recorder.start();
      setIsRecording(true);
    } catch {
      setParseError("Microphone access denied. Please allow microphone permissions.");
    }
  };

  const handleMicClick = async () => {
    if (isParsing || isTranscribing || isAssistantLoading) return;
    if (isRecording) {
      mediaRecorderRef.current?.stop();
    } else {
      await startRecording();
    }
  };

  const handlePointerDown = async (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType !== "touch") return;
    if (isParsing || isTranscribing || isRecording || isAssistantLoading) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    pointerStartYRef.current = e.clientY;
    await startRecording();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType !== "touch" || !isRecording || isLocked) return;
    const deltaY = pointerStartYRef.current - e.clientY;
    const progress = Math.min(1, Math.max(0, deltaY / LOCK_THRESHOLD));
    setDragProgress(progress);
    if (deltaY >= LOCK_THRESHOLD) {
      setIsLocked(true);
      setDragProgress(0);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType !== "touch" || !isRecording || isLocked) return;
    setDragProgress(0);
    mediaRecorderRef.current?.stop();
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType !== "touch" || !isRecording || isLocked) return;
    setDragProgress(0);
    mediaRecorderRef.current?.stop();
  };

  const handleParse = async () => {
    if (!text.trim() || isParsing) return;

    setIsParsing(true);
    setParseError(null);
    setPartialWarning(null);

    try {
      const response = await fetch("/api/ai/parse-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.trim(),
          groups: groups.map((g) => ({ id: g.id, name: g.name })),
          generate_subtasks: generateSubtasks,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setParseError(data.error || "Failed to parse task");
        return;
      }

      if (!data.parsed?.title) {
        setParseError("Could not extract a task title. Please be more specific.");
        return;
      }

      if (data.confidence === "partial" && data.unparsed_hints?.length) {
        setPartialWarning(data.unparsed_hints);
      }

      onParsed(data.parsed);
      onOpenChange(false);
    } catch {
      setParseError("Network error. Please check your connection and try again.");
    } finally {
      setIsParsing(false);
    }
  };

  const sendAssistantMessage = async () => {
    if (!assistantInput.trim() || isAssistantLoading) return;
    const userMessage: AssistantMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: assistantInput.trim(),
    };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setAssistantInput("");
    setIsAssistantLoading(true);
    try {
      const res = await fetch("/api/ai/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedMessages.map((m) => ({ role: m.role, content: m.content })),
          groups: groups.filter((g) => !g.is_parent_group).map((g) => ({ id: g.id, name: g.name })),
          existing_tasks: existingTasks?.slice(0, 50) ?? [],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: data.error || "Something went wrong. Please try again.",
          },
        ]);
        return;
      }
      const rawActions: ProposedAction[] = Array.isArray(data.proposed_actions)
        ? data.proposed_actions.map((a: Omit<ProposedAction, "_id">) => ({
            ...a,
            _id: crypto.randomUUID(),
          }))
        : [];
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.message,
          actions: rawActions.length > 0 ? rawActions : undefined,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "Network error. Please check your connection and try again.",
        },
      ]);
    } finally {
      setIsAssistantLoading(false);
    }
  };

  const applyAction = async (action: ProposedAction) => {
    setActionStatus((s) => ({ ...s, [action._id]: "applying" }));
    try {
      // All AI datetimes are local "YYYY-MM-DDTHH:MM" in the user's timezone —
      // convert to UTC before writing to the DB.
      const startUTC = parseDateTimeLocalToUTC(action.scheduled_start ?? undefined, timezone);
      const endUTC = parseDateTimeLocalToUTC(action.scheduled_end ?? undefined, timezone);
      const dueUTC = parseDateTimeLocalToUTC(action.due_date ?? undefined, timezone);

      if (action.action === "update" && action.id) {
        // Only send fields the AI provided (non-null). Avoids clearing unrelated fields.
        const payload: Record<string, unknown> = {};
        if (action.title) payload.title = action.title;
        if (action.description != null) payload.description = action.description;
        if (action.task_type) payload.task_type = action.task_type;
        if (action.priority) payload.priority = action.priority;
        if (action.duration != null) payload.duration = action.duration;
        if (action.energy_level_required)
          payload.energy_level_required = action.energy_level_required;
        if (startUTC) payload.scheduled_start = startUTC;
        if (endUTC) payload.scheduled_end = endUTC;
        if (dueUTC) payload.due_date = dueUTC;
        if (action.group_id) payload.group_id = action.group_id;

        const res = await fetch(`/api/tasks/${action.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("update failed");
      } else {
        const payload: Record<string, unknown> = {
          title: action.title,
          task_type: action.task_type ?? "task",
        };
        if (action.description != null) payload.description = action.description;
        if (action.priority) payload.priority = action.priority;
        if (action.duration != null) payload.duration = action.duration;
        if (action.energy_level_required)
          payload.energy_level_required = action.energy_level_required;
        if (startUTC) payload.scheduled_start = startUTC;
        if (endUTC) payload.scheduled_end = endUTC;
        if (dueUTC) payload.due_date = dueUTC;
        if (action.group_id) payload.group_id = action.group_id;

        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("create failed");
        const data = await res.json();
        const createdId: string | undefined = data.task?.id;

        if (createdId && action.subtasks?.length) {
          for (const st of action.subtasks) {
            await fetch(`/api/tasks/${createdId}/subtasks`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                title: st.title,
                duration: st.duration ?? 30,
                extend_parent_duration: true,
              }),
            });
          }
        }
      }

      setActionStatus((s) => ({ ...s, [action._id]: "applied" }));
      await onApplied?.();
    } catch {
      setActionStatus((s) => ({ ...s, [action._id]: "error" }));
    }
  };

  const rejectAction = (action: ProposedAction) => {
    setActionStatus((s) => ({ ...s, [action._id]: "rejected" }));
  };

  // Mark an action to be fine-tuned in the full task form during the review step.
  const editAction = (action: ProposedAction) => {
    setActionStatus((s) => ({ ...s, [action._id]: "editing" }));
  };

  const editingActions = messages
    .flatMap((m) => m.actions ?? [])
    .filter((a) => actionStatus[a._id] === "editing");

  const startReview = () => {
    if (editingActions.length === 0) return;
    setReviewQueue(editingActions);
    setReviewIndex(0);
  };

  const endReview = () => {
    setReviewQueue([]);
    setReviewIndex(0);
  };

  const advanceReview = () => {
    if (reviewIndex + 1 >= reviewQueue.length) {
      endReview();
    } else {
      setReviewIndex(reviewIndex + 1);
    }
  };

  // Skip the current review item — return it to a pending (actionable) state.
  const skipReviewItem = () => {
    const action = reviewQueue[reviewIndex];
    if (action) {
      setActionStatus((s) => {
        const next = { ...s };
        delete next[action._id];
        return next;
      });
    }
    advanceReview();
  };

  // Build the task-form initial data for the current review item.
  // For updates we merge the existing task with the proposed (non-null) changes.
  const buildReviewInitialData = (
    action: ProposedAction
  ): Partial<CreateTaskRequestWithSubtasks> & { id?: string } => {
    if (action.action === "update" && action.id) {
      const existing = existingTasks?.find((t) => t.id === action.id);
      return {
        id: action.id,
        title: action.title ?? existing?.title ?? "",
        description: action.description ?? existing?.description ?? undefined,
        priority: action.priority ?? existing?.priority,
        duration: action.duration ?? existing?.duration ?? undefined,
        task_type: (action.task_type ?? existing?.task_type ?? "task") as TaskType,
        group_id: action.group_id ?? existing?.group_id ?? undefined,
        energy_level_required: action.energy_level_required ?? existing?.energy_level_required,
        scheduled_start: action.scheduled_start ?? existing?.scheduled_start ?? undefined,
        scheduled_end: action.scheduled_end ?? existing?.scheduled_end ?? undefined,
        due_date: action.due_date ?? existing?.due_date ?? undefined,
      };
    }
    return {
      title: action.title,
      description: action.description ?? undefined,
      priority: action.priority,
      duration: action.duration ?? undefined,
      task_type: (action.task_type ?? "task") as TaskType,
      group_id: action.group_id ?? undefined,
      energy_level_required: action.energy_level_required,
      scheduled_start: action.scheduled_start ?? undefined,
      scheduled_end: action.scheduled_end ?? undefined,
      due_date: action.due_date ?? undefined,
      subtasks: action.subtasks?.map((s) => ({
        title: s.title,
        duration: s.duration ?? undefined,
      })),
    };
  };

  // Submit the reviewed task. TaskForm has already converted datetimes to UTC, so
  // the payload is sent as-is (no extra conversion here).
  const submitReviewItem = async (formData: CreateTaskRequestWithSubtasks) => {
    const action = reviewQueue[reviewIndex];
    if (!action) return;
    setIsReviewSubmitting(true);
    try {
      const { subtasks, initial_notes, ...body } = formData;

      if (action.action === "update" && action.id) {
        const res = await fetch(`/api/tasks/${action.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error("update failed");
      } else {
        const hasSubtasks = (subtasks?.length ?? 0) > 0;
        const wantsAutoSchedule = !!body.auto_schedule;
        const scheduleMode = (body as { schedule_mode?: string }).schedule_mode || "now";
        // Create parent unscheduled when it has subtasks + auto-schedule, then schedule
        // the subtasks (matches the create-form behavior on the tasks page).
        const createBody =
          hasSubtasks && wantsAutoSchedule ? { ...body, auto_schedule: false } : body;

        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(createBody),
        });
        if (!res.ok) throw new Error("create failed");
        const data = await res.json();
        const createdId: string | undefined = data.task?.id;

        if (createdId && subtasks?.length) {
          for (const st of subtasks) {
            await fetch(`/api/tasks/${createdId}/subtasks`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                title: st.title,
                duration: st.duration ?? 30,
                extend_parent_duration: true,
              }),
            });
          }
        }

        if (createdId && initial_notes?.length) {
          for (const note of initial_notes) {
            await fetch(`/api/tasks/${createdId}/todos`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ description: note }),
            });
          }
        }

        if (createdId && hasSubtasks && wantsAutoSchedule) {
          const endpointMap: Record<string, string> = {
            now: "schedule-now",
            today: "schedule-today",
            tomorrow: "schedule-tomorrow",
            "next-week": "schedule-next-week",
            "next-month": "schedule-next-month",
            asap: "schedule-asap",
            "due-date": "schedule-due-date",
            smart: "schedule-smart",
          };
          const endpoint = endpointMap[scheduleMode] ?? "schedule-now";
          await fetch(`/api/tasks/${createdId}/${endpoint}`, { method: "POST" });
        }
      }

      setActionStatus((s) => ({ ...s, [action._id]: "applied" }));
      await onApplied?.();
      advanceReview();
    } catch {
      setActionStatus((s) => ({ ...s, [action._id]: "error" }));
      advanceReview();
    } finally {
      setIsReviewSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleParse();
    }
  };

  const handleAssistantKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendAssistantMessage();
    }
  };

  const micButton = (
    <button
      type="button"
      onClick={handleMicClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      disabled={isParsing || isTranscribing || isAssistantLoading}
      style={{ touchAction: "none" }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        isRecording
          ? isLocked
            ? "text-red-500 bg-red-50 dark:bg-red-950/40"
            : "text-red-500 bg-red-50 dark:bg-red-950/40 animate-pulse"
          : "text-muted-foreground hover:text-foreground hover:bg-muted"
      )}
      title={
        isRecording
          ? isLocked
            ? "Tap to stop recording"
            : "Release to stop · slide up to lock"
          : "Hold to record · click to toggle"
      }
      aria-label="Voice input"
    >
      {isTranscribing ? (
        <span className="h-4 w-4 block animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : isRecording && isLocked ? (
        <Square className="h-4 w-4 fill-current" />
      ) : isRecording ? (
        <MicOff className="h-4 w-4" />
      ) : (
        <Mic className="h-4 w-4" />
      )}
      <span className="hidden sm:inline text-xs">
        {isTranscribing ? "Transcribing…" : isRecording ? "Stop" : "Voice"}
      </span>
    </button>
  );

  const recordingVisualizer = isRecording && (
    <div className="mt-1.5 space-y-1.5">
      <div className="flex items-center justify-between px-0.5">
        <span className="text-xs text-red-500 flex items-center gap-1.5">
          {isLocked ? (
            <>
              <Lock className="h-3 w-3" />
              Locked — tap mic to stop
            </>
          ) : (
            <>
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
              Recording
            </>
          )}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {String(Math.floor(recordingSeconds / 60)).padStart(2, "0")}:
          {String(recordingSeconds % 60).padStart(2, "0")}
        </span>
      </div>
      <div className={cn("flex items-center gap-2 px-0.5", isLocked && "invisible")}>
        <span className="text-xs text-muted-foreground/60">↑ Slide mic up to lock</span>
        {dragProgress > 0 && (
          <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-red-400 rounded-full"
              style={{ width: `${dragProgress * 100}%`, transition: "none" }}
            />
          </div>
        )}
      </div>
      <div className="rounded-md overflow-hidden bg-muted/30 border border-red-200 dark:border-red-900/60">
        <canvas
          ref={canvasRef}
          width={512}
          height={40}
          className="w-full block"
          style={{ height: "40px" }}
        />
      </div>
    </div>
  );

  const formatLocalTime = (iso: string | null | undefined): string | null => {
    if (!iso) return null;
    const local = formatDateTimeLocalForTimezone(iso, timezone);
    return local ? local.slice(0, 16).replace("T", " ") : null;
  };

  const actionCard = (action: ProposedAction) => {
    const group = action.group_id ? groups.find((g) => g.id === action.group_id) : null;
    const isUpdate = action.action === "update";
    const status = actionStatus[action._id];
    const existing = isUpdate && action.id ? existingTasks?.find((t) => t.id === action.id) : null;

    const newStart = action.scheduled_start
      ? action.scheduled_start.slice(0, 16).replace("T", " ")
      : null;
    const oldStart = existing ? formatLocalTime(existing.scheduled_start) : null;
    const showReschedule = isUpdate && newStart && newStart !== oldStart;
    const showDuration =
      isUpdate &&
      action.duration != null &&
      existing?.duration != null &&
      action.duration !== existing.duration;

    return (
      <div
        key={action._id}
        className={cn(
          "p-2.5 rounded-md border transition-opacity",
          status === "rejected" && "opacity-50",
          isUpdate
            ? "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800/40"
            : "bg-muted/40 border-input"
        )}
      >
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{action.title}</p>
            <div className="flex flex-wrap gap-1 mt-1">
              <span
                className={cn(
                  "text-xs px-1.5 py-0.5 rounded font-medium",
                  isUpdate
                    ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
                    : "bg-primary/10 text-primary"
                )}
              >
                {isUpdate ? "Edit" : "New"}
              </span>
              {action.task_type && action.task_type !== "task" && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {TYPE_CHIP[action.task_type] ?? action.task_type}
                </span>
              )}
              {action.priority && action.priority !== 3 && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {PRIORITY_CHIP[action.priority] ?? `P${action.priority}`}
                </span>
              )}
              {!isUpdate && newStart && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {newStart}
                </span>
              )}
              {!isUpdate && action.duration != null && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {action.duration}min
                </span>
              )}
              {group && (
                <span
                  className="text-xs px-1.5 py-0.5 rounded text-white"
                  style={{ backgroundColor: group.color || "#6b7280" }}
                >
                  {group.name}
                </span>
              )}
            </div>
            {showReschedule && (
              <p className="text-xs text-muted-foreground mt-1">
                {oldStart ? `${oldStart} → ` : "→ "}
                <span className="text-foreground font-medium">{newStart}</span>
              </p>
            )}
            {showDuration && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {existing?.duration}min →{" "}
                <span className="text-foreground font-medium">{action.duration}min</span>
              </p>
            )}
            {!isUpdate && action.subtasks && action.subtasks.length > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                {action.subtasks.length} subtask{action.subtasks.length !== 1 ? "s" : ""}:{" "}
                {action.subtasks.map((s) => s.title).join(", ")}
              </p>
            )}
          </div>

          {/* Per-item accept / edit / reject */}
          <div className="flex items-center gap-1 shrink-0">
            {status === "applied" ? (
              <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                <Check className="h-3.5 w-3.5" /> Applied
              </span>
            ) : status === "rejected" ? (
              <span className="text-xs text-muted-foreground">Dismissed</span>
            ) : status === "applying" ? (
              <span className="h-4 w-4 block animate-spin rounded-full border-2 border-current border-t-transparent text-muted-foreground" />
            ) : status === "editing" ? (
              <span className="text-xs text-blue-600 dark:text-blue-400 flex items-center gap-1">
                <Pencil className="h-3.5 w-3.5" /> To review
              </span>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => applyAction(action)}
                  className="inline-flex items-center justify-center h-7 w-7 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                  title="Accept"
                  aria-label="Accept"
                >
                  <Check className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => editAction(action)}
                  className="inline-flex items-center justify-center h-7 w-7 rounded-md bg-muted text-muted-foreground hover:bg-blue-500/10 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                  title="Edit before applying"
                  aria-label="Edit before applying"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => rejectAction(action)}
                  className="inline-flex items-center justify-center h-7 w-7 rounded-md bg-muted text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                  title="Reject"
                  aria-label="Reject"
                >
                  <X className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        </div>
        {status === "error" && (
          <p className="text-xs text-destructive mt-1">Failed to apply — try again.</p>
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "max-h-[90vh] w-[95vw] md:w-full mx-2 md:mx-auto flex flex-col",
          isReviewing ? "max-w-2xl" : "max-w-lg"
        )}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5" />
            {isReviewing
              ? `Review task ${reviewIndex + 1} of ${reviewQueue.length}`
              : mode === "quick"
                ? "Add Task with AI"
                : "AI Assistant"}
          </DialogTitle>
        </DialogHeader>

        {/* Mode toggle */}
        {!isReviewing && (
          <div className="flex rounded-md border border-input overflow-hidden shrink-0">
            <button
              type="button"
              onClick={() => switchMode("quick")}
              className={cn(
                "flex-1 px-3 py-1.5 text-sm font-medium transition-colors flex items-center justify-center gap-1.5",
                mode === "quick"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:text-foreground"
              )}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Quick add
            </button>
            <button
              type="button"
              onClick={() => switchMode("assistant")}
              className={cn(
                "flex-1 px-3 py-1.5 text-sm font-medium transition-colors border-l border-input flex items-center justify-center gap-1.5",
                mode === "assistant"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:text-foreground"
              )}
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Assistant
            </button>
          </div>
        )}

        {/* Quick add view */}
        {mode === "quick" && !isReviewing && (
          <div className="space-y-4 flex-1 overflow-y-auto min-h-0">
            <div className="flex flex-col h-44">
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Describe your task in plain English…"
                className="flex-1 min-h-0 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isParsing || isTranscribing}
              />
              {recordingVisualizer}
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="generate-subtasks"
                checked={generateSubtasks}
                onCheckedChange={(checked) => setGenerateSubtasks(checked === true)}
                disabled={isParsing}
              />
              <label htmlFor="generate-subtasks" className="text-sm cursor-pointer select-none">
                Generate subtasks
              </label>
            </div>

            {parseError && <p className="text-sm text-destructive">{parseError}</p>}

            {partialWarning && (
              <p className="text-sm text-amber-600 dark:text-amber-400">
                Could not extract: {partialWarning.join(", ")}. You can fill these in the form.
              </p>
            )}
          </div>
        )}

        {/* Assistant view */}
        {mode === "assistant" && !isReviewing && (
          <div className="flex-1 flex flex-col min-h-0 gap-3">
            <div className="flex-1 overflow-y-auto space-y-3 min-h-0 pr-1">
              {messages.length === 0 && (
                <p className="text-sm text-muted-foreground text-center pt-4">
                  Tell me what you need — I can build tasks from a brain dump, or manage your
                  schedule ("move my lunch to 1pm", "extend the washing to 2 hours"). I'll ask if I
                  need more detail.
                </p>
              )}
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    "flex flex-col gap-1",
                    msg.role === "user" ? "items-end" : "items-start"
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground rounded-br-sm"
                        : "bg-muted text-foreground rounded-bl-sm"
                    )}
                  >
                    {msg.content}
                  </div>
                  {msg.actions && msg.actions.length > 0 && (
                    <div className="w-full max-w-[95%] mt-1 space-y-1.5">
                      <p className="text-xs text-muted-foreground font-medium px-1">
                        Proposed changes — accept, edit, or reject each:
                      </p>
                      {msg.actions.map((a) => actionCard(a))}
                    </div>
                  )}
                </div>
              ))}
              {isAssistantLoading && (
                <div className="flex items-start">
                  <div className="bg-muted rounded-2xl rounded-bl-sm px-3 py-2 flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:0ms]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {editingActions.length > 0 && (
              <div className="shrink-0 flex items-center justify-between gap-2 rounded-md border border-blue-200 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/20 px-3 py-2">
                <span className="text-xs text-blue-700 dark:text-blue-300">
                  {editingActions.length} task{editingActions.length !== 1 ? "s" : ""} to review &
                  edit before applying.
                </span>
                <Button size="sm" onClick={startReview}>
                  Review {editingActions.length} →
                </Button>
              </div>
            )}

            <div className="shrink-0 space-y-1.5">
              <div className="flex gap-2">
                <textarea
                  ref={assistantTextareaRef}
                  value={assistantInput}
                  onChange={(e) => setAssistantInput(e.target.value)}
                  onKeyDown={handleAssistantKeyDown}
                  placeholder="Type your message…"
                  rows={2}
                  className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isAssistantLoading || isTranscribing}
                />
                <div className="flex flex-col gap-1.5">
                  {micButton}
                  <Button
                    size="sm"
                    onClick={sendAssistantMessage}
                    disabled={!assistantInput.trim() || isAssistantLoading || isTranscribing}
                    className="h-auto px-3 py-2"
                  >
                    Send →
                  </Button>
                </div>
              </div>
              {recordingVisualizer}
              {parseError && <p className="text-sm text-destructive">{parseError}</p>}
            </div>
          </div>
        )}

        {/* Review sub-view — walk through each edit-marked task in the full task form */}
        {isReviewing && reviewQueue[reviewIndex] && (
          <div className="flex-1 overflow-y-auto min-h-0">
            <TaskForm
              key={reviewQueue[reviewIndex]._id}
              onSubmit={submitReviewItem}
              onCancel={endReview}
              initialData={buildReviewInitialData(reviewQueue[reviewIndex])}
              isLoading={isReviewSubmitting}
              taskGroups={groups}
              queueInfo={{
                current: reviewIndex + 1,
                total: reviewQueue.length,
                onSkip: skipReviewItem,
              }}
            />
          </div>
        )}

        {/* Footer */}
        {!isReviewing && (
          <div className="shrink-0 flex items-center justify-between pt-3 border-t">
            {mode === "quick" ? (
              <>
                {micButton}
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isParsing}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleParse}
                    disabled={!text.trim() || isParsing || isTranscribing}
                  >
                    {isParsing ? (
                      <>
                        <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        Parsing…
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 mr-2" />
                        Parse with AI
                      </>
                    )}
                  </Button>
                </div>
              </>
            ) : (
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
