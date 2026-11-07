import { api } from "../api.js";
import { esc, store } from "../state.js";

class TagsPage extends HTMLElement {
  connectedCallback() {
    this.render();
  }

  async render() {
    const data = await api("/api/quick-tags");
    const tags = data.tags || [];
    this.innerHTML = `<section class="sheet reveal stack">
      <p class="kicker">Quick tags</p>
      <h1 class="day-title">Capture in <span>one tap</span>.</h1>
      ${tags
        .map(
          (tag) => `<div class="row"><div><strong>${esc(tag.name)}</strong><div class="muted">${esc(tag.task_title)}</div></div>
            <button class="tiny" type="button" data-copy="${esc(tag.id)}">Copy link</button>
            <button class="tiny" type="button" data-run="${esc(tag.id)}">Run</button>
            <button class="tiny" type="button" data-del="${esc(tag.id)}">Delete</button></div>`,
        )
        .join("")}
      <form class="form-grid" data-create>
        <label>Name<input name="name" required /></label>
        <label>Task title<input name="task_title" required /></label>
        <label>Minutes<input name="duration_minutes" type="number" value="30" /></label>
        <label>Priority<input name="priority" type="number" min="1" max="5" value="3" /></label>
        <label>Offset minutes<input name="schedule_offset_minutes" type="number" value="0" /></label>
        <label class="row"><input name="auto_accept" type="checkbox" /> Run without asking</label>
        <label class="row"><input name="default_locked" type="checkbox" /> Pin the new task</label>
        <button class="solid" type="submit">Save tag</button>
      </form>
      <p class="muted" data-msg></p>
    </section>`;
    this.querySelector("[data-create]").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.target);
      await api("/api/quick-tags", {
        method: "POST",
        body: {
          name: form.get("name"),
          task_title: form.get("task_title"),
          duration_minutes: Number(form.get("duration_minutes")),
          priority: Number(form.get("priority")),
          schedule_offset_minutes: Number(form.get("schedule_offset_minutes")),
          auto_accept: form.get("auto_accept") === "on",
          default_locked: form.get("default_locked") === "on",
          task_type: "task",
          energy_level: 3,
        },
      });
      await this.render();
    });
    this.querySelectorAll("[data-copy]").forEach((button) => {
      button.addEventListener("click", async () => {
        await navigator.clipboard.writeText(`${location.origin}/q/${button.dataset.copy}`);
        this.querySelector("[data-msg]").textContent = "Link copied.";
      });
    });
    this.querySelectorAll("[data-run]").forEach((button) => {
      button.addEventListener("click", () => {
        location.assign(`/q/${button.dataset.run}`);
      });
    });
    this.querySelectorAll("[data-del]").forEach((button) => {
      button.addEventListener("click", async () => {
        await api(`/api/quick-tags/${button.dataset.del}`, { method: "DELETE" });
        await this.render();
      });
    });
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

class AssistantPanel extends HTMLElement {
  connectedCallback() {
    this.messages = [];
    this.innerHTML = `<form class="stack" style="margin-top:14px">
      <p class="kicker">Assistant</p>
      <div data-log class="muted"></div>
      <div class="row"><input name="text" placeholder="Add a call with Sam tomorrow at 9" /><button class="tiny" type="submit">Ask</button></div>
      <div data-actions></div>
    </form>`;
    this.querySelector("form").addEventListener("submit", (event) => this.ask(event));
  }

  async ask(event) {
    event.preventDefault();
    const text = new FormData(event.target).get("text");
    if (!text) return;
    event.target.reset();
    this.messages.push({ role: "user", content: String(text) });
    const turn = await api("/api/ai/assistant", {
      method: "POST",
      body: {
        messages: this.messages,
        groups: store.groups.map((group) => ({ id: group.id, name: group.name })),
        existing_tasks: store.tasks.slice(0, 40),
      },
    });
    this.messages.push({ role: "assistant", content: turn.message || "" });
    this.querySelector("[data-log]").textContent = turn.message || "";
    const actions = turn.proposed_actions || [];
    this.querySelector("[data-actions]").innerHTML = actions
      .map(
        (action, index) =>
          `<button class="chip" type="button" data-index="${index}">${esc(action.action)} ${esc(action.title)}</button>`,
      )
      .join("");
    this.querySelectorAll("[data-index]").forEach((button) => {
      button.addEventListener("click", () => this.accept(actions[Number(button.dataset.index)]));
    });
  }

  async accept(action) {
    const body = {
      title: action.title,
      description: action.description,
      task_type: action.task_type,
      priority: action.priority,
      duration: action.duration,
      energy_level_required: action.energy_level_required,
      group_id: action.group_id,
      scheduled_start: action.scheduled_start,
      scheduled_end: action.scheduled_end,
      due_date: action.due_date,
    };
    if (action.action === "update" && action.id) {
      await api(`/api/tasks/${action.id}`, { method: "PUT", body });
    } else {
      const created = await api("/api/tasks", { method: "POST", body });
      for (const step of action.subtasks || []) {
        await api(`/api/tasks/${created.task.id}/subtasks`, { method: "POST", body: step });
      }
    }
    const { refresh } = await import("../state.js");
    await refresh();
  }
}

customElements.define("pmd-tags-page", TagsPage);
customElements.define("pmd-quick-page", QuickPage);
customElements.define("pmd-reminder-page", ReminderPage);
customElements.define("pmd-assistant", AssistantPanel);
