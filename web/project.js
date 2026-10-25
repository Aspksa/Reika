const $ = selector => document.querySelector(selector);
const types = {runtime: "Получает данные или запускает", build: "Использует при сборке", design: "Использует оформление", verification: "Проверяет", documentation: "Описывает"};
const statuses = {active: "Действующий", experimental: "Разрабатывается", deprecated: "Устаревает"};
let cached;

function element(tag, text, className) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
}

function changeCard(note) {
  const card = element("details", undefined, "change-entry");
  card.append(element("summary", note.title), element("p", note.description));
  card.append(element("h4", "Затронутые модули"), element("p", Object.keys(note.components).map(id => cached?.modules[id]?.name || id).join(", ")));
  for (const [label, text] of [["Зачем", note.reason], ["Для пользователя", note.userImpact]]) card.append(element("h4", label), element("p", text));
  for (const [key, label] of [["testing", "Проверки, описанные автором"], ["risks", "Ограничения и известные проблемы"], ["migration", "Переход на новую версию"]]) {
    card.append(element("h4", label));
    const list = element("ul");
    for (const text of note[key] || []) list.append(element("li", text));
    card.append(list);
  }
  return card;
}

function renderModules() {
  const selected = $("#module-filter").value;
  const container = $("#project-modules");
  container.replaceChildren();
  for (const [id, item] of Object.entries(cached.modules)) {
    const incoming = Object.entries(cached.modules).filter(([, other]) => other.dependencies.some(link => link.target === id));
    if (selected && selected !== id && !item.dependencies.some(link => link.target === selected) && !incoming.some(([source]) => source === selected)) continue;
    const card = element("article", undefined, "module-card");
    card.dataset.module = id;
    const heading = element("div", undefined, "module-heading");
    heading.append(element("h3", item.name), element("span", item.version, "outline-label"));
    card.append(heading, element("small", statuses[item.status] || item.status), element("p", item.description));
    const links = element("ul", undefined, "module-links");
    for (const link of item.dependencies) {
      const target = cached.modules[link.target];
      const row = element("li");
      const button = element("button", `${types[link.kind]}: ${target.name}`);
      button.type = "button";
      button.addEventListener("click", () => { $("#module-filter").value = link.target; renderModules(); });
      row.append(button, element("p", link.reason));
      if (link.propagate === "patch") row.append(element("small", "Изменение этой зависимости повышает версию данного модуля."));
      links.append(row);
    }
    if (!item.dependencies.length) links.append(element("li", "Зарегистрированных зависимостей нет."));
    card.append(links);
    if (incoming.length) card.append(element("p", `Входящие связи: ${incoming.map(([, source]) => source.name).join(", ")}.`, "muted"));
    container.append(card);
  }
}

export async function loadProject(force = false) {
  if (cached && !force) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch("/api/project", {cache: "no-store", signal: controller.signal});
    if (!response.ok) throw new Error();
    cached = await response.json();
    const filter = $("#module-filter");
    filter.replaceChildren(element("option", "Все модули"));
    filter.firstChild.value = "";
    for (const [id, item] of Object.entries(cached.modules)) {
      const option = element("option", item.name); option.value = id; filter.append(option);
    }
    filter.onchange = renderModules;
    renderModules();
    const history = $("#project-history");
    history.replaceChildren();
    if (cached.pending.length) {
      history.append(element("h3", "Готовится к следующему выпуску"));
      cached.pending.forEach(note => history.append(changeCard(note)));
    }
    for (const release of cached.history) {
      const section = element("section", undefined, "release-card");
      section.append(element("h3", `Reika ${release.version}`));
      section.append(element("p", `Предыдущая версия: ${release.previous}. Исходный коммит: ${release.source.slice(0, 12)}.`, "muted"));
      const versions = element("ul");
      for (const item of release.components) versions.append(element("li", `${item.name}: ${item.from || "новый модуль"} → ${item.version}. ${item.reason}.`));
      section.append(versions);
      release.changes.forEach(note => section.append(changeCard(note)));
      const files = element("details");
      files.append(element("summary", `Затронутые файлы: ${release.files.length}`));
      const list = element("ul");
      const actions = {added: "Добавлен", modified: "Изменён", deleted: "Удалён"};
      release.files.forEach(item => list.append(element("li", `${actions[item.action] || "Учтён"}: ${item.path}`)));
      files.append(list); section.append(files); history.append(section);
    }
    if (!cached.pending.length && !cached.history.length) history.append(element("p", "Расширенная история начнётся со следующего автоматического выпуска. Выпуски 0.1–0.3 описаны в CHANGELOG.md."));
    $("#project-message").textContent = `Зарегистрировано модулей: ${Object.keys(cached.modules).length}. Связи отражают устройство проекта.`;
  } catch {
    $("#project-message").textContent = "Не удалось получить сведения о проекте. Проверьте соединение и повторите загрузку.";
  } finally { clearTimeout(timeout); }
}
