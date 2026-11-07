import { pendingCount, replay } from "./offline.js";
import { loadSession, store } from "./state.js";
import "./components/app-shell.js";

const saved = localStorage.getItem("pmd-theme");
if (saved) document.documentElement.dataset.theme = saved;
else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
  document.documentElement.dataset.theme = "dark";
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  const banner = document.createElement("button");
  banner.className = "tiny";
  banner.type = "button";
  banner.textContent = "Install";
  banner.style.position = "fixed";
  banner.style.right = "16px";
  banner.style.bottom = "16px";
  banner.style.zIndex = "40";
  banner.addEventListener("click", async () => {
    await event.prompt();
    banner.remove();
  });
  document.body.append(banner);
});

window.addEventListener("online", async () => {
  await replay();
  store.offline = await pendingCount();
  if (store.user) await loadSession();
});

loadSession().catch(() => {
  store.user = null;
});
