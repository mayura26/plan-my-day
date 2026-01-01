"use client";

import { Download, Share2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Detect iOS
function isIOS(): boolean {
  if (typeof window === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

// Detect if already installed
function isInstalled(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true
  );
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalling, setIsInstalling] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isIOSDevice, setIsIOSDevice] = useState(false);
  const [showIOSPrompt, setShowIOSPrompt] = useState(false);

  useEffect(() => {
    // Install prompt works in both dev and prod - it doesn't need service worker
    // Only skip if already installed

    // Check if already installed
    if (isInstalled()) {
      return;
    }

    const ios = isIOS();
    setIsIOSDevice(ios);

    // For iOS, show prompt after a delay (browser doesn't support beforeinstallprompt)
    if (ios) {
      // Check if user has dismissed before
      const dismissed = localStorage.getItem("install-prompt-dismissed");
      if (dismissed) {
        const dismissedTime = parseInt(dismissed, 10);
        const daysSinceDismissed = (Date.now() - dismissedTime) / (1000 * 60 * 60 * 24);
        // Show again after 7 days
        if (daysSinceDismissed < 7) {
          setIsDismissed(true);
          return;
        }
      }
      // Show iOS prompt after 3 seconds
      const timer = setTimeout(() => {
        setShowIOSPrompt(true);
      }, 3000);
      return () => clearTimeout(timer);
    }

    // For Android/Chrome, use beforeinstallprompt event
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    // Check if user has dismissed before
    const dismissed = localStorage.getItem("install-prompt-dismissed");
    if (dismissed) {
      const dismissedTime = parseInt(dismissed, 10);
      const daysSinceDismissed = (Date.now() - dismissedTime) / (1000 * 60 * 60 * 24);
      // Show again after 7 days
      if (daysSinceDismissed < 7) {
        setIsDismissed(true);
      }
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    setIsInstalling(true);
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;

      if (outcome === "accepted") {
        setDeferredPrompt(null);
      }
    } catch (error) {
      console.error("Error installing app:", error);
    } finally {
      setIsInstalling(false);
    }
  };

  const handleDismiss = () => {
    setIsDismissed(true);
    setDeferredPrompt(null);
    setShowIOSPrompt(false);
    localStorage.setItem("install-prompt-dismissed", Date.now().toString());
  };

  // Don't show if dismissed or not installable
  if (isDismissed) {
    return null;
  }

  // iOS prompt
  if (isIOSDevice && showIOSPrompt) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background p-4 shadow-lg md:bottom-4 md:left-4 md:right-auto md:max-w-md md:rounded-lg md:border md:border-t-0">
        <div className="flex items-start gap-3">
          <Download className="h-5 w-5 text-primary mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm">Install Plan My Day</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Tap <Share2 className="inline h-4 w-4 mx-1" /> then select{" "}
              <strong>"Add to Home Screen"</strong> to install.
            </p>
            <div className="flex gap-2 mt-3">
              <Button onClick={handleDismiss} size="sm" variant="outline" className="flex-1">
                Got it
              </Button>
            </div>
          </div>
          <Button onClick={handleDismiss} size="icon" variant="ghost" className="h-6 w-6 shrink-0">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  // Android/Chrome prompt (beforeinstallprompt)
  if (!deferredPrompt) {
    return null;
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background p-4 shadow-lg md:bottom-4 md:left-4 md:right-auto md:max-w-md md:rounded-lg md:border md:border-t-0">
      <div className="flex items-start gap-3">
        <Download className="h-5 w-5 text-primary mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm">Install Plan My Day</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Install our app for a better experience. Get quick access and work offline.
          </p>
          <div className="flex gap-2 mt-3">
            <Button onClick={handleInstall} size="sm" disabled={isInstalling} className="flex-1">
              {isInstalling ? "Installing..." : "Install"}
            </Button>
            <Button onClick={handleDismiss} size="sm" variant="outline">
              Not Now
            </Button>
          </div>
        </div>
        <Button onClick={handleDismiss} size="icon" variant="ghost" className="h-6 w-6 shrink-0">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
