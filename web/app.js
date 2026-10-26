import { loadUpdates, verifyArchive } from "./updates.js";
import { initClarity } from "./clarity.js";
import { loadProject, showProjectTab, setReleaseData } from "./project.js";
import { loadCloudSettings } from "./cloud_settings.js";
import { initAppearance, syncTheme } from "./appearance.js";
import { initProjectPreferenceSettings, readProjectPreference } from "./project_preferences.js";
"use strict";

(() => {
  initClarity();
  const $ = (selector) => document.querySelector(selector);
  const all = (selector) => document.querySelectorAll(selector);
  const viewNames = {home: "Главная", system: "Система", about: "О Reika", project: "Проект", "project-settings": "Настройки"};
  let state = null;
  let busy = false;
  let online = false;
  let syncedAt = 0;
  let toastTimer;

  function notify(message) {
    clearTimeout(toastTimer);
    $("#toast").textContent = message;
    $("#toast").hidden = false;
    toastTimer = setTimeout(() => { $("#toast").hidden = true; }, 3500);
  }

  function route(focus = false) {
    const requested = location.hash.slice(1);
    const projectSubtab = /^project\/(overview|modules|links|analysis|history|updates)$/.exec(requested)?.[1];
    const name = requested === "updates" || projectSubtab ? "project" : Object.hasOwn(viewNames, requested) ? requested : "home";
    all(".view").forEach((view) => { view.hidden = view.id !== `view-${name}`; });
    all("[data-view]").forEach((link) => {
      const active = link.dataset.view === name;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    $("#view-title").textContent = viewNames[name];
    document.title = `${viewNames[name]} · Reika`;
    if (name === "project") {
      showProjectTab(requested === "updates" ? "updates" : projectSubtab || readProjectPreference("tab"));
      loadProject();
      loadUpdates().then(setReleaseData);
    }
    if (name === "project-settings") loadCloudSettings();
    if (focus) {
      $("#main").focus({preventScroll: true});
      window.scrollTo({top: 0, behavior: "instant"});
    }
  }

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    syncTheme();
    $("#theme-toggle").setAttribute("aria-label", theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему");
    $("#theme-toggle").setAttribute("aria-pressed", String(theme === "dark"));
    try { localStorage.setItem("reika.theme", theme); } catch { /* Optional preference. */ }
    // A host-scoped, non-sensitive preference survives changing the local port.
    try { document.cookie = `reika_theme=${theme}; Max-Age=31536000; Path=/; SameSite=Strict`; } catch { /* Optional preference. */ }
  }

  function setOnline(value) {
    online = value;
    all("[data-connection]").forEach((badge) => {
      badge.dataset.state = value ? "online" : "offline";
      badge.textContent = value ? "Reika работает" : "Нет соединения";
    });
    $("#system-status").textContent = value ? "Работает" : "Нет соединения. Данные последней проверки.";
    if (!value) {
      $("#checked-at").textContent = "Проверьте, запущена ли Reika";
      $("#uptime").textContent = "—";
      $("#tray-note").textContent = "Соединение прервано. Запустите Reika.bat и откройте страницу из трея.";
    }
  }

  function formatUptime(seconds) {
    if (seconds < 60) return `${seconds} сек`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} мин`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} ч ${Math.floor(seconds % 3600 / 60)} мин`;
    return `${Math.floor(seconds / 86400)} д ${Math.floor(seconds % 86400 / 3600)} ч`;
  }

  function updateUptime() {
    if (online && state) $("#uptime").textContent = formatUptime(state.uptime_seconds + Math.floor((performance.now() - syncedAt) / 1000));
  }

  async function refresh(manual = false) {
    if (busy) return;
    busy = true;
    $("#check-connection").disabled = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    try {
      const response = await fetch("/api/status", {cache: "no-store", signal: controller.signal, credentials: "same-origin"});
      if (!response.ok) throw new Error("Connection failed");
      const data = await response.json();
      if (data.app !== "Reika" || data.status !== "ready" || !Number.isFinite(data.uptime_seconds) || typeof data.url !== "string") throw new Error("Invalid status");
      state = data;
      syncedAt = performance.now();
      setOnline(true);
      all("[data-version]").forEach((element) => { element.textContent = data.version; });
      all("[data-nav-version]").forEach(element => {element.textContent = data.components?.[element.dataset.navVersion]?.version || data.version;});
      const components = document.createDocumentFragment();
      for (const [key, item] of Object.entries(data.components || {})) {
        const row = document.createElement("div");
        row.dataset.component = key;
        const name = document.createElement("dt");
        const version = document.createElement("dd");
        name.textContent = item.name;
        version.textContent = item.version;
        row.append(name, version);
        components.append(row);
      }
      $("#component-versions").replaceChildren(components);
      $("#local-address").textContent = data.url;
      $("#system-url").textContent = data.url;
      $("#system-started").textContent = new Date(data.started_at).toLocaleString("ru-RU");
      $("#system-os").textContent = data.platform;
      $("#system-python").textContent = data.python;
      $("#system-pid").textContent = String(data.pid);
      $("#system-tray").textContent = data.tray_active ? "Работает" : "Работа в консоли";
      $("#tray-note").textContent = data.tray_active
        ? "Ищите значок возле часов. Через него можно открыть пространство, показать консоль или завершить работу."
        : "Приложение работает в консоли. Для завершения нажмите Ctrl+C в окне запуска.";
      $("#checked-at").textContent = `Проверено в ${new Date().toLocaleTimeString("ru-RU", {hour: "2-digit", minute: "2-digit"})}`;
      updateUptime();
      if (manual) notify("Соединение установлено. Reika работает.");
    } catch {
      setOnline(false);
      if (manual) notify("Нет соединения. Проверьте окно запуска или значок в трее.");
    } finally {
      clearTimeout(timeout);
      busy = false;
      $("#check-connection").disabled = false;
    }
  }

  $("#check-updates").addEventListener("click", () => loadUpdates().then(setReleaseData));
  $("#update-file").addEventListener("change", (event) => verifyArchive(event.target.files[0]));
  $("#reload-project").addEventListener("click", () => loadProject(true));
  window.addEventListener("reika:set-theme",(event)=>setTheme(event.detail));
  $("#theme-toggle").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
  $("#check-connection").addEventListener("click", () => refresh(true));
  $("#copy-address").addEventListener("click", async () => {
    const address = state ? state.url : location.origin;
    try {
      await navigator.clipboard.writeText(address);
      notify("Адрес Reika скопирован.");
    } catch {
      notify(`Адрес Reika: ${address}`);
    }
  });
  window.addEventListener("hashchange", () => route(true));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  let initialTheme = "light";
  try {
    const saved = document.cookie.match(/(?:^|;\s*)reika_theme=(light|dark)(?:;|$)/);
    initialTheme = saved ? saved[1] : (localStorage.getItem("reika.theme") === "dark" ? "dark" : "light");
  } catch { /* Storage can be disabled in the browser. */ }
  setTheme(initialTheme);
  initAppearance();
  initProjectPreferenceSettings();
  $("#today").textContent = new Intl.DateTimeFormat("ru-RU", {day: "numeric", month: "long", weekday: "short"}).format(new Date());
  route();
  refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, 5000);
  setInterval(updateUptime, 1000);
})();
