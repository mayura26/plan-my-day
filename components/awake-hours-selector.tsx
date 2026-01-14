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

export function AwakeHoursSelector() {
  const [awakeHours, setAwakeHours] = useState<GroupScheduleHours>({});
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Fetch awake hours on mount
  useEffect(() => {
    const fetchAwakeHours = async () => {
      try {
        const response = await fetch("/api/user/awake-hours");
        if (response.ok) {
          const data = await response.json();
          setAwakeHours(data.awake_hours || {});
        } else {
          console.error("Failed to fetch awake hours");
        }
      } catch (error) {
        console.error("Error fetching awake hours:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAwakeHours();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const response = await fetch("/api/user/awake-hours", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          awake_hours: awakeHours,
        }),
      });

      if (response.ok) {
        toast.success("Awake hours updated successfully");
      } else {
        const errorData = await response.json();
        toast.error(errorData.error || "Failed to update awake hours");
      }
    } catch (error) {
      console.error("Error updating awake hours:", error);
      toast.error("An error occurred while updating awake hours");
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
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">
            Configure the hours you're awake and available for tasks each day
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Tasks can only be scheduled during these hours (unless using Schedule Today mode)
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2"
        >
          {isExpanded ? (
            <>
              <ChevronDown className="h-4 w-4" />
              Hide
            </>
          ) : (
            <>
              <ChevronRight className="h-4 w-4" />
              Configure
            </>
          )}
        </Button>
      </div>

      {isExpanded && (
        <div className="space-y-4 border rounded-lg p-4">
          {[
            { key: "monday", label: "Monday" },
            { key: "tuesday", label: "Tuesday" },
            { key: "wednesday", label: "Wednesday" },
            { key: "thursday", label: "Thursday" },
            { key: "friday", label: "Friday" },
            { key: "saturday", label: "Saturday" },
            { key: "sunday", label: "Sunday" },
          ].map((day) => {
            const daySchedule = awakeHours[day.key as keyof GroupScheduleHours];
            const isEnabled = daySchedule !== null && daySchedule !== undefined;
            const startHour = isEnabled
              ? awakeHours[day.key as keyof GroupScheduleHours]?.end ?? 17
              : 9;
            const endHour = isEnabled
              ? awakeHours[day.key as keyof GroupScheduleHours]?.start ?? 9
              : 17;

            return (
              <div key={day.key} className="flex items-center gap-4">
                <div className="flex items-center gap-2 w-24">
                  <Checkbox
                    id={`awake-${day.key}`}
                    checked={isEnabled}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setAwakeHours((prev) => ({
                          ...prev,
                          [day.key]: { start: 9, end: 17 },
                        }));
                      } else {
                        setAwakeHours((prev) => {
                          const updated = { ...prev };
                          updated[day.key as keyof GroupScheduleHours] = null;
                          return updated;
                        });
                      }
                    }}
                  />
                  <label
                    htmlFor={`awake-${day.key}`}
                    className="text-sm font-medium cursor-pointer"
                  >
                    {day.label}
                  </label>
                </div>

                {isEnabled && (
                  <div className="flex items-center gap-2 flex-1">
                    <Select
                      value={String(
                        awakeHours[day.key as keyof GroupScheduleHours]?.start ?? 9
                      )}
                      onValueChange={(value) => {
                        setAwakeHours((prev) => ({
                          ...prev,
                          [day.key]: {
                            start: parseInt(value, 10),
                            end: prev[day.key as keyof GroupScheduleHours]?.end ?? 17,
                          },
                        }));
                      }}
                    >
                      <SelectTrigger className="w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 24 }, (_, i) => (
                          <SelectItem key={i} value={String(i)}>
                            {i.toString().padStart(2, "0")}:00
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-sm text-muted-foreground">to</span>
                    <Select
                      value={String(
                        awakeHours[day.key as keyof GroupScheduleHours]?.end ?? 17
                      )}
                      onValueChange={(value) => {
                        setAwakeHours((prev) => ({
                          ...prev,
                          [day.key]: {
                            start: prev[day.key as keyof GroupScheduleHours]?.start ?? 9,
                            end: parseInt(value, 10),
                          },
                        }));
                      }}
                    >
                      <SelectTrigger className="w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 24 }, (_, i) => (
                          <SelectItem key={i} value={String(i)}>
                            {i.toString().padStart(2, "0")}:00
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            );
          })}

          <div className="flex justify-end pt-2">
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

