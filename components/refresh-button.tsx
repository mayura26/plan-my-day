"use client";

import { RotateCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface RefreshButtonProps {
  onRefresh: () => void | Promise<void>;
  size?: "sm" | "icon" | "default";
  variant?: "ghost" | "outline" | "default";
  className?: string;
  "aria-label"?: string;
}

export function RefreshButton({
  onRefresh,
  size = "icon",
  variant = "ghost",
  className,
  "aria-label": ariaLabel = "Refresh",
}: RefreshButtonProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault(); // Prevent form submission
    e.stopPropagation(); // Prevent event bubbling to parent elements
    if (isRefreshing) return;

    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      // Add a small delay to ensure the animation is visible
      setTimeout(() => {
        setIsRefreshing(false);
      }, 300);
    }
  };

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={handleClick}
      disabled={isRefreshing}
      className={cn(className)}
      aria-label={ariaLabel}
    >
      <RotateCw
        className={cn("h-4 w-4 transition-transform duration-300", isRefreshing && "animate-spin")}
      />
    </Button>
  );
}
