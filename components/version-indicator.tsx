"use client";

import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";

export function VersionIndicator() {
  const [version, setVersion] = useState<string>("1");

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const response = await fetch("/api/version");
        if (response.ok) {
          const data = await response.json();
          setVersion(data.version || "1");
        }
      } catch (error) {
        console.error("Error fetching version:", error);
      }
    };

    fetchVersion();
  }, []);

  return (
    <Badge variant="outline" className="text-xs">
      v{version}
    </Badge>
  );
}

