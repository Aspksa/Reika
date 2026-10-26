/* Reika Clarity: progressive disclosure without changing server APIs. */
const $ = selector => document.querySelector(selector);

function move(parent, selector) {
  const item = $(selector);
  if (item) parent.append(item);
  return item;
}

function navLayout() {
  const sidebar = $(".sidebar");
  const nav = $(".navigation");
  if (!sidebar || !nav) return;
  const home = nav.querySelector('[data-view="home"]');
  const project = nav.querySelector('[data-view="project"]');
  const system = nav.querySelector('[data-view="system"]');
  const settings = nav.querySelector('[data-view="project-settings"]');
  const about = nav.querySelector('[data-view="about"]');
  const group = document.createElement("div");
  group.className = "nav-group-label";
  group.textContent = "РАБОЧЕЕ ПРОСТРАНСТВО";
  const secondary = document.createElement("div");
  secondary.className = "nav-secondary";
  secondary.setAttribute("aria-label", "Дополнительно");
  const secondaryLabel = document.createElement("div");
  secondaryLabel.className = "nav-group-label";
  secondaryLabel.textContent = "УПРАВЛЕНИЕ";
  secondary.append(secondaryLabel, settings, about);
  nav.replaceChildren(group, home, project, system, secondary);
  const more = document.createElement("button");
  more.type = "button";
  more.id = "mobile-more";
  more.className = "mobile-more-button";
  more.setAttribute("aria-expanded", "false");
  more.setAttribute("aria-controls", "mobile-secondary");
  more.innerHTML = '<span class="mobile-more-icon" aria-hidden="true">•••</span><span>Ещё</span>';
  secondary.id = "mobile-secondary";
  nav.append(more);
  const close = () => {
    sidebar.classList.remove("mobile-more-open");
    more.setAttribute("aria-expanded", "false");
  };
  more.addEventListener("click", () => {
    const isOpen = sidebar.classList.toggle("mobile-more-open");
    more.setAttribute("aria-expanded", String(isOpen));
  });
  nav.querySelectorAll("a").forEach(link => link.addEventListener("click", close));
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && sidebar.classList.contains("mobile-more-open")) {
      close();
      more.focus();
    }
  });
  document.addEventListener("pointerdown", event => {
    if (!sidebar.contains(event.target)) close();
  });
  window.addEventListener("hashchange", close);
}

function simplifyHome() {
  const title = $(".hero h2");
  if (title) title.innerHTML = 'Всё важное<br><em>под рукой.</em>';
  const desc = $(".hero-copy p");
  if (desc) desc.textContent = "Управляйте проектом, следите за состоянием и находите нужное без лишних шагов.";
  const link = $(".hero .primary-button");
  if (link) {
    link.href = "#project";
    link.firstChild.textContent = "Перейти к проекту ";
  }
  const heading = $("#view-home .section-heading h2");
  if (heading) heading.textContent = "Состояние системы";
}

