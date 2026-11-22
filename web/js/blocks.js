import { api } from "./api.js";
import { icon } from "./icons.js";
import { esc, groupById, groupKey, priorityColor, refresh, store } from "./state.js";
import { dayKey, zonedParts, zonedToUtc } from "./time.js";

export const HOUR_PX = 48;
export const DAY_HEIGHT = 24 * HOUR_PX;

export function minuteOf(date, tz) {
  const parts = zonedParts(date, tz);
  return parts.hour * 60 + parts.minute;
}

export function hourLabel(hour) {
  const suffix = hour < 12 ? "AM" : "PM";
  const face = hour % 12 || 12;
  return `${face} ${suffix}`;
}

export function shortDue(iso, tz) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short" }).format(new Date(iso));
}

function endsAt(task) {
  if (task.scheduled_end) return new Date(task.scheduled_end).getTime();
  if (!task.scheduled_start) return 0;
  return new Date(task.scheduled_start).getTime() + (task.duration || 30) * 60000;
}

function overlaps(a, b) {
  if (!a.scheduled_start || !b.scheduled_start) return false;
  return new Date(a.scheduled_start).getTime() < endsAt(b) && endsAt(a) > new Date(b.scheduled_start).getTime();
}

function pastEvent(task) {
  return task.task_type === "event" && task.status !== "completed" && task.scheduled_end && new Date(task.scheduled_end) < new Date();
}

function overdue(task) {
  if (task.task_type === "event" || task.status === "completed" || task.status === "cancelled" || task.status === "rescheduled" || task.ignored) return false;
  const now = Date.now();
  if (task.due_date && new Date(task.due_date).getTime() < now) return true;
  return Boolean(task.scheduled_end && new Date(task.scheduled_end).getTime() < now);
}

