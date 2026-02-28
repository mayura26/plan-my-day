"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TaskGroup } from "@/lib/types";

export function AIPreferencesSelector() {
  const [groups, setGroups] = useState<TaskGroup[]>([]);
  const [defaultGroupId, setDefaultGroupId] = useState<string>("none");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [groupsRes, prefsRes] = await Promise.all([
          fetch("/api/task-groups"),
          fetch("/api/user/scheduling-preferences"),
        ]);
        if (groupsRes.ok) {
          const data = await groupsRes.json();
          // Exclude parent groups — only leaf groups can be assigned to tasks
          setGroups((data.groups ?? []).filter((g: TaskGroup) => !g.is_parent_group));
        }
        if (prefsRes.ok) {
          const data = await prefsRes.json();
          setDefaultGroupId(data.default_ai_group_id ?? "none");
        }
      } catch (error) {
        console.error("Error loading AI preferences:", error);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const response = await fetch("/api/user/scheduling-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          default_ai_group_id: defaultGroupId === "none" ? null : defaultGroupId,
        }),
      });
      if (response.ok) {
        toast.success("AI preferences updated");
      } else {
        const err = await response.json();
        toast.error(err.error || "Failed to update preferences");
      }
    } catch {
      toast.error("Failed to update preferences");
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
      <div className="space-y-2">
        <Label htmlFor="default_ai_group">Default group when AI is uncertain</Label>
        <p className="text-xs text-muted-foreground">
          When the AI can&apos;t confidently determine a group from your description, it will fall
          back to this group instead of leaving it blank.
        </p>
        <Select value={defaultGroupId} onValueChange={setDefaultGroupId}>
          <SelectTrigger id="default_ai_group" className="w-full max-w-xs">
            <SelectValue placeholder="No default" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No default</SelectItem>
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                <span className="flex items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: g.color }}
                  />
                  {g.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="pt-2">
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}
