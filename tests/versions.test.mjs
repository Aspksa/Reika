import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "reika-versions-"));
  await mkdir(join(root, "scripts"));
  await copyFile(new URL("../scripts/versions.mjs", import.meta.url), join(root, "scripts/versions.mjs"));
  const registry = {schema: 1, project: "1.2.3", components: {
    styles: {name: "Стили", version: "2.3.4", paths: ["styles.css"]},
    config: {name: "Сборка", version: "1.0.0", paths: ["versions.json", "package.json", "package-lock.json", "scripts/"]},
  }};
  const files = {
    "versions.json": registry,
    "package.json": {name: "test", version: "1.2.3"},
    "package-lock.json": {version: "1.2.3", packages: {"": {version: "1.2.3"}}},
  };
  for (const [name, data] of Object.entries(files)) await writeFile(join(root, name), JSON.stringify(data));
  await writeFile(join(root, "styles.css"), "body { color: red; }\n");
  return root;
}

function run(root, ...args) {
  return spawnSync(process.execPath, [join(root, "scripts/versions.mjs"), ...args], {encoding: "utf8"});
}

test("bump coordinates project, selected component and both npm manifests", async () => {
  const root = await fixture();
  try {
    assert.equal(run(root, "bump", "patch", "styles").status, 0);
    const registry = JSON.parse(await readFile(join(root, "versions.json")));
    assert.equal(registry.project, "1.2.4");
    assert.equal(registry.components.styles.version, "2.3.5");
    assert.equal(registry.components.config.version, "1.0.0");
    assert.equal(JSON.parse(await readFile(join(root, "package.json"))).version, "1.2.4");
    const lock = JSON.parse(await readFile(join(root, "package-lock.json")));
    assert.equal(lock.version, "1.2.4");
    assert.equal(lock.packages[""].version, "1.2.4");
  } finally { await rm(root, {recursive: true, force: true}); }
});

test("inventory detects edits but accepts equivalent Windows line endings", async () => {
  const root = await fixture();
  try {
    assert.equal(run(root, "sync").status, 0);
    assert.equal(run(root, "check").status, 0);
    await writeFile(join(root, "styles.css"), "body { color: red; }\r\n");
    assert.equal(run(root, "check").status, 0);
    await writeFile(join(root, "styles.css"), "body { color: blue; }\n");
    assert.notEqual(run(root, "check").status, 0);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test("an unknown component is rejected without modifying the registry", async () => {
  const root = await fixture();
  try {
    const previous = await readFile(join(root, "versions.json"));
    assert.notEqual(run(root, "bump", "minor", "unknown").status, 0);
    assert.deepEqual(await readFile(join(root, "versions.json")), previous);
  } finally { await rm(root, {recursive: true, force: true}); }
});
