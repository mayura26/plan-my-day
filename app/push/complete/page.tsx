import { AlertCircle, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { executePushComplete } from "@/lib/push-action-handlers";

interface PushCompletePageProps {
  searchParams: Promise<{ token?: string }>;
}

function errorMessage(error: string | undefined): string {
  switch (error) {
    case "missing_token":
      return "This link is missing a completion token.";
    case "invalid_token":
      return "This link is invalid or has expired. Open the task from the app to mark it complete.";
    case "task_not_found":
      return "This task could not be found. It may have been deleted.";
    case "forbidden":
      return "You do not have permission to complete this task.";
    default:
      return "Something went wrong. Please try again from the app.";
  }
}

export default async function PushCompletePage({ searchParams }: PushCompletePageProps) {
  const { token } = await searchParams;
  const result = await executePushComplete(token ?? null);

  if (!result.ok) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertCircle className="h-6 w-6 text-destructive" />
          </div>
          <CardTitle>Could not complete task</CardTitle>
          <CardDescription>{errorMessage(result.error)}</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button asChild variant="outline">
            <Link href="/tasks">Go to tasks</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const title = result.alreadyCompleted ? "Already completed" : "Task marked complete";
  const description = result.alreadyCompleted
    ? `"${result.taskTitle}" was already marked as done.`
    : `"${result.taskTitle}" has been marked as complete.`;

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10">
          <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
        </div>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center gap-3">
        <Button asChild variant="outline">
          <Link href="/calendar">View calendar</Link>
        </Button>
        <Button asChild>
          <Link href="/tasks">Go to tasks</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
