import { openDB, DBSchema, IDBPDatabase } from "idb";

interface TaskData {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  priority: number;
  status: string;
  duration: number | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  due_date: string | null;
  locked: boolean;
  group_id: string | null;
  template_id: string | null;
  task_type: string;
  google_calendar_event_id: string | null;
  notification_sent: boolean;
  depends_on_task_id: string | null;
  energy_level_required: number;
  parent_task_id: string | null;
  continued_from_task_id: string | null;
  ignored: boolean;
  created_at: string;
  updated_at: string;
}

interface TaskGroup {
  id: string;
  user_id: string;
  name: string;
  color: string | null;
  collapsed: boolean;
  created_at: string;
  updated_at: string;
}

interface DayNote {
  id: string;
  user_id: string;
  date: string;
  content: string;
  created_at: string;
  updated_at: string;
}

interface SyncQueueItem {
  id: string;
  method: "POST" | "PUT" | "DELETE" | "PATCH";
  url: string;
  body: unknown;
  timestamp: number;
  retries: number;
}

interface OfflineDB extends DBSchema {
  tasks: {
    key: string;
    value: TaskData;
    indexes: { "by-user": string; "by-group": string };
  };
  taskGroups: {
    key: string;
    value: TaskGroup;
    indexes: { "by-user": string };
  };
  dayNotes: {
    key: string;
    value: DayNote;
    indexes: { "by-user": string; "by-date": string };
  };
  syncQueue: {
    key: string;
    value: SyncQueueItem;
  };
}

const DB_NAME = "plan-my-day-offline";
const DB_VERSION = 1;

let dbInstance: IDBPDatabase<OfflineDB> | null = null;

export async function getDB(): Promise<IDBPDatabase<OfflineDB>> {
  if (dbInstance) {
    return dbInstance;
  }

  dbInstance = await openDB<OfflineDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Tasks store
      if (!db.objectStoreNames.contains("tasks")) {
        const taskStore = db.createObjectStore("tasks", { keyPath: "id" });
        taskStore.createIndex("by-user", "user_id");
        taskStore.createIndex("by-group", "group_id");
      }

      // Task groups store
      if (!db.objectStoreNames.contains("taskGroups")) {
        const groupStore = db.createObjectStore("taskGroups", { keyPath: "id" });
        groupStore.createIndex("by-user", "user_id");
      }

      // Day notes store
      if (!db.objectStoreNames.contains("dayNotes")) {
        const noteStore = db.createObjectStore("dayNotes", { keyPath: "id" });
        noteStore.createIndex("by-user", "user_id");
        noteStore.createIndex("by-date", "date");
      }

      // Sync queue store
      if (!db.objectStoreNames.contains("syncQueue")) {
        db.createObjectStore("syncQueue", { keyPath: "id" });
      }
    },
  });

  return dbInstance;
}

// Task operations
export async function saveTask(task: TaskData): Promise<void> {
  const db = await getDB();
  await db.put("tasks", task);
}

export async function getTask(taskId: string): Promise<TaskData | undefined> {
  const db = await getDB();
  return db.get("tasks", taskId);
}

export async function getAllTasks(userId: string): Promise<TaskData[]> {
  const db = await getDB();
  const index = db.transaction("tasks").store.index("by-user");
  return index.getAll(userId);
}

export async function deleteTask(taskId: string): Promise<void> {
  const db = await getDB();
  await db.delete("tasks", taskId);
}

// Task group operations
export async function saveTaskGroup(group: TaskGroup): Promise<void> {
  const db = await getDB();
  await db.put("taskGroups", group);
}

export async function getAllTaskGroups(userId: string): Promise<TaskGroup[]> {
  const db = await getDB();
  const index = db.transaction("taskGroups").store.index("by-user");
  return index.getAll(userId);
}

export async function deleteTaskGroup(groupId: string): Promise<void> {
  const db = await getDB();
  await db.delete("taskGroups", groupId);
}

// Day note operations
export async function saveDayNote(note: DayNote): Promise<void> {
  const db = await getDB();
  await db.put("dayNotes", note);
}

export async function getDayNote(
  userId: string,
  date: string
): Promise<DayNote | undefined> {
  const db = await getDB();
  const index = db.transaction("dayNotes").store.index("by-date");
  const notes = await index.getAll(date);
  return notes.find((note) => note.user_id === userId);
}

// Sync queue operations
export async function addToSyncQueue(item: Omit<SyncQueueItem, "id">): Promise<string> {
  const db = await getDB();
  const id = `sync-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  await db.put("syncQueue", {
    ...item,
    id,
  });
  return id;
}

export async function getSyncQueue(): Promise<SyncQueueItem[]> {
  const db = await getDB();
  return db.getAll("syncQueue");
}

export async function removeFromSyncQueue(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("syncQueue", id);
}

export async function clearSyncQueue(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("syncQueue", "readwrite");
  await tx.store.clear();
  await tx.done;
}

// Clear all data for a user (useful for logout)
export async function clearUserData(userId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(["tasks", "taskGroups", "dayNotes"], "readwrite");

  // Clear tasks
  const taskIndex = tx.objectStore("tasks").index("by-user");
  const tasks = await taskIndex.getAll(userId);
  for (const task of tasks) {
    await tx.objectStore("tasks").delete(task.id);
  }

  // Clear task groups
  const groupIndex = tx.objectStore("taskGroups").index("by-user");
  const groups = await groupIndex.getAll(userId);
  for (const group of groups) {
    await tx.objectStore("taskGroups").delete(group.id);
  }

  // Clear day notes
  const noteIndex = tx.objectStore("dayNotes").index("by-user");
  const notes = await noteIndex.getAll(userId);
  for (const note of notes) {
    await tx.objectStore("dayNotes").delete(note.id);
  }

  await tx.done;
}

