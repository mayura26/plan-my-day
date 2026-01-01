"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ConfirmOptions {
  title?: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "destructive";
}

type ConfirmFunction = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmDialogContext = createContext<ConfirmFunction | null>(null);

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmOptions & { open: boolean; resolve: ((value: boolean) => void) | null }>({
    open: false,
    description: "",
    resolve: null,
  });

  const confirm = useCallback<ConfirmFunction>((options) => {
    return new Promise((resolve) => {
      setState({
        ...options,
        open: true,
        resolve,
      });
    });
  }, []);

  const handleConfirm = () => {
    state.resolve?.(true);
    setState((prev) => ({ ...prev, open: false, resolve: null }));
  };

  const handleCancel = () => {
    state.resolve?.(false);
    setState((prev) => ({ ...prev, open: false, resolve: null }));
  };

  return (
    <ConfirmDialogContext.Provider value={confirm}>
      {children}
      <Dialog open={state.open} onOpenChange={(open) => !open && handleCancel()}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            {state.title && <DialogTitle>{state.title}</DialogTitle>}
            <DialogDescription>{state.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancel}>
              {state.cancelText || "Cancel"}
            </Button>
            <Button
              variant={state.variant || "default"}
              onClick={handleConfirm}
              autoFocus
            >
              {state.confirmText || "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmDialogContext.Provider>
  );
}

export function useConfirmDialog() {
  const confirm = useContext(ConfirmDialogContext);
  if (!confirm) {
    throw new Error("useConfirmDialog must be used within ConfirmDialogProvider");
  }
  return { confirm };
}
