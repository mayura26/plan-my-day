"use client";

import { AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { VersionIndicator } from "@/components/version-indicator";

interface ServiceWorkerState {
  status: "active" | "installing" | "waiting" | "redundant" | null;
  updateAvailable: boolean;
  version: string | null;
}

// Helper function to get server version
async function getServerVersion(): Promise<string> {
  try {
    const response = await fetch("/api/version");
    if (response.ok) {
      const data = await response.json();
      return data.version || "1";
    }
  } catch (error) {
    console.error("Error fetching server version:", error);
  }
  return "1";
}

// Helper function to get cached version from cache names
async function getCachedVersion(): Promise<string | null> {
  try {
    if (!("caches" in window)) {
      return null;
    }
    const cacheNames = await caches.keys();
    const versionCache = cacheNames.find((name) => name.startsWith("planmyday-v"));
    if (versionCache) {
      // Extract version from cache name like "planmyday-v16"
      const match = versionCache.match(/planmyday-v(\d+)/);
      if (match && match[1]) {
        return match[1];
      }
    }
  } catch (error) {
    console.error("Error getting cached version:", error);
  }
  return null;
}

// Helper function to compare versions (simple numeric comparison)
function compareVersions(version1: string, version2: string): number {
  const v1 = parseInt(version1, 10) || 0;
  const v2 = parseInt(version2, 10) || 0;
  return v1 - v2;
}

export function ForceUpdateButton() {
  const [swState, setSwState] = useState<ServiceWorkerState>({
    status: null,
    updateAvailable: false,
    version: null,
  });
  const [isChecking, setIsChecking] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  const checkServiceWorker = useCallback(async () => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      setSwState({
        status: null,
        updateAvailable: false,
        version: null,
      });
      return;
    }

    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) {
        // Service worker not registered - likely in development mode or PWA disabled
        setSwState({
          status: null,
          updateAvailable: false,
          version: null,
        });
        return;
      }

      // Check for waiting service worker (update available)
      const waitingWorker = registration.waiting;
      const installingWorker = registration.installing;
      const activeWorker = registration.active;

      let status: ServiceWorkerState["status"] = null;
      if (waitingWorker) {
        status = "waiting";
      } else if (installingWorker) {
        status = "installing";
      } else if (activeWorker) {
        status = "active";
      }

      // Get versions for comparison
      const serverVersion = await getServerVersion();
      const cachedVersion = await getCachedVersion();
      
      // Determine if update is available
      // Update is available if:
      // 1. There's a waiting service worker, OR
      // 2. Server version is newer than cached version
      let updateAvailable = !!waitingWorker;
      
      if (!updateAvailable && cachedVersion) {
        // Compare server version with cached version
        if (compareVersions(serverVersion, cachedVersion) > 0) {
          updateAvailable = true;
        }
      }

      // Use server version as the displayed version
      const newVersion = serverVersion;

      setSwState((prev) => {
        // Only update if something actually changed
        if (
          prev.status === status &&
          prev.updateAvailable === updateAvailable &&
          prev.version === newVersion
        ) {
          return prev; // No change, don't update
        }
        return {
          status,
          updateAvailable,
          version: newVersion,
        };
      });
    } catch (error) {
      console.error("Error checking service worker:", error);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    // Check both build-time env and runtime hostname to catch dev mode
    const isDevelopment =
      process.env.NODE_ENV === "development" ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";

    let mounted = true;
    let timeoutId: NodeJS.Timeout | null = null;
    let debounceTimeout: NodeJS.Timeout | null = null;
    let interval: NodeJS.Timeout | null = null;

    const checkOnce = async () => {
      if (mounted) {
        await checkServiceWorker();
      }
    };

    // In development mode, only check once on mount to avoid reload loops
    // Service workers are rebuilt frequently in dev, causing false update detections
    // Don't listen for controller changes or check periodically in dev
    if (isDevelopment) {
      timeoutId = setTimeout(checkOnce, 2000); // Longer delay in dev, check once only
      return () => {
        mounted = false;
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      };
    }

    // In production, check periodically and listen for updates
    timeoutId = setTimeout(checkOnce, 1000);

    // Only listen for controller changes in production
    // In development, this causes reload loops with Fast Refresh
    const handleControllerChange = () => {
      // Debounce controller change events to prevent rapid re-checks
      if (debounceTimeout) {
        clearTimeout(debounceTimeout);
      }
      debounceTimeout = setTimeout(() => {
        if (mounted) {
          checkServiceWorker();
        }
      }, 1000); // Longer debounce
    };

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);

    // Check periodically for updates (only in production)
    interval = setInterval(() => {
      if (mounted) {
        checkServiceWorker();
      }
    }, 60000); // Check every minute

    return () => {
      mounted = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (debounceTimeout) {
        clearTimeout(debounceTimeout);
      }
      if (interval) {
        clearInterval(interval);
      }
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
    };
  }, [checkServiceWorker]);

  const checkForUpdates = async () => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      toast.error("Service workers are not supported");
      return;
    }

    setIsChecking(true);
    try {
      // Register service worker if not already registered (following Next.js pattern)
      let registration = await navigator.serviceWorker.getRegistration();
      if (!registration) {
        registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
      }

      if (!registration) {
        toast.error("No service worker registered");
        setIsChecking(false);
        return;
      }

      // Set up listener for updatefound event before calling update()
      let updateFound = false;
      const handleUpdateFound = () => {
        updateFound = true;
        const newWorker = registration.installing;
        if (newWorker) {
          const handleStateChange = async () => {
            if (newWorker.state === "installed") {
              // Check versions when new service worker is installed
              await checkServiceWorker();
            }
          };
          newWorker.addEventListener("statechange", handleStateChange);
        }
      };

      registration.addEventListener("updatefound", handleUpdateFound);

      // Call update() to check for new service worker
      await registration.update();

      // Wait a bit for updatefound event to fire if there's an update
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Remove the listener
      registration.removeEventListener("updatefound", handleUpdateFound);

      // Check service worker state and versions
      await checkServiceWorker();

      // Get current state to provide feedback
      const serverVersion = await getServerVersion();
      const cachedVersion = await getCachedVersion();
      const hasUpdate = registration.waiting || (cachedVersion && compareVersions(serverVersion, cachedVersion) > 0);

      if (hasUpdate) {
        toast.success("Update available! Click 'Force Update' to install.");
      } else if (updateFound) {
        toast.success("Update check completed. No new updates available.");
      } else {
        toast.success("Checked for updates. You're up to date.");
      }
    } catch (error) {
      console.error("Error checking for updates:", error);
      toast.error("Failed to check for updates");
    } finally {
      setIsChecking(false);
    }
  };

  const clearCacheAndReload = async () => {
    try {
      // Clear all caches (like reference implementation)
      if ("caches" in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
        console.log("All caches cleared");
      }

      // Unregister service worker to force fresh registration
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        await registration.unregister();
        console.log("Service worker unregistered");
      }

      // Clear service worker registrations
      if ("serviceWorker" in navigator && navigator.serviceWorker.getRegistrations) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((reg) => reg.unregister()));
      }

      // Reload the page to get fresh version
      window.location.reload();
    } catch (error) {
      console.error("Error clearing cache:", error);
      // Still reload even if cache clearing fails
      window.location.reload();
    }
  };

  const forceUpdate = async () => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      toast.error("Service workers are not supported");
      return;
    }

    setIsUpdating(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) {
        // No service worker, but still allow cache clear and reload
        await clearCacheAndReload();
        return;
      }

      const waitingWorker = registration.waiting;
      if (waitingWorker) {
        // Tell the waiting service worker to skip waiting and activate
        waitingWorker.postMessage({ type: "SKIP_WAITING" });

        // Clear cache and reload after a short delay
        setTimeout(async () => {
          await clearCacheAndReload();
        }, 500);
      } else {
        // No waiting worker, but user wants to force update
        // Clear cache and reload anyway (like reference "clear cache and reload")
        await clearCacheAndReload();
      }
    } catch (error) {
      console.error("Error forcing update:", error);
      // Even on error, try to clear cache and reload
      await clearCacheAndReload();
    } finally {
      setIsUpdating(false);
    }
  };

  // Check if we're in development mode
  const isDevelopment =
    typeof window !== "undefined" &&
    (process.env.NODE_ENV === "development" ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1");

  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return (
      <div className="text-sm text-muted-foreground">
        Service workers are not supported in this browser.
      </div>
    );
  }

  // Show message in development that PWA features require production
  if (isDevelopment) {
    return (
      <div className="space-y-4">
        <div className="rounded-md bg-muted p-4 text-sm">
          <p className="font-medium mb-2">App Updates</p>
          <p className="text-muted-foreground">
            Service worker update detection is disabled in development mode to prevent reload loops.
            Build and run in production mode to test app updates.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {swState.updateAvailable ? (
          <AlertCircle className="h-5 w-5 text-yellow-500" />
        ) : swState.status === "active" ? (
          <CheckCircle2 className="h-5 w-5 text-green-500" />
        ) : (
          <AlertCircle className="h-5 w-5 text-muted-foreground" />
        )}
        <span className="text-sm font-medium">
          Status:{" "}
          {swState.status
            ? swState.status.charAt(0).toUpperCase() + swState.status.slice(1)
            : "Not Registered"}
        </span>
      </div>

      {!swState.status && (
        <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
          Service worker is not registered. To enable PWA in development mode, run{" "}
          <code className="px-1 py-0.5 bg-background rounded text-xs">npm run dev:pwa</code> instead
          of <code className="px-1 py-0.5 bg-background rounded text-xs">npm run dev</code>.
        </div>
      )}

      {swState.updateAvailable && (
        <div className="rounded-md bg-yellow-50 dark:bg-yellow-900/20 p-3 text-sm text-yellow-800 dark:text-yellow-200">
          An update is available. Click "Force Update Now" to install it.
        </div>
      )}

      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">App Version:</span>
        <VersionIndicator />
      </div>

      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold mb-2">Force Update</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Clear cache and reload to get the newest app version. Use this if the app seems
            outdated.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={forceUpdate} disabled={isUpdating} className="w-full sm:w-auto">
              <RefreshCw className={`h-4 w-4 mr-2 ${isUpdating ? "animate-spin" : ""}`} />
              {isUpdating ? "Updating..." : "Force Update"}
            </Button>
            <Button onClick={checkForUpdates} variant="outline" disabled={isChecking || isUpdating} className="w-full sm:w-auto">
              <RefreshCw className={`h-4 w-4 mr-2 ${isChecking ? "animate-spin" : ""}`} />
              {isChecking ? "Checking..." : "Check for Updates"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
