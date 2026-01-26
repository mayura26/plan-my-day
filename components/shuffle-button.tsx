"use client";

import { Shuffle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ShuffleButtonProps {
  onShuffle: () => void | Promise<void>;
  size?: "sm" | "icon" | "default";
  variant?: "ghost" | "outline" | "default";
  className?: string;
  "aria-label"?: string;
}

export function ShuffleButton({
  onShuffle,
  size = "icon",
  variant = "ghost",
  className,
  "aria-label": ariaLabel = "Shuffle tasks",
}: ShuffleButtonProps) {
  const [isShuffling, setIsShuffling] = useState(false);

  const handleClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (isShuffling) return;

    setIsShuffling(true);
    try {
      await onShuffle();
    } finally {
      setTimeout(() => {
        setIsShuffling(false);
      }, 300);
    }
  };

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={handleClick}
      disabled={isShuffling}
      className={cn(className)}
      aria-label={ariaLabel}
    >
      <Shuffle
        className={cn("h-4 w-4 transition-transform duration-300", isShuffling && "animate-spin")}
      />
    </Button>
  );
}
