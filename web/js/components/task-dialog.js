import { api } from "../api.js";
import { icon } from "../icons.js";
import { esc, refresh, store } from "../state.js";
import { addDays, fromLocalValue, toLocalValue, zonedParts, zonedToUtc } from "../time.js";

const PRIORITY = { 1: "Critical", 2: "High", 3: "Medium", 4: "Low", 5: "Very Low" };
const ENERGY = { 1: "Low Energy", 2: "Low-Medium", 3: "Medium", 4: "Medium-High", 5: "High Energy" };
const MODES = [
  ["now", "Schedule Now"],
  ["today", "Schedule Today"],
  ["tomorrow", "Schedule Tomorrow"],
  ["this-weekend", "Schedule This Weekend"],
  ["next-weekend", "Schedule Next Weekend"],
  ["next-week", "Schedule Next Week"],
  ["next-month", "Schedule Next Month"],
  ["asap", "Schedule ASAP"],
  ["due-date", "Schedule to Due Date"],
  ["smart", "Smart Schedule"],
];
const DUE = [
  ["today", "TDY"],
  ["tomorrow", "TMRW"],
  ["eow", "EOW"],
  ["next-eow", "Next EOW"],
  ["eom", "EOM"],
  ["next-eom", "Next EOM"],
];

function leafGroups(currentId) {
  const parents = new Set(store.groups.filter((group) => group.is_parent_group).map((group) => group.id));
  store.groups.forEach((group) => {
    if (group.parent_group_id) parents.add(group.parent_group_id);
  });
  return store.groups.filter((group) => !parents.has(group.id) || group.id === currentId);
}

function duePreset(preset, tz) {
  const now = new Date();
  const parts = zonedParts(now, tz);
  const noon = zonedToUtc(parts.year, parts.month, parts.day, 12, 0, tz);
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(String(parts.weekday).slice(0, 3));
  let target = noon;
  if (preset === "tomorrow") target = addDays(noon, 1);
  if (preset === "eow") {
    let days = (5 - dow + 7) % 7;
    if (days === 0 && (parts.hour > 17 || (parts.hour === 17 && parts.minute > 0))) days = 7;
    target = addDays(noon, days);
  }
  if (preset === "next-eow") {
    let days = (5 - dow + 7) % 7;
    if (days === 0) days = 7;
    target = addDays(noon, days + 7);
  }
  if (preset === "eom" || preset === "next-eom") {
    const jump = preset === "next-eom" ? 2 : 1;
    const monthIndex = parts.month - 1 + jump;
    const year = parts.year + Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    target = addDays(zonedToUtc(year, month, 1, 12, 0, tz), -1);
  }
  const day = zonedParts(target, tz);
  return toLocalValue(zonedToUtc(day.year, day.month, day.day, 17, 0, tz).toISOString(), tz);
}

class TaskDialog extends HTMLElement {
  connectedCallback() {
    this.hidden = true;
  }

  open(task) {
    const fresh = !task?.id;
    this.task = {
      title: "",
      priority: 3,
      energy_level_required: 3,
      task_type: "task",
      duration: 30,
      auto_schedule: fresh ? Boolean(store.user?.auto_schedule_new_tasks) : false,
      schedule_mode: store.user?.default_schedule_mode || "now",
      ...(task || {}),
    };
    this.hidden = false;
    this.render();
  }

  close() {
    this.hidden = true;
    this.innerHTML = "";
  }

