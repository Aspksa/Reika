import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join, extname } from "node:path";

import { owner } from "./project.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const mode = process.argv[2] || "check";
const registry = JSON.parse(await readFile(join(root, "versions.json"), "utf8"));
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
if (registry.schema !== 1 || !semver.test(registry.project) || !registry.components || !Object.keys(registry.components).length) throw new Error("Неверный versions.json");
for (const component of Object.values(registry.components)) {
  if (!semver.test(component.version) || !component.name || !Array.isArray(component.paths) || !component.paths.length) throw new Error("Неверная запись компонента");
}
if (!["check", "sync", "bump"].includes(mode)) throw new Error("Режим: check, sync или bump patch|minor|major компонент|all");

if (mode === "bump") {
  const level = process.argv[3];
  const target = process.argv[4];
  if (!["patch", "minor", "major"].includes(level) || !(target === "all" || Object.hasOwn(registry.components, target))) throw new Error("Укажите patch|minor|major и компонент либо all");
  const next = (version) => {
    const values = version.split(".").map(Number);
    const index = {major: 0, minor: 1, patch: 2}[level];
    values[index]++;
    for (let i = index + 1; i < 3; i++) values[i] = 0;
    return values.join(".");
  };
  registry.project = next(registry.project);
  for (const [key, component] of Object.entries(registry.components)) if (target === "all" || key === target) component.version = next(component.version);
  await writeFile(join(root, "versions.json"), JSON.stringify(registry, null, 2) + "\n");
}

for (const name of ["package.json", "package-lock.json"]) {
  const path = join(root, name);
  const data = JSON.parse(await readFile(path, "utf8"));
  const matches = data.version === registry.project && (name !== "package-lock.json" || data.packages[""].version === registry.project);
  if (mode === "check" && !matches) throw new Error(`${name}: версия не совпадает с versions.json`);
  if (!matches && mode !== "check") {
    data.version = registry.project;
    if (name === "package-lock.json") data.packages[""].version = registry.project;
    await writeFile(path, JSON.stringify(data, null, 2) + "\n");
  }
}

if (mode === "bump") {
  console.log(`✓ Версия Reika: ${registry.project}. Обновите CHANGELOG.md и выполните npm run build.`);
} else {
  const excluded = new Set([".runtime", "logs", "node_modules", ".git", "__pycache__", ".venv", "test-results", "attempt"]);
  const paths = [];
  async function walk(directory, prefix = "") {
    for (const item of await readdir(directory, {withFileTypes: true})) {
      if (excluded.has(item.name)) continue;
      const path = prefix + item.name;
      if (item.isDirectory()) await walk(join(directory, item.name), path + "/");
      else if (path !== "versions.lock.json") paths.push(path);
    }
  }
  await walk(root);
  const inventory = {schema: 1, project: registry.project, files: {}};
  const textExtensions = new Set([".py", ".js", ".mjs", ".cjs", ".json", ".css", ".html", ".svg", ".ps1", ".bat", ".md", ".yml", ".yaml"]);
  for (const path of paths.sort()) {
    const componentId = owner(registry, path);
    if (!componentId) throw new Error(`Зарегистрируйте модуль для файла: ${path}`);
    const component = registry.components[componentId];
    const raw = await readFile(join(root, path));
    const text = textExtensions.has(extname(path)) || path === ".gitattributes" || path === ".gitignore";
    const data = text ? Buffer.from(raw.toString("utf8").replaceAll("\r\n", "\n")) : raw;
    inventory.files[path] = {component: componentId, version: component.version, hashMode: text ? "utf8-lf" : "bytes", sha256: createHash("sha256").update(data).digest("hex")};
  }
  const contents = JSON.stringify(inventory, null, 2) + "\n";
  const path = join(root, "versions.lock.json");
  if (mode === "check") {
    if ((await readFile(path, "utf8")).replaceAll("\r\n", "\n") !== contents) throw new Error("Каталог версий устарел. Выполните npm run build.");
    console.log(`✓ Версии согласованы; учтено файлов: ${paths.length}.`);
  } else {
    await writeFile(path, contents);
    console.log(`✓ Reika ${registry.project}: версии и каталог ${paths.length} файлов сохранены.`);
  }
}
