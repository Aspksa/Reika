import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRegistry, owner, planRelease, bump, validateNote } from "../scripts/project.mjs";

const module = (name, paths, dependencies = []) => ({name, description: "Подробное описание назначения модуля.", version: "0.3.0", status: "active", paths, dependencies});
const link = (target, kind = "runtime", propagate = "none") => ({target, kind, propagate, reason: "Получает данные от указанного модуля."});
const registry = () => ({schema: 1, project: "0.3.0", components: {
  core: module("Ядро", ["reika/"]),
  frontend: module("Интерфейс", ["web/"], [link("styles", "design", "patch")]),
  styles: module("Стили", ["web/styles/"]),
}});
const note = (components, id = "test-change") => ({
  id, kind: "feature", title: "Изменение проекта", description: "Добавлена новая проверяемая возможность.",
  reason: "Чтобы сделать работу приложения удобнее.", userImpact: "Пользователь получит новую возможность.", components,
  testing: ["Выполнены проверки изменённого поведения."], risks: ["Ограничения описаны в документации проекта."], migration: ["Дополнительные действия не требуются."],
});

test("a nested module owns its paths without taking unrelated core files", () => {
  const data = registry();
  data.components.memory = module("Память", ["reika/modules/memory/"], [link("core")]);
  validateRegistry(data);
  assert.equal(owner(data, "reika/modules/memory/store.py"), "memory");
  assert.equal(owner(data, "reika/server.py"), "core");
  assert.equal(owner(data, "web/styles/theme.css"), "styles");
});

test("unknown paths and undocumented component edits cannot be released", () => {
  const data = registry();
  assert.throws(() => planRelease(data, data, [], ["new/location.py"]), /владельца/);
  assert.throws(() => planRelease(data, data, [], ["reika/app.py"]), /Нет русского описания/);
});

test("several changes bump a component once and retain the strongest declared level", () => {
  const data = registry();
  const plan = planRelease(data, data, [note({core: "patch"}), note({core: "minor"}, "second-change")], ["reika/a.py", "reika/b.py"]);
  assert.equal(plan.version, "0.4.0");
  assert.equal(plan.components.core.version, "0.4.0");
  assert.equal(plan.components.styles, undefined);
});

test("design dependencies propagate only when explicitly enabled", () => {
  const data = registry();
  const plan = planRelease(data, data, [note({styles: "patch"})], ["web/styles/theme.css"]);
  assert.equal(plan.components.styles.version, "0.3.1");
  assert.equal(plan.components.frontend.version, "0.3.1");
  assert.match(plan.components.frontend.reason, /Связь/);
  data.components.frontend.dependencies[0].propagate = "none";
  assert.equal(planRelease(data, data, [note({styles: "patch"})], []).components.frontend, undefined);
});

test("new modules retain their initial version and deleted paths use the previous owner", () => {
  const before = registry(), after = registry();
  after.components.memory = {...module("Память", ["reika/modules/memory/"]), version: "0.1.0"};
  const plan = planRelease(after, before, [note({memory: "minor", core: "patch"})], ["reika/modules/memory/store.py", "reika/removed.py"]);
  assert.equal(plan.components.memory.from, null);
  assert.equal(plan.components.memory.version, "0.1.0");
  assert.equal(plan.components.core.version, "0.3.1");
});

test("cycles of required dependencies, duplicate path owners and unknown links are rejected", () => {
  const cycle = registry(); cycle.components.core.dependencies = [link("frontend")]; cycle.components.frontend.dependencies.push(link("core"));
  assert.throws(() => validateRegistry(cycle), /Цикл/);
  const duplicate = registry(); duplicate.components.styles.paths = ["web/"];
  assert.throws(() => validateRegistry(duplicate), /двум модулям/);
  const unknown = registry(); unknown.components.core.dependencies.push(link("missing"));
  assert.throws(() => validateRegistry(unknown), /Неверная связь/);
});

test("Russian explanations are mandatory and breaking changes follow the pre-1.0 policy", () => {
  const change = note({core: "patch"}); change.description = "Only an English message.";
  assert.throws(() => validateNote(change, registry()), /по-русски/);
  assert.equal(bump("0.3.0", "major"), "0.4.0");
  assert.equal(bump("1.3.4", "major"), "2.0.0");
});

test("generated build output never causes a second release", () => {
  const data = registry();
  assert.equal(planRelease(data, data, [], ["web/dist/index.html", "versions.lock.json", "releases/history.json", ".changes/archive/0.3.0/a.json"]), null);
});
