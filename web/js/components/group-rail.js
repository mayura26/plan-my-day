import { api } from "../api.js";
import { chevron, icon } from "../icons.js";
import { bus, esc, groupKey, persistExpanded, persistHidden, persistSections, persistShowAll, refresh, shownTasks, store } from "../state.js";

const STATUS = {
  pending: "Pending",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
  rescheduled: "Rescheduled",
};

const SCHEDULE_MODES = [
  ["now", "Schedule Now"],
  ["today", "Schedule Today"],
  ["tomorrow", "Schedule Tomorrow"],
  ["next-week", "Schedule Next Week"],
  ["this-weekend", "Schedule This Weekend"],
  ["next-weekend", "Schedule Next Weekend"],
  ["next-month", "Schedule Next Month"],
  ["asap", "Schedule ASAP"],
];

const ADD_TYPES = [
  ["task", "Task", "check-square"],
  ["event", "Event", "calendar"],
  ["todo", "To-Do", "list-todo"],
];

const METRICS = [
  ["overdue", "Overdue", "alert-triangle", true],
  ["soon", "Upcoming Soon", "clock", false],
  ["progress", "In Progress", "play-circle", false],
  ["priority", "High Priority", "star", false],
];

class GroupRail extends HTMLElement {
  constructor() {
    super();
    this.onChange = () => {
      if (this.editor || this.menu) return;
      this.render();
    };
    this.menu = null;
    this.editor = null;
    this.scheduleCount = 5;
    this.busy = false;
  }

  connectedCallback() {
    bus.addEventListener("change", this.onChange);
    this.addEventListener("click", (event) => this.onClick(event));
    this.addEventListener("submit", (event) => this.onSubmit(event));
    this.addEventListener("input", (event) => this.onInput(event));
    this.onDoc = (event) => {
      if (!this.menu) return;
      if (event.target.closest?.("[data-pop], [data-menu]")) return;
      this.menu = null;
      this.render();
    };
    document.addEventListener("click", this.onDoc);
    this.render();
  }

  disconnectedCallback() {
    bus.removeEventListener("change", this.onChange);
    document.removeEventListener("click", this.onDoc);
  }

  render() {
    const groupsOpen = store.sections.groups !== false;
    const roots = hierarchy(store.groups);
    const cards = roots.map((group) => this.groupCard(group)).join("");
    const ungroupedCount = taskCount(null);
    const ungrouped = ungroupedCount > 0 ? this.groupCard(ungroupedModel(), true) : "";
    const bench = this.bench();
    this.innerHTML = `<aside class="rail">
      <div class="rail-actions">
        <button class="rail-btn primary with-icon" type="button" data-create>${icon("plus")} Add Task</button>
        <button class="rail-btn with-icon" type="button" data-ai>${icon("sparkles")} Add with AI</button>
      </div>
      <section class="rail-card">
        <div class="rail-card-head">
          <button class="rail-fold" type="button" data-section="groups" aria-expanded="${groupsOpen}">${chevron(groupsOpen)}<span>Task Groups</span></button>
          <button class="rail-icon" type="button" data-refresh aria-label="Refresh task groups">${icon("refresh-cw")}</button>
        </div>
        <div class="rail-card-body" ${groupsOpen ? "" : "hidden"}>
          <div class="group-tools">
            <button class="tool" type="button" data-new>${icon("plus")}<span>New Group</span></button>
            <button class="tool icon-only" type="button" data-expand-all title="${this.allExpanded() ? "Collapse All" : "Expand All"}" aria-label="${this.allExpanded() ? "Collapse All" : "Expand All"}">${icon(this.allExpanded() ? "chevrons-up" : "chevrons-down")}</button>
            <button class="tool ${store.showAllTasks ? "filled" : ""}" type="button" data-show-all aria-pressed="${store.showAllTasks}">${store.showAllTasks ? "All" : "Unscheduled"}</button>
          </div>
          <div class="group-list">
            ${cards || '<p class="muted empty-note">No task groups yet</p>'}
            ${ungrouped}
          </div>
        </div>
      </section>
      ${this.metricsCard()}
      ${bench}
      ${this.editor ? this.editorDialog() : ""}
      ${this.menu ? this.menuPop() : ""}
    </aside>`;
    this.placePop();
  }

