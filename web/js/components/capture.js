import { api } from "../api.js";
import { icon } from "../icons.js";
import { esc, store } from "../state.js";

const PRIORITY = { 1: "Critical", 2: "High", 3: "Medium", 4: "Low", 5: "Very Low" };
const ENERGY = { 1: "Low Energy", 2: "Low-Medium", 3: "Medium", 4: "Medium-High", 5: "High Energy" };
const OFFSETS = [["Now", 0], ["15 min", 15], ["30 min", 30], ["1 hour", 60], ["2 hours", 120]];

function offsetLabel(minutes) {
  const value = Number(minutes) || 0;
  if (value === 0) return "Now";
  if (value < 60) return `${value} min`;
  const hours = value / 60;
  if (hours === Math.floor(hours)) return `${hours}h`;
  return `${Math.floor(hours)}h ${value % 60}m`;
}

function leafGroups() {
  const parents = new Set(store.groups.filter((group) => group.is_parent_group).map((group) => group.id));
  store.groups.forEach((group) => {
    if (group.parent_group_id) parents.add(group.parent_group_id);
  });
  return store.groups.filter((group) => !parents.has(group.id));
}

class TagsPage extends HTMLElement {
  connectedCallback() {
    this.tags = [];
    this.editor = null;
    this.copied = "";
    this.render();
  }

  async render() {
    const data = await api("/api/quick-tags");
    this.tags = data.tags || [];
    const cards = this.tags.length
      ? this.tags.map((tag) => this.card(tag)).join("")
      : `<article class="tag-card empty"><div>${icon("tag")}<h3>No Quick Tags yet</h3><p class="muted">Create a Quick Tag to generate a short URL you can program into an NFC tag.</p><button class="solid" type="button" data-new>Create Your First Tag</button></div></article>`;
    this.innerHTML = `<section class="sheet reveal stack">
      <div class="page-head">
        <div><h1>Quick Tags</h1><p class="muted">Create NFC-triggered shortcuts for quick task creation</p></div>
        <button class="solid with-icon" type="button" data-new>${icon("plus")} New Tag</button>
      </div>
      <div class="tag-list">${cards}</div>
      <p class="muted" data-msg></p>
      ${this.editor ? this.editorForm() : ""}
    </section>`;
    this.querySelectorAll("[data-new]").forEach((button) => button.addEventListener("click", () => this.openEditor(null)));
    this.querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", () => this.openEditor(this.tags.find((tag) => tag.id === button.dataset.edit))));
    this.querySelectorAll("[data-del]").forEach((button) => button.addEventListener("click", () => this.remove(button.dataset.del)));
    this.querySelectorAll("[data-copy]").forEach((button) => button.addEventListener("click", () => this.copy(button.dataset.copy)));
    this.querySelector("[data-editor]")?.addEventListener("submit", (event) => this.save(event));
    this.querySelectorAll("[data-offset]").forEach((button) => {
      button.addEventListener("click", () => {
        this.querySelector('[name="schedule_offset_minutes"]').value = button.dataset.offset;
        this.querySelectorAll("[data-offset]").forEach((item) => item.classList.toggle("on", item === button));
      });
    });
    this.querySelector("[data-cancel]")?.addEventListener("click", () => {
      this.editor = null;
      this.render();
    });
  }

  card(tag) {
    return `<article class="tag-card">
      <header>
        <div><h2>${icon("tag")} ${esc(tag.name)}</h2><p class="muted">${esc(tag.task_title)}</p></div>
        <div class="row">
          <button class="tiny icon-btn" type="button" data-edit="${esc(tag.id)}" aria-label="Edit tag">${icon("pencil")}</button>
          <button class="tiny icon-btn" type="button" data-del="${esc(tag.id)}" aria-label="Delete tag">${icon("trash")}</button>
        </div>
      </header>
      <div class="pills">
        <span class="pill">${tag.task_type === "todo" ? "To-Do" : "Task"}</span>
        <span class="pill">P${esc(tag.priority)}: ${esc(PRIORITY[tag.priority] || "Medium")}</span>
        ${tag.duration_minutes ? `<span class="pill">${icon("clock")} ${esc(tag.duration_minutes)}m</span>` : ""}
        <span class="pill">${icon("zap")} ${esc(ENERGY[tag.energy_level] || "Medium")}</span>
        <span class="pill">Schedules in ${esc(offsetLabel(tag.schedule_offset_minutes))}</span>
        ${tag.auto_accept ? `<span class="pill solid">Auto-create</span>` : ""}
        ${tag.default_locked ? `<span class="pill">${icon("lock")} Locked</span>` : ""}
      </div>
      <div class="row">
        <input readonly value="${esc(`${location.origin}/q/${tag.id}`)}" />
        <button class="tiny icon-btn" type="button" data-copy="${esc(tag.id)}" aria-label="Copy URL">${icon(this.copied === tag.id ? "check" : "copy")}</button>
      </div>
    </article>`;
  }

