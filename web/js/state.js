import { api } from "./api.js";

const hiddenSaved = JSON.parse(localStorage.getItem("pmd-hidden-groups") || "[]");

export const store = {
  user: null,
  tasks: [],
  groups: [],
  cursor: new Date(),
  mode: "week",
  offline: 0,
  hidden: new Set(hiddenSaved),
  selectedGroupId: null,
  sections: { groups: true, bench: true, metrics: true },
  metricOpen: {},
};

export function persistHidden() {
  localStorage.setItem("pmd-hidden-groups", JSON.stringify([...store.hidden]));
}

export function shownTasks() {
  return store.tasks.filter((task) => !store.hidden.has(task.group_id || ""));
}

export function gridTasks() {
  return shownTasks().filter((task) => {
    if (task.parent_task_id || task.status === "cancelled" || task.status === "rescheduled") return false;
    if (store.selectedGroupId && (task.group_id || "") !== store.selectedGroupId) return false;
    return Boolean(task.scheduled_start);
  });
}

export const bus = new EventTarget();

export function emit() {
  bus.dispatchEvent(new Event("change"));
}

export async function loadSession() {
  const me = await api("/api/me");
  store.user = me.user;
  await refresh();
}

export async function refresh() {
  const [tasks, groups] = await Promise.all([api("/api/tasks"), api("/api/task-groups")]);
  store.tasks = tasks.tasks || [];
  store.groups = groups.groups || [];
  emit();
}

export function groupById(id) {
  return store.groups.find((group) => group.id === id) || null;
}

export function priorityColor(priority) {
  return ["", "var(--p1)", "var(--p2)", "var(--p3)", "var(--p4)", "var(--p5)"][priority] || "var(--p3)";
}

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );
}
