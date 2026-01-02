"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/service-worker-registration";

/**
 * Service Worker Provider
 * Manually registers the service worker following Next.js best practices
 * https://nextjs.org/docs/app/guides/progressive-web-apps
 *
 * Service worker registration is disabled in development mode to prevent caching issues
 */
export function ServiceWorkerProvider() {
  useEffect(() => {
    // Skip service worker registration in development mode
    const isDevelopment =
      process.env.NODE_ENV === "development" ||
      (typeof window !== "undefined" &&
        (window.location.hostname === "localhost" ||
          window.location.hostname === "127.0.0.1"));

    if (isDevelopment) {
      return;
    }

    // Register service worker in production only
    registerServiceWorker().catch((error) => {
      console.error("Failed to register service worker:", error);
    });
  }, []);

  return null; // This component doesn't render anything
}
