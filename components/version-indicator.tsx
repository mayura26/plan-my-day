"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";

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

export function VersionIndicator() {
  const [serverVersion, setServerVersion] = useState<string>("1");
  const [cachedVersion, setCachedVersion] = useState<string | null>(null);
  const [isUpToDate, setIsUpToDate] = useState<boolean | null>(null);

  useEffect(() => {
    const fetchVersions = async () => {
      try {
        const [server, cached] = await Promise.all([getServerVersion(), getCachedVersion()]);

        setServerVersion(server);
        setCachedVersion(cached);

        // Determine if up to date
        if (cached) {
          const comparison = compareVersions(server, cached);
          setIsUpToDate(comparison <= 0);
        } else {
          // No cached version means first load or no service worker
          setIsUpToDate(null);
        }
      } catch (error) {
        console.error("Error fetching versions:", error);
      }
    };

    fetchVersions();

    // Refresh periodically to check for updates
    const interval = setInterval(fetchVersions, 60000); // Check every minute

    return () => clearInterval(interval);
  }, []);

  // Show server version, and indicate if update is available
  const displayVersion = cachedVersion || serverVersion;
  const hasUpdate = cachedVersion && compareVersions(serverVersion, cachedVersion) > 0;

  return (
    <div className="flex items-center gap-2">
      <Badge variant="outline" className="text-xs">
        v{displayVersion}
      </Badge>
      {hasUpdate && (
        <Badge variant="destructive" className="text-xs">
          Update Available (v{serverVersion})
        </Badge>
      )}
      {isUpToDate === true && cachedVersion && (
        <Badge variant="secondary" className="text-xs">
          Up to date
        </Badge>
      )}
    </div>
  );
}
