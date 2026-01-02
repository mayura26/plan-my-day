"use client";

export interface PushSubscriptionData {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

class PushNotificationService {
  private vapidPublicKey: string | null = null;

  async getVapidPublicKey(): Promise<string> {
    if (this.vapidPublicKey) {
      return this.vapidPublicKey;
    }

    try {
      const response = await fetch("/api/push/vapid-key");
      const data = await response.json();

      if (response.ok && data.publicKey) {
        this.vapidPublicKey = data.publicKey;
        return data.publicKey;
      } else {
        throw new Error(data.error || "Failed to get VAPID key");
      }
    } catch (error) {
      console.error("Error getting VAPID public key:", error);
      throw error;
    }
  }

  async isSupported(): Promise<boolean> {
    return (
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window
    );
  }

  async requestPermission(): Promise<NotificationPermission> {
    if (typeof window === "undefined" || !("Notification" in window)) {
      throw new Error("Notifications are not supported");
    }

    return await Notification.requestPermission();
  }

  async subscribe(): Promise<PushSubscription | null> {
    try {
      // Check if push notifications are supported
      if (!(await this.isSupported())) {
        throw new Error("Push notifications are not supported");
      }

      // Skip service worker registration in development mode
      const isDevelopment =
        process.env.NODE_ENV === "development" ||
        (typeof window !== "undefined" &&
          (window.location.hostname === "localhost" ||
            window.location.hostname === "127.0.0.1"));

      // Register service worker manually if not already registered
      // Following Next.js best practices with updateViaCache: 'none'
      let registration = await navigator.serviceWorker.getRegistration();
      if (!registration && !isDevelopment) {
        registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none", // Prevent caching issues per Next.js docs
        });
      }

      // In development, if no registration exists, throw an error
      if (!registration && isDevelopment) {
        throw new Error("Service worker is disabled in development mode");
      }

      // Wait for service worker to be ready
      await navigator.serviceWorker.ready;

      // Check current subscription
      let subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        // Get VAPID public key
        const vapidPublicKey = await this.getVapidPublicKey();

        // Convert VAPID key to Uint8Array
        const applicationServerKey = this.urlBase64ToUint8Array(vapidPublicKey);

        // Subscribe to push notifications
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey.buffer as ArrayBuffer,
        });
      }

      // Save subscription to server
      await this.saveSubscription(subscription);

      return subscription;
    } catch (error) {
      console.error("Error subscribing to push notifications:", error);
      throw error;
    }
  }

  async unsubscribe(): Promise<boolean> {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        await subscription.unsubscribe();
        await this.removeSubscription(subscription);
        return true;
      }

      return false;
    } catch (error) {
      console.error("Error unsubscribing from push notifications:", error);
      return false;
    }
  }

  async getSubscription(): Promise<PushSubscription | null> {
    try {
      const registration = await navigator.serviceWorker.ready;
      return await registration.pushManager.getSubscription();
    } catch (error) {
      console.error("Error getting push subscription:", error);
      return null;
    }
  }

  private async saveSubscription(subscription: PushSubscription): Promise<void> {
    try {
      // Generate device name from user agent
      const deviceName = this.generateDeviceName();

      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          deviceName,
          userAgent: navigator.userAgent,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to save subscription");
      }
    } catch (error) {
      console.error("Error saving push subscription:", error);
      throw error;
    }
  }

  private generateDeviceName(): string {
    const userAgent = navigator.userAgent;

    let deviceType = "Unknown";
    let browser = "Unknown";

    if (userAgent.includes("Mobile")) {
      deviceType = "Mobile";
    } else if (userAgent.includes("Tablet")) {
      deviceType = "Tablet";
    } else {
      deviceType = "Desktop";
    }

    if (userAgent.includes("Chrome")) {
      browser = "Chrome";
    } else if (userAgent.includes("Firefox")) {
      browser = "Firefox";
    } else if (userAgent.includes("Safari") && !userAgent.includes("Chrome")) {
      browser = "Safari";
    } else if (userAgent.includes("Edge")) {
      browser = "Edge";
    }

    return `${deviceType} - ${browser}`;
  }

  private async removeSubscription(subscription: PushSubscription): Promise<void> {
    try {
      const response = await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          endpoint: subscription.endpoint,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to remove subscription");
      }
    } catch (error) {
      console.error("Error removing push subscription:", error);
      throw error;
    }
  }

  private urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = "=".repeat(4 - ((base64String.length % 4) % 4));
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }
}

// Export singleton instance
export const pushNotificationService = new PushNotificationService();
