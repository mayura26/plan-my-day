"use client";

import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";

// Helper function to convert hour and minute to decimal hours
export const timeToDecimal = (hour: number, minute: number): number => {
  return hour + minute / 60;
};

interface CalendarSlotProps {
  day: Date;
  hour: number;
  minute: number;
  children?: React.ReactNode;
  onDoubleClick?: (day: Date, hour: number, minute: number) => void;
}

export function CalendarSlot({ day, hour, minute, children, onDoubleClick }: CalendarSlotProps) {
  const time = timeToDecimal(hour, minute); // Convert to decimal hours (e.g., 1.25 for 1:15)
  const { setNodeRef, isOver } = useDroppable({
    id: `calendar-slot-${day.getTime()}-${hour}-${minute}`,
    data: {
      type: "calendar-slot",
      day,
      time,
    },
  });

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDoubleClick?.(day, hour, minute);
  };

  return (
    <div
      ref={setNodeRef}
      onDoubleClick={handleDoubleClick}
      className={cn(
        "h-4 border-b border-border/50 transition-colors duration-150",
        minute === 0 && "border-b-2 border-border", // Thicker border for hour marks
        isOver && "bg-primary/20 ring-1 ring-primary/30",
        !isOver && "hover:bg-accent/30"
      )}
    >
      {children}
    </div>
  );
}