  groupCard(group, ungrouped = false) {
    const id = group.id;
    const open = store.expandedGroups.has(id);
    const selected = store.selectedGroupId === id;
    const dim = store.selectedGroupId && !selected;
    const shared = Boolean(group.shared_by_email);
    const parent = Boolean(group.isParent);
    const color = group.color || "#6B7280";
    const on = contrast(color);
    if (parent) {
      const kids = open ? `<div class="parent-kids">${(group.children || []).map((child) => this.groupCard(child)).join("")}</div>` : "";
      return `<div class="parent-folder ${dim ? "is-dim" : ""}" style="--group:${esc(color)}">
        <div class="parent-head">
          <button class="parent-name" type="button" data-filter="${esc(id)}" aria-pressed="${selected}">
            <span class="folder-ico">${icon("folder")}</span>
            <span>${esc(group.name)}</span>
          </button>
          <span class="parent-count">${(group.children || []).length}</span>
          <button class="rail-icon" type="button" data-expand="${esc(id)}" aria-label="${open ? "Collapse" : "Expand"} ${esc(group.name)}">${chevron(open)}</button>
        </div>
        ${kids}
      </div>`;
    }
    const tasks = tasksFor(id === "ungrouped" ? null : id);
    const count = taskCount(id === "ungrouped" ? null : id);
    const crit = criticalMark(tasks, on);
    const chevronBtn = `<button class="rail-icon" type="button" data-expand="${esc(id)}" aria-label="${open ? "Collapse" : "Expand"} ${esc(group.name)}">${open ? icon("chevron-down") : icon("chevron-right")}</button>`;
    const actions = ungrouped
      ? `${this.addButton(id)}${open ? "" : this.hideButton(id, group.name)}<span class="grow"></span>${chevronBtn}`
      : open
        ? `${this.addButton(id)}
           ${this.pullButton(id)}
           ${this.zapButton(id)}
           <span class="grow"></span>
           ${chevronBtn}`
        : `${this.addButton(id)}
           ${this.pullButton(id)}
           ${this.zapButton(id)}
           ${this.hideButton(id, group.name)}
           ${shared ? this.leaveButton(id, group.name) : `${this.editButton(group)}${this.deleteButton(id, group.name)}`}
           <span class="grow"></span>
           ${chevronBtn}`;
    const list = open
      ? `<div class="group-tasks">${tasks.map((task) => this.slim(task, false)).join("") || `<p class="muted empty-note">No ${store.showAllTasks ? "tasks" : "unscheduled tasks"}</p>`}</div>`
      : "";
    return `<article class="gcard ${dim ? "is-dim" : ""}">
      <button class="ghead" type="button" data-filter="${esc(id)}" aria-pressed="${selected}" style="--group:${esc(color)};--on:${on}">
        <span class="gname">${esc(group.name)}${shared ? '<span class="shared-badge">Shared</span>' : ""}</span>
        <span class="gmeta">${crit}<span class="gcount">${count}</span></span>
      </button>
      <div class="gactions">${actions}</div>
      ${list}
    </article>`;
  }

  addButton(id) {
    return `<button class="rail-icon" type="button" data-menu="add:${id}" data-kind="add" data-group="${esc(id)}" title="Quick add to this group" aria-label="Quick add">${icon("plus")}</button>`;
  }

  pullButton(id) {
    return `<button class="rail-icon" type="button" data-pull="${esc(id)}" title="Pull forward tasks from future days" aria-label="Pull forward">${icon("magnet")}</button>`;
  }

  zapButton(id) {
    return `<button class="rail-icon" type="button" data-menu="zap:${id}" data-kind="zap" data-group="${esc(id)}" title="Auto schedule top tasks" aria-label="Auto schedule">${icon("zap")}</button>`;
  }

  hideButton(id, name) {
    const hidden = store.hidden.has(id);
    return `<button class="rail-icon" type="button" data-hide="${esc(id)}" title="${hidden ? "Show in calendar" : "Hide from calendar"}" aria-label="${hidden ? "Show" : "Hide"} ${esc(name)}">${icon(hidden ? "eye-off" : "eye")}</button>`;
  }