  openEditor(tag) {
    this.editor = tag || {
      name: "",
      task_title: "",
      task_description: "",
      task_type: "task",
      priority: 3,
      duration_minutes: 30,
      energy_level: 3,
      schedule_offset_minutes: 0,
      group_id: "",
      auto_accept: false,
      default_locked: false,
    };
    this.render();
  }

  editorForm() {
    const tag = this.editor;
    const groups = leafGroups().map((group) => `<option value="${esc(group.id)}" ${group.id === tag.group_id ? "selected" : ""}>${esc(group.name)}</option>`).join("");
    const offsets = OFFSETS.map(([label, value]) => `<button class="tiny ${Number(tag.schedule_offset_minutes) === value ? "on" : ""}" type="button" data-offset="${value}">${label}</button>`).join("");
    return `<div class="dialog-back"><form class="dialog" data-editor>
      <h2>${tag.id ? "Edit Quick Tag" : "Create Quick Tag"}</h2>
      <p class="muted">${tag.id ? "Update this tag's configuration. Changes apply to future scans." : "Configure a quick tag for NFC-triggered task creation."}</p>
      <label>Tag Name<input name="name" required value="${esc(tag.name)}" placeholder="e.g., Laundry, Take Medication" /></label>
      <label>Task Title<input name="task_title" required value="${esc(tag.task_title)}" placeholder="e.g., Collect Laundry" /></label>
      <label>Description (optional)<textarea name="task_description">${esc(tag.task_description || "")}</textarea></label>
      <div class="form-grid">
        <label>Type<select name="task_type"><option value="task" ${tag.task_type === "task" ? "selected" : ""}>Task</option><option value="todo" ${tag.task_type === "todo" ? "selected" : ""}>To-Do</option></select></label>
        <label>Priority<select name="priority">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${Number(tag.priority) === n ? "selected" : ""}>${n} - ${PRIORITY[n]}</option>`).join("")}</select></label>
        <label>Duration (minutes)<input name="duration_minutes" type="number" min="1" value="${esc(tag.duration_minutes || "")}" /></label>
        <label>Energy Level<select name="energy_level">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${Number(tag.energy_level) === n ? "selected" : ""}>${n} - ${ENERGY[n]}</option>`).join("")}</select></label>
      </div>
      <label>Schedule Offset<div class="modes">${offsets}</div><span class="row"><input name="schedule_offset_minutes" type="number" min="0" value="${esc(tag.schedule_offset_minutes || 0)}" /> <span class="muted">minutes from now</span></span></label>
      <label>Group (optional)<select name="group_id"><option value="">No group</option>${groups}</select></label>
      <label class="row"><input name="auto_accept" type="checkbox" ${tag.auto_accept ? "checked" : ""} /> Auto-create without asking</label>
      <label class="row"><input name="default_locked" type="checkbox" ${tag.default_locked ? "checked" : ""} /> Lock the new task</label>
      <p class="error" data-error></p>
      <div class="actions"><button class="tiny" type="button" data-cancel>Cancel</button><button class="solid" type="submit">${tag.id ? "Save" : "Create Tag"}</button></div>
    </form></div>`;
  }

  async save(event) {
    event.preventDefault();
    const form = new FormData(event.target);
    const body = {
      name: form.get("name"),
      task_title: form.get("task_title"),
      task_description: form.get("task_description") || null,
      task_type: form.get("task_type"),
      priority: Number(form.get("priority")),
      duration_minutes: Number(form.get("duration_minutes")) || null,
      energy_level: Number(form.get("energy_level")),
      schedule_offset_minutes: Number(form.get("schedule_offset_minutes")) || 0,
      group_id: form.get("group_id") || null,
      auto_accept: form.get("auto_accept") === "on",
      default_locked: form.get("default_locked") === "on",
    };
    try {
      if (this.editor.id) await api(`/api/quick-tags/${this.editor.id}`, { method: "PUT", body });
      else await api("/api/quick-tags", { method: "POST", body });
      this.editor = null;
      await this.render();
    } catch (error) {
      this.querySelector("[data-error]").textContent = error.message;
    }
  }

  async copy(id) {
    await navigator.clipboard.writeText(`${location.origin}/q/${id}`);
    this.copied = id;
    await this.render();
    setTimeout(() => {
      if (this.copied === id) {
        this.copied = "";
        this.render();
      }
    }, 2000);
  }

  async remove(id) {
    if (!window.confirm("Delete this quick tag?")) return;
    await api(`/api/quick-tags/${id}`, { method: "DELETE" });
    await this.render();
  }
}