  render() {
    const task = this.task;
    const tz = store.user?.timezone || "UTC";
    const groups = leafGroups(task.group_id);
    const selected = groups.find((group) => group.id === task.group_id) || groups[0];
    const options = groups
      .map((group) => `<option value="${esc(group.id)}" ${group.id === task.group_id ? "selected" : ""}>${esc(group.name)}</option>`)
      .join("");
    const modes = task.id
      ? `<div class="modes">${MODES.map(([mode, label]) => `<button class="tiny" data-mode="${mode}" type="button">${label}</button>`).join("")}</div>`
      : `<label class="row"><input name="auto_schedule" type="checkbox" ${task.auto_schedule ? "checked" : ""} /> Auto-schedule</label>
         <label>Schedule mode<select name="schedule_mode">${MODES.map(([mode, label]) => `<option value="${mode}" ${task.schedule_mode === mode ? "selected" : ""}>${label}</option>`).join("")}</select></label>`;
    this.innerHTML = `<div class="dialog-back"><form class="dialog task-form">
      <div class="dialog-title">
        <h2>${task.id ? esc(task.title) : "Create New Task"}</h2>
        <label class="type-menu">Type<select name="task_type">
          <option value="task" ${task.task_type === "task" ? "selected" : ""}>Task</option>
          <option value="event" ${task.task_type === "event" ? "selected" : ""}>Event</option>
          <option value="todo" ${task.task_type === "todo" ? "selected" : ""}>To-Do</option>
        </select></label>
        <button class="tiny icon-btn" type="button" data-act="close" aria-label="Close">${icon("x")}</button>
      </div>
      <label>Title<input name="title" required value="${esc(task.title || "")}" /></label>
      <details>
        <summary>Extra Info</summary>
        <label>Notes<textarea name="description">${esc(task.description || "")}</textarea></label>
        ${task.id ? this.extra(task) : ""}
      </details>
      <div class="form-grid">
        <label>Priority<select name="priority">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${Number(task.priority) === n ? "selected" : ""}>${PRIORITY[n]}</option>`).join("")}</select></label>
        <label>Energy<select name="energy_level_required">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${Number(task.energy_level_required) === n ? "selected" : ""}>${ENERGY[n]}</option>`).join("")}</select></label>
        <label>Group<span class="row"><span class="swatch" data-swatch style="background:${esc(selected?.color || "#9aabbc")}"></span><select name="group_id"><option value="">None</option>${options}</select></span></label>
        <label>Est. Time<input name="duration" type="number" min="5" value="${esc(task.duration || "")}" /></label>
      </div>
      <label>Due Date
        <input name="due_date" type="datetime-local" value="${esc(toLocalValue(task.due_date, tz))}" />
        <span class="modes">${DUE.map(([preset, label]) => `<button class="tiny" type="button" data-due="${preset}">${label}</button>`).join("")}</span>
      </label>
      ${modes}
      <div class="form-grid">
        <label>Start<input name="scheduled_start" type="datetime-local" value="${esc(toLocalValue(task.scheduled_start, tz))}" /></label>
        <label>End<input name="scheduled_end" type="datetime-local" value="${esc(toLocalValue(task.scheduled_end, tz))}" /></label>
      </div>
      <label class="row"><input name="locked" type="checkbox" ${task.locked ? "checked" : ""} /> <span data-lock>${task.locked ? "Locked" : "Unlocked"}</span></label>
      <p class="error" data-error></p>
      <div class="actions">
        ${task.id ? '<button class="tiny" type="button" data-act="complete">Complete</button>' : ""}
        ${task.id ? '<button class="tiny" type="button" data-act="carry">Carry over</button>' : ""}
        ${task.id && task.locked ? '<button class="tiny" type="button" data-act="unlock">Unpin</button>' : ""}
        ${task.id ? '<button class="tiny" type="button" data-act="delete">Delete</button>' : ""}
        <span class="spacer"></span>
        <button class="tiny" type="button" data-act="close">Cancel</button>
        <button class="solid" type="submit">${task.id ? "Save" : "Create Task"}</button>
      </div>
    </form></div>`;
    this.querySelector("form").addEventListener("submit", (event) => this.save(event));
    this.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => this.schedule(button.dataset.mode)));
    this.querySelectorAll("[data-act]").forEach((button) => button.addEventListener("click", () => this.act(button.dataset.act)));
    this.querySelectorAll("[data-due]").forEach((button) => {
      button.addEventListener("click", () => {
        this.querySelector('[name="due_date"]').value = duePreset(button.dataset.due, tz);
      });
    });
    this.querySelector('[name="group_id"]')?.addEventListener("change", (event) => {
      const group = store.groups.find((item) => item.id === event.target.value);
      this.querySelector("[data-swatch]").style.background = group?.color || "#9aabbc";
    });
    this.querySelector('[name="locked"]')?.addEventListener("change", (event) => {
      this.querySelector("[data-lock]").textContent = event.target.checked ? "Locked" : "Unlocked";
    });
  }

  extra(task) {
    const subs = store.tasks.filter((item) => item.parent_task_id === task.id);
    const deps = (task.depends_on || []).join(", ");
    return `<div class="list-block">
      ${subs.map((sub) => `<div class="chip">${esc(sub.step_order || "")} ${esc(sub.title)}</div>`).join("") || '<p class="muted">No steps yet.</p>'}
      <div class="row"><input name="step" placeholder="Add a step" /><button class="tiny" type="button" data-act="step">Add step</button></div>
      <p class="muted">Waiting on: ${esc(deps || "nothing")}</p>
      <div class="row"><input name="dep" placeholder="Task id it waits on" /><button class="tiny" type="button" data-act="dep">Add dependency</button></div>
    </div>`;
  }

  payload() {
    const form = new FormData(this.querySelector("form"));
    const tz = store.user?.timezone || "UTC";
    const duration = Number(form.get("duration"));
    const start = fromLocalValue(form.get("scheduled_start"), tz);
    let end = fromLocalValue(form.get("scheduled_end"), tz);
    if (!end && start && duration) end = new Date(new Date(start).getTime() + duration * 60000).toISOString();
    return {
      title: form.get("title"),
      description: form.get("description") || null,
      task_type: form.get("task_type"),
      priority: Number(form.get("priority")),
      energy_level_required: Number(form.get("energy_level_required")),
      duration: duration || null,
      group_id: form.get("group_id") || null,
      scheduled_start: start,
      scheduled_end: end,
      due_date: fromLocalValue(form.get("due_date"), tz),
      locked: form.get("locked") === "on",
      auto: form.get("auto_schedule") === "on",
      mode: form.get("schedule_mode") || this.task.schedule_mode || "now",
    };
  }

  async save(event) {
    event.preventDefault();
    try {
      const { auto, mode, ...body } = this.payload();
      const steps = this.task.subtasks || [];
      if (this.task.id) {
        await api(`/api/tasks/${this.task.id}`, { method: "PUT", body });
      } else {
        const created = await api("/api/tasks", { method: "POST", body });
        for (const step of steps) {
          if (!step?.title) continue;
          await api(`/api/tasks/${created.task.id}/subtasks`, { method: "POST", body: { title: step.title, duration: step.duration || 30 } });
        }
        if (auto) await api(`/api/tasks/${created.task.id}/schedule`, { method: "POST", body: { mode } });
      }
      await refresh();
      this.close();
    } catch (error) {
      this.querySelector("[data-error]").textContent = error.message;
    }
  }

  async schedule(mode) {
    try {
      await api(`/api/tasks/${this.task.id}/schedule`, { method: "POST", body: { mode } });
      await refresh();
      this.close();
    } catch (error) {
      this.querySelector("[data-error]").textContent = error.message;
    }
  }

  async act(name) {
    try {
      if (name === "close") return this.close();
      if (name === "delete") {
        await api(`/api/tasks/${this.task.id}`, { method: "DELETE" });
      } else if (name === "complete") {
        await api(`/api/tasks/${this.task.id}/complete`, { method: "POST", body: {} });
      } else if (name === "carry") {
        await api(`/api/tasks/${this.task.id}/carryover`, { method: "POST", body: { auto_schedule: true } });
      } else if (name === "unlock") {
        await api(`/api/tasks/${this.task.id}`, { method: "PUT", body: { locked: false } });
      } else if (name === "step") {
        const title = this.querySelector('[name="step"]').value;
        if (!title) return;
        await api(`/api/tasks/${this.task.id}/subtasks`, { method: "POST", body: { title, duration: 30 } });
        await refresh();
        this.task = store.tasks.find((item) => item.id === this.task.id) || this.task;
        this.render();
        return;
      } else if (name === "dep") {
        const depends = this.querySelector('[name="dep"]').value.trim();
        if (!depends) return;
        await api(`/api/tasks/${this.task.id}/dependencies`, { method: "POST", body: { depends_on_task_id: depends } });
      }
      await refresh();
      this.close();
    } catch (error) {
      this.querySelector("[data-error]").textContent = error.message;
    }
  }
}

customElements.define("pmd-task-dialog", TaskDialog);
