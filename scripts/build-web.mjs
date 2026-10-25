import { build } from "vite";
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";

const root = fileURLToPath(new URL("../", import.meta.url));
const check = process.argv.includes("--check");
const temporary = check ? await mkdtemp(join(tmpdir(), "reika-build-")) : null;
const output = temporary || join(root, "web", "dist");

async function files(directory, base = directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path, base));
    else result.push(relative(base, path).replaceAll("\\", "/"));
  }
  return result.sort();
}

try {
  await build({ configFile: join(root, "vite.config.mjs"), build: { outDir: output } });
  const manifest = { version: JSON.parse(await readFile(join(root, "package.json"), "utf8")).version, files: {} };
  for (const path of await files(output)) {
    if (path !== "index.html" && !/^assets\/[a-zA-Z0-9_.-]+\.(css|js|svg)$/.test(path)) {
      throw new Error(`Недопустимый файл сборки: ${path}`);
    }
    manifest.files[path] = createHash("sha256").update(await readFile(join(output, path))).digest("hex");
  }
  await writeFile(join(output, "build.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  if (check) {
    const committed = join(root, "web", "dist");
    const expected = await files(output);
    if (JSON.stringify(await files(committed)) !== JSON.stringify(expected)) throw new Error("Состав web/dist устарел. Выполните npm run build.");
    for (const path of expected) {
      if (!(await readFile(join(committed, path))).equals(await readFile(join(output, path)))) {
        throw new Error(`Сборка устарела: ${path}. Выполните npm run build.`);
      }
    }
    console.log("✓ Готовый интерфейс соответствует исходникам.");
  } else console.log("✓ Интерфейс собран в web/dist; создан список файлов с SHA-256.");
} finally {
  if (temporary) await rm(temporary, { recursive: true, force: true });
}
