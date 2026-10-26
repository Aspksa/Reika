const defaults = {
  tab: "modules",
  density: "comfortable",
  audience: "user",
  layout: "grid",
  interval: "30000"
};
const allowed = {
  tab: ["modules", "links", "history", "updates"],
  density: ["comfortable", "compact"],
  audience: ["user", "developer"],
  layout: ["grid", "list"],
  interval: ["0", "30000", "300000", "1800000"]
};
const keyFor = key => "reika.project.preference." + key;
const memory = {};

export function readProjectPreference(key) {
  if (!Object.hasOwn(defaults, key)) return undefined;
  try {
    const stored = localStorage.getItem(keyFor(key));
    return allowed[key].includes(stored) ? stored : memory[key] || defaults[key];
  } catch { return memory[key] || defaults[key]; }
}

export function saveProjectPreference(key, value) {
  if (!Object.hasOwn(defaults, key) || !allowed[key].includes(value)) return;
  memory[key] = value;
  try { localStorage.setItem(keyFor(key), value); } catch { /* Настройка действует до закрытия вкладки. */ }
  window.dispatchEvent(new CustomEvent("reika:project-preference", {detail: {key, value}}));
}

export function initProjectPreferenceSettings() {
  for (const key of Object.keys(defaults)) {
    const select = document.getElementById("settings-project-" + key);
    select.value = readProjectPreference(key);
    select.addEventListener("change", () => {
      saveProjectPreference(key, select.value);
      document.getElementById("settings-project-message").textContent = "Настройка применена и сохранена в этом браузере.";
    });
  }
  document.getElementById("settings-project-reset").addEventListener("click", () => {
    for (const [key, value] of Object.entries(defaults)) {
      document.getElementById("settings-project-" + key).value = value;
      saveProjectPreference(key, value);
    }
    document.getElementById("settings-project-message").textContent = "Настройки поведения проекта возвращены к исходным.";
  });
}
