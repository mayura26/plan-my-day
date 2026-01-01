"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/service-worker-registration";

/**
 * Service Worker Provider
 * Manually registers the service worker following Next.js best practices
 * ONLY registers in production - completely disabled in development
 */
export function ServiceWorkerProvider() {
  useEffect(() => {
    // Only register service worker in production
    // Completely disabled in development to avoid reload loops and issues
    if (process.env.NODE_ENV !== "production") {
      return;
    }

    // Register service worker manually (not auto-registered by next-pwa)
    registerServiceWorker().catch((error) => {
      console.error("Failed to register service worker:", error);
    });
  }, []);

  return null; // This component doesn't render anything
}

