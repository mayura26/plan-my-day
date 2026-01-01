"use client";

/**
 * Service Worker Registration
 * Following Next.js PWA best practices: https://nextjs.org/docs/app/guides/progressive-web-apps
 *
 * Manual registration with updateViaCache: 'none' to prevent caching issues
 * This prevents the reload loops caused by next-pwa's auto-registration
 */

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }

  try {
    // Manual registration following Next.js best practices
    // updateViaCache: 'none' prevents the service worker from being cached
    // This is crucial to prevent reload loops in development
    const registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none", // Key difference from next-pwa auto-registration
    });

    console.log("Service Worker registered successfully:", registration);
    return registration;
  } catch (error) {
    console.error("Service Worker registration failed:", error);
    return null;
  }
}

export async function unregisterServiceWorker(): Promise<boolean> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) {
      await registration.unregister();
      console.log("Service Worker unregistered");
      return true;
    }
    return false;
  } catch (error) {
    console.error("Service Worker unregistration failed:", error);
    return false;
  }
}
