import { api } from "../api.js";
import { bus, esc, groupById, refresh, store } from "../state.js";

class TasksPage extends HTMLElement {
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
    const groups = [{ id: "", name: "Ungrouped", color: "#23466a" }, ...store.groups];
    const blocks = groups
      .map((group) => {
        const tasks = store.tasks.filter((task) => (task.group_id || "") === group.id && !task.parent_task_id);
        if (!tasks.length && group.id === "") return "";
        const rows = tasks
          .map(
            (task) => `<button class="chip" type="button" data-id="${esc(task.id)}"><span class="group-dot" style="background:${esc(groupById(task.group_id)?.color || group.color)}"></span>${esc(task.title)} <span class="muted">${esc(task.status)}</span></button>`,
          )
          .join("");
        return `<section class="list-block"><h2>${esc(group.name)}</h2>${rows || '<p class="muted">Empty.</p>'}</section>`;
      })
      .join("");
    this.innerHTML = `<section class="sheet reveal"><p class="kicker">Library</p><h1 class="day-title">All the <span>work</span>.</h1><div data-overdue></div>${blocks}</section>`;
    this.querySelectorAll("[data-id]").forEach((button) => {
      button.addEventListener("click", () => {
        this.dispatchEvent(new CustomEvent("open-task", { bubbles: true, detail: button.dataset.id }));
      });
    });
    api("/api/tasks/overdue").then((data) => {
      const host = this.querySelector("[data-overdue]");
      if (!host) return;
      const tasks = data?.tasks || [];
      if (!tasks.length) return;
      host.innerHTML = `<section class="list-block"><h2>Overdue</h2>${tasks
        .map(
          (task) => `<div class="row"><button class="chip" type="button" data-id="${esc(task.id)}">${esc(task.title)}</button><button class="tiny" type="button" data-ignore="${esc(task.id)}">Ignore</button></div>`,
        )
        .join("")}</section>`;
      host.querySelectorAll("[data-id]").forEach((button) => {
        button.addEventListener("click", () => {
          this.dispatchEvent(new CustomEvent("open-task", { bubbles: true, detail: button.dataset.id }));
        });
      });
      host.querySelectorAll("[data-ignore]").forEach((button) => {
        button.addEventListener("click", async () => {
          await api("/api/tasks/overdue", { method: "POST", body: { actions: [{ id: button.dataset.ignore, action: "ignore" }] } });
          await refresh();
        });
      });
    });
  }
}

class SettingsPage extends HTMLElement {
  connectedCallback() {
    this.render();
    this.load();
  }

  render() {
    this.innerHTML = `<section class="sheet reveal stack">
      <p class="kicker">Preferences</p>
      <h1 class="day-title">How the day <span>behaves</span>.</h1>
      <form data-tz class="row"><label>Timezone<input name="timezone" placeholder="Pacific/Auckland" /></label><button class="solid" type="submit">Save</button></form>
      <form data-hours class="stack"></form>
      <form data-prefs class="stack">
        <label class="row"><input name="auto" type="checkbox" /> Schedule new tasks automatically</label>
        <label>Default mode<select name="mode">
          ${["now", "today", "tomorrow", "asap", "smart"].map((mode) => `<option>${mode}</option>`).join("")}
        </select></label>
        <label>Assistant model<select name="model"><option value="mini">mini</option><option value="full">full</option></select></label>
        <label class="row"><input name="critical" type="checkbox" /> Repeat reminders for critical overdue tasks</label>
        <label>Minutes between those reminders<input name="interval" type="number" min="1" max="120" value="15" /></label>
        <button class="solid" type="submit">Save preferences</button>
      </form>
      <div data-keys></div>
      <div data-push></div>
      <p class="error" data-error></p>
    </section>`;
    this.querySelector("[data-tz]").addEventListener("submit", (event) => this.saveTz(event));
    this.querySelector("[data-prefs]").addEventListener("submit", (event) => this.savePrefs(event));
  }