  editButton(group) {
    return `<button class="rail-icon" type="button" data-edit="${esc(group.id)}" title="Edit group" aria-label="Edit ${esc(group.name)}">${icon("pencil")}</button>`;
  }

  deleteButton(id, name) {
    return `<button class="rail-icon" type="button" data-delete="${esc(id)}" title="Delete group" aria-label="Delete ${esc(name)}">${icon("trash")}</button>`;
  }

  leaveButton(id, name) {
    return `<button class="rail-icon" type="button" data-leave="${esc(id)}" title="Leave shared group" aria-label="Leave ${esc(name)}">${icon("log-out")}</button>`;
  }

  slim(task, nested) {
    const kids = nested ? childrenOf(task.parent_task_id) : childrenOf(task.id);
    const visibleKids = kids.filter((child) => child.status !== "completed" && (store.showAllTasks || !child.scheduled_start || !child.scheduled_end));
    const card = this.slimCard(task, nested, kids);
    if (!visibleKids.length || nested) return card;
    const rows = visibleKids
      .map((child) => this.slimCard(child, true, kids))
      .join("");
    return `<div class="slim-nest">${card}${rows}</div>`;
  }

  slimCard(task, nested, siblings) {
    const index = nested ? siblings.findIndex((item) => item.id === task.id) : -1;
    const step = nested && index >= 0 ? `<span class="step">Step ${index + 1} of ${siblings.length}</span>` : "";
    const lock = task.locked ? `<span class="lock">${icon("lock")}</span>` : "";
    const unscheduled = !task.scheduled_start || !task.scheduled_end;
    const unsched = store.showAllTasks && unscheduled ? `<span class="badge unsched">${icon("calendar")} Unscheduled</span>` : "";
    const duration = task.duration ? `<span class="dur">${icon("clock")} ${formatDuration(task.duration)}</span>` : "";
    return `<button class="slim ${nested ? "is-sub" : ""}" type="button" data-id="${esc(task.id)}">
      <span class="slim-title">${lock}${step}<span>${esc(task.title)}</span></span>
      <span class="slim-meta">
        <span class="badge" data-p="${esc(task.priority)}">P${esc(task.priority)}</span>
        <span class="badge" data-status="${esc(task.status)}">${esc(STATUS[task.status] || task.status)}</span>
        ${unsched}
        ${duration}
      </span>
    </button>`;
  }

  metricsCard() {
    return `<section class="rail-card">
      <div class="rail-card-head">
        <span class="rail-title">Task Metrics</span>
        <button class="rail-icon" type="button" data-refresh aria-label="Refresh task metrics">${icon("refresh-cw")}</button>
      </div>
      <div class="rail-card-body metrics">${this.metricRows()}</div>
    </section>`;
  }

  metricRows() {
    const rows = metricRows();
    return METRICS.map(([id, label, glyph, process]) => {
      const list = rows[id];
      const open = Boolean(store.metricOpen[id]) && list.length > 0;
      const body = open
        ? `<div class="metric-list">${list.map((task) => this.slim(task, Boolean(task.parent_task_id))).join("")}</div>`
        : "";
      const action = process && list.length ? '<button class="process" type="button" data-process>Process</button>' : "";
      return `<div class="metric" data-tone="${id}">
        <div class="metric-row">
          <button class="metric-toggle" type="button" data-metric-toggle="${id}" aria-expanded="${open}" ${list.length ? "" : "disabled"}>
            ${chevron(open)}<span class="tone">${icon(glyph)}</span><span>${label}</span>
          </button>
          <span class="metric-side">${action}<span class="metric-count ${list.length ? "" : "is-zero"}">${list.length}</span></span>
        </div>
        ${body}
      </div>`;
    }).join("");
  }

