import { enqueue } from "./offline.js";

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function api(path, options = {}) {
  const method = options.method || "GET";
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (offline && method !== "GET") {
    await enqueue({ method, url: path, body: options.body });
    return { queued: true };
  }
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: "include",
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch (error) {
    if (method !== "GET") {
      await enqueue({ method, url: path, body: options.body });
      return { queued: true };
    }
    throw error;
  }
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(data.error || "Request failed", response.status);
  }
  return data;
}
