import { CheckCircle2, Clock, XCircle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReminderActionOutcome } from "@/lib/push-action-handlers";

interface ReminderActionViewProps {
  outcome: ReminderActionOutcome;
}

function errorMessage(error: ReminderActionOutcome & { ok: false }): string {
  switch (error.error) {
    case "missing_token":
      return "This reminder link is missing a token.";
    case "invalid":
      return "This reminder link is invalid or has expired.";
    case "unauthorized":
      return "You do not have permission to perform this action.";
    case "not_found":
      return "This task could not be found. It may have been deleted.";
    default:
      return "Something went wrong. Please try again from the app.";
  }
}

export function ReminderActionView({ outcome }: ReminderActionViewProps) {
  if (!outcome.ok) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <XCircle className="h-6 w-6 text-destructive" />
          </div>
          <CardTitle>Action failed</CardTitle>
          <CardDescription>{errorMessage(outcome)}</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button asChild variant="outline">
            <Link href="/tasks">Go to tasks</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const isComplete = outcome.action === "complete";
  const title = isComplete ? (outcome.alreadyCompleted ? "Already completed" : "Done") : "Snoozed";
  const description =
    outcome.message ??
    (isComplete
      ? outcome.entityType === "test"
        ? "Test action reached the server."
        : "Task marked complete."
      : "Reminders snoozed.");

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <div
          className={`mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full ${
            isComplete ? "bg-green-500/10" : "bg-amber-500/10"
          }`}
        >
          {isComplete ? (
            <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
          ) : (
            <Clock className="h-6 w-6 text-amber-600 dark:text-amber-400" />
          )}
        </div>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center gap-3">
        <Button asChild variant="outline">
          <Link href="/calendar">View calendar</Link>
        </Button>
        <Button asChild>
          <Link href={outcome.entityType === "test" ? "/settings" : "/tasks"}>
            {outcome.entityType === "test" ? "Back to settings" : "Go to tasks"}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
