import { api } from "../api.js";
import { pendingCount } from "../offline.js";
import { bus, esc, refresh, store } from "../state.js";
import { zonedToUtc } from "../time.js";
import "./day-grid.js";
import "./week-month.js";
import "./task-dialog.js";
import "./group-rail.js";
import "./pages.js";
import "./capture.js";

const LINKS = [
  ["/calendar", "Calendar"],
  ["/tasks", "Tasks"],
  ["/tags", "Tags"],
  ["/settings", "Settings"],
];

class AppShell extends HTMLElement {
  connectedCallback() {
    this.dialog = document.createElement("pmd-task-dialog");
    bus.addEventListener("change", () => {
      if (!store.user || !this.querySelector("[data-grid]")) this.paint();
      else this.syncChrome();
    });
    this.addEventListener("open-task", (event) => this.openTask(event.detail));
    this.addEventListener("create-task", (event) => {
      this.dialog.open({ title: "", priority: 3, energy_level_required: 3, task_type: "task", duration: 60, group_id: event.detail || null });
    });
    this.addEventListener("create-at", (event) => this.createAt(event.detail));
    this.addEventListener("open-ai", () => {
      const panel = this.querySelector("pmd-assistant");
      if (panel) panel.hidden = !panel.hidden;
    });
    this.addEventListener("click", (event) => {
      const link = event.target.closest("[data-link]");
      if (!link) return;
      event.preventDefault();
      history.pushState({}, "", link.getAttribute("href"));
      this.paint();
    });
    window.addEventListener("popstate", () => this.paint());
    this.paint();
  }

  path() {
    if (location.pathname === "/") return "/calendar";
    return location.pathname;
  }

