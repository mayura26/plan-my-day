import { api } from "./api.js";

function readJSON(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "");
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

const hiddenSaved = readJSON("pmd-hidden-groups", []);
const sectionSaved = readJSON("pmd-sections", null);
const expandedSaved = readJSON("pmd-expanded-groups", []);
const showAllSaved = localStorage.getItem("pmd-show-all-tasks") === "1";

export const store = {
  user: null,
  tasks: [],
  groups: [],
  cursor: new Date(),
  mode: "week",
  offline: 0,
  hidden: new Set(Array.isArray(hiddenSaved) ? hiddenSaved : []),
  selectedGroupId: null,
  sections: {
    groups: sectionSaved?.groups !== false,
    bench: sectionSaved?.bench !== false,
    metrics: sectionSaved?.metrics !== false,
  },
  expandedGroups: new Set(Array.isArray(expandedSaved) ? expandedSaved : []),
  metricOpen: {},
  showAllTasks: showAllSaved,
};

export function persistHidden() {
  localStorage.setItem("pmd-hidden-groups", JSON.stringify([...store.hidden]));
}

export function persistSections() {
  localStorage.setItem("pmd-sections", JSON.stringify(store.sections));
}

export function persistExpanded() {
  localStorage.setItem("pmd-expanded-groups", JSON.stringify([...store.expandedGroups]));
}

export function persistShowAll() {
  localStorage.setItem("pmd-show-all-tasks", store.showAllTasks ? "1" : "0");
}

export function groupKey(task) {
  return task?.group_id || "ungrouped";
}

export function shownTasks() {
  return store.tasks.filter((task) => !store.hidden.has(groupKey(task)) && !store.hidden.has(task.group_id || ""));
}

export function gridTasks() {
  return shownTasks().filter((task) => {
    if (task.parent_task_id || task.status === "cancelled" || task.status === "rescheduled") return false;
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