class QuickPage extends HTMLElement {
  async connectedCallback() {
    const id = location.pathname.split("/").pop();
    if (!store.user) {
      this.innerHTML = `<section class="signin"><div class="card"><h1>Sign in to capture this.</h1><a class="solid" href="/signin">Sign in</a></div></section>`;
      return;
    }
    const data = await api(`/api/quick-tags/${id}`);
    const tag = data.tag;
    if (tag.auto_accept) {
      await api(`/api/quick-tags/${id}/execute`, { method: "POST", body: {} });
      this.innerHTML = `<section class="signin"><div class="card"><h1>Captured.</h1><p>${esc(tag.task_title)} is on your list.</p><a class="solid" href="/calendar">Open the day</a></div></section>`;
      return;
    }
    this.innerHTML = `<section class="signin"><form class="card stack"><p class="kicker">${esc(tag.name)}</p><h1>${esc(tag.task_title)}</h1><button class="solid" type="submit">Add it</button></form></section>`;
    this.querySelector("form").addEventListener("submit", async (event) => {
      event.preventDefault();
      await api(`/api/quick-tags/${id}/execute`, { method: "POST", body: {} });
      location.assign("/calendar");
    });
  }
}

class ReminderPage extends HTMLElement {
  async connectedCallback() {
    const params = new URLSearchParams(location.search);
    let token = params.get("actionToken") || params.get("token");
    const parts = location.pathname.split("/").filter(Boolean);
    if (!token && parts[0] === "reminder" && parts[1] === "a") token = parts[2];
    if (!token) {
      this.innerHTML = `<section class="signin"><div class="card"><h1>Nothing to do.</h1></div></section>`;
      return;
    }
    try {
      const result = await api(`/api/push/actions?actionToken=${encodeURIComponent(token)}`, { method: "POST", body: { actionToken: token } });
      const verb = result.action === "snooze" ? "Snoozed for 15 minutes." : "Marked done.";
      this.innerHTML = `<section class="signin"><div class="card"><h1>${esc(verb)}</h1><a class="solid" href="/calendar">Back to the day</a></div></section>`;
    } catch (error) {
      this.innerHTML = `<section class="signin"><div class="card"><h1>That link has expired.</h1><p class="error">${esc(error.message)}</p></div></section>`;
    }
  }
}

const ASSISTANT_EMPTY = `Tell me what you need — I can build tasks from a brain dump, or manage your schedule ("move my lunch to 1pm", "extend the washing to 2 hours"). I'll ask if I need more detail.`;

class AssistantPanel extends HTMLElement {
  connectedCallback() {
    this.messages = [];
    this.mode = "assistant";
    this.busy = false;
    this.note = "";
    this.assistantDraft = "";
    this.quickDraft = "";
    this.quickSubs = false;
    this.mounted = false;
    this.hidden = true;
  }

  open() {
    this.hidden = false;
    if (!this.mounted) this.mount();
    else this.syncChrome();
  }