  bench() {
    const tasks = unscheduledBench().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    if (!tasks.length) return "";
    const open = store.sections.bench !== false;
    return `<section class="rail-card">
      <div class="rail-card-head">
        <button class="rail-fold" type="button" data-section="bench" aria-expanded="${open}">${chevron(open)}<span class="with-icon">${icon("check-square")} Unscheduled (${tasks.length})</span></button>
        <button class="rail-icon" type="button" data-refresh aria-label="Refresh unscheduled tasks">${icon("refresh-cw")}</button>
      </div>
      <div class="rail-card-body" ${open ? "" : "hidden"}>
        <div class="group-tasks">${tasks.map((task) => this.slim(task, false)).join("")}</div>
      </div>
    </section>`;
  }

  editorDialog() {
    const editing = Boolean(this.editor.id);
    const parents = store.groups.filter((group) => group.is_parent_group && group.id !== this.editor.id);
    const options = parents
      .map((group) => `<option value="${esc(group.id)}" ${group.id === this.editor.parentId ? "selected" : ""}>${esc(group.name)}</option>`)
      .join("");
    const parentField = this.editor.isParent
      ? ""
      : `<label data-parent-field>Parent Group
          <select name="parent_group_id">
            <option value="">None (top-level group)</option>
            ${options}
          </select>
        </label>`;
    const folder = editing
      ? ""
      : `<label class="check"><input name="is_parent" type="checkbox" /> Parent folder</label>`;
    return `<div class="dialog-back" data-editor-back>
      <form class="dialog group-editor" data-editor>
        <p class="kicker">${editing ? "Group" : "New group"}</p>
        <h2>${editing ? "Edit Group" : "Create New Group"}</h2>
        <label>Group Name<input name="name" required value="${esc(this.editor.name)}" /></label>
        <label>Color
          <span class="color-row">
            <input data-color-picker type="color" value="${esc(this.editor.color)}" />
            <input name="color" value="${esc(this.editor.color)}" />
          </span>
        </label>
        ${folder}
        ${parentField}
        <p class="error" data-error></p>
        <div class="actions">
          <button class="tiny" type="button" data-editor-cancel>Cancel</button>
          <button class="solid" type="submit">${editing ? "Save" : "Create Group"}</button>
        </div>
      </form>
    </div>`;
  }

  menuPop() {
    if (this.menu.kind === "add") {
      const items = ADD_TYPES.map(
        ([type, label, glyph]) => `<button type="button" data-add-type="${type}">${icon(glyph)}<span>${label}</span></button>`,
      ).join("");
      return `<div class="rail-pop" data-pop>${items}</div>`;
    }
    const counts = [3, 5, 10]
      .map((count) => `<button type="button" data-count="${count}" class="${count === this.scheduleCount ? "on" : ""}">${count}</button>`)
      .join("");
    const modes = SCHEDULE_MODES.map(
      ([mode, label]) => `<button type="button" data-schedule="${mode}">${icon("zap")}<span>${label}</span></button>`,
    ).join("");
    return `<div class="rail-pop" data-pop>
      <p class="pop-label">Tasks to schedule</p>
      <div class="count-picks">${counts}</div>
      ${modes}
    </div>`;
  }

