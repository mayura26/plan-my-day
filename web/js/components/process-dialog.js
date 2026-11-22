import { api } from "../api.js";
import { icon } from "../icons.js";
import { esc, refresh, shownTasks, store } from "../state.js";
import { fromLocalValue, toLocalValue } from "../time.js";

const REVIEW_MODES = [
  ["now", "Schedule Now"],
  ["today", "Later Today"],
  ["tomorrow", "Tomorrow"],
  ["next-week", "Next Week"],
  ["this-weekend", "This Weekend"],
  ["next-weekend", "Next Weekend"],
  ["next-month", "Next Month"],
  ["asap", "ASAP"],
  ["due-date", "By Due Date"],
  ["smart", "Smart"],
];

const EXTEND = [
  ["+1d", 86_400_000],
  ["+3d", 3 * 86_400_000],
  ["+1w", 7 * 86_400_000],
  ["+2w", 14 * 86_400_000],
  ["+1mo", 30 * 86_400_000],
];

const MISSED_ACTIONS = [
  ["carryover", "Carryover", "refresh-cw"],
  ["reschedule", "Reschedule", "zap"],
  ["complete", "Complete", "check"],
];

const DEADLINE_ACTIONS = [
  ["extend-due-date", "Extend Due Date", "calendar"],
  ["schedule", "Schedule", "zap"],
  ["complete", "Complete", "check"],
  ["ignore", "Ignore", ""],
];

export function overdueTasks() {
  const now = Date.now();
  return shownTasks().filter((task) => {
    if (task.task_type === "event" || task.ignored) return false;
    if (["completed", "cancelled", "rescheduled"].includes(task.status)) return false;
    if (task.due_date && new Date(task.due_date).getTime() < now) return true;
    return Boolean(task.scheduled_end && new Date(task.scheduled_end).getTime() < now);
  });
}

function partition(tasks) {
  const now = Date.now();
  const missed = [];
  const deadline = [];
  tasks.forEach((task) => {
    if (task.scheduled_end && new Date(task.scheduled_end).getTime() < now) missed.push(task);
    else deadline.push(task);
  });
  return { missed, deadline };
}

function formatStamp(iso, tz) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

class ProcessDialog extends HTMLElement {
  connectedCallback() {
    this.hidden = true;
    this.tasks = [];
    this.decisions = {};
    this.error = "";
    this.busy = false;
  }

  open() {
    this.tasks = overdueTasks();
    this.decisions = {};
    this.error = "";
    this.busy = false;
    this.hidden = false;
    this.render();
  }

  close() {
    this.hidden = true;
    this.innerHTML = "";
    this.painted = false;
  }

  render() {
    const tz = store.user?.timezone || "UTC";
    if (!this.tasks.length) {
      this.innerHTML = `<div class="dialog-back"><div class="dialog review">
        <div class="review-head"><h2>No Overdue Tasks</h2></div>
        <p class="muted review-empty">All tasks are up to date!</p>
        <div class="review-foot"><button class="solid" type="button" data-close>Close</button></div>
      </div></div>`;
      this.querySelector("[data-close]").addEventListener("click", () => this.close());
      return;
    }
    const { missed, deadline } = partition(this.tasks);
    const again = this.painted;
    const resolved = Object.keys(this.decisions).length;
    const total = this.tasks.length;
    const pct = Math.round((resolved / total) * 100);
    this.innerHTML = `<div class="dialog-back"><div class="dialog review">
      <div class="review-head">
        <h2>${icon("alert-triangle")} Review Overdue Tasks (${total})</h2>
        <div class="review-count"><span>${resolved} of ${total} resolved</span><span>${pct}%</span></div>
        <div class="review-progress"><span style="width:${pct}%"></span></div>
      </div>
      <div class="review-list">
        ${this.section("Missed Schedule", "calendar-clock", missed, "missed", tz)}
        ${this.section("Overdue Deadline", "calendar", deadline, "deadline", tz)}
        ${this.error ? `<p class="error">${esc(this.error)}</p>` : ""}
      </div>
      <div class="review-foot">
        <button class="tiny" type="button" data-close ${this.busy ? "disabled" : ""}>Cancel</button>
        <button class="solid" type="button" data-apply ${resolved && !this.busy ? "" : "disabled"}>${this.busy ? "Applying…" : `Apply All (${resolved} resolved)`}</button>
      </div>
    </div></div>`;
    this.querySelector("[data-close]").addEventListener("click", () => this.close());
    this.querySelector("[data-apply]").addEventListener("click", () => this.apply());
    this.querySelectorAll("[data-choice]").forEach((button) => {
      button.addEventListener("click", () => this.choose(button.dataset.id, button.dataset.choice));
    });
    this.querySelectorAll("[data-extend]").forEach((button) => {
      button.addEventListener("click", () => this.extend(button.dataset.id, Number(button.dataset.extend)));
    });
    this.querySelectorAll("[data-field]").forEach((field) => {
      field.addEventListener("input", () => this.remember(field));
      field.addEventListener("change", () => this.remember(field));
    });
    if (again) this.querySelector(".dialog-back")?.classList.add("settled");
    this.painted = true;
  }