  close() {
    this.hidden = true;
    this.innerHTML = "";
    this.mounted = false;
  }

  mount() {
    this.mounted = true;
    this.innerHTML = `<div class="dialog-back"><form class="dialog assistant">
      <div class="dialog-title"><h2 data-title>${icon("sparkles")} AI Assistant</h2><button class="tiny icon-btn" type="button" data-close aria-label="Close">${icon("x")}</button></div>
      <div class="tabs">
        <button type="button" data-mode="assistant">${icon("message-circle")} Assistant</button>
        <button type="button" data-mode="quick">${icon("sparkles")} Quick add</button>
      </div>
      <div data-body></div>
      <p class="error" data-note></p>
      <div class="assistant-foot" data-foot></div>
    </form></div>`;
    const form = this.querySelector("form");
    form.addEventListener("submit", (event) => this.send(event));
    form.addEventListener("click", (event) => this.onClick(event));
    form.addEventListener("change", (event) => this.onScheduleToggle(event));
    this.syncChrome();
  }

  captureDraft() {
    const text = this.querySelector('[name="text"]');
    const quick = this.querySelector('[name="quick"]');
    const subtasks = this.querySelector('[name="subtasks"]');
    if (text) this.assistantDraft = text.value;
    if (quick) this.quickDraft = quick.value;
    if (subtasks) this.quickSubs = subtasks.checked;
  }

  syncChrome() {
    const assistant = this.mode === "assistant";
    this.querySelector("[data-title]").innerHTML = `${icon("sparkles")} ${assistant ? "AI Assistant" : "Add Task with AI"}`;
    this.querySelectorAll("[data-mode]").forEach((button) => {
      button.classList.toggle("on", button.dataset.mode === this.mode);
    });
    const body = this.querySelector("[data-body]");
    const foot = this.querySelector("[data-foot]");
    if (assistant) {
      body.innerHTML = `<div class="transcript" data-transcript></div>
        <div class="composer">
          <textarea name="text" rows="2" placeholder="Type your message…">${esc(this.assistantDraft)}</textarea>
          <div class="composer-side">
            <button class="tiny with-icon" type="button" data-voice>${icon("mic")} Voice</button>
            <button class="solid" type="submit" data-send ${this.busy ? "disabled" : ""}>Send →</button>
          </div>
        </div>`;
      foot.innerHTML = `<button class="tiny" type="button" data-close>Done</button>`;
      this.renderTranscript();
    } else {
      body.innerHTML = `<label>Describe your task<textarea name="quick" placeholder="Describe your task in plain English…">${esc(this.quickDraft)}</textarea></label>
        <label class="row"><input name="subtasks" type="checkbox" ${this.quickSubs ? "checked" : ""} /> Generate subtasks</label>`;
      foot.innerHTML = `<button class="tiny with-icon" type="button" data-voice>${icon("mic")} Voice</button>
        <span class="spacer"></span>
        <button class="tiny" type="button" data-close>Cancel</button>
        <button class="solid with-icon" type="submit" ${this.busy ? "disabled" : ""}>${icon("sparkles")} Parse with AI</button>`;
    }
    this.querySelector("[data-note]").textContent = this.note;
  }

  renderTranscript() {
    const host = this.querySelector("[data-transcript]");
    if (!host) return;
    const waiting = this.busy
      ? `<div class="turn assistant"><div class="bubble waiting" aria-label="Waiting"><i></i><i></i><i></i></div></div>`
      : "";
    host.innerHTML = this.messages.length
      ? `${this.messages.map((message, index) => this.turnHTML(message, index)).join("")}${waiting}`
      : `<p class="empty center">${esc(ASSISTANT_EMPTY)}</p>${waiting}`;
    host.scrollTop = host.scrollHeight;
  }

  turnHTML(message, index) {
    const actions = (message.actions || [])
      .map((action, actionIndex) => this.actionCard(action, index, actionIndex))
      .join("");
    const wide = actions ? " wide" : "";
    return `<div class="turn ${message.role}${wide}"><div class="bubble">${esc(message.content)}</div>${actions ? `<div class="action-list">${actions}</div>` : ""}</div>`;
  }

