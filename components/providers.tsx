"use client";

import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "sonner";
import { ConfirmDialogProvider } from "@/components/ui/confirm-dialog";

interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <SessionProvider>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <ConfirmDialogProvider>
          {children}
          <Toaster theme="system" />
        </ConfirmDialogProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
