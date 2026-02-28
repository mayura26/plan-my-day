"use client";

import { CalendarClock, Clock, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { SchedulingMode } from "@/lib/types";

const SCHEDULE_MODE_OPTIONS: { value: SchedulingMode; label: string }[] = [
  { value: "now", label: "Schedule Now" },
  { value: "today", label: "Schedule Today" },
  { value: "tomorrow", label: "Schedule Tomorrow" },
  { value: "next-week", label: "Schedule Next Week" },
  { value: "next-month", label: "Schedule Next Month" },
  { value: "asap", label: "Schedule ASAP" },
  { value: "due-date", label: "Schedule to Due Date" },
];

function ModeIcon({ mode }: { mode: SchedulingMode }) {
  if (mode === "now") return <Clock className="h-4 w-4 mr-2" />;
  if (mode === "asap") return <Zap className="h-4 w-4 mr-2" />;
  return <CalendarClock className="h-4 w-4 mr-2" />;
}

export function SchedulingPreferencesSelector() {
  const [autoScheduleNewTasks, setAutoScheduleNewTasks] = useState(false);
  const [defaultScheduleMode, setDefaultScheduleMode] = useState<SchedulingMode>("now");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const fetchPrefs = async () => {
      try {
        const response = await fetch("/api/user/scheduling-preferences");
        if (response.ok) {
          const data = await response.json();
          setAutoScheduleNewTasks(data.auto_schedule_new_tasks ?? false);
          setDefaultScheduleMode(
            data.default_schedule_mode &&
              SCHEDULE_MODE_OPTIONS.some((o) => o.value === data.default_schedule_mode)
              ? data.default_schedule_mode
              : "now"
          );
        }
      } catch (error) {
        console.error("Error fetching scheduling preferences:", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchPrefs();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const response = await fetch("/api/user/scheduling-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auto_schedule_new_tasks: autoScheduleNewTasks,
          default_schedule_mode: defaultScheduleMode,
        }),
      });
      if (response.ok) {
        toast.success("Scheduling preferences updated");
      } else {
        const err = await response.json();
        toast.error(err.error || "Failed to update preferences");
      }
    } catch (error) {
      console.error("Error saving scheduling preferences:", error);
      toast.error("Failed to update preferences");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="text-sm text-muted-foreground">Loading...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor="auto_schedule_new_tasks">Auto-schedule new tasks</Label>
          <p className="text-xs text-muted-foreground">
            When enabled, the new task form will have auto-schedule turned on by default with the
            mode below.
          </p>
        </div>
        <Switch
          id="auto_schedule_new_tasks"
          checked={autoScheduleNewTasks}
          onCheckedChange={setAutoScheduleNewTasks}
        />
      </div>

      {autoScheduleNewTasks && (
        <div className="space-y-2">
          <Label htmlFor="default_schedule_mode">Default schedule mode</Label>
          <p className="text-xs text-muted-foreground">
            Used when creating a new task with auto-schedule on. &quot;Schedule to Due Date&quot;
            only applies when the task has a due date.
          </p>
          <Select
            value={defaultScheduleMode}
            onValueChange={(v) => setDefaultScheduleMode(v as SchedulingMode)}
          >
            <SelectTrigger id="default_schedule_mode" className="w-full max-w-xs">
              <SelectValue>
                {SCHEDULE_MODE_OPTIONS.find((o) => o.value === defaultScheduleMode)?.label ??
                  "Schedule Now"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {SCHEDULE_MODE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  <span className="flex items-center">
                    <ModeIcon mode={opt.value} />
                    {opt.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="pt-2">
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}
