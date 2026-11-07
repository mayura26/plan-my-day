import { blockHTML, DAY_HEIGHT, gutterLabels, hourLines, installPointer, layoutTasks, nowMarker, scrollToNow } from "../blocks.js";
import { bus, gridTasks, store } from "../state.js";
import { dayKey } from "../time.js";

class DayGrid extends HTMLElement {
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
    const key = dayKey(store.cursor, tz);
    const placed = layoutTasks(gridTasks().filter((task) => dayKey(new Date(task.scheduled_start), tz) === key), tz);
    const today = key === dayKey(new Date(), tz);
    const scroll = this.querySelector(".week-scroll")?.scrollTop || 0;
    this.innerHTML = `<div class="week-scroll">
      <div class="week-grid day-only" style="height:${DAY_HEIGHT}px">
        <div class="gutter">${gutterLabels()}</div>
        <div class="day-col" data-key="${key}">${hourLines()}${placed.map((item) => blockHTML(item, tz)).join("")}${today ? nowMarker(tz) : ""}</div>
      </div>
    </div>`;
    const scroller = this.querySelector(".week-scroll");
    if (scroll) scroller.scrollTop = scroll;
    else scrollToNow(scroller, tz);
  }
}

customElements.define("pmd-day-grid", DayGrid);
