import {
  addToSyncQueue,
  getSyncQueue,
  removeFromSyncQueue,
  getAllTasks,
  getAllTaskGroups,
  saveTask,
  saveTaskGroup,
} from "./offline-storage";

interface SyncResult {
  success: boolean;
  error?: string;
}

export class SyncManager {
  private isSyncing = false;
  private syncListeners: Array<() => void> = [];

  async sync(): Promise<SyncResult> {
    if (this.isSyncing) {
      return { success: false, error: "Sync already in progress" };
    }

    if (!navigator.onLine) {
      return { success: false, error: "Device is offline" };
    }

    this.isSyncing = true;
    this.notifyListeners();

    try {
      // Process sync queue
      const queue = await getSyncQueue();
      const results = await Promise.allSettled(
        queue.map((item) => this.processQueueItem(item))
      );

      // Remove successfully processed items
      for (let i = 0; i < results.length; i++) {
        if (results[i].status === "fulfilled") {
          await removeFromSyncQueue(queue[i].id);
        }
      }

      // Sync data from server
      await this.syncFromServer();

      this.isSyncing = false;
      this.notifyListeners();
      return { success: true };
    } catch (error) {
      this.isSyncing = false;
      this.notifyListeners();
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private async processQueueItem(
    item: Awaited<ReturnType<typeof getSyncQueue>>[0]
  ): Promise<void> {
    try {
      const response = await fetch(item.url, {
        method: item.method,
        headers: {
          "Content-Type": "application/json",
        },
        body: item.body ? JSON.stringify(item.body) : undefined,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      // If retries exceeded, throw to keep in queue
      if (item.retries >= 3) {
        throw error;
      }
      // Otherwise, increment retries and re-queue
      await addToSyncQueue({
        ...item,
        retries: item.retries + 1,
      });
      await removeFromSyncQueue(item.id);
      throw error;
    }
  }

  private async syncFromServer(): Promise<void> {
    // This would be called to sync server data to local storage
    // For now, we'll just ensure local data is up to date
    // In a full implementation, you'd fetch from API and merge
  }

  async queueRequest(
    method: "POST" | "PUT" | "DELETE" | "PATCH",
    url: string,
    body?: unknown
  ): Promise<string> {
    return addToSyncQueue({
      method,
      url,
      body,
      timestamp: Date.now(),
      retries: 0,
    });
  }

  getIsSyncing(): boolean {
    return this.isSyncing;
  }

  onSyncChange(listener: () => void): () => void {
    this.syncListeners.push(listener);
    return () => {
      this.syncListeners = this.syncListeners.filter((l) => l !== listener);
    };
  }

  private notifyListeners(): void {
    this.syncListeners.forEach((listener) => listener());
  }
}

// Singleton instance
export const syncManager = new SyncManager();

// Auto-sync when coming online
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    syncManager.sync().catch(console.error);
  });
}

