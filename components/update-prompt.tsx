"use client";

import { RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

// Track if user requested reload to prevent auto-reload loops
let userRequestedReload = false;

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
      if (match?.[1]) {
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

export function UpdatePrompt() {
  const [showPrompt, setShowPrompt] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    // Check if we're in development mode - if so, don't do anything
    const isDevelopment =
      process.env.NODE_ENV === "development" ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";

    // Completely skip all service worker logic in development
    if (isDevelopment) {
      return;
    }

    let mounted = true;
    let checkInterval: NodeJS.Timeout | null = null;
    let checkTimeout: NodeJS.Timeout | null = null;

    // Function to check if update is available by comparing versions
    const checkVersionUpdate = async (): Promise<boolean> => {
      try {
        const serverVersion = await getServerVersion();
        const cachedVersion = await getCachedVersion();

        // If we have a cached version and server version is newer, update is available
        if (cachedVersion && compareVersions(serverVersion, cachedVersion) > 0) {
          return true;
        }

        // Also check for waiting service worker
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration?.waiting) {
          return true;
        }

        return false;
      } catch (error) {
        console.error("Error checking version update:", error);
        return false;
      }
    };

    // Function to check for updates and show prompt if needed
    const checkForUpdate = async () => {
      if (!mounted) return;

      try {
        const registration = await navigator.serviceWorker.getRegistration();
        if (!registration) return;

        // Check for waiting service worker first
        const waitingWorker = registration.waiting;
        if (waitingWorker) {
          // Check versions to confirm update is real
          const hasVersionUpdate = await checkVersionUpdate();
          if (hasVersionUpdate) {
            setShowPrompt((prev) => {
              if (prev) return prev; // Already showing
              return true;
            });
          }
          return;
        }

        // Also check versions even if no waiting worker (in case service worker hasn't updated yet)
        const hasVersionUpdate = await checkVersionUpdate();
        if (hasVersionUpdate) {
          setShowPrompt((prev) => {
            if (prev) return prev; // Already showing
            return true;
          });
        }
      } catch (error) {
        console.error("Error checking for updates:", error);
      }
    };

    // Listen for new service worker installing (not just once - can detect multiple updates)
    const handleUpdateFound = async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) return;

      const newWorker = registration.installing;
      if (newWorker) {
        const handleStateChange = async () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            // Check version before showing prompt to avoid false positives
            const hasVersionUpdate = await checkVersionUpdate();
            if (hasVersionUpdate) {
              setShowPrompt((prev) => {
                if (prev) return prev; // Already showing
                return true;
              });
            }
          }
        };
        newWorker.addEventListener("statechange", handleStateChange);
      }
    };

    // Set up updatefound listener (not once - can detect multiple updates)
    const setupUpdateListener = async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        registration.addEventListener("updatefound", handleUpdateFound);
      }
    };

    // Initial setup
    setupUpdateListener();

    // Initial check with delay
    checkTimeout = setTimeout(checkForUpdate, 2000);

    // Check periodically for updates (every 5 minutes)
    checkInterval = setInterval(checkForUpdate, 5 * 60 * 1000);

    // Listen for controller change (service worker activated)
    // Only reload if user explicitly requested update AND version actually changed
    // This prevents false reloads when service worker updates but version is same
    const handleControllerChange = async () => {
      // Never reload in development mode, even if user requested
      if (isDevelopment) {
        return;
      }

      if (userRequestedReload) {
        // Check version before reloading to ensure it actually changed
        try {
          const serverVersion = await getServerVersion();
          const cachedVersion = await getCachedVersion();

          // Only reload if we can confirm version changed, or if we can't check (assume it did)
          if (!cachedVersion || compareVersions(serverVersion, cachedVersion) > 0) {
            userRequestedReload = false;
            // Small delay to ensure service worker is ready
            setTimeout(() => {
              window.location.reload();
            }, 100);
          } else {
            // Version didn't change, don't reload
            userRequestedReload = false;
          }
        } catch (error) {
          // If version check fails, don't reload to be safe
          console.error("Error checking version before reload:", error);
          userRequestedReload = false;
        }
      }
    };

    // Only listen for controller changes in production
    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);

    return () => {
      mounted = false;
      if (checkTimeout) {
        clearTimeout(checkTimeout);
      }
      if (checkInterval) {
        clearInterval(checkInterval);
      }
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);

      // Clean up updatefound listener
      navigator.serviceWorker
        .getRegistration()
        .then((registration) => {
          if (registration) {
            registration.removeEventListener("updatefound", handleUpdateFound);
          }
        })
        .catch(() => {
          // Ignore errors during cleanup
        });
    };
  }, []);

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

  const handleUpdate = async () => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    setIsUpdating(true);
    setShowPrompt(false);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) {
        // No service worker, but still allow cache clear and reload
        await clearCacheAndReload();
        return;
      }

      const waitingWorker = registration.waiting;
      if (waitingWorker) {
        // Set flag so controllerchange handler knows to reload
        userRequestedReload = true;

        // Tell the waiting service worker to skip waiting and activate
        waitingWorker.postMessage({ type: "SKIP_WAITING" });

        // Set up timeout fallback in case controllerchange doesn't fire
        // The controllerchange event should trigger reload via handleControllerChange
        setTimeout(async () => {
          // If controllerchange didn't fire within 5 seconds, fall back to clearCacheAndReload
          if (userRequestedReload) {
            console.warn("Controllerchange event did not fire, using fallback reload");
            userRequestedReload = false;
            await clearCacheAndReload();
          }
        }, 5000);
        // Note: We don't store the timeout ID since we can't reliably clear it
        // when controllerchange fires (it's async). The page will reload anyway if either fires.
      } else {
        // No waiting worker, but user wants to force update
        // Clear cache and reload anyway (like reference "clear cache and reload")
        await clearCacheAndReload();
      }
    } catch (error) {
      console.error("Error forcing update:", error);
      // Reset flag on error
      userRequestedReload = false;
      // Even on error, try to clear cache and reload
      await clearCacheAndReload();
    } finally {
      // Note: setIsUpdating(false) is intentionally not called here because
      // we're about to reload the page. If the reload fails or is delayed,
      // the component will unmount anyway.
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
  };

  if (!showPrompt) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-md rounded-lg border bg-background p-4 shadow-lg">
      <div className="flex items-start gap-3">
        <RefreshCw className="h-5 w-5 text-primary mt-0.5" />
        <div className="flex-1">
          <h3 className="font-semibold text-sm">Update Available</h3>
          <p className="text-sm text-muted-foreground mt-1">
            A new version of Plan My Day is available. Update now to get the latest features and
            improvements.
          </p>
          <div className="flex gap-2 mt-3">
            <Button onClick={handleUpdate} size="sm" disabled={isUpdating}>
              {isUpdating ? "Updating..." : "Update Now"}
            </Button>
            <Button onClick={handleDismiss} size="sm" variant="outline">
              Later
            </Button>
          </div>
        </div>
        <Button onClick={handleDismiss} size="icon" variant="ghost" className="h-6 w-6">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
