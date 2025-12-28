"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUserTimezone } from "@/hooks/use-user-timezone";
import { COMMON_TIMEZONES } from "@/lib/timezone-utils";

interface TimezoneSelectorProps {
  onTimezoneChange?: (timezone: string) => void;
  showLabel?: boolean;
}

export function TimezoneSelector({ onTimezoneChange, showLabel = true }: TimezoneSelectorProps) {
  const { timezone, isLoading, updateTimezone } = useUserTimezone();
  const [selectedTimezone, setSelectedTimezone] = useState<string>(timezone);
  const [isSaving, setIsSaving] = useState(false);

  // Update local state when timezone is loaded
  useEffect(() => {
    if (!isLoading && timezone) {
      setSelectedTimezone(timezone);
    }
  }, [timezone, isLoading]);

  const handleTimezoneChange = async (newTimezone: string) => {
    setSelectedTimezone(newTimezone);

    setIsSaving(true);
    const result = await updateTimezone(newTimezone);
    setIsSaving(false);

    if (result.success) {
      onTimezoneChange?.(newTimezone);
    } else {
      // Revert on error
      setSelectedTimezone(timezone);
      console.error("Failed to update timezone:", result.error);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        {showLabel && <label className="text-sm font-medium">Timezone:</label>}
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm text-muted-foreground">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
      {showLabel && (
        <label htmlFor="timezone-select" className="text-sm font-medium">
          Timezone:
        </label>
      )}
      <Select value={selectedTimezone} onValueChange={handleTimezoneChange} disabled={isSaving}>
        <SelectTrigger id="timezone-select" className="w-full sm:w-[280px] h-11 md:h-10">
          <SelectValue placeholder="Select timezone" />
        </SelectTrigger>
        <SelectContent>
          {COMMON_TIMEZONES.map((tz) => (
            <SelectItem key={tz.value} value={tz.value}>
              {tz.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isSaving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
    </div>
  );
}
