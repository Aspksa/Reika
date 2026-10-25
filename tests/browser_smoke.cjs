/* Optional browser QA; Playwright is installed only by the CI browser job. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { spawn } = require("node:child_process");
const { mkdir } = require("node:fs/promises");
const { readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const results = path.join(root, "test-results");
const app = spawn(process.env.REIKA_PYTHON || "python", ["-X", "utf8", "-B", "run.py", "--no-tray", "--no-browser"], { cwd: root });
let browser;
let devServer;
let output = "";
app.stderr.on("data", (chunk) => { output += chunk.toString(); });

async function capture(page, name) {
  await page.mouse.move(0, 0);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: path.join(results, name), fullPage: true, animations: "disabled" });
}

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
  assert.equal(await page.locator(".metrics").evaluate((element) => getComputedStyle(element).display), "grid", "CSS bundle was not applied");
  await capture(page, "desktop.png");
  await page.getByRole("button", { name: "Скопировать адрес" }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), url);
  await page.getByRole("link", { name: "Система", exact: true }).click();
  await page.waitForSelector("#view-system:not([hidden])");
  await page.waitForSelector('#component-versions [data-component="styles"] dd');
  assert.match(await page.locator('#component-versions [data-component="styles"] dd').textContent(), /^\d+\.\d+\.\d+$/);
  await page.getByRole("button", { name: "Включить тёмную тему" }).click();
  // A fresh server port has a new localStorage, but shares host-scoped cookies.
  await page.evaluate(() => localStorage.removeItem("reika.theme"));
  await page.reload();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await page.waitForSelector('.view:not([hidden]) [data-connection][data-state="online"]');
  await capture(page, "system-dark.png");
  await page.getByRole("link", { name: "О Reika", exact: true }).click();
  await page.waitForSelector("#view-about:not([hidden])");
  await capture(page, "about.png");
  await page.getByRole("button", { name: "Включить светлую тему" }).click();
  await page.getByRole("link", { name: "Настройки проекта", exact: true }).click();
  await page.waitForSelector("#view-project-settings:not([hidden])");
  await page.waitForSelector(".cloud-model-card");
  assert.ok(await page.locator(".cloud-model-card").count() >= 7);
  assert.ok((await page.locator("#cloud-key-status").textContent()).length>0);
  assert.ok(await page.locator("#cloud-model option").count()>=7);
  assert.equal(await page.locator(".cloud-capabilities").count(), await page.locator(".cloud-model-card").count());
  await page.locator('[data-appearance-theme="dark"]').click();
  assert.equal(await page.locator("html").getAttribute("data-theme"),"dark");
  await page.locator('[data-appearance-theme="light"]').click();
  await page.locator('[data-appearance-accent="jade"]').click();
  await page.locator('[data-appearance-rounding="round"]').click();
  await page.locator('[data-appearance-scale="large"]').click();
  assert.equal(await page.locator("html").getAttribute("data-accent"),"jade");
  assert.equal(await page.locator("html").getAttribute("data-rounding"),"round");
  assert.equal(await page.locator("html").getAttribute("data-scale"),"large");
  await page.reload();
  await page.waitForSelector(".cloud-model-card");
  assert.equal(await page.locator("html").getAttribute("data-accent"),"jade");
  assert.equal(await page.locator("html").getAttribute("data-rounding"),"round");
  assert.equal(await page.locator("html").getAttribute("data-scale"),"large");
  for (const width of [390,768,1440]) {
    await page.setViewportSize({width,height:900});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false,`Settings overflow at ${width}px`);
    if(width===390||width===1440)await capture(page,`settings-${width}.png`);
  }
  await page.locator('[data-appearance-scale="normal"]').click();
  await page.locator('[data-appearance-rounding="normal"]').click();
  await page.locator('[data-appearance-accent="sakura"]').click();
  await capture(page, "cloud-settings.png");
  await page.getByRole("link", { name: "Проект", exact: true }).click();
  await page.waitForSelector('[data-module="release"]');
  assert.ok(Number(await page.locator("#project-count-modules").textContent()) >= 10);
  assert.ok(Number(await page.locator("#project-count-links").textContent()) > 0);
  await page.waitForFunction(() => document.querySelector("#project-monitor-status").textContent.includes("Последняя проверка"));
  assert.ok(Number(await page.locator(".project-monitor-item").count()) >= 5);
  await page.locator("#project-monitor-interval").selectOption("0");
  await page.locator("#project-monitor-now").click();
  await page.waitForFunction(() => document.querySelector("#project-monitor-status").textContent.includes("Последняя проверка"));
  await page.locator("#project-monitor-interval").selectOption("30000");

  assert.equal(await page.locator('[data-project-tab]').count(),3);
  assert.ok(await page.locator(".project-hero").isVisible());
  await page.locator("#project-toggle-filters").click();
  assert.ok(await page.locator("#project-filter-fields").isVisible());
  await page.locator('[data-project-layout="list"]').click();
  assert.equal(await page.locator("#view-project").getAttribute("data-layout"),"list");
  await page.locator('[data-project-layout="grid"]').click();
  await page.locator('[data-module="release"] .project-open-module').click();
  assert.ok(await page.locator("#project-inspector").isVisible());
  await page.locator(".project-inspector-close").click();
  assert.equal(await page.locator("#project-inspector").isVisible(),false);
  await page.locator('[data-project-tab="links"]').click();
  assert.ok(await page.locator("#project-links .project-link-card").count()>0);
  assert.ok(await page.locator("#project-map .project-map-node").count()>=10);
  await page.locator("#project-map-zoom-in").click();
  assert.match(await page.locator("#project-map-scene").getAttribute("transform"),/scale\(1\.2\)/);
  await page.locator("#project-map-reset").click();
  assert.match(await page.locator("#project-map-scene").getAttribute("transform"),/scale\(1\)/);
  assert.equal(await page.locator('#project-architecture').isVisible(),false);
  await page.locator('[data-project-tab="history"]').click();
  assert.ok(await page.locator("#compare-result .project-compare-card").count()===2);
  await page.locator("#project-density").selectOption("compact");
  assert.equal(await page.locator("#view-project").getAttribute("data-density"),"compact");
  await page.locator("#project-audience").selectOption("developer");
  assert.equal(await page.locator("#view-project").getAttribute("data-audience"),"developer");
  await page.locator('[data-project-tab="modules"]').click();
  await page.locator("#module-search").fill("несуществующий-запрос");
  assert.equal(await page.locator(".module-card").count(),0);
  await page.locator("#reset-project-filters").click();
  assert.equal(await page.locator("#module-search").inputValue(),"");
  assert.ok(await page.locator(".module-card").count()>0);
  await page.locator("#module-search").fill("Запуск Windows");
  assert.equal(await page.locator(".module-card").count(),1);
  await page.locator("#module-search").fill("несуществующий-запрос");
  assert.equal(await page.locator(".module-card").count(),0);
  await page.locator("#module-search").fill("");
  await page.locator("#module-category").selectOption("Интерфейс");
  assert.ok(await page.locator('[data-module="styles"]').isVisible());
  assert.equal(await page.locator('[data-module="launcher"]').count(),0);
  await page.locator("#module-category").selectOption("");
  await page.locator("#module-status").selectOption("active");
  assert.ok(await page.locator('[data-module="release"]').isVisible());
  await page.locator("#module-status").selectOption("");
  const details = page.locator('[data-module="release"] .module-details');
  if ((await details.getAttribute("open")) === null) await details.locator("summary").click();
  assert.notEqual(await details.getAttribute("open"), null);
  assert.ok((await details.locator(".module-paths").textContent()).includes("scripts/"));
  await page.locator('[data-project-tab="history"]').click();
  await page.locator("#history-search").fill("несуществующее-обновление");
  assert.equal(await page.locator(".project-history .release-card").count(),0);
  await page.locator("#history-search").fill("");
  await page.locator("#history-kind").selectOption("fix");
  await page.locator("#history-kind").selectOption("");
  await page.locator('[data-project-tab="modules"]').click();
  await page.locator("#module-filter").selectOption("frontend");
  assert.ok(await page.locator('[data-module="styles"]').isVisible());
  assert.equal(await page.locator('[data-module="launcher"]').count(), 0);
  await page.locator("#module-filter").selectOption("");
  await page.locator("#project-audience").selectOption("user");
  await page.locator("#project-density").selectOption("comfortable");
  const moduleCount = await page.locator(".module-card").count();
  assert.equal(await page.locator(".module-counts").count(), moduleCount);
  for (const theme of ["light", "dark"]) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    for (const width of [360, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1080 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Project overflow: ${theme}, ${width}px`);
      if (width === 390 || width === 1440) await capture(page, `project-${theme}-${width}.png`);
    }
  }
  await page.evaluate(() => document.documentElement.dataset.theme = "light");
  await capture(page, "project.png");
  await page.getByRole("link", { name: "Главная", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".navigation")).flexDirection === "row");
  await capture(page, "mobile.png");
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
  // Check the real development server, API proxy, and CSS hot updates too.
  const { createServer } = await import("vite");
  devServer = await createServer({ configFile: path.join(root, "vite.config.mjs") });
  await devServer.listen();
  await page.goto(devServer.resolvedUrls.local[0]);
  await page.waitForSelector('.view:not([hidden]) [data-connection][data-state="online"]');
  const cssPath = path.join(root, "web/styles/hero.css");
  const originalCss = await readFile(cssPath, "utf8");
  try {
    await writeFile(cssPath, originalCss + "\n.hero { border-top-width: 7px; }\n");
    await page.waitForFunction(() => getComputedStyle(document.querySelector(".hero")).borderTopWidth === "7px");
  } finally {
    await writeFile(cssPath, originalCss);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  console.log("Browser checks passed: production CSS/JS, navigation, clipboard, themes, 5 viewport sizes, offline recovery, Vite API proxy and CSS hot updates.");
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (devServer) await devServer.close();
  if (app.exitCode === null) app.kill("SIGTERM");
});
