"use client";

import { Calendar, CheckCircle2, Clock, ListTodo, Zap } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ENERGY_LABELS, PRIORITY_LABELS } from "@/lib/task-utils";
import type { QuickTag, Task } from "@/lib/types";

type PageState =
  | "loading"
  | "auth-redirect"
  | "auto-creating"
  | "confirm-form"
  | "success"
  | "error";

export default function QuickTaskPage() {
  const { data: session, status: authStatus } = useSession();
  const { tagId } = useParams<{ tagId: string }>();
  const router = useRouter();

  const [pageState, setPageState] = useState<PageState>("loading");
  const [tag, setTag] = useState<QuickTag | null>(null);
  const [createdTask, setCreatedTask] = useState<Task | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Form state for confirm flow
  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formOffset, setFormOffset] = useState(60);
  const [formPriority, setFormPriority] = useState(3);
  const [formDuration, setFormDuration] = useState("30");
  const [formEnergy, setFormEnergy] = useState(3);

  // Redirect unauthenticated users
  useEffect(() => {
    if (authStatus === "unauthenticated") {
      setPageState("auth-redirect");
      signIn(undefined, { callbackUrl: `/q/${tagId}` });
    }
  }, [authStatus, tagId]);

  const executeTag = useCallback(
    async (overrides?: Record<string, any>) => {
      try {
        const res = await fetch(`/api/quick-tags/${tagId}/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(overrides || {}),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to create task");
        }

        const data = await res.json();
        setCreatedTask(data.task);
        setPageState("success");
        toast.success("Task created!");
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Something went wrong");
        setPageState("error");
      }
    },
    [tagId]
  );

  // Fetch tag and determine flow
  useEffect(() => {
    if (authStatus !== "authenticated" || !session) return;

    const fetchTag = async () => {
      try {
        const res = await fetch(`/api/quick-tags/${tagId}`);
        if (!res.ok) {
          if (res.status === 404) {
            setErrorMessage("This Quick Tag was not found or has been deleted.");
          } else {
            setErrorMessage("Failed to load tag configuration.");
          }
          setPageState("error");
          return;
        }

        const data = await res.json();
        const fetchedTag: QuickTag = data.tag;
        setTag(fetchedTag);

        if (fetchedTag.auto_accept) {
          setPageState("auto-creating");
          executeTag();
        } else {
          // Set up form with tag defaults
          setFormTitle(fetchedTag.task_title);
          setFormDescription(fetchedTag.task_description || "");
          setFormOffset(fetchedTag.schedule_offset_minutes);
          setFormPriority(fetchedTag.priority);
          setFormDuration(fetchedTag.duration_minutes?.toString() || "30");
          setFormEnergy(fetchedTag.energy_level);
          setPageState("confirm-form");
        }
      } catch (error) {
        console.error("Error fetching tag:", error);
        setErrorMessage("Failed to load tag configuration.");
        setPageState("error");
      }
    };

    fetchTag();
  }, [authStatus, session, tagId, executeTag]);

  const handleConfirmSubmit = async () => {
    setSubmitting(true);
    await executeTag({
      task_title: formTitle,
      task_description: formDescription || undefined,
      schedule_offset_minutes: formOffset,
      priority: formPriority,
      duration_minutes: parseInt(formDuration, 10) || 30,
      energy_level: formEnergy,
    });
    setSubmitting(false);
  };

  const getOffsetLabel = (minutes: number) => {
    if (minutes === 0) return "now";
    if (minutes < 60) return `in ${minutes} min`;
    const hours = minutes / 60;
    if (hours === Math.floor(hours)) return `in ${hours}h`;
    return `in ${Math.floor(hours)}h ${minutes % 60}m`;
  };

  // Loading state
  if (pageState === "loading" || pageState === "auth-redirect") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-4" />
            <p className="text-muted-foreground">
              {pageState === "auth-redirect" ? "Redirecting to sign in..." : "Loading..."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Auto-creating state
  if (pageState === "auto-creating") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-4" />
            <p className="text-lg font-medium mb-1">Creating task...</p>
            {tag && <p className="text-muted-foreground">{tag.task_title}</p>}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Success state
  if (pageState === "success" && createdTask) {
    const scheduledTime = createdTask.scheduled_start
      ? new Date(createdTask.scheduled_start).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;
    const scheduledDate = createdTask.scheduled_start
      ? new Date(createdTask.scheduled_start).toLocaleDateString([], {
          weekday: "short",
          month: "short",
          day: "numeric",
        })
      : null;

    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center py-8 space-y-4">
            <div className="h-16 w-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
            </div>
            <div className="text-center space-y-1">
              <h2 className="text-xl font-bold">Task Created!</h2>
              <p className="text-lg">{createdTask.title}</p>
              {scheduledDate && scheduledTime && (
                <p className="text-muted-foreground">
                  Scheduled for {scheduledDate} at {scheduledTime}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2 justify-center">
              <Badge variant="secondary">
                {createdTask.task_type === "todo" ? "To-Do" : "Task"}
              </Badge>
              <Badge variant="outline">P{createdTask.priority}</Badge>
              {createdTask.duration && (
                <Badge variant="outline">
                  <Clock className="h-3 w-3 mr-1" />
                  {createdTask.duration}m
                </Badge>
              )}
            </div>
            <div className="flex gap-3 pt-2">
              <Button asChild>
                <Link href="/calendar">
                  <Calendar className="h-4 w-4 mr-2" />
                  Calendar
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/tasks">
                  <ListTodo className="h-4 w-4 mr-2" />
                  Tasks
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Error state
  if (pageState === "error") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center py-12 space-y-4">
            <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center">
              <span className="text-2xl">!</span>
            </div>
            <div className="text-center space-y-1">
              <h2 className="text-xl font-bold">Something went wrong</h2>
              <p className="text-muted-foreground">{errorMessage}</p>
            </div>
            <div className="flex gap-3">
              <Button onClick={() => router.push("/calendar")}>Go to Calendar</Button>
              <Button variant="outline" onClick={() => window.location.reload()}>
                Try Again
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Confirm form state
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Quick Task
          </CardTitle>
          <CardDescription>
            {tag?.name ? `From tag: ${tag.name}` : "Review and create task"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="q-title">Title</Label>
            <Input id="q-title" value={formTitle} onChange={(e) => setFormTitle(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="q-desc">Description</Label>
            <Textarea
              id="q-desc"
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label>Schedule {getOffsetLabel(formOffset)}</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min="0"
                value={formOffset}
                onChange={(e) => setFormOffset(parseInt(e.target.value, 10) || 0)}
                className="w-24"
              />
              <span className="text-sm text-muted-foreground">minutes from now</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select
                value={formPriority.toString()}
                onValueChange={(v) => setFormPriority(parseInt(v, 10))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((p) => (
                    <SelectItem key={p} value={p.toString()}>
                      {p} - {PRIORITY_LABELS[p as keyof typeof PRIORITY_LABELS]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Duration</Label>
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  min="1"
                  value={formDuration}
                  onChange={(e) => setFormDuration(e.target.value)}
                />
                <span className="text-sm text-muted-foreground">min</span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Energy Level</Label>
            <Select
              value={formEnergy.toString()}
              onValueChange={(v) => setFormEnergy(parseInt(v, 10))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5].map((e) => (
                  <SelectItem key={e} value={e.toString()}>
                    {e} - {ENERGY_LABELS[e as keyof typeof ENERGY_LABELS]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            className="w-full"
            onClick={handleConfirmSubmit}
            disabled={submitting || !formTitle.trim()}
          >
            {submitting ? "Creating..." : "Create Task"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
