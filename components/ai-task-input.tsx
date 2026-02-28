"use client";

import { Lock, Mic, MicOff, Sparkles, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { TaskGroup } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { CreateTaskRequestWithSubtasks } from "./task-form";

interface AITaskInputProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onParsed: (data: Partial<CreateTaskRequestWithSubtasks>) => void;
  groups?: TaskGroup[];
}

const LOCK_THRESHOLD = 60; // px upward drag to lock recording

export function AITaskInput({ open, onOpenChange, onParsed, groups = [] }: AITaskInputProps) {
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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
    } else {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [open, isRecording]);

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
          setText((prev) => (prev ? `${prev} ${data.text}` : data.text));
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

  // Mouse: click to toggle
  const handleMicClick = async () => {
    if (isParsing || isTranscribing) return;
    if (isRecording) {
      mediaRecorderRef.current?.stop();
    } else {
      await startRecording();
    }
  };

  // Touch: press-and-hold to record, drag up to lock
  const handlePointerDown = async (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType !== "touch") return;
    if (isParsing || isTranscribing || isRecording) return;
    e.preventDefault(); // suppress synthesized click so it doesn't double-fire
    e.currentTarget.setPointerCapture(e.pointerId);
    pointerStartYRef.current = e.clientY;
    await startRecording();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType !== "touch" || !isRecording || isLocked) return;
    const deltaY = pointerStartYRef.current - e.clientY; // positive = dragged upward
    const progress = Math.min(1, Math.max(0, deltaY / LOCK_THRESHOLD));
    setDragProgress(progress);
    if (deltaY >= LOCK_THRESHOLD) {
      setIsLocked(true);
      setDragProgress(0);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType !== "touch" || !isRecording || isLocked) return;
    // Hold mode: release finger → stop immediately
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

      // API already returns dates in datetime-local format for the user's timezone
      onParsed(data.parsed);
      onOpenChange(false);
    } catch {
      setParseError("Network error. Please check your connection and try again.");
    } finally {
      setIsParsing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter alone submits; Shift+Enter inserts newline
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleParse();
    }
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

        <div className="space-y-4 flex-1 overflow-y-auto min-h-0">
          <div className="flex flex-col h-44">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe your task in plain English..."
              className="flex-1 min-h-0 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isParsing || isTranscribing}
            />

            {/* Recording visualizer panel */}
            {isRecording && (
              <div className="mt-1.5 space-y-1.5">
                {/* Status row */}
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

                {/* Drag-to-lock hint + progress bar — always rendered to prevent layout shift when locking */}
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

                {/* Frequency visualizer canvas */}
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
            )}
          </div>

          {/* Generate subtasks option */}
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

          {/* Error */}
          {parseError && <p className="text-sm text-destructive">{parseError}</p>}

          {/* Partial warning */}
          {partialWarning && (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              Could not extract: {partialWarning.join(", ")}. You can fill these in the form.
            </p>
          )}
        </div>

        {/* Footer — outside the scrollable body so it never moves */}
        <div className="shrink-0 flex items-center justify-between pt-3 border-t">
          {/* Mic — left side */}
          <button
            type="button"
            onClick={handleMicClick}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            disabled={isParsing || isTranscribing}
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

          {/* Cancel + Parse — right side */}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isParsing}>
              Cancel
            </Button>
            <Button onClick={handleParse} disabled={!text.trim() || isParsing || isTranscribing}>
              {isParsing ? (
                <>
                  <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Parsing...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Parse with AI
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
