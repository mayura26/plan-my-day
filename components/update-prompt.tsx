"use client";

import { RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

// Track if user requested reload to prevent auto-reload loops
let userRequestedReload = false;

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

    // Debounce to prevent checking too frequently
    let checkTimeout: NodeJS.Timeout;
    let lastCheckTime = 0;
    const CHECK_INTERVAL = 10000; // Only check every 10 seconds in production

    const checkForUpdate = async () => {
      const now = Date.now();
      if (now - lastCheckTime < CHECK_INTERVAL) {
        return; // Skip if checked recently
      }
      lastCheckTime = now;

      try {
        const registration = await navigator.serviceWorker.getRegistration();
        if (!registration) return;

        // Check for waiting service worker
        const waitingWorker = registration.waiting;
        if (waitingWorker) {
          // Only show if we don't already have a prompt showing
          setShowPrompt((prev) => {
            if (prev) return prev; // Already showing
            return true;
          });
        }

        // Listen for new service worker installing (only once)
        // Only show prompt if version actually changed (like reference implementation)
        const handleUpdateFound = () => {
          const newWorker = registration.installing;
          if (newWorker) {
            const handleStateChange = async () => {
              if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                // Check version before showing prompt to avoid false positives
                try {
                  const response = await fetch("/api/version");
                  if (response.ok) {
                    const data = await response.json();
                    const currentVersion = data.version || "1";
                    const cacheNames = await caches.keys();
                    const versionCache = cacheNames.find(
                      (name) => name.startsWith("planmyday-v") || name.includes("v")
                    );

                    // Only show if version actually changed
                    if (!versionCache || !versionCache.includes(currentVersion)) {
                      setShowPrompt((prev) => {
                        if (prev) return prev; // Already showing
                        return true;
                      });
                    }
                  }
                } catch (error) {
                  // If version check fails, don't show prompt to be safe
                  console.error("Error checking version:", error);
                }
              }
            };
            newWorker.addEventListener("statechange", handleStateChange);
          }
        };

        // Only add listener once
        registration.addEventListener("updatefound", handleUpdateFound, { once: true });
      } catch (error) {
        console.error("Error checking for updates:", error);
      }
    };

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
          const response = await fetch("/api/version");
          if (response.ok) {
            const data = await response.json();
            const currentVersion = data.version || "1";
            // Get cache names to check service worker version
            const cacheNames = await caches.keys();
            const versionCache = cacheNames.find(
              (name) => name.startsWith("planmyday-v") || name.includes("v")
            );

            // Only reload if we can confirm version changed, or if we can't check (assume it did)
            if (!versionCache || !versionCache.includes(currentVersion)) {
              userRequestedReload = false;
              // Small delay to ensure service worker is ready
              setTimeout(() => {
                window.location.reload();
              }, 100);
            } else {
              // Version didn't change, don't reload
              userRequestedReload = false;
            }
          }
        } catch (error) {
          // If version check fails, don't reload to be safe
          console.error("Error checking version before reload:", error);
          userRequestedReload = false;
        }
      }
    };

    // Only listen for controller changes in production
    if (!isDevelopment) {
      navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
    }

    // Initial check with delay
    checkTimeout = setTimeout(checkForUpdate, 1000);

    return () => {
      if (checkTimeout) {
        clearTimeout(checkTimeout);
      }
      if (!isDevelopment) {
        navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      }
    };
  }, []);

  const handleUpdate = async () => {
    setIsUpdating(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) return;

      const waitingWorker = registration.waiting;
      if (waitingWorker) {
        // Mark that we want to reload when controller changes
        userRequestedReload = true;
        // Tell the waiting service worker to skip waiting
        waitingWorker.postMessage({ type: "SKIP_WAITING" });
        setShowPrompt(false);
      }
    } catch (error) {
      console.error("Error updating:", error);
      userRequestedReload = false;
    } finally {
      setIsUpdating(false);
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
