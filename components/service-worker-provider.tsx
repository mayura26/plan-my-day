"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/service-worker-registration";

/**
 * Service Worker Provider
 * Manually registers the service worker following Next.js best practices
 * https://nextjs.org/docs/app/guides/progressive-web-apps
 *
 * Uses updateViaCache: 'none' to prevent caching issues in development
 */
export function ServiceWorkerProvider() {
  useEffect(() => {
    // Register service worker in all environments
    // updateViaCache: 'none' prevents reload loops in development
    registerServiceWorker().catch((error) => {
      console.error("Failed to register service worker:", error);
    });
  }, []);

  return null; // This component doesn't render anything
}
