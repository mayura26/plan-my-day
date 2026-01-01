"use client";

import { CloudOff, Cloud, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { syncManager } from "@/lib/sync-manager";
import { Button } from "@/components/ui/button";

export function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);

  // Disable in development - service worker features don't work in dev
  const isDevelopment = 
    typeof window !== "undefined" && (
      process.env.NODE_ENV === "development" ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1"
    );

  useEffect(() => {
    // Skip in development - offline sync requires service worker
    if (isDevelopment) {
      return;
    }
    setIsOnline(navigator.onLine);

    const handleOnline = () => {
      setIsOnline(true);
      // Trigger sync when coming online
      syncManager.sync().catch(console.error);
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Check sync status
    const updateSyncStatus = () => {
      setIsSyncing(syncManager.getIsSyncing());
    };

    const unsubscribe = syncManager.onSyncChange(updateSyncStatus);
    updateSyncStatus();

    // Check pending sync count periodically
    const checkPendingSync = async () => {
      if (typeof window !== "undefined") {
        const { getSyncQueue } = await import("@/lib/offline-storage");
        const queue = await getSyncQueue();
        setPendingSyncCount(queue.length);
      }
    };

    checkPendingSync();
    const interval = setInterval(checkPendingSync, 5000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

  if (isOnline && !isSyncing && pendingSyncCount === 0) {
    return null;
  }

  const handleSync = async () => {
    if (isOnline) {
      setIsSyncing(true);
      try {
        await syncManager.sync();
      } catch (error) {
        console.error("Error syncing:", error);
      } finally {
        setIsSyncing(false);
      }
    }
  };

  return (
    <div className="fixed top-16 right-4 z-50 flex items-center gap-2 rounded-md border bg-background px-3 py-2 shadow-md">
      {!isOnline ? (
        <>
          <CloudOff className="h-4 w-4 text-yellow-500" />
          <span className="text-sm font-medium">Offline</span>
        </>
      ) : isSyncing ? (
        <>
          <RefreshCw className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm font-medium">Syncing...</span>
        </>
      ) : pendingSyncCount > 0 ? (
        <>
          <Cloud className="h-4 w-4 text-blue-500" />
          <span className="text-sm font-medium">
            {pendingSyncCount} pending sync
          </span>
          <Button
            onClick={handleSync}
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs"
          >
            Sync Now
          </Button>
        </>
      ) : (
        <>
          <Cloud className="h-4 w-4 text-green-500" />
          <span className="text-sm font-medium">Online</span>
        </>
      )}
    </div>
  );
}

