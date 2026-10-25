import { readFile, writeFile, mkdir, readdir, rename } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { validateRegistry, validateNote, planRelease, owner, generated } from "./project.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const execute = promisify(execFile);
const git = async (...args) => (await execute("git", args, {cwd: root, maxBuffer: 8_000_000})).stdout;
const read = async path => JSON.parse(await readFile(join(root, path), "utf8"));
const write = async (path, data) => { await mkdir(join(root, path, ".."), {recursive: true}); await writeFile(join(root, path), JSON.stringify(data, null, 2) + "\n"); };
const option = name => process.argv[process.argv.indexOf(name) + 1];
const mode = process.argv[2] || "check";
const registry = validateRegistry(await read("versions.json"));

if (mode === "register") {
  const path = process.argv[3];
  if (!path) throw new Error("Укажите JSON-описание нового модуля");
  const descriptor = JSON.parse(await readFile(path, "utf8"));
  const {id, ...component} = descriptor;
  if (registry.components[id]) throw new Error("Модуль с таким идентификатором уже зарегистрирован");
  if (component.version !== "0.1.0") throw new Error("Новый модуль начинает учёт с версии 0.1.0");
  registry.components[id] = component;
  validateRegistry(registry);
  await write("versions.json", registry);
  console.log(`✓ Модуль ${id} зарегистрирован. Добавьте русскую запись .changes и выполните npm run build.`);
} else {
  if (!["check", "plan", "prepare"].includes(mode)) throw new Error("Режим: check, plan, prepare или register");
  const state = await read("releases/state.json");
  const history = await read("releases/history.json");
  const head = (await git("rev-parse", "HEAD")).trim();
  let base = process.argv.includes("--base") ? option("--base") : "";
  if (!base) {
    try { base = (await git("rev-parse", "--verify", `refs/tags/v${registry.project}`)).trim(); }
    catch { base = state.baseline; }
  }
  if (!/^[a-f0-9]{40}$/.test(base)) throw new Error("Нужен полный SHA базового коммита");
  const previous = JSON.parse(await git("show", `${base}:versions.json`));
  const notes = [];
  for (const filename of (await readdir(join(root, ".changes"))).filter(name => name.endsWith(".json")).sort()) {
    const note = validateNote(await read(`.changes/${filename}`), registry);
    if (filename !== `${note.id}.json`) throw new Error("Имя записи должно совпадать с её id");
    notes.push(note);
  }
  let paths = [...new Set([
    ...(await git("diff", "--name-only", "--no-renames", "-z", base)).split("\0"),
    ...(await git("ls-files", "--others", "--exclude-standard", "-z")).split("\0"),
  ].filter(Boolean))];
  for (const path of ["package.json", "package-lock.json"]) if (paths.includes(path)) {
    try {
      const normalize = data => { delete data.version; if (data.packages?.[""]) delete data.packages[""].version; return JSON.stringify(data); };
      if (normalize(await read(path)) === normalize(JSON.parse(await git("show", `${base}:${path}`)))) paths = paths.filter(item => item !== path);
    } catch { /* A new or substantively changed manifest belongs to the build module. */ }
  }
  const plan = planRelease(registry, previous, notes, paths);
  const changedNumbers = registry.project !== previous.project || Object.entries(registry.components).some(([id, item]) => previous.components[id] && previous.components[id].version !== item.version);
  if (changedNumbers) {
    const latest = history.releases[0];
    const parent = (await git("rev-parse", "HEAD^")).trim();
    if (notes.length || plan || parent !== base || state.baseline !== base || latest?.source !== base || latest?.version !== registry.project) throw new Error("Номера существующих модулей повышает автоматический выпуск. Не меняйте их вручную в рабочем PR.");
  }
  const statusParts = (await git("diff", "--name-status", "--no-renames", "-z", base)).split("\0");
  const fileStatus = {};
  for (let i = 0; i + 1 < statusParts.length; i += 2) fileStatus[statusParts[i + 1]] = statusParts[i] === "A" ? "added" : statusParts[i] === "D" ? "deleted" : "modified";
  const result = {schema: 1, source: head, base, plan, notes, files: paths.filter(path => !generated(path)), fileStatus};
  if (mode === "check") console.log(plan ? `✓ Изменения описаны: ${notes.length}; следующий выпуск ${plan.version}.` : "✓ Неописанных изменений нет; новый выпуск не требуется.");
  if (mode === "plan") console.log(JSON.stringify(result, null, 2));
  if (mode === "prepare") {
    if ((await git("status", "--porcelain")).trim()) throw new Error("Подготовка выпуска требует чистого Git checkout");
    await mkdir(join(root, ".runtime/release"), {recursive: true});
    await write(".runtime/release/plan.json", result);
    if (!plan) { console.log("Нет накопленных изменений для выпуска."); process.exit(0); }
    registry.project = plan.version;
    for (const [id, item] of Object.entries(plan.components)) registry.components[id].version = item.version;
    const changes = notes.map(note => ({...note}));
    const commitIds = (await git("rev-list", "--reverse", `${base}..HEAD`)).trim().split("\n").filter(Boolean);
    let journal;
    try { journal = await read("releases/commits.json"); } catch { journal = {schema: 1, commits: []}; }
    for (const sha of commitIds) if (!journal.commits.some(item => item.sha === sha)) {
      const files = (await git("diff-tree", "--no-commit-id", "--name-only", "-r", "--no-renames", "-z", sha)).split("\0").filter(Boolean);
      journal.commits.push({sha, release: plan.version, change_ids: notes.map(note => note.id), files});
    }
    const entry = {
      version: plan.version, previous: plan.from, source: head,
      created_at: new Date().toISOString(),
      components: Object.entries(plan.components).map(([id, item]) => ({id, name: registry.components[id].name, from: item.from, version: item.version, reason: item.reason, level: item.level})),
      changes, files: result.files.map(path => ({path, action: fileStatus[path] || "added", component: owner(registry, path) || owner(previous, path)})),
      commits: commitIds,
    };
    if (history.releases.some(item => item.source === head || item.version === plan.version)) throw new Error("Этот исходный коммит или номер уже учтён");
    history.releases.unshift(entry);
    const labels = {fix: "Исправление", feature: "Новая возможность", design: "Дизайн", refactor: "Внутреннее улучшение", docs: "Документация", test: "Проверки", security: "Безопасность", maintenance: "Обслуживание", "new-module": "Новый модуль", breaking: "Несовместимое изменение"};
    const paragraphs = [`# Reika ${plan.version}`, "", `Предыдущий выпуск: ${plan.from}. Исходный коммит: ${head}.`, "", "## Версии компонентов", "", ...entry.components.map(item => `- **${item.name}**: ${item.from || "первый выпуск"} → ${item.version}. ${item.reason}.`), ""];
    for (const note of notes) paragraphs.push(`## ${labels[note.kind]}: ${note.title}`, "", note.description, "", `**Зачем:** ${note.reason}`, "", `**Что изменится для пользователя:** ${note.userImpact}`, "", "**Проверки, описанные автором:**", ...note.testing.map(text => `- ${text}`), "", "**Ограничения и известные проблемы:**", ...note.risks.map(text => `- ${text}`), "", "**Переход на новую версию:**", ...note.migration.map(text => `- ${text}`), "");
    const actions = {added: "Добавлен", deleted: "Удалён", modified: "Изменён"};
    paragraphs.push("## Затронутые файлы", "", ...entry.files.map(item => `- ${actions[item.action]} \`${item.path}\` — ${registry.components[item.component]?.name || item.component}`), "", "Подробный результат автоматических проверок и факт публикации доступны в GitHub Actions и GitHub Releases.", "");
    const markdown = paragraphs.join("\n");
    await write("versions.json", registry);
    await write("releases/history.json", history);
    await write("releases/commits.json", journal);
    await write("releases/state.json", {schema: 1, baseline: head});
    await writeFile(join(root, `releases/${plan.version}.md`), markdown);
    const changelog = await readFile(join(root, "CHANGELOG.md"), "utf8");
    await writeFile(join(root, "CHANGELOG.md"), changelog.replace("# История Reika\n", `# История Reika\n\n## ${plan.version}\n\n${notes.map(note => `- **${note.title}** — ${note.userImpact}`).join("\n")}\n\nПолное описание: [releases/${plan.version}.md](releases/${plan.version}.md).\n`));
    await mkdir(join(root, ".changes/archive", plan.version), {recursive: true});
    for (const note of notes) await rename(join(root, `.changes/${note.id}.json`), join(root, `.changes/archive/${plan.version}/${note.id}.json`));
    await execute(process.execPath, [join(root, "scripts/build-web.mjs")], {cwd: root});
    await execute(process.execPath, [join(root, "scripts/versions.mjs"), "sync"], {cwd: root});
    console.log(`✓ Кандидат ${plan.version} подготовлен. Он ещё не опубликован.`);
  }
}
