"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { GroupScheduleHours } from "@/lib/types";

export function WorkingHoursSelector() {
  const [workingHours, setWorkingHours] = useState<GroupScheduleHours>({});
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Fetch working hours on mount
  useEffect(() => {
    const fetchWorkingHours = async () => {
      try {
        const response = await fetch("/api/user/working-hours");
        if (response.ok) {
          const data = await response.json();
          setWorkingHours(data.working_hours || {});
        } else {
          console.error("Failed to fetch working hours");
        }
      } catch (error) {
        console.error("Error fetching working hours:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchWorkingHours();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const response = await fetch("/api/user/working-hours", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          working_hours: workingHours,
        }),
      });

      if (response.ok) {
        toast.success("Working hours updated successfully");
      } else {
        const errorData = await response.json();
        toast.error(errorData.error || "Failed to update working hours");
      }
    } catch (error) {
      console.error("Error updating working hours:", error);
      toast.error("An error occurred while updating working hours");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="text-sm text-muted-foreground">Loading...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">
        Configure your working hours for each day of the week. Tasks will be automatically scheduled
        within these hours when using auto-schedule features.
      </div>

      <div className="border rounded-lg overflow-hidden">
        <div
          role="button"
          tabIndex={0}
          className="px-4 py-3 border-b cursor-pointer hover:bg-accent/50 transition-colors flex items-center justify-between bg-card"
          onClick={() => setIsExpanded(!isExpanded)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setIsExpanded(!isExpanded);
            }
          }}
        >
          <div className="flex items-center gap-2">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <h3 className="text-sm font-semibold">Working Hours</h3>
          </div>
        </div>
        {isExpanded && (
          <div className="p-4 space-y-4">
            <div className="space-y-3">
              {(
                [
                  { key: "monday", label: "Monday" },
                  { key: "tuesday", label: "Tuesday" },
                  { key: "wednesday", label: "Wednesday" },
                  { key: "thursday", label: "Thursday" },
                  { key: "friday", label: "Friday" },
                  { key: "saturday", label: "Saturday" },
                  { key: "sunday", label: "Sunday" },
                ] as const
              ).map((day) => {
                const daySchedule = workingHours[day.key as keyof GroupScheduleHours];
                const isDayEnabled = daySchedule !== null && daySchedule !== undefined;
                const startHour = daySchedule?.start ?? 9;
                const endHour = daySchedule?.end ?? 17;

                return (
                  <div key={day.key} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id={`day-${day.key}`}
                        checked={isDayEnabled}
                        onCheckedChange={(checked) => {
                          setWorkingHours((prev) => ({
                            ...prev,
                            [day.key]: checked ? { start: startHour, end: endHour } : null,
                          }));
                        }}
                      />
                      <label
                        htmlFor={`day-${day.key}`}
                        className="text-sm font-medium flex-1 cursor-pointer"
                      >
                        {day.label}
                      </label>
                    </div>
                    {isDayEnabled && (
                      <div className="ml-6 flex items-center gap-4 py-2 px-2">
                        <div className="flex items-center gap-2.5">
                          <label
                            htmlFor={`start-${day.key}`}
                            className="text-xs text-muted-foreground whitespace-nowrap"
                          >
                            Start:
                          </label>
                          <Select
                            value={startHour.toString()}
                            onValueChange={(value) => {
                              const newStart = parseInt(value, 10);
                              const currentEnd =
                                workingHours[day.key as keyof GroupScheduleHours]?.end ?? 17;
                              setWorkingHours((prev) => ({
                                ...prev,
                                [day.key]: {
                                  start: newStart,
                                  end: currentEnd > newStart ? currentEnd : newStart + 1,
                                },
                              }));
                            }}
                          >
                            <SelectTrigger
                              id={`start-${day.key}`}
                              className="h-8 min-w-[5rem] px-3"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Array.from({ length: 24 }, (_, i) => (
                                <SelectItem key={i} value={i.toString()}>
                                  {i.toString().padStart(2, "0")}:00
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <span className="text-xs text-muted-foreground px-1">to</span>
                        <div className="flex items-center gap-2.5">
                          <label
                            htmlFor={`end-${day.key}`}
                            className="text-xs text-muted-foreground whitespace-nowrap"
                          >
                            End:
                          </label>
                          <Select
                            value={endHour.toString()}
                            onValueChange={(value) => {
                              const newEnd = parseInt(value, 10);
                              const currentStart =
                                workingHours[day.key as keyof GroupScheduleHours]?.start ?? 9;
                              setWorkingHours((prev) => ({
                                ...prev,
                                [day.key]: { start: currentStart, end: newEnd },
                              }));
                            }}
                          >
                            <SelectTrigger id={`end-${day.key}`} className="h-8 min-w-[5rem] px-3">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Array.from({ length: 24 }, (_, i) => {
                                const currentStart =
                                  workingHours[day.key as keyof GroupScheduleHours]?.start ?? 9;
                                if (i <= currentStart) return null;
                                return (
                                  <SelectItem key={i} value={i.toString()}>
                                    {i.toString().padStart(2, "0")}:00
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end pt-2 border-t">
              <Button onClick={handleSave} loading={isSaving} disabled={isSaving}>
                {isSaving ? "Saving..." : "Save Working Hours"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