  placePop() {
    const pop = this.querySelector("[data-pop]");
    if (!pop || !this.menu) return;
    const anchor = this.querySelector(`[data-menu="${cssEscape(this.menu.key)}"]`);
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = pop.offsetWidth;
    const height = pop.offsetHeight;
    let left = Math.min(rect.left, window.innerWidth - width - 8);
    left = Math.max(8, left);
    let top = rect.bottom + 4;
    if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 4);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }

  onInput(event) {
    const picker = event.target.closest("[data-color-picker]");
    if (picker) {
      const field = this.querySelector("[name=color]");
      if (field) field.value = picker.value;
      return;
    }
    if (event.target.name === "color") {
      const pickerField = this.querySelector("[data-color-picker]");
      if (pickerField && /^#[0-9a-fA-F]{6}$/.test(event.target.value)) pickerField.value = event.target.value;
    }
    if (event.target.name === "is_parent") {
      const field = this.querySelector("[data-parent-field]");
      if (field) field.hidden = event.target.checked;
    }
  }

  async onSubmit(event) {
    const form = event.target.closest("[data-editor]");
    if (!form) return;
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    if (!name) return;
    const creating = !this.editor?.id;
    const isParent = creating ? Boolean(form.querySelector("[name=is_parent]")?.checked) : Boolean(this.editor.isParent);
    const parent = isParent ? null : String(data.get("parent_group_id") || "") || null;
    const body = {
      name,
      color: String(data.get("color") || "#3B82F6"),
      is_parent_group: isParent,
      parent_group_id: parent,
    };
    try {
      if (creating) await api("/api/task-groups", { method: "POST", body });
      else await api(`/api/task-groups/${this.editor.id}`, { method: "PUT", body });
      this.editor = null;
      await refresh();
    } catch (error) {
      const slot = form.querySelector("[data-error]");
      if (slot) slot.textContent = error.message || "Could not save the group";
    }
  }

  onClick(event) {
    if (event.target.closest("[data-pop]")) {
      this.onPop(event);
      return;
    }
    if (event.target.matches?.("[data-editor-back]")) {
      this.editor = null;
      this.render();
      return;
    }
    const button = event.target.closest("button");
    if (!button || !this.contains(button)) return;
    if (button.dataset.editorCancel !== undefined) {
      this.editor = null;
      this.render();
      return;
    }
    if (button.dataset.menu) {
      const key = button.dataset.menu;
      this.menu = this.menu?.key === key ? null : { key, kind: button.dataset.kind, groupId: button.dataset.group || null };
      this.render();
      return;
    }
    if (this.menu) {
      this.menu = null;
      this.render();
    }
    if (button.dataset.create !== undefined) {
      const groupId = store.selectedGroupId === "ungrouped" ? null : store.selectedGroupId;
      this.dispatchEvent(new CustomEvent("create-task", { bubbles: true, detail: groupId }));
      return;
    }
    if (button.dataset.ai !== undefined) {
      this.dispatchEvent(new CustomEvent("open-ai", { bubbles: true }));
      return;
    }
    if (button.dataset.section) {
      store.sections[button.dataset.section] = !store.sections[button.dataset.section];
      persistSections();
      this.render();
      return;
    }
    if (button.dataset.refresh !== undefined) {
      event.stopPropagation();
      refresh();
      return;
    }
    if (button.dataset.new !== undefined) {
      this.editor = { id: null, name: "", color: "#3B82F6", parentId: "", isParent: false };
      this.render();
      return;
    }
    if (button.dataset.expandAll !== undefined) {
      if (this.allExpanded()) store.expandedGroups = new Set();
      else store.expandedGroups = new Set(["ungrouped", ...store.groups.map((group) => group.id)]);
      persistExpanded();
      this.render();
      return;
    }
    if (button.dataset.showAll !== undefined) {
      store.showAllTasks = !store.showAllTasks;
      persistShowAll();
      this.render();
      return;
    }
    if (button.dataset.expand) {
      const id = button.dataset.expand;
      if (store.expandedGroups.has(id)) store.expandedGroups.delete(id);
      else store.expandedGroups.add(id);
      persistExpanded();
      this.render();
      return;
    }
    if (button.dataset.filter) {
      store.selectedGroupId = store.selectedGroupId === button.dataset.filter ? null : button.dataset.filter;
      bus.dispatchEvent(new Event("change"));
      return;
    }
    if (button.dataset.hide) {
      const id = button.dataset.hide;
      if (store.hidden.has(id)) store.hidden.delete(id);
      else store.hidden.add(id);
      persistHidden();
      bus.dispatchEvent(new Event("change"));
      return;
    }
    if (button.dataset.edit) {
      const group = store.groups.find((item) => item.id === button.dataset.edit);
      if (!group) return;
      this.editor = {
        id: group.id,
        name: group.name,
        color: group.color || "#3B82F6",
        parentId: group.parent_group_id || "",
        isParent: Boolean(group.is_parent_group),
      };
      this.render();
      return;
    }
    if (button.dataset.delete) {
      this.removeGroup(button.dataset.delete);
      return;
    }
    if (button.dataset.leave) {
      this.leaveGroup(button.dataset.leave);
      return;
    }
    if (button.dataset.pull) {
      this.pull(button.dataset.pull);
      return;
    }
    if (button.dataset.id) {
      this.dispatchEvent(new CustomEvent("open-task", { bubbles: true, detail: button.dataset.id }));
      return;
    }
    if (button.dataset.process !== undefined) {
      event.stopPropagation();
      this.process();
      return;
    }
    if (button.dataset.metricToggle) {
      const id = button.dataset.metricToggle;
      store.metricOpen[id] = !store.metricOpen[id];
      this.render();
    }
  }

  onPop(event) {
    const button = event.target.closest("button");
    if (!button) return;
    event.stopPropagation();
    if (button.dataset.count) {
      this.scheduleCount = Number(button.dataset.count);
      this.render();
      return;
    }
    if (button.dataset.addType) {
      const groupId = this.menu?.groupId === "ungrouped" ? null : this.menu?.groupId;
      this.menu = null;
      this.render();
      this.dispatchEvent(new CustomEvent("create-task", { bubbles: true, detail: { group_id: groupId, task_type: button.dataset.addType } }));
      return;
    }
    if (button.dataset.schedule) {
      const groupId = this.menu?.groupId;
      const mode = button.dataset.schedule;
      const limit = this.scheduleCount;
      this.menu = null;
      this.render();
      this.autoSchedule(groupId, mode, limit);
    }
  }

  allExpanded() {
    const ids = ["ungrouped", ...store.groups.map((group) => group.id)];
    return ids.every((id) => store.expandedGroups.has(id));
  }

  async pull(groupId) {
    if (this.busy) return;
    this.busy = true;
    try {
      await api("/api/tasks/pull-forward", { method: "POST", body: { group_id: groupId } });
      await refresh();
    } catch (error) {
      window.alert(error.message || "Could not pull tasks forward");
    } finally {
      this.busy = false;
    }
  }

  async autoSchedule(groupId, mode, limit) {
    const selected = candidates(groupId).slice(0, limit);
    if (!selected.length) {
      window.alert("No eligible tasks to schedule in this group");
      return;
    }
    this.busy = true;
    try {
      for (const task of selected) {
        await api(`/api/tasks/${task.id}/schedule`, { method: "POST", body: { mode } });
      }
      await refresh();
    } catch (error) {
      await refresh();
      window.alert(error.message || "Could not schedule those tasks");
    } finally {
      this.busy = false;
    }
  }

  async process() {
    const actions = overdueTasks().map((task) => ({ id: task.id, action: "schedule", mode: "now" }));
    if (!actions.length) return;
    try {
      await api("/api/tasks/overdue", { method: "POST", body: { actions } });
      await refresh();
    } catch (error) {
      window.alert(error.message || "Could not process overdue tasks");
    }
  }

  async removeGroup(id) {
    if (!window.confirm("Delete this group?")) return;
    await api(`/api/task-groups/${id}`, { method: "DELETE" });
    if (store.selectedGroupId === id) store.selectedGroupId = null;
    store.expandedGroups.delete(id);
    persistExpanded();
    await refresh();
  }

  async leaveGroup(id) {
    const group = store.groups.find((item) => item.id === id);
    if (!group?.share_id || !window.confirm("Leave this shared group?")) return;
    await api(`/api/task-groups/${id}/share/${group.share_id}`, { method: "DELETE" });
    if (store.selectedGroupId === id) store.selectedGroupId = null;
    await refresh();
  }
}

