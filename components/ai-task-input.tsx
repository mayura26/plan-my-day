"use client";

import { CheckSquare, Lock, MessageCircle, Mic, MicOff, Sparkles, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { TaskGroup } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { CreateTaskRequestWithSubtasks } from "./task-form";

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
}

interface AITaskInputProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onParsed: (data: Partial<CreateTaskRequestWithSubtasks>) => void;
  onMultipleParsed: (tasks: Partial<CreateTaskRequestWithSubtasks>[]) => void;
  groups?: TaskGroup[];
  existingTasks?: ExistingTaskContext[];
}

type Mode = "single" | "braindump" | "plan";

interface PreviewTask {
  title: string;
  task_type?: string;
  priority?: number;
  group_id?: string;
  _previewId?: string;
  [key: string]: unknown;
}

interface ProposedTask {
  action?: "create" | "update";
  id?: string | null; // existing task id when action === "update"
  title: string;
  description?: string | null;
  task_type?: string;
  priority?: number;
  duration?: number;
  energy_level_required?: number;
  scheduled_start?: string | null;
  scheduled_end?: string | null;
  due_date?: string | null;
  group_id?: string | null;
  [key: string]: unknown;
}

interface PlanMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  proposedTasks?: ProposedTask[];
}

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
  onMultipleParsed,
  groups = [],
  existingTasks,
}: AITaskInputProps) {
  const [mode, setMode] = useState<Mode>("single");
  const [text, setText] = useState("");
  const [generateSubtasks, setGenerateSubtasks] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [partialWarning, setPartialWarning] = useState<string[] | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [dragProgress, setDragProgress] = useState(0);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  // Brain dump preview state
  const [previewTasks, setPreviewTasks] = useState<PreviewTask[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [showPreview, setShowPreview] = useState(false);

  // Plan mode state
  const [planMessages, setPlanMessages] = useState<PlanMessage[]>([]);
  const [planInput, setPlanInput] = useState("");
  const [isPlanLoading, setIsPlanLoading] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const planTextareaRef = useRef<HTMLTextAreaElement>(null);
  const planMessagesEndRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerStartYRef = useRef<number>(0);

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
      setPreviewTasks([]);
      setSelectedIndices(new Set());
      setShowPreview(false);
      setPlanMessages([]);
      setPlanInput("");
      setIsPlanLoading(false);
    } else {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [open, isRecording]);

  // Scroll plan chat to bottom on new messages or when loading state changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: ref scroll must run when message list or loading changes, not derivable from effect body for static analysis
  useEffect(() => {
    if (mode === "plan") {
      planMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [mode, planMessages.length, isPlanLoading]);

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
    setText("");
    setParseError(null);
    setPartialWarning(null);
    setPreviewTasks([]);
    setSelectedIndices(new Set());
    setShowPreview(false);
    setPlanMessages([]);
    setPlanInput("");
    setIsPlanLoading(false);
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
          if (mode === "plan") {
            setPlanInput((prev) => (prev ? `${prev} ${data.text}` : data.text));
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
    if (isParsing || isTranscribing || isPlanLoading) return;
    if (isRecording) {
      mediaRecorderRef.current?.stop();
    } else {
      await startRecording();
    }
  };

  const handlePointerDown = async (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType !== "touch") return;
    if (isParsing || isTranscribing || isRecording || isPlanLoading) return;
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

  const handleBrainDump = async () => {
    if (!text.trim() || isParsing) return;

    setIsParsing(true);
    setParseError(null);

    try {
      const response = await fetch("/api/ai/parse-tasks-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.trim(),
          groups: groups.map((g) => ({ id: g.id, name: g.name })),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setParseError(data.error || "Failed to parse tasks");
        return;
      }

      if (!Array.isArray(data.tasks) || data.tasks.length === 0) {
        setParseError("Could not extract any tasks. Please add more detail.");
        return;
      }

      const tasksWithKeys = (data.tasks as PreviewTask[]).map((t) => ({
        ...t,
        _previewId: crypto.randomUUID(),
      }));
      setPreviewTasks(tasksWithKeys);
      setSelectedIndices(new Set(tasksWithKeys.map((_: PreviewTask, i: number) => i)));
      setShowPreview(true);
    } catch {
      setParseError("Network error. Please check your connection and try again.");
    } finally {
      setIsParsing(false);
    }
  };

  const sendPlanMessage = async () => {
    if (!planInput.trim() || isPlanLoading) return;
    const userMessage: PlanMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: planInput.trim(),
    };
    const updatedMessages = [...planMessages, userMessage];
    setPlanMessages(updatedMessages);
    setPlanInput("");
    setIsPlanLoading(true);
    try {
      const res = await fetch("/api/ai/plan-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedMessages.map((m) => ({ role: m.role, content: m.content })),
          groups: groups.filter((g) => !g.is_parent_group).map((g) => ({ id: g.id, name: g.name })),
          existing_tasks: existingTasks?.slice(0, 20) ?? [],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPlanMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: data.error || "Something went wrong. Please try again.",
          },
        ]);
        return;
      }
      const assistantMsg: PlanMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.message,
        proposedTasks: data.ready && data.proposed_tasks ? data.proposed_tasks : undefined,
      };
      setPlanMessages((prev) => [...prev, assistantMsg]);
    } catch {
      setPlanMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "Network error. Please check your connection and try again.",
        },
      ]);
    } finally {
      setIsPlanLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (mode === "single") handleParse();
      else handleBrainDump();
    }
  };

  const handlePlanKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendPlanMessage();
    }
  };

  const toggleIndex = (i: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const handleStartCreating = () => {
    const selected = previewTasks.filter((_, i) => selectedIndices.has(i));
    if (selected.length === 0) return;
    onMultipleParsed(selected as Partial<CreateTaskRequestWithSubtasks>[]);
    onOpenChange(false);
  };

  const handleApplyProposedTasks = async (tasks: ProposedTask[]) => {
    const creates = tasks.filter((t) => t.action !== "update");
    const updates = tasks.filter((t) => t.action === "update" && t.id);

    // Fire updates in parallel — best-effort, don't block creates
    if (updates.length > 0) {
      await Promise.allSettled(
        updates.map((t) => {
          const { action: _action, id, ...fields } = t;
          return fetch(`/api/tasks/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(fields),
          });
        })
      );
    }

    if (creates.length > 0) {
      onMultipleParsed(creates as Partial<CreateTaskRequestWithSubtasks>[]);
    }

    onOpenChange(false);
  };

  const micButton = (
    <button
      type="button"
      onClick={handleMicClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      disabled={isParsing || isTranscribing || isPlanLoading}
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

  const proposedTaskCard = (task: ProposedTask, idx: number) => {
    const group = task.group_id ? groups.find((g) => g.id === task.group_id) : null;
    const isUpdate = task.action === "update";
    return (
      <div
        key={idx}
        className={cn(
          "flex items-start gap-2 p-2 rounded-md border",
          isUpdate
            ? "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800/40"
            : "bg-muted/40 border-input"
        )}
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{task.title}</p>
          <div className="flex flex-wrap gap-1 mt-1">
            <span
              className={cn(
                "text-xs px-1.5 py-0.5 rounded font-medium",
                isUpdate
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
                  : "bg-primary/10 text-primary"
              )}
            >
              {isUpdate ? "Update" : "New"}
            </span>
            {task.task_type && task.task_type !== "task" && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                {TYPE_CHIP[task.task_type] ?? task.task_type}
              </span>
            )}
            {task.priority && task.priority !== 3 && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                {PRIORITY_CHIP[task.priority as number] ?? `P${task.priority}`}
              </span>
            )}
            {task.scheduled_start && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                {task.scheduled_start.slice(11, 16)}
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
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] w-[95vw] md:w-full mx-2 md:mx-auto flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5" />
            Add Task with AI
          </DialogTitle>
        </DialogHeader>

        {/* Mode toggle */}
        {!showPreview && (
          <div className="flex rounded-md border border-input overflow-hidden shrink-0">
            <button
              type="button"
              onClick={() => switchMode("single")}
              className={cn(
                "flex-1 px-3 py-1.5 text-sm font-medium transition-colors",
                mode === "single"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:text-foreground"
              )}
            >
              Single task
            </button>
            <button
              type="button"
              onClick={() => switchMode("braindump")}
              className={cn(
                "flex-1 px-3 py-1.5 text-sm font-medium transition-colors border-l border-input",
                mode === "braindump"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:text-foreground"
              )}
            >
              Brain dump
            </button>
            <button
              type="button"
              onClick={() => switchMode("plan")}
              className={cn(
                "flex-1 px-3 py-1.5 text-sm font-medium transition-colors border-l border-input flex items-center justify-center gap-1.5",
                mode === "plan"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:text-foreground"
              )}
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Plan
            </button>
          </div>
        )}

        {/* View 1 & 2: single / braindump input views */}
        {!showPreview && mode !== "plan" && (
          <div className="space-y-4 flex-1 overflow-y-auto min-h-0">
            <div className="flex flex-col h-44">
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  mode === "single"
                    ? "Describe your task in plain English..."
                    : "Describe everything you need to get done…"
                }
                className="flex-1 min-h-0 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isParsing || isTranscribing}
              />
              {recordingVisualizer}
            </div>

            {/* Generate subtasks — single mode only */}
            {mode === "single" && (
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
            )}

            {/* Error */}
            {parseError && <p className="text-sm text-destructive">{parseError}</p>}

            {/* Partial warning */}
            {partialWarning && (
              <p className="text-sm text-amber-600 dark:text-amber-400">
                Could not extract: {partialWarning.join(", ")}. You can fill these in the form.
              </p>
            )}
          </div>
        )}

        {/* View 3: preview list */}
        {showPreview && (
          <div className="flex-1 flex flex-col min-h-0">
            <p className="text-sm text-muted-foreground shrink-0 mb-3">
              {previewTasks.length} task{previewTasks.length !== 1 ? "s" : ""} from your brain dump
              — uncheck any you don't want.
            </p>
            <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
              {previewTasks.map((task, i) => {
                const group = task.group_id ? groups.find((g) => g.id === task.group_id) : null;
                return (
                  <button
                    key={task._previewId ?? `preview-${task.title}-${i}`}
                    type="button"
                    onClick={() => toggleIndex(i)}
                    className={cn(
                      "w-full text-left flex items-start gap-3 p-3 rounded-lg border transition-colors",
                      selectedIndices.has(i)
                        ? "border-primary/40 bg-primary/5"
                        : "border-input bg-muted/30 opacity-60"
                    )}
                  >
                    <div className="mt-0.5 shrink-0">
                      {selectedIndices.has(i) ? (
                        <CheckSquare className="h-4 w-4 text-primary" />
                      ) : (
                        <div className="h-4 w-4 rounded border-2 border-muted-foreground/40" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{task.title}</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {task.task_type && task.task_type !== "task" && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            {TYPE_CHIP[task.task_type] ?? task.task_type}
                          </span>
                        )}
                        {task.priority && task.priority !== 3 && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            {PRIORITY_CHIP[task.priority as number] ?? `P${task.priority}`}
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
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* View 4: Plan mode chat */}
        {!showPreview && mode === "plan" && (
          <div className="flex-1 flex flex-col min-h-0 gap-3">
            {/* Message history */}
            <div className="flex-1 overflow-y-auto space-y-3 min-h-0 pr-1">
              {planMessages.length === 0 && (
                <p className="text-sm text-muted-foreground text-center pt-4">
                  Describe what you need to plan and I'll help you break it down into tasks.
                </p>
              )}
              {planMessages.map((msg) => (
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
                  {msg.proposedTasks && msg.proposedTasks.length > 0 && (
                    <div className="w-full max-w-[95%] mt-1 space-y-1.5">
                      <p className="text-xs text-muted-foreground font-medium px-1">
                        {(() => {
                          const creates = msg.proposedTasks.filter(
                            (t) => t.action !== "update"
                          ).length;
                          const updates = msg.proposedTasks.filter(
                            (t) => t.action === "update"
                          ).length;
                          const parts = [];
                          if (creates > 0)
                            parts.push(`${creates} new task${creates !== 1 ? "s" : ""}`);
                          if (updates > 0)
                            parts.push(`${updates} update${updates !== 1 ? "s" : ""}`);
                          return parts.join(", ");
                        })()}:
                      </p>
                      {msg.proposedTasks.map((t, idx) => proposedTaskCard(t, idx))}
                      <div className="flex items-center gap-3 pt-1">
                        <Button
                          size="sm"
                          onClick={() => {
                            const tasks = msg.proposedTasks;
                            if (tasks && tasks.length > 0) {
                              handleApplyProposedTasks(tasks);
                            }
                          }}
                        >
                          Apply all →
                        </Button>
                        <button
                          type="button"
                          onClick={() => planTextareaRef.current?.focus()}
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          Keep chatting
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {isPlanLoading && (
                <div className="flex items-start">
                  <div className="bg-muted rounded-2xl rounded-bl-sm px-3 py-2 flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:0ms]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              )}
              <div ref={planMessagesEndRef} />
            </div>

            {/* Plan input */}
            <div className="shrink-0 space-y-1.5">
              <div className="flex gap-2">
                <textarea
                  ref={planTextareaRef}
                  value={planInput}
                  onChange={(e) => setPlanInput(e.target.value)}
                  onKeyDown={handlePlanKeyDown}
                  placeholder="Type your message…"
                  rows={2}
                  className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isPlanLoading || isTranscribing}
                />
                <div className="flex flex-col gap-1.5">
                  {micButton}
                  <Button
                    size="sm"
                    onClick={sendPlanMessage}
                    disabled={!planInput.trim() || isPlanLoading || isTranscribing}
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

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between pt-3 border-t">
          {mode === "plan" && !showPreview ? (
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          ) : !showPreview ? (
            <>
              {micButton}
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isParsing}>
                  Cancel
                </Button>
                <Button
                  onClick={mode === "single" ? handleParse : handleBrainDump}
                  disabled={!text.trim() || isParsing || isTranscribing}
                >
                  {isParsing ? (
                    <>
                      <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      {mode === "single" ? "Parsing..." : "Analysing..."}
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      {mode === "single" ? "Parse with AI" : "Generate tasks"}
                    </>
                  )}
                </Button>
              </div>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setShowPreview(false)}>
                <X className="h-4 w-4 mr-1.5" />
                Back
              </Button>
              <div className="flex gap-2 items-center">
                <span className="text-xs text-muted-foreground">
                  {selectedIndices.size} selected
                </span>
                <Button onClick={handleStartCreating} disabled={selectedIndices.size === 0}>
                  Start Creating →
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