  actionCard(action, messageIndex, actionIndex) {
    if (action.dismissed) return "";
    const isUpdate = action.action === "update";
    const group = action.group_id ? store.groups.find((item) => item.id === action.group_id) : null;
    const when = action.scheduled_start
      ? String(action.scheduled_start).includes("T")
        ? String(action.scheduled_start).slice(0, 16).replace("T", " ")
        : String(action.scheduled_start)
      : "";
    const typeLabel = action.task_type === "todo" ? "To-Do" : action.task_type === "event" ? "Event" : "Task";
    const pills = [
      `<span class="pill">${isUpdate ? "Edit" : "New"}</span>`,
      `<span class="pill">${esc(typeLabel)}</span>`,
      action.priority ? `<span class="pill">P${esc(action.priority)} ${esc(PRIORITY[action.priority] || "")}</span>` : "",
      action.duration ? `<span class="pill">${esc(action.duration)}m</span>` : "",
      action.energy_level_required ? `<span class="pill">${esc(ENERGY[action.energy_level_required] || "")}</span>` : "",
      group ? `<span class="pill">${esc(group.name)}</span>` : "",
      when ? `<span class="pill">${esc(when)}</span>` : "",
    ].filter(Boolean).join("");
    const steps = (action.subtasks || []).map((step) => step?.title).filter(Boolean);
    const summary = steps.length
      ? `<p class="muted">${steps.length} subtask${steps.length === 1 ? "" : "s"}: ${esc(steps.join(", "))}</p>`
      : "";
    const heading = `<header><h3>${esc(action.title || "Untitled")}</h3>${action.applied ? `<span class="muted">Added</span>` : ""}</header>`;
    if (action.applied) {
      return `<article class="action-card">${heading}<div class="pills">${pills}</div>${summary}</article>`;
    }
    const toggle = isUpdate
      ? ""
      : `<label class="row schedule-now"><input type="checkbox" data-schedule-now data-message="${messageIndex}" data-action="${actionIndex}" ${action.scheduleNow ? "checked" : ""} /> Schedule now</label>`;
    return `<article class="action-card">${heading}<div class="pills">${pills}</div>${summary}
      <div class="action-card-foot">${toggle}<span class="spacer"></span>
        <button class="tiny" type="button" data-apply="${actionIndex}" data-message="${messageIndex}">Accept</button>
        <button class="tiny" type="button" data-dismiss="${actionIndex}" data-message="${messageIndex}">Dismiss</button>
      </div></article>`;
  }

  onScheduleToggle(event) {
    const input = event.target.closest?.("[data-schedule-now]");
    if (!input) return;
    const message = this.messages[Number(input.dataset.message)];
    const action = message?.actions?.[Number(input.dataset.action)];
    if (action) action.scheduleNow = input.checked;
  }