function hierarchy(groups) {
  const map = new Map();
  groups.forEach((group) => map.set(group.id, { ...group, children: [], isParent: Boolean(group.is_parent_group) }));
  const roots = [];
  groups.forEach((group) => {
    const node = map.get(group.id);
    if (group.parent_group_id && map.has(group.parent_group_id)) {
      const parent = map.get(group.parent_group_id);
      parent.children.push(node);
      parent.isParent = true;
    } else roots.push(node);
  });
  const sortLevel = (list) => {
    const regular = list.filter((group) => !group.is_parent_group).sort((a, b) => a.name.localeCompare(b.name));
    const parents = list.filter((group) => group.is_parent_group).sort((a, b) => a.name.localeCompare(b.name));
    [...regular, ...parents].forEach((group) => {
      group.children = sortLevel(group.children);
    });
    return [...regular, ...parents];
  };
  return sortLevel(roots);
}

function ungroupedModel() {
  return { id: "ungrouped", name: "Ungrouped", color: "#6B7280", children: [], isParent: false };
}

function sameGroup(task, groupId) {
  if (groupId === null) return !task.group_id;
  return task.group_id === groupId;
}

function childrenOf(id) {
  return store.tasks
    .filter((task) => task.parent_task_id === id)
    .sort((a, b) => (a.step_order ?? 0) - (b.step_order ?? 0));
}

