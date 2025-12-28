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
}

export function CalendarSlot({ day, hour, minute, children }: CalendarSlotProps) {
  const time = timeToDecimal(hour, minute); // Convert to decimal hours (e.g., 1.25 for 1:15)
  const { setNodeRef, isOver } = useDroppable({
    id: `calendar-slot-${day.getTime()}-${hour}-${minute}`,
    data: {
      type: "calendar-slot",
      day,
      time,
    },
  });

  return (
    <div
      ref={setNodeRef}
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
