"use client";

import { Check, Clock, Copy, Edit2, Plus, Tag, Trash2, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ENERGY_LABELS, PRIORITY_LABELS } from "@/lib/task-utils";
import type { CreateQuickTagRequest, QuickTag, TaskGroup } from "@/lib/types";

const OFFSET_PRESETS = [
  { label: "Now", value: 0 },
  { label: "15 min", value: 15 },
  { label: "30 min", value: 30 },
  { label: "1 hour", value: 60 },
  { label: "2 hours", value: 120 },
];

interface TagFormData {
  name: string;
  task_title: string;
  task_description: string;
  task_type: "task" | "todo";
  priority: number;
  duration_minutes: string;
  energy_level: number;
  schedule_offset_minutes: number;
  group_id: string;
  auto_accept: boolean;
}

const DEFAULT_FORM: TagFormData = {
  name: "",
  task_title: "",
  task_description: "",
  task_type: "task",
  priority: 3,
  duration_minutes: "30",
  energy_level: 3,
  schedule_offset_minutes: 60,
  group_id: "",
  auto_accept: false,
};

export default function TagsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { confirm } = useConfirmDialog();

  const [tags, setTags] = useState<QuickTag[]>([]);
  const [groups, setGroups] = useState<TaskGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<QuickTag | null>(null);
  const [formData, setFormData] = useState<TagFormData>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/auth/signin");
    }
  }, [status, router]);

  const fetchTags = useCallback(async () => {
    try {
      const res = await fetch("/api/quick-tags");
      if (res.ok) {
        const data = await res.json();
        setTags(data.tags);
      }
    } catch (error) {
      console.error("Error fetching tags:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchGroups = useCallback(async () => {
    try {
      const res = await fetch("/api/task-groups");
      if (res.ok) {
        const data = await res.json();
        setGroups(data.groups || []);
      }
    } catch (error) {
      console.error("Error fetching groups:", error);
    }
  }, []);

  useEffect(() => {
    if (session) {
      fetchTags();
      fetchGroups();
    }
  }, [session, fetchTags, fetchGroups]);

  const openCreateDialog = () => {
    setEditingTag(null);
    setFormData(DEFAULT_FORM);
    setDialogOpen(true);
  };

  const openEditDialog = (tag: QuickTag) => {
    setEditingTag(tag);
    setFormData({
      name: tag.name,
      task_title: tag.task_title,
      task_description: tag.task_description || "",
      task_type: tag.task_type,
      priority: tag.priority,
      duration_minutes: tag.duration_minutes?.toString() || "",
      energy_level: tag.energy_level,
      schedule_offset_minutes: tag.schedule_offset_minutes,
      group_id: tag.group_id || "",
      auto_accept: tag.auto_accept,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.task_title.trim()) {
      toast.error("Name and task title are required");
      return;
    }

    setSaving(true);
    try {
      const payload: CreateQuickTagRequest = {
        name: formData.name.trim(),
        task_title: formData.task_title.trim(),
        task_description: formData.task_description.trim() || undefined,
        task_type: formData.task_type,
        priority: formData.priority,
        duration_minutes: formData.duration_minutes
          ? parseInt(formData.duration_minutes, 10)
          : undefined,
        energy_level: formData.energy_level,
        schedule_offset_minutes: formData.schedule_offset_minutes,
        group_id: formData.group_id || undefined,
        auto_accept: formData.auto_accept,
      };

      const url = editingTag ? `/api/quick-tags/${editingTag.id}` : "/api/quick-tags";
      const method = editingTag ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        toast.success(editingTag ? "Tag updated" : "Tag created");
        setDialogOpen(false);
        fetchTags();
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to save tag");
      }
    } catch (error) {
      console.error("Error saving tag:", error);
      toast.error("Failed to save tag");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (tag: QuickTag) => {
    const confirmed = await confirm({
      title: "Delete Quick Tag",
      description: `Are you sure you want to delete "${tag.name}"? This cannot be undone. Any NFC tags programmed with this URL will stop working.`,
      confirmText: "Delete",
      variant: "destructive",
    });

    if (!confirmed) return;

    try {
      const res = await fetch(`/api/quick-tags/${tag.id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Tag deleted");
        fetchTags();
      } else {
        toast.error("Failed to delete tag");
      }
    } catch (error) {
      console.error("Error deleting tag:", error);
      toast.error("Failed to delete tag");
    }
  };

  const copyUrl = async (tagId: string) => {
    const url = `${window.location.origin}/q/${tagId}`;
    await navigator.clipboard.writeText(url);
    setCopiedId(tagId);
    toast.success("URL copied to clipboard");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getOffsetLabel = (minutes: number) => {
    if (minutes === 0) return "Now";
    if (minutes < 60) return `${minutes} min`;
    const hours = minutes / 60;
    if (hours === Math.floor(hours)) return `${hours}h`;
    return `${Math.floor(hours)}h ${minutes % 60}m`;
  };

  if (status === "loading" || loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="container mx-auto px-4 py-4 md:py-8 max-w-4xl">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Quick Tags</h1>
            <p className="text-sm md:text-base text-muted-foreground mt-2">
              Create NFC-triggered shortcuts for quick task creation
            </p>
          </div>
          <Button onClick={openCreateDialog}>
            <Plus className="h-4 w-4 mr-2" />
            New Tag
          </Button>
        </div>

        <Separator />

        {tags.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Tag className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No Quick Tags yet</h3>
              <p className="text-muted-foreground text-center text-sm mb-4 max-w-md">
                Create a Quick Tag to generate a short URL you can program into an NFC tag. Tapping
                the tag will instantly create a task with your preset configuration.
              </p>
              <Button onClick={openCreateDialog}>
                <Plus className="h-4 w-4 mr-2" />
                Create Your First Tag
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {tags.map((tag) => (
              <Card key={tag.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Tag className="h-4 w-4" />
                        {tag.name}
                      </CardTitle>
                      <CardDescription>{tag.task_title}</CardDescription>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEditDialog(tag)}>
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(tag)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">{tag.task_type === "todo" ? "To-Do" : "Task"}</Badge>
                    <Badge variant="outline">
                      P{tag.priority}:{" "}
                      {PRIORITY_LABELS[tag.priority as keyof typeof PRIORITY_LABELS]}
                    </Badge>
                    {tag.duration_minutes && (
                      <Badge variant="outline">
                        <Clock className="h-3 w-3 mr-1" />
                        {tag.duration_minutes}m
                      </Badge>
                    )}
                    <Badge variant="outline">
                      <Zap className="h-3 w-3 mr-1" />
                      {ENERGY_LABELS[tag.energy_level as keyof typeof ENERGY_LABELS]}
                    </Badge>
                    <Badge variant="outline">
                      Schedules in {getOffsetLabel(tag.schedule_offset_minutes)}
                    </Badge>
                    {tag.auto_accept && <Badge>Auto-create</Badge>}
                  </div>

                  <div className="flex items-center gap-2">
                    <Input
                      readOnly
                      value={`${typeof window !== "undefined" ? window.location.origin : ""}/q/${tag.id}`}
                      className="text-xs font-mono"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => copyUrl(tag.id)}
                      className="shrink-0"
                    >
                      {copiedId === tag.id ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingTag ? "Edit Quick Tag" : "Create Quick Tag"}</DialogTitle>
            <DialogDescription>
              {editingTag
                ? "Update this tag's configuration. Changes apply to future scans."
                : "Configure a quick tag for NFC-triggered task creation."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="tag-name">Tag Name</Label>
              <Input
                id="tag-name"
                placeholder="e.g., Laundry, Take Medication"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="task-title">Task Title</Label>
              <Input
                id="task-title"
                placeholder="e.g., Collect Laundry"
                value={formData.task_title}
                onChange={(e) => setFormData({ ...formData, task_title: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="task-description">Description (optional)</Label>
              <Textarea
                id="task-description"
                placeholder="Additional details..."
                value={formData.task_description}
                onChange={(e) => setFormData({ ...formData, task_description: e.target.value })}
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={formData.task_type}
                  onValueChange={(v) =>
                    setFormData({ ...formData, task_type: v as "task" | "todo" })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="task">Task</SelectItem>
                    <SelectItem value="todo">To-Do</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Priority</Label>
                <Select
                  value={formData.priority.toString()}
                  onValueChange={(v) => setFormData({ ...formData, priority: parseInt(v, 10) })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5].map((p) => (
                      <SelectItem key={p} value={p.toString()}>
                        {p} - {PRIORITY_LABELS[p as keyof typeof PRIORITY_LABELS]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="duration">Duration (minutes)</Label>
                <Input
                  id="duration"
                  type="number"
                  min="1"
                  placeholder="30"
                  value={formData.duration_minutes}
                  onChange={(e) => setFormData({ ...formData, duration_minutes: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>Energy Level</Label>
                <Select
                  value={formData.energy_level.toString()}
                  onValueChange={(v) => setFormData({ ...formData, energy_level: parseInt(v, 10) })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5].map((e) => (
                      <SelectItem key={e} value={e.toString()}>
                        {e} - {ENERGY_LABELS[e as keyof typeof ENERGY_LABELS]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Schedule Offset</Label>
              <div className="flex flex-wrap gap-2">
                {OFFSET_PRESETS.map((preset) => (
                  <Button
                    key={preset.value}
                    type="button"
                    variant={
                      formData.schedule_offset_minutes === preset.value ? "default" : "outline"
                    }
                    size="sm"
                    onClick={() =>
                      setFormData({ ...formData, schedule_offset_minutes: preset.value })
                    }
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Input
                  type="number"
                  min="0"
                  value={formData.schedule_offset_minutes}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      schedule_offset_minutes: parseInt(e.target.value, 10) || 0,
                    })
                  }
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">minutes from now</span>
              </div>
            </div>

            {groups.length > 0 && (
              <div className="space-y-2">
                <Label>Group (optional)</Label>
                <Select
                  value={formData.group_id || "none"}
                  onValueChange={(v) =>
                    setFormData({ ...formData, group_id: v === "none" ? "" : v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="No group" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No group</SelectItem>
                    {groups
                      .filter((g) => !g.is_parent_group)
                      .map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label>Auto-create task</Label>
                <p className="text-sm text-muted-foreground">
                  Skip confirmation and create the task immediately on scan
                </p>
              </div>
              <Switch
                checked={formData.auto_accept}
                onCheckedChange={(checked) => setFormData({ ...formData, auto_accept: checked })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : editingTag ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
