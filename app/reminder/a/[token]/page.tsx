import { ReminderActionView } from "@/components/reminder/ReminderActionView";
import { performReminderActionFromToken } from "@/lib/push-action-handlers";

interface ReminderTokenPageProps {
  params: Promise<{ token: string }>;
}

/** Legacy path-token URLs — new notifications use /reminder/action?... */
export default async function ReminderTokenPage({ params }: ReminderTokenPageProps) {
  const { token } = await params;

  try {
    const outcome = await performReminderActionFromToken(token);
    return <ReminderActionView outcome={outcome} />;
  } catch (error) {
    console.error("Legacy reminder token action failed:", error);
    return <ReminderActionView outcome={{ ok: false, error: "invalid" }} />;
  }
}