  paint() {
    if (!store.user) {
      if (this.path().startsWith("/q/") || this.path().startsWith("/reminder")) {
        this.innerHTML = this.path().startsWith("/q/") ? "<pmd-quick-page></pmd-quick-page>" : "<pmd-reminder-page></pmd-reminder-page>";
        return;
      }
      this.innerHTML = `<section class="signin"><div class="card">
        <p class="kicker">Plan My Day</p>
        <h1>A desk for the <em style="color:var(--seal)">hours you actually have</em>.</h1>
        <p class="muted">The same tasks, a calmer way to place them.</p>
        <div class="stack">
          <a class="solid" href="/auth/google" style="text-align:center">Continue with Google</a>
          <a class="ghost" href="/auth/github" style="text-align:center;border-color:var(--rule)">Continue with GitHub</a>
          <form data-dev class="row" hidden><input name="email" type="email" placeholder="you@example.com" /><button class="tiny" type="submit">Dev sign in</button></form>
        </div>
      </div></section>`;
      api("/api/auth/config").then((config) => {
        if (!config.devLogin) return;
        const form = this.querySelector("[data-dev]");
        form.hidden = false;
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          await api("/api/auth/dev-login", { method: "POST", body: { email: new FormData(form).get("email") } });
          const { loadSession } = await import("../state.js");
          await loadSession();
        });
      });
      return;
    }
    const path = this.path();
    const nav = LINKS.map(
      ([href, label]) => `<a data-link href="${href}" ${path === href ? 'aria-current="page"' : ""}>${label}</a>`,
    ).join("");
    const calendar = path === "/calendar" || path === "/";
    let body = "";
    if (path === "/tasks") body = "<pmd-tasks-page></pmd-tasks-page>";
    else if (path === "/settings") body = "<pmd-settings-page></pmd-settings-page>";
    else if (path === "/tags") body = "<pmd-tags-page></pmd-tags-page>";
    else if (path.startsWith("/q/")) body = "<pmd-quick-page></pmd-quick-page>";
    else if (path.startsWith("/reminder")) body = "<pmd-reminder-page></pmd-reminder-page>";
    else body = `<section class="sheet calendar"><div class="cal-head" data-chrome></div><div data-grid></div><pmd-assistant hidden></pmd-assistant></section>`;
    this.innerHTML = `<header class="topbar">
      <button class="tiny menu-btn" type="button" data-sidebar>Groups</button>
      <a class="brand" data-link href="/calendar">Plan My Day</a>
      <nav class="nav">${nav}</nav>
      <span class="spacer"></span>
      <span class="who">${esc(store.user.name || store.user.email || "")}</span>
      <button class="tiny" type="button" data-theme>Theme</button>
      <button class="tiny" type="button" data-out>Sign out</button>
    </header>
    <div class="banner" data-offline hidden></div>
    <div class="layout">${calendar ? "<pmd-group-rail></pmd-group-rail>" : ""}${body}</div>`;
    this.append(this.dialog);
    if (calendar) this.syncChrome();
    this.querySelector("[data-theme]")?.addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      localStorage.setItem("pmd-theme", next);
    });
    this.querySelector("[data-out]")?.addEventListener("click", async () => {
      await api("/api/auth/logout", { method: "POST" });
      store.user = null;
      this.paint();
    });
    this.querySelector("[data-sidebar]")?.addEventListener("click", () => {
      this.querySelector(".layout")?.classList.toggle("sidebar-open");
    });
    pendingCount().then((count) => {
      const banner = this.querySelector("[data-offline]");
      if (!banner) return;
      if (!navigator.onLine || count) {
        banner.hidden = false;
        banner.textContent = navigator.onLine ? `${count} change${count === 1 ? "" : "s"} waiting to sync.` : "Offline. Changes will sync when you are back.";
      }
    });
  }

  syncChrome() {
    const host = this.querySelector("[data-chrome]");
    const grid = this.querySelector("[data-grid]");
    if (!host || !grid) return;
    const tz = store.user?.timezone || "UTC";
    const title = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "long", year: "numeric" }).format(store.cursor);
    if (!host.childElementCount) {
      host.innerHTML = `<h1 data-title></h1>
        <button class="tiny" type="button" data-today>Today</button>
        <div class="view-toggle">
          <button class="tiny" type="button" data-view="day">Day</button>
          <button class="tiny" type="button" data-view="week">Week</button>
          <button class="tiny" type="button" data-view="month">Month</button>
        </div>
        <span class="spacer"></span>
        <button class="tiny" type="button" data-shift="-1">Prev</button>
        <button class="tiny" type="button" data-shift="1">Next</button>
        <button class="tiny" type="button" data-compress>Compress</button>`;
      host.addEventListener("click", (event) => this.onChrome(event));
    }
    host.querySelector("[data-title]").textContent = title;
    host.querySelectorAll("[data-view]").forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset.view === store.mode ? "true" : "false");
    });
    if (grid.dataset.mode !== store.mode) {
      grid.dataset.mode = store.mode;
      grid.innerHTML = store.mode === "week" ? "<pmd-week-grid></pmd-week-grid>" : store.mode === "month" ? "<pmd-month-grid></pmd-month-grid>" : "<pmd-day-grid></pmd-day-grid>";
    }
  }

  onChrome(event) {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.today) store.cursor = new Date();
    if (button.dataset.view) store.mode = button.dataset.view;
    if (button.dataset.shift) {
      const direction = Number(button.dataset.shift);
      const days = store.mode === "week" ? direction * 7 : store.mode === "month" ? direction * 30 : direction;
      store.cursor = new Date(store.cursor.getTime() + days * 86400000);
    }
    if (button.dataset.compress) {
      api("/api/tasks/shuffle", { method: "POST", body: {} }).then(() => refresh());
      return;
    }
    if (button.dataset.today || button.dataset.view || button.dataset.shift) bus.dispatchEvent(new Event("change"));
  }

  createAt({ key, minute }) {
    const tz = store.user?.timezone || "UTC";
    const [year, month, day] = key.split("-").map(Number);
    const start = zonedToUtc(year, month, day, Math.floor(minute / 60), minute % 60, tz);
    this.dialog.open({
      title: "",
      priority: 3,
      energy_level_required: 3,
      task_type: "task",
      duration: 60,
      group_id: store.selectedGroupId,
      scheduled_start: start.toISOString(),
      scheduled_end: new Date(start.getTime() + 60 * 60000).toISOString(),
    });
  }

  openTask(id) {
    const task = id ? store.tasks.find((item) => item.id === id) : null;
    this.dialog.open(task || null);
  }
}

customElements.define("pmd-app", AppShell);
