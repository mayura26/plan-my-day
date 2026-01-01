"use client";

import { Bell, BellOff, CheckCircle2, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

export function PushNotificationManager() {
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [isTesting, setIsTesting] = useState(false);

  const checkSubscription = useCallback(async () => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      setIsLoading(false);
      return;
    }

    try {
      // First check if service worker is registered
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) {
        // No service worker registered (likely in development mode)
        setIsLoading(false);
        setPermission(Notification.permission);
        return;
      }

      // Wait for service worker to be ready with timeout
      const readyPromise = navigator.serviceWorker.ready;
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Service worker ready timeout")), 5000)
      );

      const registrationReady = await Promise.race([readyPromise, timeoutPromise]) as ServiceWorkerRegistration;
      
      const subscription = await registrationReady.pushManager.getSubscription();
      const newIsSubscribed = !!subscription;
      const newPermission = Notification.permission;
      
      // Only update state if values changed
      setIsSubscribed((prev) => {
        if (prev === newIsSubscribed) return prev;
        return newIsSubscribed;
      });
      setPermission((prev) => {
        if (prev === newPermission) return prev;
        return newPermission;
      });
    } catch (error) {
      console.error("Error checking subscription:", error);
      // Set permission even if service worker check fails
      setPermission(Notification.permission);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    let timeoutId: NodeJS.Timeout | null = null;

    const checkOnce = async () => {
      if (mounted) {
        await checkSubscription();
      }
    };

    // Longer delay in development to avoid race conditions with Fast Refresh
    const delay = process.env.NODE_ENV === "development" ? 1000 : 100;
    timeoutId = setTimeout(checkOnce, delay);

    return () => {
      mounted = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [checkSubscription]);

  const subscribe = async () => {
    if (!VAPID_PUBLIC_KEY) {
      toast.error("Push notifications are not configured");
      return;
    }

    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      toast.error("Push notifications are not supported in this browser");
      return;
    }

    try {
      // Request notification permission
      const permission = await Notification.requestPermission();
      setPermission(permission);

      if (permission !== "granted") {
        toast.error("Notification permission denied");
        return;
      }

      // Register service worker manually if not already registered
      // Following Next.js best practices with updateViaCache: 'none'
      let registration = await navigator.serviceWorker.getRegistration();
      if (!registration) {
        registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none", // Prevent caching issues per Next.js docs
        });
      }
      
      // Wait for service worker to be ready
      await navigator.serviceWorker.ready;

      // Subscribe to push notifications
      const keyArray = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyArray.buffer as ArrayBuffer,
      });

      // Send subscription to server
      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          keys: {
            p256dh: arrayBufferToBase64(
              subscription.getKey("p256dh") || new ArrayBuffer(0)
            ),
            auth: arrayBufferToBase64(
              subscription.getKey("auth") || new ArrayBuffer(0)
            ),
          },
        }),
      });

      if (response.ok) {
        setIsSubscribed(true);
        toast.success("Push notifications enabled");
      } else {
        const error = await response.json();
        toast.error(error.error || "Failed to enable push notifications");
        await subscription.unsubscribe();
      }
    } catch (error) {
      console.error("Error subscribing to push notifications:", error);
      toast.error("Failed to enable push notifications");
    }
  };

  const unsubscribe = async () => {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        // Unsubscribe from push service
        await subscription.unsubscribe();

        // Remove from server
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });

        setIsSubscribed(false);
        toast.success("Push notifications disabled");
      }
    } catch (error) {
      console.error("Error unsubscribing from push notifications:", error);
      toast.error("Failed to disable push notifications");
    }
  };

  const testNotification = async () => {
    setIsTesting(true);
    try {
      const response = await fetch("/api/push/test", {
        method: "POST",
      });

      if (response.ok) {
        toast.success("Test notification sent");
      } else {
        const error = await response.json();
        toast.error(error.error || "Failed to send test notification");
      }
    } catch (error) {
      console.error("Error sending test notification:", error);
      toast.error("Failed to send test notification");
    } finally {
      setIsTesting(false);
    }
  };

  // Check if we're in development mode
  const isDevelopment = 
    typeof window !== "undefined" && (
      process.env.NODE_ENV === "development" ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1"
    );

  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return (
      <div className="text-sm text-muted-foreground">
        Push notifications are not supported in this browser.
      </div>
    );
  }

  // Show message in development that PWA features require production
  if (isDevelopment) {
    return (
      <div className="space-y-4">
        <div className="rounded-md bg-muted p-4 text-sm">
          <p className="font-medium mb-2">Push Notifications</p>
          <p className="text-muted-foreground">
            Push notifications require service workers, which are disabled in development mode to prevent reload loops.
            Build and run in production mode to test push notifications.
          </p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-4">
      
      <div className="flex items-center gap-2">
        {isSubscribed ? (
          <CheckCircle2 className="h-5 w-5 text-green-500" />
        ) : (
          <XCircle className="h-5 w-5 text-muted-foreground" />
        )}
        <span className="text-sm font-medium">
          Status: {isSubscribed ? "Subscribed" : "Not Subscribed"}
        </span>
      </div>

      <div className="text-sm text-muted-foreground">
        Permission: {permission === "granted" ? "Granted" : permission === "denied" ? "Denied" : "Not Requested"}
      </div>

      <div className="flex flex-wrap gap-2">
        {!isSubscribed ? (
          <Button onClick={subscribe} disabled={permission === "denied"}>
            <Bell className="h-4 w-4" />
            Enable Push Notifications
          </Button>
        ) : (
          <>
            <Button onClick={unsubscribe} variant="outline">
              <BellOff className="h-4 w-4" />
              Disable Push Notifications
            </Button>
            <Button
              onClick={testNotification}
              variant="outline"
              disabled={isTesting}
            >
              {isTesting ? "Sending..." : "Test Notification"}
            </Button>
          </>
        )}
      </div>

      {permission === "denied" && (
        <p className="text-sm text-destructive">
          Notification permission was denied. Please enable it in your browser
          settings to receive push notifications.
        </p>
      )}
    </div>
  );
}

// Helper function to convert VAPID key
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