  section(title, glyph, tasks, kind, tz) {
    if (!tasks.length) return "";
    const actions = kind === "missed" ? MISSED_ACTIONS : DEADLINE_ACTIONS;
    const cards = tasks.map((task) => this.card(task, kind, actions, tz)).join("");
    return `<section class="review-section">
      <h3>${icon(glyph)} ${title} (${tasks.length})</h3>
      ${cards}
    </section>`;
  }

  card(task, kind, actions, tz) {
    const decision = this.decisions[task.id];
    const parent = task.parent_task_id ? store.tasks.find((item) => item.id === task.parent_task_id) : null;
    const deadlineAlso = kind === "missed" && task.due_date && new Date(task.due_date).getTime() < Date.now();
    const buttons = actions
      .map(([action, label, glyph]) => {
        const on = decision?.action === action ? " solid" : "";
        const mark = glyph ? icon(glyph) : "";
        return `<button class="tiny with-icon${on}" type="button" data-choice="${action}" data-id="${esc(task.id)}">${mark}${label}</button>`;
      })
      .join("");
    const when = task.scheduled_end
      ? `<span>${icon("calendar-clock")} Scheduled end: ${esc(formatStamp(task.scheduled_end, tz))}</span>`
      : task.due_date
        ? `<span>${icon("calendar")} Due: ${esc(formatStamp(task.due_date, tz))}</span>`
        : "";
    return `<article class="review-card${decision ? " resolved" : ""}">
      <header>
        <div>
          <p class="review-title">${esc(task.title)}</p>
          ${parent ? `<p class="muted">↳ ${esc(parent.title)}</p>` : ""}
          <p class="review-meta">${task.duration ? `<span>${icon("clock")} ${esc(task.duration)} min</span>` : ""}${when}</p>
        </div>
        <div class="review-tags">
          <span class="tag-amber">${kind === "missed" ? "Missed Schedule" : "Overdue Deadline"}</span>
          ${deadlineAlso ? `<span class="tag-alert" title="Rescheduling will move the deadline to the new time">Deadline also passed</span>` : ""}
        </div>
      </header>
      <div class="review-actions">${buttons}</div>
      ${this.extra(task, decision, tz)}
    </article>`;
  }

  extra(task, decision, tz) {
    if (!decision) return "";
    if (decision.action === "reschedule" || decision.action === "schedule") {
      const options = REVIEW_MODES.map(
        ([mode, label]) => `<option value="${mode}" ${decision.scheduleMode === mode ? "selected" : ""}>${label}</option>`,
      ).join("");
      return `<label>Schedule mode<select data-field data-id="${esc(task.id)}" data-key="scheduleMode">${options}</select></label>`;
    }
    if (decision.action === "carryover") {
      return `<div class="form-grid">
        <label>Duration (min)<input data-field data-id="${esc(task.id)}" data-key="carryoverDuration" type="number" min="1" value="${esc(decision.carryoverDuration ?? task.duration ?? 30)}" /></label>
        <label>Notes<input data-field data-id="${esc(task.id)}" data-key="carryoverNotes" placeholder="Optional notes…" value="${esc(decision.carryoverNotes || "")}" /></label>
      </div>`;
    }
    if (decision.action === "extend-due-date") {
      const current = task.due_date ? `<p class="muted">Current deadline: ${esc(formatStamp(task.due_date, tz))}</p>` : "";
      const jumps = EXTEND.map(
        ([label, ms]) => `<button class="tiny" type="button" data-extend="${ms}" data-id="${esc(task.id)}">${label}</button>`,
      ).join("");
      return `${current}
        <div class="modes">${jumps}</div>
        <label>Or pick a date<input data-field data-id="${esc(task.id)}" data-key="newDueDate" type="datetime-local" value="${esc(decision.newDueDate || "")}" /></label>`;
    }
    return "";
  }

