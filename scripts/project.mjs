export const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const levels = {patch: 1, minor: 2, major: 3};
export const russian = value => typeof value === "string" && /[А-Яа-яЁё]/u.test(value) && value.trim().length >= 8;
export const generated = path => path === "versions.lock.json" || path === "CHANGELOG.md" || path.startsWith("web/dist/") || path.startsWith("releases/") || path.startsWith(".changes/");

export function bump(version, level) {
  if (!semver.test(version) || !levels[level]) throw new Error("Неверный номер или тип повышения версии");
  const values = version.split(".").map(Number);
  // Until 1.0, incompatible changes advance the minor series.
  const index = level === "major" ? (values[0] === 0 ? 1 : 0) : level === "minor" ? 1 : 2;
  values[index]++;
  for (let i = index + 1; i < 3; i++) values[i] = 0;
  return values.join(".");
}

export function validateRegistry(registry) {
  if (registry.schema !== 1 || !semver.test(registry.project) || !registry.components || !Object.keys(registry.components).length) throw new Error("Неверный реестр версий");
  const rules = new Map();
  for (const [id, component] of Object.entries(registry.components)) {
    if (!/^[a-z][a-z0-9_]*$/.test(id) || !semver.test(component.version) || typeof component.name !== "string" || !/[А-Яа-яЁё]/u.test(component.name) || !russian(component.description) || !["active", "experimental", "deprecated"].includes(component.status)) throw new Error(`Неверное описание модуля: ${id}`);
    if (!Array.isArray(component.paths) || !component.paths.length || !Array.isArray(component.dependencies)) throw new Error(`Нет путей или списка связей: ${id}`);
    for (const path of component.paths) {
      if (typeof path !== "string" || !path || path.startsWith("/") || path.includes("\\") || path.split("/").includes("..")) throw new Error(`Недопустимый путь: ${id}`);
      if (rules.has(path) && rules.get(path) !== id) throw new Error(`Путь принадлежит двум модулям: ${path}`);
      rules.set(path, id);
    }
    const targets = new Set();
    for (const link of component.dependencies) {
      if (!registry.components[link.target] || link.target === id || targets.has(link.target) || !["runtime", "build", "design", "verification", "documentation"].includes(link.kind) || !["none", "patch"].includes(link.propagate) || !russian(link.reason)) throw new Error(`Неверная связь модуля: ${id}`);
      targets.add(link.target);
    }
  }
  const visiting = new Set(), visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new Error(`Цикл обязательных зависимостей: ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const link of registry.components[id].dependencies) if (["runtime", "build"].includes(link.kind)) visit(link.target);
    visiting.delete(id); visited.add(id);
  }
  Object.keys(registry.components).forEach(visit);
  return registry;
}

export function owner(registry, path) {
  const matches = [];
  for (const [id, component] of Object.entries(registry.components)) for (const rule of component.paths) {
    if (rule.endsWith("/") ? path.startsWith(rule) : path === rule) matches.push({id, length: rule.length});
  }
  matches.sort((a, b) => b.length - a.length);
  if (!matches.length) return null;
  const best = matches.filter(item => item.length === matches[0].length);
  if (new Set(best.map(item => item.id)).size !== 1) throw new Error(`Неоднозначный владелец файла: ${path}`);
  return best[0].id;
}

export function validateNote(note, registry) {
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(note.id) || !["fix", "feature", "design", "refactor", "docs", "test", "security", "maintenance", "new-module", "breaking"].includes(note.kind)) throw new Error("Неверный идентификатор или вид изменения");
  for (const key of ["title", "description", "reason", "userImpact"]) if (!russian(note[key])) throw new Error(`Заполните поле по-русски: ${key}`);
  for (const key of ["testing", "risks", "migration"]) if (!Array.isArray(note[key]) || !note[key].length || !note[key].every(russian)) throw new Error(`Заполните список по-русски: ${key}`);
  if (!note.components || !Object.keys(note.components).length) throw new Error("Укажите затронутые модули");
  for (const [id, level] of Object.entries(note.components)) if (!registry.components[id] || !levels[level]) throw new Error(`Неизвестный модуль или тип повышения: ${id}`);
  if (note.kind === "breaking" && !Object.values(note.components).includes("major")) throw new Error("Несовместимое изменение требует отметки major");
  return note;
}

export function planRelease(registry, previous, notes, paths) {
  validateRegistry(registry);
  notes.forEach(note => validateNote(note, registry));
  if (new Set(notes.map(note => note.id)).size !== notes.length) throw new Error("Повторяется идентификатор изменения");
  const changes = new Map(), changedModules = new Set();
  for (const path of paths) {
    if (generated(path) || path === "versions.json") continue;
    const id = owner(registry, path) || owner(previous, path);
    if (!id || !registry.components[id]) throw new Error(`Зарегистрируйте владельца файла: ${path}. Для удалённого модуля сохраните запись со статусом deprecated.`);
    changedModules.add(id);
  }
  for (const [id, component] of Object.entries(registry.components)) {
    const {version, ...definition} = component;
    const {version: oldVersion, ...oldDefinition} = previous.components[id] || {};
    if (JSON.stringify(definition) !== JSON.stringify(oldDefinition)) changedModules.add(id);
  }
  for (const note of notes) for (const [id, level] of Object.entries(note.components)) {
    const existing = changes.get(id);
    if (!existing || levels[level] > levels[existing.level]) changes.set(id, {level, reason: "Описано в записи об изменении"});
  }
  for (const id of changedModules) if (!changes.has(id)) throw new Error(`Нет русского описания изменения модуля ${id}. Добавьте запись в .changes.`);
  // Propagation is opt-in; merely displaying a relation does not bump a version.
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const [id, component] of Object.entries(registry.components)) for (const link of component.dependencies) {
      if (link.propagate === "patch" && changes.has(link.target) && !changes.has(id)) {
        changes.set(id, {level: "patch", reason: `Связь с ${registry.components[link.target].name}: ${link.reason}`}); expanded = true;
      }
    }
  }
  if (!changes.size) return null;
  const level = [...changes.values()].reduce((a, b) => levels[b.level] > levels[a] ? b.level : a, "patch");
  return {from: registry.project, version: bump(registry.project, level), components: Object.fromEntries([...changes].map(([id, change]) => [id, {
    ...change, from: previous.components[id]?.version || null,
    version: previous.components[id] ? bump(registry.components[id].version, change.level) : registry.components[id].version,
  }]))};
}