  onClick(event) {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.close !== undefined) {
      this.close();
      return;
    }
    if (button.dataset.mode) {
      if (button.dataset.mode === this.mode) return;
      this.captureDraft();
      this.mode = button.dataset.mode;
      this.note = "";
      this.syncChrome();
      return;
    }
    if (button.dataset.voice !== undefined) {
      this.note = "Voice input is not available in this browser.";
      this.querySelector("[data-note]").textContent = this.note;
      return;
    }
    if (button.dataset.apply !== undefined) {
      const message = this.messages[Number(button.dataset.message)];
      this.accept(message.actions[Number(button.dataset.apply)]);
      return;
    }
    if (button.dataset.dismiss !== undefined) {
      const message = this.messages[Number(button.dataset.message)];
      message.actions[Number(button.dataset.dismiss)].dismissed = true;
      this.renderTranscript();
    }
  }

  async send(event) {
    event.preventDefault();
    if (this.busy) return;
    const form = new FormData(event.target);
    this.note = "";
    this.querySelector("[data-note]").textContent = "";
    if (this.mode === "quick") {
      const text = String(form.get("quick") || "").trim();
      if (!text) return;
      this.captureDraft();
      this.busy = true;
      this.syncChrome();
      try {
        const parsed = await api("/api/ai/parse-task", {
          method: "POST",
          body: {
            text,
            generate_subtasks: form.get("subtasks") === "on",
            groups: store.groups.map((group) => ({ id: group.id, name: group.name })),
          },
        });
        const task = parsed.task || {};
        const { fromLocalValue } = await import("../time.js");
        const tz = store.user?.timezone || "UTC";
        const local = (value) => (value && String(value).includes("T") && !String(value).endsWith("Z") ? fromLocalValue(String(value).slice(0, 16), tz) : value || null);
        this.busy = false;
        this.close();
        this.dispatchEvent(new CustomEvent("create-task", {
          bubbles: true,
          detail: {
            title: task.title || text,
            description: task.description || "",
            task_type: task.task_type || "task",
            priority: task.priority || 3,
            energy_level_required: task.energy_level_required || 3,
            duration: task.duration || 30,
            group_id: task.group_id || null,
            scheduled_start: local(task.scheduled_start),
            scheduled_end: local(task.scheduled_end),
            due_date: local(task.due_date),
            subtasks: task.subtasks || [],
          },
        }));
      } catch (error) {
        this.busy = false;
        this.note = error.message;
        if (!this.hidden) this.syncChrome();
      }
      return;
    }
    const field = this.querySelector('[name="text"]');
    const spoken = String(field?.value || "").trim();
    if (!spoken) return;
    this.assistantDraft = "";
    field.value = "";
    this.messages.push({ role: "user", content: spoken });
    this.busy = true;
    const send = this.querySelector("[data-send]");
    if (send) send.disabled = true;
    this.renderTranscript();
    try {
      const turn = await api("/api/ai/assistant", {
        method: "POST",
        body: {
          messages: this.messages.map(({ role, content }) => ({ role, content })),
          groups: store.groups.map((group) => ({ id: group.id, name: group.name })),
          existing_tasks: store.tasks.slice(0, 40),
        },
      });
      this.messages.push({
        role: "assistant",
        content: turn.message || "",
        actions: (turn.proposed_actions || []).map((action) => ({
          ...action,
          scheduleNow: (action.action || "create") !== "update" && !action.scheduled_start,
        })),
      });
    } catch (error) {
      this.note = error.message;
      this.querySelector("[data-note]").textContent = this.note;
    } finally {
      this.busy = false;
      if (this.hidden || !this.mounted) return;
      if (this.mode === "assistant") {
        const again = this.querySelector("[data-send]");
        if (again) again.disabled = false;
        this.renderTranscript();
      } else this.syncChrome();
    }
  }

  async accept(action) {
    if (!action || action.applied) return;
    const scheduleNow = action.action !== "update" && Boolean(action.scheduleNow);
    const body = {
      title: action.title,
      description: action.description,
      task_type: action.task_type,
      priority: action.priority,
      duration: action.duration,
      energy_level_required: action.energy_level_required,
      group_id: action.group_id,
      due_date: action.due_date,
    };
    if (!scheduleNow) {
      body.scheduled_start = action.scheduled_start;
      body.scheduled_end = action.scheduled_end;
    }
    let createdId = null;
    try {
      if (action.action === "update" && action.id) {
        await api(`/api/tasks/${action.id}`, { method: "PUT", body });
      } else {
        const created = await api("/api/tasks", { method: "POST", body });
        createdId = created.task.id;
        for (const step of action.subtasks || []) {
          await api(`/api/tasks/${createdId}/subtasks`, { method: "POST", body: step });
        }
        if (scheduleNow) {
          await api(`/api/tasks/${createdId}/schedule`, { method: "POST", body: { mode: "now" } });
        }
      }
      action.applied = true;
      const { refresh } = await import("../state.js");
      await refresh();
      this.renderTranscript();
    } catch (error) {
      if (createdId) {
        action.applied = true;
        const { refresh } = await import("../state.js");
        await refresh();
        this.renderTranscript();
      }
      this.note = error.message;
      const note = this.querySelector("[data-note]");
      if (note) note.textContent = error.message;
    }
  }
}

customElements.define("pmd-tags-page", TagsPage);
customElements.define("pmd-quick-page", QuickPage);
customElements.define("pmd-reminder-page", ReminderPage);
customElements.define("pmd-assistant", AssistantPanel);