function tasksFor(groupId) {
  return store.tasks.filter((task) => {
    if (task.status === "completed" || task.parent_task_id) return false;
    if (!sameGroup(task, groupId)) return false;
    if (store.showAllTasks) return true;
    const unscheduled = !task.scheduled_start || !task.scheduled_end;
    if (!unscheduled) return false;
    const kids = childrenOf(task.id);
    if (kids.length && kids.every((child) => child.scheduled_start && child.scheduled_end)) return false;
    return true;
  });
}

function taskCount(groupId) {
  if (store.showAllTasks) {
    return store.tasks.filter((task) => task.status !== "completed" && sameGroup(task, groupId)).length;
  }
  return tasksFor(groupId).length;
}

function criticalMark(tasks, on) {
  const p1 = tasks.filter((task) => task.priority === 1).length;
  const p2 = tasks.filter((task) => task.priority === 2).length;
  if (!p1 && !p2) return "";
  const glyph = p1 ? "alert-circle" : "alert-triangle";
  const title = p1 ? `Contains ${p1} critical task${p1 === 1 ? "" : "s"} (Priority 1)` : `Contains ${p2} high priority task${p2 === 1 ? "" : "s"} (Priority 2)`;
  return `<span class="crit" title="${esc(title)}" style="color:${on}">${icon(glyph)}</span>`;
}

function contrast(hex) {
  const raw = String(hex || "").replace("#", "");
  if (raw.length < 6) return "#ffffff";
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  if ([r, g, b].some((part) => Number.isNaN(part))) return "#ffffff";
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5 ? "#000000" : "#ffffff";
}

function formatDuration(minutes) {
  const value = Number(minutes);
  if (!value) return "";
  if (value < 60) return `${value}m`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function overdueTasks() {
  const now = Date.now();
  return shownTasks().filter((task) => {
    if (task.task_type === "event" || task.ignored) return false;
    if (["completed", "cancelled", "rescheduled"].includes(task.status)) return false;
    if (task.due_date && new Date(task.due_date).getTime() < now) return true;
    return Boolean(task.scheduled_end && new Date(task.scheduled_end).getTime() < now);
  });
}

function metricRows() {
  const now = Date.now();
  const soon = now + 2 * 60 * 60 * 1000;
  const tasks = shownTasks();
  return {
    overdue: overdueTasks(),
    soon: tasks.filter((task) => task.scheduled_start && !["completed", "cancelled"].includes(task.status) && new Date(task.scheduled_start).getTime() > now && new Date(task.scheduled_start).getTime() <= soon),
    progress: tasks.filter((task) => task.status === "in_progress"),
    priority: tasks.filter((task) => !["completed", "cancelled"].includes(task.status) && (!task.scheduled_start || !task.scheduled_end) && task.priority <= 2),
  };
}

function unscheduledBench() {
  return shownTasks().filter((task) => {
    if (task.status !== "pending" || task.parent_task_id) return false;
    if (task.scheduled_start && task.scheduled_end) return false;
    const kids = childrenOf(task.id);
    if (kids.length && kids.every((child) => child.scheduled_start && child.scheduled_end)) return false;
    return true;
  });
}

function candidates(groupId) {
  return store.tasks
    .filter((task) => task.group_id === groupId && !task.scheduled_start && (task.status === "pending" || task.status === "in_progress") && task.duration > 0 && !task.parent_task_id)
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      if (a.due_date && b.due_date) return String(a.due_date).localeCompare(String(b.due_date));
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      return String(a.created_at).localeCompare(String(b.created_at));
    });
}

function cssEscape(value) {
  return String(value).replace(/["\\]/g, "\\$&");
}

customElements.define("pmd-group-rail", GroupRail);