  async load() {
    const user = store.user;
    if (!user) return;
    this.querySelector('[name="timezone"]').value = user.timezone || "UTC";
    const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
    const hours = user.awake_hours || {};
    this.querySelector("[data-hours]").innerHTML = `<p class="kicker">Awake hours</p>${days
      .map((day) => {
        const span = hours[day] || { start: 9, end: 17 };
        return `<div class="row"><strong style="width:7rem">${day}</strong><input data-day="${day}" data-edge="start" type="number" min="0" max="23" value="${span.start ?? ""}" /><input data-day="${day}" data-edge="end" type="number" min="1" max="24" value="${span.end ?? ""}" /></div>`;
      })
      .join("")}<button class="solid" type="submit">Save hours</button>`;
    this.querySelector("[data-hours]").onsubmit = (event) => this.saveHours(event);
    this.querySelector('[name="auto"]').checked = Boolean(user.auto_schedule_new_tasks);
    this.querySelector('[name="mode"]').value = user.default_schedule_mode || "now";
    this.querySelector('[name="model"]').value = user.ai_model || "mini";
    this.querySelector('[name="critical"]').checked = user.critical_reminder_enabled !== false;
    this.querySelector('[name="interval"]').value = user.critical_reminder_interval_minutes || 15;
    const keys = await api("/api/api-keys");
    this.querySelector("[data-keys]").innerHTML = `<p class="kicker">API keys</p>${(keys.keys || [])
      .map((key) => `<div class="row"><span>${esc(key.name)} · ${esc(key.key_prefix)}…</span><button class="tiny" data-revoke="${esc(key.id)}" type="button">Revoke</button></div>`)
      .join("")}<form data-key class="row"><input name="name" placeholder="Key name" /><button class="tiny" type="submit">Create</button></form><p data-secret class="muted"></p>`;
    this.querySelector("[data-key]").addEventListener("submit", async (event) => {
      event.preventDefault();
      const created = await api("/api/api-keys", { method: "POST", body: { name: new FormData(event.target).get("name") } });
      this.querySelector("[data-secret]").textContent = `Copy this key now: ${created.key.key}`;
      await this.load();
    });
    this.querySelectorAll("[data-revoke]").forEach((button) => {
      button.addEventListener("click", async () => {
        await api(`/api/api-keys?id=${button.dataset.revoke}`, { method: "DELETE" });
        await this.load();
      });
    });
    const config = await api("/api/push/vapid-key");
    this.querySelector("[data-push]").innerHTML = `<p class="kicker">Notifications</p><button class="tiny" type="button" data-push-btn ${config.publicKey ? "" : "disabled"}>Enable push</button>`;
    this.querySelector("[data-push-btn]")?.addEventListener("click", () => this.enablePush(config.publicKey));
  }

  async saveTz(event) {
    event.preventDefault();
    await api("/api/user/timezone", { method: "PUT", body: { timezone: new FormData(event.target).get("timezone") } });
    store.user = (await api("/api/me")).user;
    bus.dispatchEvent(new Event("change"));
  }

  async saveHours(event) {
    event.preventDefault();
    const awake = {};
    event.target.querySelectorAll("[data-day]").forEach((input) => {
      awake[input.dataset.day] = awake[input.dataset.day] || {};
      awake[input.dataset.day][input.dataset.edge] = Number(input.value);
    });
    await api("/api/user/awake-hours", { method: "PUT", body: { awake_hours: awake } });
    store.user = (await api("/api/me")).user;
  }

  async savePrefs(event) {
    event.preventDefault();
    const form = new FormData(event.target);
    await api("/api/user/scheduling-preferences", {
      method: "PUT",
      body: {
        auto_schedule_new_tasks: form.get("auto") === "on",
        default_schedule_mode: form.get("mode"),
        ai_model: form.get("model"),
        critical_reminder_enabled: form.get("critical") === "on",
        critical_reminder_interval_minutes: Number(form.get("interval")),
      },
    });
    store.user = (await api("/api/me")).user;
  }

  async enablePush(publicKey) {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    const json = sub.toJSON();
    await api("/api/push/subscribe", {
      method: "POST",
      body: { endpoint: json.endpoint, keys: json.keys, platform: navigator.platform },
    });
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

customElements.define("pmd-tasks-page", TasksPage);
customElements.define("pmd-settings-page", SettingsPage);
