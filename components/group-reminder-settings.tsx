"use client";

import { Pencil } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { EditGroupDialog } from "@/components/edit-group-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ReminderSettings, TaskGroup } from "@/lib/types";

function buildSummary(settings: ReminderSettings): string {
  const parts: string[] = [];
  parts.push(`P1–P${settings.min_priority}`);
  if (settings.lead_time_minutes != null) {
    const mins = settings.lead_time_minutes;
    parts.push(mins >= 60 ? `${mins / 60}h lead` : `${mins}min lead`);
  }
  if (settings.on_time_reminder) parts.push("on-time");
  if (settings.due_date_lead_minutes != null) {
    const mins = settings.due_date_lead_minutes;
    parts.push(mins >= 1440 ? "due 1d" : mins >= 60 ? `due ${mins / 60}h` : `due ${mins}min`);
  }
  return parts.join(" · ");
}

export function GroupReminderSettings() {
  const [groups, setGroups] = useState<TaskGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingGroup, setEditingGroup] = useState<TaskGroup | null>(null);

  const fetchGroups = useCallback(async () => {
    try {
      const res = await fetch("/api/task-groups");
      if (res.ok) {
        const data = await res.json();
        setGroups(data.groups ?? []);
      }
    } catch (err) {
      console.error("Failed to fetch groups:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading groups...</div>;
  }

  if (groups.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No groups found. Create a group first to configure reminders.
      </div>
    );
  }

  // Show only non-parent groups (only leaf groups can have reminders)
  const leafGroups = groups.filter((g) => !g.is_parent_group);

  if (leafGroups.length === 0) {
    return <div className="text-sm text-muted-foreground">No schedulable groups found.</div>;
  }

  return (
    <>
      <div className="space-y-2">
        {leafGroups.map((group) => {
          const settings = group.reminder_settings;
          const isOn = settings?.enabled === true;

          return (
            <div
              key={group.id}
              className="flex items-center justify-between rounded-lg border px-4 py-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="h-3 w-3 rounded-full shrink-0"
                  style={{ backgroundColor: group.color }}
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{group.name}</div>
                  {isOn && settings && (
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {buildSummary(settings)}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-3">
                <Badge variant={isOn ? "default" : "secondary"} className="text-xs">
                  {isOn ? "On" : "Off"}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setEditingGroup(group)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  <span className="sr-only">Edit {group.name}</span>
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <EditGroupDialog
        open={editingGroup !== null}
        onOpenChange={(open) => {
          if (!open) setEditingGroup(null);
        }}
        group={editingGroup}
        groups={groups}
        onGroupUpdated={fetchGroups}
      />
    </>
  );
}