  choose(id, action) {
    if (this.busy) return;
    const current = this.decisions[id];
    if (current?.action === action) {
      delete this.decisions[id];
    } else {
      const task = this.tasks.find((item) => item.id === id);
      const next = { action };
      if (action === "carryover") {
        next.carryoverDuration = task?.duration || 30;
        next.carryoverNotes = "";
      }
      if (action === "reschedule" || action === "schedule") next.scheduleMode = current?.scheduleMode || "asap";
      if (action === "extend-due-date") next.newDueDate = "";
      this.decisions[id] = next;
    }
    this.render();
  }

  extend(id, ms) {
    const task = this.tasks.find((item) => item.id === id);
    const decision = this.decisions[id];
    if (!task || !decision) return;
    const tz = store.user?.timezone || "UTC";
    const base = task.due_date ? new Date(task.due_date) : new Date();
    decision.newDueDate = toLocalValue(new Date(base.getTime() + ms).toISOString(), tz);
    this.render();
  }

  remember(field) {
    const decision = this.decisions[field.dataset.id];
    if (!decision) return;
    const key = field.dataset.key;
    decision[key] = key === "carryoverDuration" ? Number(field.value) : field.value;
  }

  async apply() {
    if (this.busy) return;
    const tz = store.user?.timezone || "UTC";
    const problems = [];
    Object.entries(this.decisions).forEach(([id, decision]) => {
      const task = this.tasks.find((item) => item.id === id);
      if (!task) return;
      if (decision.action === "carryover" && !(Number(decision.carryoverDuration) > 0)) {
        problems.push(`"${task.title}": carryover duration must be > 0`);
      }
      if (decision.action === "extend-due-date") {
        if (!decision.newDueDate) problems.push(`"${task.title}": new due date is required`);
        else if (new Date(fromLocalValue(decision.newDueDate, tz)) <= new Date()) {
          problems.push(`"${task.title}": new due date must be in the future`);
        }
      }
    });
    if (problems.length) {
      this.error = problems.join(" · ");
      this.render();
      return;
    }
    this.busy = true;
    this.error = "";
    this.render();
    const failed = [];
    for (const [id, decision] of Object.entries(this.decisions)) {
      const task = this.tasks.find((item) => item.id === id);
      if (!task) continue;
      try {
        await this.execute(task, decision, tz);
      } catch (error) {
        failed.push(error.message || `Failed: "${task.title}"`);
      }
    }
    this.busy = false;
    if (failed.length) {
      this.error = failed.join(" · ");
      this.render();
      return;
    }
    this.decisions = {};
    await refresh();
    this.close();
  }

  async execute(task, decision, tz) {
    if (decision.action === "carryover") {
      await api(`/api/tasks/${task.id}/carryover`, {
        method: "POST",
        body: {
          additional_duration: Number(decision.carryoverDuration) || task.duration || 30,
          notes: decision.carryoverNotes || "",
          auto_schedule: true,
        },
      });
      return;
    }
    if (decision.action === "reschedule" || decision.action === "schedule") {
      await api(`/api/tasks/${task.id}/schedule`, {
        method: "POST",
        body: { mode: decision.scheduleMode || "asap" },
      });
      return;
    }
    if (decision.action === "complete") {
      await api(`/api/tasks/${task.id}`, { method: "PUT", body: { status: "completed" } });
      return;
    }
    if (decision.action === "ignore") {
      await api(`/api/tasks/${task.id}`, { method: "PUT", body: { ignored: true } });
      return;
    }
    if (decision.action === "extend-due-date") {
      await api(`/api/tasks/${task.id}`, {
        method: "PUT",
        body: { due_date: fromLocalValue(decision.newDueDate, tz) },
      });
    }
  }
}

customElements.define("pmd-process-dialog", ProcessDialog);
