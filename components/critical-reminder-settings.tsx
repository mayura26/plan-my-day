"use client";

import { AlertTriangle } from "lucide-react";
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

const INTERVAL_OPTIONS = [5, 10, 15, 30, 45, 60, 90, 120];

export function CriticalReminderSettings() {
  const [enabled, setEnabled] = useState(true);
  const [intervalMinutes, setIntervalMinutes] = useState(15);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch("/api/user/scheduling-preferences");
        if (response.ok) {
          const data = await response.json();
          setEnabled(data.critical_reminder_enabled !== false);
          const iv = Number(data.critical_reminder_interval_minutes);
          if (Number.isFinite(iv) && iv >= 1 && iv <= 120) {
            setIntervalMinutes(iv);
          }
        }
      } catch (e) {
        console.error(e);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const response = await fetch("/api/user/scheduling-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          critical_reminder_enabled: enabled,
          critical_reminder_interval_minutes: intervalMinutes,
        }),
      });
      if (response.ok) {
        toast.success("Critical reminder settings updated");
      } else {
        const err = await response.json();
        toast.error(err.error || "Failed to save");
      }
    } catch (e) {
      console.error(e);
      toast.error("Failed to save");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        Loading…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
        <div className="space-y-1 text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">Critical tasks (priority 1)</span> that
            are overdue keep sending push notifications at the interval below until you complete the
            task or snooze from the notification.
          </p>
          <p>
            Requires push enabled, group reminders on, and min priority including Critical. Deploy
            with <code className="text-xs bg-muted px-1 rounded">CRON_SECRET</code> and scheduled
            cron (see Vercel or run{" "}
            <code className="text-xs bg-muted px-1 rounded">npm run reminders:process</code>
            ).
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor="critical_reminder_enabled">Repeat overdue critical reminders</Label>
          <p className="text-xs text-muted-foreground">
            When off, overdue critical tasks use the same one-shot reminders as other priorities.
          </p>
        </div>
        <Switch id="critical_reminder_enabled" checked={enabled} onCheckedChange={setEnabled} />
      </div>

      {enabled && (
        <div className="space-y-2 max-w-xs">
          <Label htmlFor="critical_interval">Minutes between reminders</Label>
          <Select
            value={intervalMinutes.toString()}
            onValueChange={(v) => setIntervalMinutes(parseInt(v, 10))}
          >
            <SelectTrigger id="critical_interval">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INTERVAL_OPTIONS.map((m) => (
                <SelectItem key={m} value={m.toString()}>
                  {m} min
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <Button type="button" onClick={handleSave} loading={isSaving}>
        Save critical reminder settings
      </Button>
    </div>
  );
}
