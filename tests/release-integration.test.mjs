import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, symlink, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const source = fileURLToPath(new URL("../", import.meta.url));

test("a real Git checkout produces one coherent candidate and no recursive release", async () => {
  const root = await mkdtemp(join(tmpdir(), "reika-publication-"));
  const excluded = new Set([".git", "node_modules", ".runtime", "logs", "test-results", "__pycache__", ".venv"]);
  const run = (file, args) => {
    const result = spawnSync(file, args, {cwd: root, encoding: "utf8", timeout: 60000});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result.stdout.trim();
  };
  const node = (...args) => run(process.execPath, args);
  try {
    await cp(source, root, {recursive: true, filter: path => !relative(source, path).split(/[\\/]/).some(part => excluded.has(part))});
    await symlink(join(source, "node_modules"), join(root, "node_modules"), "junction");
    for (const name of await readdir(join(root, ".changes"))) if (name.endsWith(".json")) await rm(join(root, ".changes", name));
    const current = JSON.parse(await readFile(join(root, "versions.json")));
    await writeFile(join(root, ".changes/fixture-release.json"), JSON.stringify({
      id: "fixture-release", kind: "fix", title: "Проверка подготовки выпуска",
      description: "Проверяем единый выпуск и согласованность его файлов.",
      reason: "Нужно проверить подготовку в настоящем Git checkout.",
      userImpact: "Пользователь получает согласованную сборку приложения.",
      components: Object.fromEntries(Object.keys(current.components).map(id => [id, "patch"])),
      testing: ["Проверяется подготовка и повторный запуск без новых изменений."],
      risks: ["Используется изолированная временная папка для теста."],
      migration: ["Переход пользователя в этом тесте не требуется."],
    }));
    run("git", ["init"]);
    run("git", ["config", "user.name", "Reika Test"]);
    run("git", ["config", "user.email", "reika-test@example.invalid"]);
    run("git", ["add", "--all"]);
    run("git", ["commit", "-m", "Базовая версия для проверки"]);
    const base = run("git", ["rev-parse", "HEAD"]);
    await writeFile(join(root, "releases/state.json"), JSON.stringify({schema: 1, baseline: base}));
    run("git", ["add", "--all"]);
    run("git", ["commit", "-m", "База автоматического выпуска"]);
    const original = JSON.parse(await readFile(join(root, "versions.json")));
    node("scripts/release.mjs", "check", "--base", base);
    node("scripts/release.mjs", "prepare", "--base", base);
    const registry = JSON.parse(await readFile(join(root, "versions.json")));
    const history = JSON.parse(await readFile(join(root, "releases/history.json")));
    assert.notEqual(registry.project, original.project);
    assert.equal(history.releases[0].version, registry.project);
    assert.ok(history.releases[0].changes[0].description.includes("выпуск"));
    run("git", ["add", "--all"]);
    run("git", ["commit", "-m", "Подготовленный выпуск"]);
    node("scripts/versions.mjs", "check");
    node("scripts/release.mjs", "check");
    node("scripts/release.mjs", "prepare");
    assert.equal(JSON.parse(await readFile(join(root, ".runtime/release/plan.json"))).plan, null);
    assert.equal(run("git", ["status", "--porcelain"]), "");
  } finally { await rm(root, {recursive: true, force: true}); }
});
