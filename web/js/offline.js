const DB_NAME = "plan-my-day-offline";
const STORE = "queue";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueue(item) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).add({ ...item, timestamp: Date.now(), retries: 0 });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function pendingCount() {
  const db = await openDb();
  const count = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return count;
}

export async function replay() {
  const db = await openDb();
  const items = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  for (const item of items) {
    try {
      const res = await fetch(item.url, {
        method: item.method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: item.body ? JSON.stringify(item.body) : undefined,
      });
      if (!res.ok && res.status < 500) {
        await remove(db, item.id);
        continue;
      }
      if (res.ok) await remove(db, item.id);
    } catch {
      break;
    }
  }
  db.close();
}

function remove(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