function projectSections() {
  const project = $("#view-project");
  const tablist = $(".project-tabs");
  const controls = $(".project-view-controls");
  if (!project || !tablist || !controls) return;
  const overviewButton = document.createElement("button");
  overviewButton.type = "button";
  overviewButton.dataset.projectTab = "overview";
  overviewButton.setAttribute("role", "tab");
  overviewButton.setAttribute("aria-selected", "true");
  overviewButton.textContent = "Обзор";
  tablist.prepend(overviewButton);
  const analysisButton = document.createElement("button");
  analysisButton.type = "button";
  analysisButton.dataset.projectTab = "analysis";
  analysisButton.setAttribute("role", "tab");
  analysisButton.setAttribute("aria-selected", "false");
  analysisButton.textContent = "Анализ";
  tablist.querySelector('[data-project-tab="history"]').before(analysisButton);
  tablist.querySelector('[data-project-tab="links"]').textContent = "Карта связей";
  tablist.querySelector('[data-project-tab="history"]').textContent = "Развитие";
  tablist.setAttribute("aria-label", "Разделы проекта");
  const anchor = $("#project-architecture");
  const overview = document.createElement("section");
  overview.className = "project-content-pane";
  overview.dataset.projectPanel = "overview";
  overview.setAttribute("aria-label", "Обзор проекта");
  anchor.before(overview);
  const intro = document.createElement("div");
  intro.className = "clarity-intro";
  intro.innerHTML = '<div><span class="clarity-label">ОБЗОР</span><h2>Проект в одном взгляде</h2><p>Состояние, ключевые показатели и действия. Остальные инструменты — в отдельных разделах выше.</p></div>';
  overview.append(intro);
  move(overview, "#project-overview");
  move(overview, ".project-command-bar");
  move(overview, ".project-monitor-toolbar");
  move(overview, ".project-monitor-diagnostics");
  move(overview, "#project-notification");
  move(overview, "#project-problems");
  const diagnostics = $(".project-diagnostic-history");
  if (diagnostics) {
    const details = document.createElement("details");
    details.className = "clarity-details";
    const summary = document.createElement("summary");
    summary.textContent = "Подробная история диагностики";
    details.append(summary, diagnostics);
    overview.append(details);
  }
  move(overview, ".project-quick-links");
  const analysis = document.createElement("section");
  analysis.className = "project-content-pane";
  analysis.dataset.projectPanel = "analysis";
  analysis.hidden = true;
  analysis.setAttribute("aria-label", "Анализ проекта");
  $("#project-updates").before(analysis);
  const analysisIntro = document.createElement("div");
  analysisIntro.className = "clarity-intro";
  analysisIntro.innerHTML = '<div><span class="clarity-label">АНАЛИЗ</span><h2>Диагностика и идеи развития</h2><p>Cloud.ru запускается только по вашей команде. Результаты анализов сохраняются в этом браузере.</p></div>';
  analysis.append(analysisIntro);
  move(analysis, ".project-ai-panel");
  move(analysis, ".project-review-history");
  // Tools for module cards should not clutter every other project view.
  const moduleOptions = document.createElement("div");
  moduleOptions.className = "project-module-options";
  $("#project-architecture .project-action-row").before(moduleOptions);
  controls.querySelectorAll("label").forEach(label => moduleOptions.append(label));
  project.classList.add("clarity-project");
  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  tablist.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const current = tabs.indexOf(document.activeElement);
    if (current < 0) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
      : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus();
    tabs[next].click();
  });
}

function compactSystem() {
  const versions = $("#view-system #component-versions");
  if (!versions) return;
  const card = versions.closest(".detail-card");
  if (card) {
    card.classList.add("clarity-system-components");
    const note = document.createElement("p");
    note.className = "clarity-subtle";
    note.textContent = "Технические версии компонентов. Используйте при диагностике или проверке обновлений.";
    card.querySelector("h2")?.after(note);
  }
}

function settingsCatalog() {
  const grid = $("#cloud-model-cards");
  if (!grid) return;
  const toolbar = document.createElement("div");
  toolbar.className = "clarity-catalog-tools";
  const search = document.createElement("input");
  search.type = "search";
  search.id = "clarity-model-search";
  search.placeholder = "Найти модель по названию или возможностям";
  search.setAttribute("aria-label", "Поиск моделей Cloud.ru");
  const count = document.createElement("span");
  count.setAttribute("role", "status");
  count.className = "clarity-catalog-count";
  const expand = document.createElement("button");
  expand.type = "button";
  expand.textContent = "Показать все";
  expand.className = "clarity-catalog-expand";
  toolbar.append(search, count, expand);
  grid.before(toolbar);
  let showAll = false;
  const filter = () => {
    const cards = [...grid.querySelectorAll(".cloud-model-card")];
    const query = search.value.toLocaleLowerCase("ru").trim();
    let matched = 0;
    cards.forEach(card => {
      const matches = card.textContent.toLocaleLowerCase("ru").includes(query);
      card.hidden = !matches || (!showAll && !query && matched >= 6);
      if (matches) matched++;
    });
    count.textContent = query ? `Найдено: ${matched}` : `Всего моделей: ${cards.length}`;
    expand.hidden = Boolean(query) || cards.length <= 6;
    expand.textContent = showAll ? "Показать меньше" : "Показать все";
  };
  search.addEventListener("input", filter);
  expand.addEventListener("click", () => { showAll = !showAll; filter(); });
  new MutationObserver(filter).observe(grid, {childList:true});
  filter();
}

export function initClarity() {
  navLayout();
  simplifyHome();
  projectSections();
  compactSystem();
  settingsCatalog();
}
