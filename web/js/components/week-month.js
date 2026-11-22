import { api } from "../api.js";
import { blockHTML, DAY_HEIGHT, gutterLabels, hourLines, installPointer, layoutTasks, nowMarker, scrollToNow } from "../blocks.js";
import { icon } from "../icons.js";
import { bus, esc, gridTasks, store } from "../state.js";
import { addDays, dayKey, zonedParts, zonedToUtc } from "../time.js";

function mondayKey(date, tz) {
  const parts = zonedParts(date, tz);
  const index = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(String(parts.weekday).slice(0, 3));
  const noon = zonedToUtc(parts.year, parts.month, parts.day, 12, 0, tz);
  return dayKey(addDays(noon, -Math.max(0, index)), tz);
}

class WeekGrid extends HTMLElement {
  constructor() {
    super();
    this.onChange = () => this.render();
  }

  connectedCallback() {
    bus.addEventListener("change", this.onChange);
    installPointer(this);
    this.render();
  }

  disconnectedCallback() {
    bus.removeEventListener("change", this.onChange);
  }

  render() {
    const tz = store.user?.timezone || "UTC";
    const today = dayKey(new Date(), tz);
    const start = mondayKey(store.cursor, tz);
    const [year, month, day] = start.split("-").map(Number);
    const heads = [];
    const columns = [];
    for (let i = 0; i < 7; i += 1) {
      const date = addDays(zonedToUtc(year, month, day, 12, 0, tz), i);
      const key = dayKey(date, tz);
      const parts = zonedParts(date, tz);
      const placed = layoutTasks(gridTasks().filter((task) => dayKey(new Date(task.scheduled_start), tz) === key), tz);
      heads.push(`<div class="day-head ${key === today ? "today" : ""}"><span>${esc(parts.weekday)}</span><strong>${parts.day}</strong><button class="icon-btn" type="button" data-note-day="${key}" title="Day note" aria-label="Day note">${icon("sticky-note")}</button></div>`);
      columns.push(`<div class="day-col" data-key="${key}">${hourLines()}${placed.map((item) => blockHTML(item, tz)).join("")}${key === today ? nowMarker(tz) : ""}</div>`);
    }
    const scroll = this.querySelector(".week-scroll")?.scrollTop || 0;
    this.innerHTML = `<div class="week-scroll">
      <div class="week-head"><div></div>${heads.join("")}</div>
      <div class="week-grid" style="height:${DAY_HEIGHT}px"><div class="gutter">${gutterLabels()}</div>${columns.join("")}</div>
    </div>`;
    const scroller = this.querySelector(".week-scroll");
    if (scroll) scroller.scrollTop = scroll;
    else scrollToNow(scroller, tz);
    this.querySelectorAll("[data-note-day]").forEach((button) => {
      button.addEventListener("click", async () => {
        const date = button.dataset.noteDay;
        const existing = await api(`/api/day-notes?date=${date}`);
        const content = window.prompt("Note for this day", existing?.note?.content || "");
        if (content === null) return;
        await api("/api/day-notes", { method: "PUT", body: { note_date: date, content } });
      });
    });
  }
}

class MonthGrid extends HTMLElement {
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
    const tz = store.user?.timezone || "UTC";
    const parts = zonedParts(store.cursor, tz);
    const first = zonedToUtc(parts.year, parts.month, 1, 12, 0, tz);
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(String(zonedParts(first, tz).weekday).slice(0, 3));
    const start = addDays(first, -Math.max(0, weekday));
    const cells = [];
    for (let i = 0; i < 42; i += 1) {
      const day = addDays(start, i);
      const key = dayKey(day, tz);
      const tasks = gridTasks().filter((task) => dayKey(new Date(task.scheduled_start), tz) === key);
      const lines = tasks
        .slice(0, 3)
        .map((task) => {
          const group = store.groups.find((item) => item.id === task.group_id);
          const marked = task.status === "completed" || (task.task_type === "event" && task.scheduled_end && new Date(task.scheduled_end) < new Date());
          return `<em class="${marked ? "done" : ""}" style="color:${esc(group?.color || "#9aabbc")}">${esc(task.title)}</em>`;
        })
        .join("");
      const inMonth = key.startsWith(`${parts.year}-${String(parts.month).padStart(2, "0")}`);
      cells.push(`<button class="cell ${inMonth ? "" : "muted"}" data-key="${key}"><strong>${key.slice(-2)}</strong>${lines}</button>`);
    }
    this.innerHTML = `<div class="month">${cells.join("")}</div>`;
    this.querySelectorAll(".cell").forEach((node) => {
      node.addEventListener("click", () => {
        const [y, m, d] = node.dataset.key.split("-").map(Number);
        store.cursor = zonedToUtc(y, m, d, 12, 0, tz);
        store.mode = "day";
        bus.dispatchEvent(new Event("change"));
      });
    });
  }
}

customElements.define("pmd-week-grid", WeekGrid);
customElements.define("pmd-month-grid", MonthGrid);
