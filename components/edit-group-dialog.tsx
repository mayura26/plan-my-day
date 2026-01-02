"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TaskGroup } from "@/lib/types";

interface EditGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: TaskGroup | null;
  groups: TaskGroup[];
  onGroupUpdated?: () => void;
}

export function EditGroupDialog({
  open,
  onOpenChange,
  group,
  groups,
  onGroupUpdated,
}: EditGroupDialogProps) {
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupColor, setNewGroupColor] = useState("#3B82F6");
  const [newParentGroupId, setNewParentGroupId] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  // Initialize form when group changes
  useEffect(() => {
    if (group) {
      setNewGroupName(group.name);
      setNewGroupColor(group.color);
      setNewParentGroupId(group.parent_group_id || null);
    }
  }, [group]);

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setNewGroupName("");
      setNewGroupColor("#3B82F6");
      setNewParentGroupId(null);
    }
  }, [open]);

  // Get available parent groups (exclude current group and its descendants)
  const getAvailableParentGroups = (excludeGroupId?: string): TaskGroup[] => {
    const excludeIds = new Set<string>();
    if (excludeGroupId) {
      excludeIds.add(excludeGroupId);
      // Find all descendants
      const findDescendants = (parentId: string) => {
        groups.forEach((g) => {
          if (g.parent_group_id === parentId) {
            excludeIds.add(g.id);
            findDescendants(g.id);
          }
        });
      };
      findDescendants(excludeGroupId);
    }
    return groups.filter((g) => g.is_parent_group && !excludeIds.has(g.id));
  };

  const updateGroup = async () => {
    if (!group || !newGroupName.trim()) return;

    setIsUpdating(true);
    try {
      const response = await fetch(`/api/task-groups/${group.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: newGroupName.trim(),
          color: newGroupColor,
          parent_group_id: newParentGroupId || null,
        }),
      });

      if (response.ok) {
        const _data = await response.json();
        toast.success("Task group updated successfully");
        onGroupUpdated?.();
        onOpenChange(false);
      } else {
        const errorData = await response
          .json()
          .catch(() => ({ error: "Failed to update task group" }));
        toast.error(errorData.error || "Failed to update task group. Please try again.");
      }
    } catch (error) {
      console.error("Error updating task group:", error);
      toast.error("An error occurred while updating the task group. Please try again.");
    } finally {
      setIsUpdating(false);
    }
  };

  if (!group) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Group</DialogTitle>
          <DialogDescription>Update the group name, color, and parent group.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <div className="text-sm font-medium mb-1">Group Name</div>
            <Input
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="Enter group name"
              className="mt-1"
            />
          </div>
          <div>
            <label htmlFor="group-color-input-edit" className="text-sm font-medium">
              Color
            </label>
            <div className="mt-1 flex items-center gap-3">
              <div className="relative">
                <input
                  id="group-color-input-edit"
                  type="color"
                  value={newGroupColor}
                  onChange={(e) => setNewGroupColor(e.target.value)}
                  className="h-10 w-20 cursor-pointer rounded-md border border-input bg-background"
                  title="Pick a color"
                />
              </div>
              <div className="flex items-center gap-2">
                <div
                  className="h-10 w-10 rounded-md border border-input"
                  style={{ backgroundColor: newGroupColor }}
                />
                <Input
                  type="text"
                  value={newGroupColor}
                  onChange={(e) => setNewGroupColor(e.target.value)}
                  placeholder="#3B82F6"
                  className="w-24 font-mono text-sm"
                />
              </div>
            </div>
          </div>
          {!group.is_parent_group && (
            <div>
              <label htmlFor="parent-group-select-edit" className="text-sm font-medium">
                Parent Group
              </label>
              <Select
                value={newParentGroupId || "__none__"}
                onValueChange={(value) => setNewParentGroupId(value === "__none__" ? null : value)}
              >
                <SelectTrigger id="parent-group-select-edit" className="mt-1 w-full">
                  <SelectValue placeholder="None (top-level group)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None (top-level group)</SelectItem>
                  {getAvailableParentGroups(group.id).map((parentGroup) => (
                    <SelectItem key={parentGroup.id} value={parentGroup.id}>
                      {parentGroup.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isUpdating}>
              Cancel
            </Button>
            <Button
              onClick={updateGroup}
              loading={isUpdating}
              disabled={!newGroupName.trim() || isUpdating}
            >
              {isUpdating ? "Updating..." : "Update Group"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
