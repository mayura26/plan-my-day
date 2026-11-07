import { api } from "../api.js";
import { bus, esc, groupById, persistHidden, refresh, shownTasks, store } from "../state.js";

class GroupRail extends HTMLElement {
  constructor() {
    super();
    this.onChange = () => this.render();
  }

  connectedCallback() {
    bus.addEventListener("change", this.onChange);
    this.render();
  }

  disconnectedCallback() {
    bus.removeEventListener("change", this.onChange);
  }

  render() {
    const sections = store.sections;
    const pendingCount = (groupId) =>
      store.tasks.filter((task) => (task.group_id || "") === groupId && task.status === "pending" && !task.parent_task_id).length;
    const groups = store.groups
      .map((group) => {
        const hidden = store.hidden.has(group.id);
        const selected = store.selectedGroupId === group.id;
        return `<div class="group-row" style="--group:${esc(group.color)}">
          <button class="group-name" type="button" data-filter="${esc(group.id)}" aria-pressed="${selected}">${esc(group.name)}</button>
          <span class="count">${pendingCount(group.id)}</span>
          <button class="icon" type="button" data-add="${esc(group.id)}" title="Add task">+</button>
          <button class="icon" type="button" data-hide="${esc(group.id)}" title="${hidden ? "Show" : "Hide"}">${hidden ? "Show" : "Hide"}</button>
          <button class="icon" type="button" data-delete="${esc(group.id)}" title="Delete">Del</button>
        </div>`;
      })
      .join("");
    const unscheduled = shownTasks().filter((task) => !task.scheduled_start && !task.parent_task_id && task.status === "pending");
    const chips = unscheduled
      .map((task) => `<button class="chip" type="button" data-id="${esc(task.id)}"><span class="group-dot" style="background:${esc(groupById(task.group_id)?.color || "#23466a")}"></span>${esc(task.title)}</button>`)
      .join("");
    const metrics = this.metrics();
    this.innerHTML = `<aside class="rail">
      <div class="rail-actions">
        <button class="solid" type="button" data-create>Add task</button>
        <button class="ghost" type="button" data-ai>Add with AI</button>
      </div>
      <button class="section" type="button" data-section="groups">Task groups</button>
      <div ${sections.groups ? "" : "hidden"}>
        ${groups || '<p class="muted">No groups yet.</p>'}
        <form class="row" data-new-group>
          <input name="name" placeholder="New group" />
          <button class="tiny" type="submit">Add</button>
        </form>
      </div>
      <button class="section" type="button" data-section="bench">Unscheduled</button>
      <div ${sections.bench ? "" : "hidden"}>
        ${chips || '<p class="muted">The bench is clear.</p>'}
      </div>
      <button class="section" type="button" data-section="metrics">Task metrics</button>
      <div ${sections.metrics ? "" : "hidden"}>${metrics}</div>
    </aside>`;
    this.querySelector("[data-create]").addEventListener("click", () => {
      this.dispatchEvent(new CustomEvent("create-task", { bubbles: true, detail: store.selectedGroupId }));
    });
    this.querySelector("[data-ai]").addEventListener("click", () => {
      this.dispatchEvent(new CustomEvent("open-ai", { bubbles: true }));
    });
    this.querySelectorAll("[data-section]").forEach((button) => {
      button.addEventListener("click", () => {
        store.sections[button.dataset.section] = !store.sections[button.dataset.section];
        this.render();
      });
    });
    this.querySelector("[data-new-group]").addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = new FormData(event.target).get("name");
      if (!name) return;
      await api("/api/task-groups", { method: "POST", body: { name } });
      await refresh();
    });
    this.querySelectorAll("[data-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        store.selectedGroupId = store.selectedGroupId === button.dataset.filter ? null : button.dataset.filter;
        bus.dispatchEvent(new Event("change"));
      });
    });
    this.querySelectorAll("[data-hide]").forEach((button) => {
      button.addEventListener("click", () => {
        if (store.hidden.has(button.dataset.hide)) store.hidden.delete(button.dataset.hide);
        else store.hidden.add(button.dataset.hide);
        persistHidden();
        bus.dispatchEvent(new Event("change"));
      });
    });
    this.querySelectorAll("[data-add]").forEach((button) => {
      button.addEventListener("click", () => {
        this.dispatchEvent(new CustomEvent("create-task", { bubbles: true, detail: button.dataset.add }));
      });
    });
    this.querySelectorAll("[data-delete]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (!window.confirm("Delete this group?")) return;
        await api(`/api/task-groups/${button.dataset.delete}`, { method: "DELETE" });
        if (store.selectedGroupId === button.dataset.delete) store.selectedGroupId = null;
        await refresh();
      });
    });
    this.querySelectorAll("[data-id]").forEach((button) => {
      button.addEventListener("click", () => {
        this.dispatchEvent(new CustomEvent("open-task", { bubbles: true, detail: button.dataset.id }));
      });
    });
    this.querySelector("[data-process]")?.addEventListener("click", async () => {
      const actions = this.overdue().map((task) => ({ id: task.id, action: "schedule", mode: "now" }));
      await api("/api/tasks/overdue", { method: "POST", body: { actions } });
      await refresh();
    });
    this.querySelectorAll("[data-metric-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        store.metricOpen[button.dataset.metricToggle] = !store.metricOpen[button.dataset.metricToggle];
        this.render();
      });
    });
    this.querySelectorAll("[data-metric]").forEach((button) => {
      button.addEventListener("click", () => {
        this.dispatchEvent(new CustomEvent("open-task", { bubbles: true, detail: button.dataset.metric }));
      });
    });
  }

  overdue() {
    const now = Date.now();
    return shownTasks().filter((task) => {
      if (task.task_type === "event" || task.ignored) return false;
      if (["completed", "cancelled", "rescheduled"].includes(task.status)) return false;
      if (task.due_date && new Date(task.due_date).getTime() < now) return true;
      return Boolean(task.scheduled_end && new Date(task.scheduled_end).getTime() < now);
    });
  }

  metrics() {
    const now = Date.now();
    const soon = now + 2 * 60 * 60 * 1000;
    const tasks = shownTasks().filter((task) => !task.parent_task_id);
    const buckets = [
      ["Overdue", this.overdue(), true],
      ["Due soon", tasks.filter((task) => task.scheduled_start && !["completed", "cancelled"].includes(task.status) && new Date(task.scheduled_start).getTime() > now && new Date(task.scheduled_start).getTime() <= soon)],
      ["In progress", tasks.filter((task) => task.status === "in_progress")],
      ["High priority, unscheduled", tasks.filter((task) => !["completed", "cancelled"].includes(task.status) && (!task.scheduled_start || !task.scheduled_end) && task.priority <= 2)],
    ];
    return buckets
      .map(([label, rows, process]) => {
        const open = store.metricOpen[label];
        const list = open
          ? rows.map((task) => `<button class="chip" type="button" data-metric="${esc(task.id)}">${esc(task.title)}</button>`).join("")
          : "";
        return `<div class="metric"><div class="row"><button class="group-name" type="button" data-metric-toggle="${esc(label)}">${label}</button><span class="count">${rows.length}</span>${process && rows.length ? '<button class="tiny" type="button" data-process>Process</button>' : ""}</div>${list}</div>`;
      })
      .join("");
  }
}

customElements.define("pmd-group-rail", GroupRail);
