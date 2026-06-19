import { redirect } from "next/navigation";

interface PushCompletePageProps {
  searchParams: Promise<{ token?: string }>;
}

/** Legacy redirect shim for old /push/complete?token= links */
export default async function PushCompletePage({ searchParams }: PushCompletePageProps) {
  const { token } = await searchParams;
  if (token) {
    redirect(`/reminder/a/${token}`);
  }
  redirect("/settings");
}
