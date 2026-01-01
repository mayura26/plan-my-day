"use client";

import { SessionProvider } from "next-auth/react";
import { Toaster } from "sonner";
import { ServiceWorkerProvider } from "@/components/service-worker-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { ConfirmDialogProvider } from "@/components/ui/confirm-dialog";

interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <SessionProvider>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <ConfirmDialogProvider>
          <ServiceWorkerProvider />
          {children}
          <Toaster theme="system" />
        </ConfirmDialogProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
