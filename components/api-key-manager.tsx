"use client";

import { CheckCircle2, Copy, Key, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import type { APIKeyResponse } from "@/lib/types";

export function APIKeyManager() {
  const { confirm } = useConfirmDialog();
  const [keys, setKeys] = useState<APIKeyResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<APIKeyResponse | null>(null);
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);
  const [isRevoking, setIsRevoking] = useState<string | null>(null);

  // Fetch API keys
  const fetchKeys = useCallback(async () => {
    try {
      const response = await fetch("/api/api-keys");
      if (response.ok) {
        const data = await response.json();
        setKeys(data.keys || []);
      }
    } catch (error) {
      console.error("Error fetching API keys:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Create new API key
  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;

    setIsCreating(true);
    try {
      const response = await fetch("/api/api-keys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: newKeyName.trim() }),
      });

      if (response.ok) {
        const data = await response.json();
        setNewlyCreatedKey(data.key);
        setNewKeyName("");
        setShowCreateDialog(false);
        await fetchKeys();
        toast.success("API key created successfully");
      } else {
        const error = await response.json();
        toast.error(error.error || "Failed to create API key");
      }
    } catch (error) {
      console.error("Error creating API key:", error);
      toast.error("Failed to create API key");
    } finally {
      setIsCreating(false);
    }
  };

  // Revoke API key
  const handleRevokeKey = async (keyId: string) => {
    const confirmed = await confirm({
      title: "Revoke API Key",
      description: "Are you sure you want to revoke this API key? It will no longer be usable.",
      variant: "destructive",
      confirmText: "Revoke",
    });

    if (!confirmed) {
      return;
    }

    setIsRevoking(keyId);
    try {
      const response = await fetch("/api/api-keys", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: keyId }),
      });

      if (response.ok) {
        await fetchKeys();
        toast.success("API key revoked successfully");
      } else {
        const error = await response.json();
        toast.error(error.error || "Failed to revoke API key");
      }
    } catch (error) {
      console.error("Error revoking API key:", error);
      toast.error("Failed to revoke API key");
    } finally {
      setIsRevoking(null);
    }
  };

  // Copy key to clipboard
  const handleCopyKey = async (key: string, keyId: string) => {
    try {
      await navigator.clipboard.writeText(key);
      setCopiedKeyId(keyId);
      setTimeout(() => setCopiedKeyId(null), 2000);
      toast.success("API key copied to clipboard");
    } catch (error) {
      console.error("Failed to copy key:", error);
      toast.error("Failed to copy key to clipboard");
    }
  };

  // Format date for display
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    try {
      return new Date(dateStr).toLocaleString();
    } catch {
      return dateStr;
    }
  };

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading API keys...</div>;
  }

  const activeKeys = keys.filter((k) => !k.revoked_at);
  const revokedKeys = keys.filter((k) => k.revoked_at);

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">API Keys</h3>
            <p className="text-sm text-muted-foreground">
              Create API keys to authenticate requests to the task import API
            </p>
          </div>
          <Button onClick={() => setShowCreateDialog(true)} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            Create API Key
          </Button>
        </div>

        {activeKeys.length === 0 && revokedKeys.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Key className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No API keys yet. Create one to get started.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {activeKeys.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Active Keys</h4>
                <div className="space-y-2">
                  {activeKeys.map((key) => (
                    <div
                      key={key.id}
                      className="flex items-center justify-between p-4 border rounded-lg"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium">{key.name}</span>
                          <span className="text-xs text-muted-foreground font-mono bg-muted px-2 py-1 rounded">
                            {key.key_prefix}...
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground space-y-1">
                          <div>Created: {formatDate(key.created_at)}</div>
                          {key.last_used_at && <div>Last used: {formatDate(key.last_used_at)}</div>}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRevokeKey(key.id)}
                        disabled={isRevoking === key.id}
                        className="ml-4"
                      >
                        {isRevoking === key.id ? (
                          "Revoking..."
                        ) : (
                          <>
                            <Trash2 className="h-4 w-4 mr-2" />
                            Revoke
                          </>
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {revokedKeys.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground">Revoked Keys</h4>
                <div className="space-y-2">
                  {revokedKeys.map((key) => (
                    <div
                      key={key.id}
                      className="flex items-center justify-between p-4 border rounded-lg opacity-60"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium">{key.name}</span>
                          <span className="text-xs text-muted-foreground font-mono bg-muted px-2 py-1 rounded">
                            {key.key_prefix}...
                          </span>
                          <span className="text-xs text-muted-foreground">(Revoked)</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Revoked: {formatDate(key.revoked_at)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Create API Key Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create API Key</DialogTitle>
            <DialogDescription>
              Give your API key a name to help you identify it later. You'll only see the full key
              once after creation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="key-name">Key Name</Label>
              <Input
                id="key-name"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="e.g., Production API, Development"
                disabled={isCreating}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreateDialog(false)}
              disabled={isCreating}
            >
              Cancel
            </Button>
            <Button onClick={handleCreateKey} disabled={isCreating || !newKeyName.trim()}>
              {isCreating ? "Creating..." : "Create Key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Show New Key Dialog */}
      <Dialog open={!!newlyCreatedKey} onOpenChange={(open) => !open && setNewlyCreatedKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API Key Created</DialogTitle>
            <DialogDescription>
              Copy your API key now. You won't be able to see it again after closing this dialog.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Your API Key</Label>
              <div className="flex items-center gap-2">
                <Input value={newlyCreatedKey?.key || ""} readOnly className="font-mono text-sm" />
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() =>
                    newlyCreatedKey?.key && handleCopyKey(newlyCreatedKey.key, newlyCreatedKey.id)
                  }
                >
                  {copiedKeyId === newlyCreatedKey?.id ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Use this key in the Authorization header:{" "}
                <code className="bg-muted px-1 rounded">
                  Bearer {newlyCreatedKey?.key_prefix}...
                </code>
              </p>
            </div>
            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                ⚠️ Make sure to save this key securely. You won't be able to access it again.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setNewlyCreatedKey(null)}>I've Saved My Key</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
