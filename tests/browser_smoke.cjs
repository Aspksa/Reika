/* Optional browser QA; Playwright is installed only by the CI browser job. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { spawn } = require("node:child_process");
const { mkdir } = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const results = path.join(root, "test-results");
const app = spawn(process.env.REIKA_PYTHON || "python", ["-X", "utf8", "-B", "run.py", "--no-tray", "--no-browser"], { cwd: root });
let browser;
let output = "";
app.stderr.on("data", (chunk) => { output += chunk.toString(); });

async function run() {
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Startup timeout: ${output}`)), 15000);
    app.on("error", (error) => { clearTimeout(timer); reject(error); });
    app.on("exit", (code) => { clearTimeout(timer); reject(new Error(`Reika exited ${code}: ${output}`)); });
    app.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const found = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (found) { clearTimeout(timer); resolve(found[0]); }
    });
  });
  await mkdir(results, { recursive: true });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  const errors = [];
  const failures = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => { if (response.status() >= 400) failures.push(response.url()); });
  await page.goto(url);
  await page.waitForSelector('.view:not([hidden]) [data-connection][data-state="online"]');
  await page.screenshot({ path: path.join(results, "desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "Скопировать адрес" }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), url);
  await page.getByRole("link", { name: "Система", exact: true }).click();
  await page.waitForSelector("#view-system:not([hidden])");
  await page.getByRole("button", { name: "Включить тёмную тему" }).click();
  await page.reload();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await page.waitForSelector('.view:not([hidden]) [data-connection][data-state="online"]');
  await page.screenshot({ path: path.join(results, "system-dark.png"), fullPage: true });
  await page.getByRole("link", { name: "О Reika", exact: true }).click();
  await page.waitForSelector("#view-about:not([hidden])");
  await page.screenshot({ path: path.join(results, "about.png"), fullPage: true });
  await page.getByRole("button", { name: "Включить светлую тему" }).click();
  await page.getByRole("link", { name: "Главная", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(results, "mobile.png"), fullPage: true });
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Overflow at ${width}px`);
  }
  await context.setOffline(true);
  await page.getByRole("button", { name: "Проверить соединение" }).click();
  await page.waitForSelector('.view:not([hidden]) [data-connection][data-state="offline"]');
  assert.equal(await page.locator("#uptime").textContent(), "—");
  await context.setOffline(false);
  await page.getByRole("button", { name: "Проверить соединение" }).click();
  await page.waitForSelector('.view:not([hidden]) [data-connection][data-state="online"]');
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  console.log("Browser checks passed: navigation, clipboard, themes, 5 viewport sizes, offline recovery, no script/resource errors.");
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (app.exitCode === null) app.kill("SIGTERM");
});
