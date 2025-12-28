"use client";

import { LogOut } from "lucide-react";
import { signIn, signOut, useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function AuthButton() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return <div className="h-9 w-20 animate-pulse rounded-md bg-muted" />;
  }

  if (session) {
    return (
      <div className="flex items-center gap-3">
        <span className="hidden sm:inline-block text-sm text-muted-foreground">
          {session.user?.name || session.user?.email}
        </span>
        <Button size="sm" variant="ghost" onClick={() => signOut()} className="gap-2">
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Sign Out</span>
        </Button>
      </div>
    );
  }

  return (
    <Button size="sm" onClick={() => signIn()}>
      Sign In
    </Button>
  );
}
