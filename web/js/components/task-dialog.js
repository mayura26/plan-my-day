import { api } from "../api.js";
import { bus, esc, refresh, store } from "../state.js";
import { fromLocalValue, toLocalValue } from "../time.js";

const MODES = [
  ["now", "Next opening"],
  ["today", "Today"],
  ["tomorrow", "Tomorrow"],
  ["this-weekend", "This weekend"],
  ["next-weekend", "Next weekend"],
  ["next-week", "Next week"],
  ["next-month", "Next month"],
  ["asap", "Insert now"],
  ["due-date", "Before due"],
  ["smart", "Make room"],
];

class TaskDialog extends HTMLElement {
  connectedCallback() {
    this.hidden = true;
  }

  open(task) {
    this.task = task || {
      title: "",
      priority: 3,
      energy_level_required: 3,
      task_type: "task",
      duration: 30,
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
    const groups = store.groups
      .map((group) => `<option value="${esc(group.id)}" ${group.id === task.group_id ? "selected" : ""}>${esc(group.name)}</option>`)
      .join("");
    const modes = task.id
      ? `<div class="modes">${MODES.map(([mode, label]) => `<button class="tiny" data-mode="${mode}" type="button">${label}</button>`).join("")}</div>`
      : "";
    this.innerHTML = `<div class="dialog-back"><form class="dialog">
      <p class="kicker">${task.id ? "Task" : "New task"}</p>
      <h2 class="day-title" style="font-size:2.2rem">${task.id ? esc(task.title) : "Make room for something."}</h2>
      <div class="form-grid">
        <label>Title<input name="title" required value="${esc(task.title || "")}" /></label>
        <label>Type<select name="task_type">
          ${["task", "event", "todo"].map((type) => `<option ${task.task_type === type ? "selected" : ""}>${type}</option>`).join("")}
        </select></label>
        <label>Priority<select name="priority">${[1, 2, 3, 4, 5].map((n) => `<option ${Number(task.priority) === n ? "selected" : ""}>${n}</option>`).join("")}</select></label>
        <label>Energy<select name="energy_level_required">${[1, 2, 3, 4, 5].map((n) => `<option ${Number(task.energy_level_required) === n ? "selected" : ""}>${n}</option>`).join("")}</select></label>
        <label>Minutes<input name="duration" type="number" min="5" value="${esc(task.duration || "")}" /></label>
        <label>Group<select name="group_id"><option value="">None</option>${groups}</select></label>
        <label>Starts<input name="scheduled_start" type="datetime-local" value="${esc(toLocalValue(task.scheduled_start, tz))}" /></label>
        <label>Due<input name="due_date" type="datetime-local" value="${esc(toLocalValue(task.due_date, tz))}" /></label>
      </div>
      <label>Notes<textarea name="description">${esc(task.description || "")}</textarea></label>
      <label class="row"><input name="locked" type="checkbox" ${task.locked ? "checked" : ""} /> Pinned, so packing will not move it</label>
      ${modes}
      <p class="error" data-error></p>
      <div class="actions">
        <button class="solid" type="submit">${task.id ? "Save" : "Create"}</button>
        ${task.id ? '<button class="tiny" type="button" data-act="complete">Complete</button>' : ""}
        ${task.id ? '<button class="tiny" type="button" data-act="carry">Carry over</button>' : ""}
        ${task.id && task.locked ? '<button class="tiny" type="button" data-act="unlock">Unpin</button>' : ""}
        ${task.id ? '<button class="tiny" type="button" data-act="delete">Delete</button>' : ""}
        <button class="tiny" type="button" data-act="close">Close</button>
      </div>
      ${task.id ? this.extra(task) : ""}
    </form></div>`;
    this.querySelector("form").addEventListener("submit", (event) => this.save(event));
    this.querySelectorAll("[data-mode]").forEach((button) => {
      button.addEventListener("click", () => this.schedule(button.dataset.mode));
    });
    this.querySelectorAll("[data-act]").forEach((button) => {
      button.addEventListener("click", () => this.act(button.dataset.act));
    });
  }

  extra(task) {
    const subs = store.tasks.filter((item) => item.parent_task_id === task.id);
    const deps = (task.depends_on || []).join(", ");
    return `<div class="list-block"><p class="kicker">Steps</p>
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
    let end = null;
    if (start && duration) end = new Date(new Date(start).getTime() + duration * 60000).toISOString();
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
    };
  }

  async save(event) {
    event.preventDefault();
    try {
      const body = this.payload();
      if (this.task.id) await api(`/api/tasks/${this.task.id}`, { method: "PUT", body });
      else await api("/api/tasks", { method: "POST", body });
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
        await api(`/api/tasks/${this.task.id}/subtasks`, { method: "POST", body: { title, duration: 30 } });
      } else if (name === "dep") {
        const depends = this.querySelector('[name="dep"]').value.trim();
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