export function layoutTasks(tasks, tz) {
  const active = tasks.filter((task) => task.status !== "completed");
  const completed = tasks.filter((task) => task.status === "completed");
  const hidden = new Map();
  for (const task of active) {
    const covered = completed.filter((done) => overlaps(task, done));
    if (covered.length) hidden.set(task.id, covered.map((done) => done.id));
  }
  const visible = [...active, ...completed.filter((done) => !active.some((task) => overlaps(task, done)))];
  const items = visible
    .filter((task) => task.scheduled_start)
    .map((task) => {
      const begin = new Date(task.scheduled_start);
      const start = minuteOf(begin, tz);
      const finish = new Date(task.scheduled_end || begin.getTime() + (task.duration || 30) * 60000);
      let end = dayKey(finish, tz) === dayKey(begin, tz) ? minuteOf(finish, tz) : 24 * 60;
      if (end <= start) end = Math.min(24 * 60, start + (task.duration || 30));
      return { task, start, end, col: 0, cols: 1, hiddenCompleted: hidden.get(task.id) || [] };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);
  let group = [];
  let groupEnd = -1;
  const flush = () => {
    const count = Math.max(1, ...group.map((item) => item.col + 1));
    group.forEach((item) => {
      item.cols = count;
    });
    group = [];
  };
  const lanes = [];
  for (const item of items) {
    if (group.length && item.start >= groupEnd) flush();
    for (let i = lanes.length - 1; i >= 0; i -= 1) {
      if (lanes[i].end <= item.start) lanes.splice(i, 1);
    }
    const used = new Set(lanes.map((entry) => entry.col));
    let col = 0;
    while (used.has(col)) col += 1;
    item.col = col;
    lanes.push(item);
    group.push(item);
    groupEnd = Math.max(groupEnd, item.end);
  }
  if (group.length) flush();
  return items;
}

export function blockHTML(item, tz) {
  const task = item.task;
  const group = groupById(task.group_id);
  const color = group?.color || "#6b7280";
  const top = (item.start / 1440) * DAY_HEIGHT;
  const height = Math.max(22, ((item.end - item.start) / 1440) * DAY_HEIGHT);
  const done = task.status === "completed";
  const past = pastEvent(task);
  const selected = store.selectedGroupId;
  const faded = selected && (selected === "ungrouped" ? Boolean(task.group_id) : groupKey(task) !== selected);
  const classes = ["block", done || past ? "done" : "", overdue(task) ? "overdue" : "", task.status === "in_progress" ? "progress" : "", faded ? "faded" : ""].filter(Boolean).join(" ");
  const energy = task.energy_level_required
    ? `<span class="block-energy">${icon("zap")}<span>${esc(task.energy_level_required)}</span></span>`
    : "";
  const archive = !done && item.hiddenCompleted.length
    ? `<button class="block-archive${task.energy_level_required ? "" : " alone"}" type="button" data-archive="${esc(item.hiddenCompleted[0])}" title="${item.hiddenCompleted.length === 1 ? "View completed task" : `${item.hiddenCompleted.length} completed tasks hidden`}">${icon("archive")}</button>`
    : "";
  const duration = task.duration || item.end - item.start;
  const badge = group && duration >= 45
    ? `<em class="block-group">${esc(group.name.length > 10 ? `${group.name.slice(0, 10)}...` : group.name)}</em>`
    : "";
  return `<article class="${classes}" role="button" tabindex="0" data-id="${esc(task.id)}" data-minute="${item.start}" data-dur="${item.end - item.start}" style="top:${top}px;height:${height}px;left:${(item.col / item.cols) * 100}%;width:calc(${100 / item.cols}% - 6px);--block:${esc(color)}">
    <span class="priority" style="background:${priorityColor(task.priority)}"></span>
    ${energy}${archive}
    <strong>${esc(task.title)}</strong>
    ${badge}
    <div class="resize" data-resize="1"></div>
  </article>`;
}

export function hourLines() {
  return Array.from({ length: 24 }, (_, hour) => `<div class="hour-line" style="top:${hour * HOUR_PX}px"></div>`).join("");
}

export function gutterLabels() {
  return Array.from({ length: 24 }, (_, hour) =>
    hour === 0 ? "" : `<div class="hour-label" style="top:${hour * HOUR_PX}px">${hourLabel(hour)}</div>`,
  ).join("");
}

export function nowMarker(tz) {
  const top = (minuteOf(new Date(), tz) / 1440) * DAY_HEIGHT;
  return `<div class="now-line" style="top:${top}px"></div>`;
}

export function installPointer(root) {
  root.addEventListener("pointerdown", (event) => {
    const archive = event.target.closest("[data-archive]");
    if (archive) {
      event.preventDefault();
      event.stopPropagation();
      root.dispatchEvent(new CustomEvent("open-task", { bubbles: true, detail: archive.dataset.archive }));
      return;
    }
    const block = event.target.closest(".block");
    if (!block || event.button !== 0) return;
    event.preventDefault();
    const resize = Boolean(event.target.closest(".resize"));
    const originX = event.clientX;
    const originY = event.clientY;
    const originHeight = block.offsetHeight;
    let moved = false;
    const move = (ev) => {
      const delta = ev.clientY - originY;
      const across = ev.clientX - originX;
      if (Math.abs(delta) < 4 && Math.abs(across) < 4) return;
      moved = true;
      block.classList.add("dragging");
      if (resize) block.style.height = `${Math.max(18, originHeight + delta)}px`;
      else block.style.transform = `translate(${across}px, ${delta}px)`;
    };
    const up = async (ev) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      block.classList.remove("dragging");
      if (!moved) {
        root.dispatchEvent(new CustomEvent("open-task", { bubbles: true, detail: block.dataset.id }));
        return;
      }
      const columns = [...root.querySelectorAll("[data-key]")];
      const column = columns.find((col) => {
        const rect = col.getBoundingClientRect();
        return ev.clientX >= rect.left && ev.clientX <= rect.right;
      }) || block.closest("[data-key]");
      const rect = column.getBoundingClientRect();
      let minute = resize ? Number(block.dataset.minute) : Math.round(((ev.clientY - rect.top) / DAY_HEIGHT) * 1440 / 15) * 15;
      minute = Math.max(0, Math.min(24 * 60 - 15, minute));
      let duration = Number(block.dataset.dur);
      if (resize) duration = Math.max(15, Math.round((block.offsetHeight / DAY_HEIGHT) * 1440 / 15) * 15);
      await saveSlot(block.dataset.id, column.dataset.key, minute, duration);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
  root.addEventListener("dblclick", (event) => {
    if (event.target.closest(".block")) return;
    const column = event.target.closest("[data-key]");
    if (!column) return;
    const rect = column.getBoundingClientRect();
    const minute = Math.max(0, Math.min(24 * 60 - 15, Math.round(((event.clientY - rect.top) / DAY_HEIGHT) * 1440 / 15) * 15));
    root.dispatchEvent(new CustomEvent("create-at", { bubbles: true, detail: { key: column.dataset.key, minute } }));
  });
}

export async function saveSlot(id, key, minute, duration) {
  const { store } = await import("./state.js");
  const tz = store.user?.timezone || "UTC";
  const [year, month, day] = key.split("-").map(Number);
  const start = zonedToUtc(year, month, day, Math.floor(minute / 60), minute % 60, tz);
  const end = new Date(start.getTime() + duration * 60000);
  await api(`/api/tasks/${id}`, {
    method: "PUT",
    body: {
      scheduled_start: start.toISOString(),
      scheduled_end: end.toISOString(),
      duration,
      locked: true,
    },
  });
  await refresh();
}

export function scrollToNow(scroller, tz) {
  if (!scroller) return;
  const top = (minuteOf(new Date(), tz) / 1440) * DAY_HEIGHT;
  scroller.scrollTop = Math.max(0, top - 140);
}
