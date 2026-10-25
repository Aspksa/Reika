const $ = selector => document.querySelector(selector);
const types = {runtime: "Получает данные или запускает", build: "Использует при сборке", design: "Использует оформление", verification: "Проверяет", documentation: "Описывает"};
const statuses = {active: "Действующий", experimental: "Разрабатывается", deprecated: "Устаревает"};
const groups = {core:"Ядро",frontend:"Интерфейс",styles:"Интерфейс",launcher:"Запуск",tray:"Запуск",build:"Разработка",checks:"Разработка",docs:"Документация",config:"Разработка",release:"Обновления"};
let cached;
let projectTab = "modules";
let projectDensity = "comfortable";
let projectAudience = "user";
let projectLayout = "grid";
let projectMonitor = null;
let monitorTimer = null;
let projectBaseline = null;
let lastReport = "";
const icons={core:"◆",frontend:"◈",styles:"✦",launcher:"▷",tray:"◉",build:"⬡",checks:"✓",docs:"▤",config:"⚙",release:"↻"};
const categoryColor={Ядро:"core",Интерфейс:"frontend",Запуск:"launcher",Разработка:"build",Документация:"docs",Обновления:"release"};
function countRu(n,one,few,many){const v=Math.abs(n)%100,k=v%10;return n+" "+(v>=11&&v<=14?many:k===1?one:k>=2&&k<=4?few:many);}

export function normalize(value) { return String(value ?? "").toLocaleLowerCase("ru").trim(); }
export function category(id) { return groups[id] || "Другие модули"; }
export function moduleMatches(id,item,{query="",group="",status="",related=""}={}) {
  if (group && category(id)!==group) return false;
  if (status && item.status!==status) return false;
  const q=normalize(query);
  if(q && !normalize([id,item.name,item.description,...(item.paths||[])].join(" ")).includes(q)) return false;
  if(related && related!==id && !(item.dependencies||[]).some(link=>link.target===related)
     && !(cached?.modules?.[related]?.dependencies||[]).some(link=>link.target===id)) return false;
  return true;
}
export function releaseMatches(release,query="",kind="") {
  const changes=release.changes||[];
  if(kind && !changes.some(note=>note.kind===kind)) return false;
  const q=normalize(query);
  if(!q) return true;
  return normalize([release.version,release.previous,...changes.flatMap(note=>[note.title,note.description,note.userImpact,note.kind])].join(" ")).includes(q);
}
function element(tag,text,className) {
  const node=document.createElement(tag); if(text!==undefined)node.textContent=text; if(className)node.className=className;return node;
}
function changeCard(note) {
  const card=element("details",undefined,"change-entry");
  card.append(element("summary",note.title),element("p",note.description));
  if(projectAudience==="developer") card.append(element("h4","Затронутые модули"),element("p",Object.keys(note.components||{}).map(id=>cached?.modules[id]?.name||id).join(", ")));
  for(const [label,value] of [["Зачем",note.reason],["Для пользователя",note.userImpact]])card.append(element("h4",label),element("p",value));
  for(const [key,label] of [["testing","Проверки, описанные автором"],["risks","Ограничения и известные проблемы"],["migration","Переход на новую версию"]]){
    card.append(element("h4",label));const ul=element("ul");for(const text of note[key]||[])ul.append(element("li",text));card.append(ul);
  }
  return card;
}
function filters(){
 return {query:$("#module-search").value,group:$("#module-category").value,status:$("#module-status").value,related:$("#module-filter").value};
}
function renderModules(){
 const container=$("#project-modules");container.replaceChildren();
 const visible=Object.entries(cached.modules).filter(([id,item])=>moduleMatches(id,item,filters())).sort((a,b)=>category(a[0]).localeCompare(category(b[0]),"ru")||a[1].name.localeCompare(b[1].name,"ru"));
 $("#module-results").textContent=`Показано модулей: ${visible.length} из ${Object.keys(cached.modules).length}`;
 for(const [id,item] of visible){
   const incoming=Object.entries(cached.modules).filter(([,other])=>(other.dependencies||[]).some(link=>link.target===id));
   const card=element("article",undefined,"module-card");card.dataset.module=id;card.dataset.category=categoryColor[category(id)]||"misc";
   const heading=element("div",undefined,"module-heading");
   heading.append(element("span",icons[id]||"◇","module-icon"),element("h3",item.name)); if(projectAudience==="developer")heading.append(element("span",item.version,"outline-label"));
   card.append(heading);
   const meta=element("div",undefined,"module-meta");
   const health=projectMonitor?.module_health?.[id];
   const status=element("span",health==="problem"?"Проблема":health==="warning"?"Предупреждение":statuses[item.status]||item.status,"module-status");
   if(health)card.dataset.health=health;
   status.dataset.status=item.status;meta.append(status,element("span",category(id),"module-category-label"));card.append(meta,element("p",item.description));
   const details=element("details",undefined,"module-details");
   details.append(element("summary",projectAudience==="developer"?`Файлы и связи · ${countRu((item.paths||[]).length,"путь","пути","путей")} · ${countRu((item.dependencies||[]).length,"связь","связи","связей")}`:"Подробнее о модуле"));
   if(projectAudience==="developer")details.append(element("h4","Файлы и каталоги"));
   const paths=element("ul",undefined,"module-paths");
   (item.paths||[]).forEach(path=>paths.append(element("li",path)));if(projectAudience==="developer")details.append(paths);
   details.append(element("h4",projectAudience==="developer"?"Исходящие связи":"Использует"));
   const links=element("ul",undefined,"module-links");
   for(const link of item.dependencies||[]){
     const target=cached.modules[link.target];if(!target)continue;
     const row=element("li"),button=element("button",`${types[link.kind]||link.kind}: ${target.name}`);
     button.type="button";button.addEventListener("click",()=>{$("#module-filter").value=link.target;renderModules();});
     row.append(button,element("p",link.reason));
     if(link.propagate==="patch")row.append(element("small","Изменение этой зависимости повышает версию модуля."));
     links.append(row);
   }
   if(!links.children.length)links.append(element("li","Зарегистрированных зависимостей нет."));
   details.append(links);
   details.append(element("h4",projectAudience==="developer"?"Входящие связи":"От этого модуля зависят"),element("p",incoming.map(([,source])=>source.name).join(", ")||"Другие модули не зависят от него."));
   const counts=element("div",undefined,"module-counts");
   counts.append(element("span",`${(item.dependencies||[]).length} исходящих`),element("span",`${incoming.length} входящих`));
   counts.setAttribute("aria-label","Количество связей");
   card.append(counts,details);
   const open=element("button","Открыть модуль ↗","project-open-module");open.type="button";open.addEventListener("click",()=>openInspector(id));card.append(open);container.append(card);
 }
 if(!visible.length){const empty=element("div",undefined,"project-empty");empty.append(element("span","◇","project-empty-symbol"),element("h3","Ничего не найдено"),element("p","Попробуйте изменить запрос или сбросить фильтры."));container.append(empty);}
}
function renderHistory(){
 const history=$("#project-history");history.replaceChildren();
 const q=$("#history-search").value,kind=$("#history-kind").value;
 const pending=(cached.pending||[]).filter(note=>!kind||note.kind===kind).filter(note=>!normalize(q)||normalize([note.title,note.description,note.userImpact].join(" ")).includes(normalize(q)));
 const releases=(cached.history||[]).filter(item=>releaseMatches(item,q,kind));
 $("#history-results").textContent=`Показано выпусков: ${releases.length} · ожидают выпуска: ${pending.length}`;
 if(pending.length){const group=element("section",undefined,"release-card");group.append(element("h3","Готовится к следующему выпуску"));pending.forEach(note=>group.append(changeCard(note)));history.append(group);}
 for(const release of releases){
   const section=element("details",undefined,"release-card");
   section.append(element("summary",`✦ Reika ${release.version} · ${countRu((release.changes||[]).length,"изменение","изменения","изменений")}${release.date||release.created_at?" · "+new Date(release.date||release.created_at).toLocaleDateString("ru-RU"):""}`));
   if(projectAudience==="developer")section.append(element("p",`Предыдущая версия: ${release.previous}. Исходный коммит: ${String(release.source||"").slice(0,12)}.`,"muted"));
   const versions=element("ul");
   (release.components||[]).forEach(item=>versions.append(element("li",`${item.name}: ${item.from||"новый модуль"} → ${item.version}. ${item.reason}.`)));
   if(projectAudience==="developer")section.append(versions);
   (release.changes||[]).filter(note=>!kind||note.kind===kind).forEach(note=>{const change=changeCard(note);change.prepend(element("span",note.kind==="fix"?"Исправление":note.kind==="feature"?"Новое":note.kind==="design"?"Дизайн":"Изменение","project-change-tag"));section.append(change);});
   const files=element("details");files.append(element("summary",`Затронутые файлы: ${(release.files||[]).length}`));
   const ul=element("ul"),actions={added:"Добавлен",modified:"Изменён",deleted:"Удалён"};
   (release.files||[]).filter(item=>item?.path).forEach(item=>ul.append(element("li",`${actions[item.action]||"Учтён"}: ${item.path}`)));
   files.append(ul);if(projectAudience==="developer" && ul.children.length)section.append(files);history.append(section);
 }
 if(!pending.length&&!releases.length)history.append(element("p","По выбранным условиям обновлений нет.","project-empty"));
}

function showProjectTab(name) {
  projectTab=name;
  const pane=$("#project-inspector");
  if(name==="links")$(".project-map-workspace").append(pane);
  else $(".project-module-workspace").append(pane);
  document.querySelectorAll("[data-project-panel]").forEach(panel=>{panel.hidden=panel.dataset.projectPanel!==name;});
  document.querySelectorAll("[data-project-tab]").forEach(button=>{const active=button.dataset.projectTab===name;button.setAttribute("aria-selected",String(active));button.tabIndex=active?0:-1;});
}
function renderLinks() {
 const target=$("#project-links");target.replaceChildren();
 const selected=$("#project-link-filter").value;
 for(const [id,item] of Object.entries(cached.modules)){
   if(selected&&selected!==id)continue;
   const card=element("article",undefined,"project-link-card");
   card.append(element("h3",item.name));
   const links=item.dependencies||[];
   if(!links.length)card.append(element("p","Исходящих связей нет.","muted"));
   for(const link of links){const row=element("div",undefined,"project-link-row");row.append(element("span",types[link.kind]||link.kind),element("strong",cached.modules[link.target]?.name||link.target));
     if(projectAudience==="developer")row.append(element("small",link.reason));card.append(row);}
   target.append(card);
 }
}
function compareVersions(){
 const old=$("#compare-old").value,newer=$("#compare-new").value,out=$("#compare-result");out.replaceChildren();
 const versions=new Map((cached.history||[]).map(r=>[r.version,r]));
 for(const version of [old,newer]){
   const release=versions.get(version),card=element("article",undefined,"project-compare-card");
   card.append(element("h4",version?("Reika "+version):"Выберите версию"));
   if(release){
     const notes=release.changes||[];
     card.append(element("p",notes.length+" "+(notes.length===1?"изменение":notes.length>=2&&notes.length<=4?"изменения":"изменений")));
     for(const note of notes)card.append(element("p",projectAudience==="user"?(note.userImpact||note.title):note.title));
     if(projectAudience==="developer")card.append(element("small",(release.files||[]).filter(f=>f.path).length+" затронутых файлов"));
   }
   out.append(card);
 }
}
function initProjectControls(){
 document.querySelectorAll("[data-project-tab]").forEach(button=>button.onclick=()=>showProjectTab(button.dataset.projectTab));
 $("#project-density").onchange=event=>{projectDensity=event.target.value;$("#view-project").dataset.density=projectDensity;};
 $("#project-audience").onchange=event=>{projectAudience=event.target.value;$("#view-project").dataset.audience=projectAudience;renderModules();renderHistory();renderLinks();compareVersions();};
 const selector=$("#project-link-filter"),previous=selector.value;selector.replaceChildren(element("option","Все модули"));selector.firstChild.value="";
 for(const [id,item] of Object.entries(cached.modules)){const option=element("option",item.name);option.value=id;selector.append(option);}
 selector.value=cached.modules[previous]?previous:"";selector.onchange=renderLinks;
 const releases=cached.history||[];
 for(const [id,defaultIndex] of [["compare-old",1],["compare-new",0]]){
   const select=$("#"+id),current=select.value;select.replaceChildren();
   for(const release of releases){const option=element("option",release.version);option.value=release.version;select.append(option);}
   if(releases.length)select.value=releases.some(r=>r.version===current)?current:releases[Math.min(defaultIndex,releases.length-1)].version;
   select.onchange=compareVersions;
 }
 $("#view-project").dataset.density=projectDensity;$("#view-project").dataset.audience=projectAudience;
 showProjectTab(projectTab);renderLinks();compareVersions();renderMap();renderChronicle();
}

function stats(){
 const modules=Object.values(cached.modules);
 const links=modules.reduce((n,item)=>n+(item.dependencies||[]).length,0);
 const paths=new Set(modules.flatMap(item=>item.paths||[]));
 for(const [id,value] of [["project-count-modules",modules.length],["project-count-links",links],["project-count-paths",paths.size],["project-count-releases",(cached.history||[]).length]])$("#"+id).textContent=String(value);
}

function openInspector(id){
 const item=cached.modules[id],pane=$("#project-inspector");if(!item)return;
 pane.hidden=false;pane.replaceChildren();pane.dataset.category=categoryColor[category(id)]||"misc";
 const close=element("button","✕","project-inspector-close");close.type="button";close.setAttribute("aria-label","Закрыть панель");close.onclick=()=>{pane.hidden=true;($("#project-map .project-map-node[data-id='"+id+"']")||$("#project-modules [data-module='"+id+"'] .project-open-module"))?.focus();};
 pane.append(close,element("span",icons[id]||"◇","module-icon"),element("h3",item.name),element("p",item.description));
 pane.append(element("p","Версия "+item.version+" · "+(statuses[item.status]||item.status),"muted"));
 pane.append(element("h4","Файлы и каталоги"));
 const ul=element("ul",undefined,"module-paths");for(const path of item.paths||[])ul.append(element("li",path));pane.append(ul);
 pane.append(element("h4","Зависимости"));
 for(const link of item.dependencies||[]){const target=cached.modules[link.target];pane.append(element("p",(types[link.kind]||link.kind)+": "+(target?.name||link.target)+" — "+link.reason));}
 if(!(item.dependencies||[]).length)pane.append(element("p","Зависимости отсутствуют.","muted"));
 close.focus();
}
const SVG="http://www.w3.org/2000/svg";
function svgEl(tag,attrs){const node=document.createElementNS(SVG,tag);for(const [key,value] of Object.entries(attrs||{}))node.setAttribute(key,String(value));return node;}
let mapZoom=1,mapX=0,mapY=0,mapDragging=false,mapDragX=0,mapDragY=0;
function applyMapTransform(){const group=$("#project-map-scene");if(group)group.setAttribute("transform",`translate(${mapX} ${mapY}) scale(${mapZoom})`);const overview=$("#project-map-minimap");if(overview)overview.textContent="Мини-карта · "+Math.round(mapZoom*100)+"%";}
function renderMap(){
 const svg=$("#project-map");svg.replaceChildren();if(!cached)return;
 const names=Object.entries(cached.modules);const positions=new Map(names.map(([id],i)=>[id,{x:450+Math.cos(i*2*Math.PI/names.length-Math.PI/2)*310,y:265+Math.sin(i*2*Math.PI/names.length-Math.PI/2)*188}]));
 const defs=svgEl("defs");
 for(const [kind,color] of Object.entries({runtime:"#668bb1",build:"#bc9661",design:"#ac75a6",verification:"#6c9a7c",documentation:"#a5a07b"})){
 const marker=svgEl("marker",{id:"project-arrow-"+kind,viewBox:"0 0 10 10",refX:9,refY:5,markerWidth:6,markerHeight:6,orient:"auto-start-reverse"});
 marker.append(svgEl("path",{d:"M 0 0 L 10 5 L 0 10 z",fill:color}));defs.append(marker);}
 svg.append(defs);
 const scene=svgEl("g",{id:"project-map-scene"});svg.append(scene);
 const selected=$("#project-link-filter").value;
 let invalid=0;
 for(const [id,item] of names)for(const link of item.dependencies||[]){
 const from=positions.get(id),to=positions.get(link.target);if(!to){invalid++;continue;}
 const edge=svgEl("line",{class:projectMonitor?.events?.[0]?.changes?.some(change=>(change.modules||[]).includes(id))?"project-map-edge-changed":"",x1:from.x,y1:from.y,x2:to.x,y2:to.y,stroke:({runtime:"#668bb1",build:"#bc9661",design:"#ac75a6",verification:"#6c9a7c",documentation:"#a5a07b"}[link.kind]||"#888"),"stroke-width":selected&&(selected===id||selected===link.target)?3.2:1.7,"marker-end":"url(#project-arrow-"+( ["runtime","build","design","verification","documentation"].includes(link.kind)?link.kind:"build")+")",opacity:selected&&selected!==id&&selected!==link.target?.22:.85});
 scene.append(edge);
 }
 for(const [id,item] of names){
 const p=positions.get(id),g=svgEl("g",{class:"project-map-node",role:"button",tabindex:0,"aria-label":"Показать модуль "+item.name,"data-id":id,transform:`translate(${p.x} ${p.y})`});
 g.append(svgEl("circle",{r:29,fill:"var(--surface)",stroke:selected===id?"var(--accent)":"var(--gold)","stroke-width":selected===id?3:1.5}));
 const label=svgEl("text",{"text-anchor":"middle",y:45,fill:"var(--ink)","font-size":12});label.textContent=item.name;
 const symbol=svgEl("text",{"text-anchor":"middle",y:7,fill:"var(--accent)","font-size":24});symbol.textContent=icons[id]||"◇";
 g.append(symbol,label);if(projectMonitor?.events?.[0]?.changes?.some(change=>(change.modules||[]).includes(id)))g.classList.add("project-map-node-changed");g.addEventListener("click",()=>{$("#project-link-filter").value=id;renderLinks();renderMap();openInspector(id);});
 g.addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();g.dispatchEvent(new Event("click"));}});
 scene.append(g);
 }
 applyMapTransform();$("#project-map-warning").textContent=invalid?"Обнаружено отсутствующих связей: "+invalid:"Все зарегистрированные ссылки ведут к существующим модулям.";
}
function renderChronicle(){
 // Не создаём фиктивные данные: локальный журнал не входит в публичный API.
 $("#project-agent-events").textContent="События агентов не опубликованы в API. Локальный журнал: .chronicle/events.jsonl.";
 $("#project-bug-events").textContent="Журнал проблем доступен локально через Project Chronicle. Записи не загружены в API.";
 const roadmap=$("#project-roadmap");roadmap.replaceChildren();
 for(const note of cached.pending||[])roadmap.append(element("p",note.title));
 if(!roadmap.children.length)roadmap.textContent="Зарегистрированных ожидающих изменений нет.";
}
function initVisualControls(){
 const filters=$("#project-filter-fields"),toggle=$("#project-toggle-filters");
 toggle.onclick=()=>{filters.hidden=!filters.hidden;toggle.setAttribute("aria-expanded",String(!filters.hidden));};
 for(const btn of document.querySelectorAll("[data-project-layout]"))btn.onclick=()=>{
 projectLayout=btn.dataset.projectLayout;$("#view-project").dataset.layout=projectLayout;
 document.querySelectorAll("[data-project-layout]").forEach(b=>b.setAttribute("aria-pressed",String(b===btn)));
 };
 $("#project-link-filter").onchange=()=>{renderLinks();renderMap();};
 $("#project-map-zoom-in").onclick=()=>{mapZoom=Math.min(2.5,mapZoom+.2);applyMapTransform();};
 $("#project-map-zoom-out").onclick=()=>{mapZoom=Math.max(.5,mapZoom-.2);applyMapTransform();};
 $("#project-map-reset").onclick=()=>{mapZoom=1;mapX=mapY=0;applyMapTransform();};
 $("#project-map-fullscreen").onclick=()=>{$("#project-map-viewport").classList.toggle("project-map-expanded");};
 const viewport=$("#project-map-viewport");
 viewport.onpointerdown=e=>{if(e.target.closest(".project-map-node"))return;mapDragging=true;mapDragX=e.clientX;mapDragY=e.clientY;viewport.setPointerCapture(e.pointerId);};
 viewport.onpointermove=e=>{if(!mapDragging)return;const bounds=viewport.getBoundingClientRect();mapX+=(e.clientX-mapDragX)*900/bounds.width;mapY+=(e.clientY-mapDragY)*530/bounds.height;mapDragX=e.clientX;mapDragY=e.clientY;applyMapTransform();};
 viewport.onpointerup=()=>{mapDragging=false;};viewport.onpointercancel=()=>{mapDragging=false;};
 viewport.onkeydown=e=>{const d={ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]}[e.key];if(d){e.preventDefault();mapX+=d[0];mapY+=d[1];applyMapTransform();}};
}


function diagnosticItem(title,value,warning=false){
 const card=element("div",undefined,"project-monitor-item");if(warning)card.classList.add("warning");
 card.append(element("strong",title),element("span",String(value)));return card;
}
const reviewStore="reika.project.reviews";
const historyRead=()=>{try{const value=JSON.parse(localStorage.getItem(reviewStore)||"[]");return Array.isArray(value)?value:[];}catch{return [];}};
function historySave(value){try{localStorage.setItem(reviewStore,JSON.stringify(value.slice(0,8)));}catch{ /* Хранилище браузера может быть недоступно. */ }}
function renderReviewHistory(){
 const list=$("#project-review-list");list.replaceChildren();
 const records=historyRead();
 if(!records.length){list.append(element("p","Анализов пока нет.","muted"));return;}
 records.forEach(record=>{
  const card=element("details",undefined,"project-review-entry");
  const date=new Date(record.at);
  card.append(element("summary",`${Number.isNaN(date.getTime())?record.at:date.toLocaleString("ru-RU")} · ${record.model} · ${record.resolved?"исправлено":"требует проверки"}`));
  card.append(element("p",`Файлов: ${record.count}`),element("pre",record.answer));
  const button=element("button",record.resolved?"Вернуть в работу":"Отметить исправленным");button.type="button";
  button.onclick=()=>{const next=historyRead();const found=next.find(item=>item.id===record.id);if(found){found.resolved=!found.resolved;historySave(next);renderReviewHistory();}};
  card.append(button);list.append(card);
 });
}
function notifyProject(text){const box=$("#project-notification");box.textContent=text;box.hidden=false;}
function applyMonitor(data){
 const previous=projectMonitor;
 projectMonitor=data;
 if(previous){
  if($("#notify-problems").checked && (data.missing.length>previous.missing.length || data.invalid_links.length>previous.invalid_links.length || data.ambiguous.length>previous.ambiguous.length || (!previous.version_problem && data.version_problem)))notifyProject("Обнаружены новые проблемы проекта. Проверьте показатели ниже.");
  else if($("#notify-changes").checked && data.events?.[0]?.at && data.events[0].at!==previous.events?.[0]?.at)notifyProject("Обнаружены изменения файлов или модулей проекта.");
 }

 const diag=$("#project-monitor-diagnostics");diag.replaceChildren();
 diag.append(diagnosticItem("Проверено файлов",data.file_count),
 diagnosticItem("Отсутствуют пути",data.missing.length,data.missing.length>0),
 diagnosticItem("Ошибки связей",data.invalid_links.length,data.invalid_links.length>0),
 diagnosticItem("Предложенные модули",data.candidates.length),
 diagnosticItem("Неоднозначные владельцы",data.ambiguous.length,data.ambiguous.length>0));
 if(data.version_problem)diag.append(diagnosticItem("Согласованность сборки",data.version_problem,true));
 if(data.limit_reached)diag.append(diagnosticItem("Ограничение проверки","Сканирование ограничено, отчёт частичный",true));
 const problems=[];
 for(const item of data.missing)problems.push(`Отсутствует путь: ${item.path}`);
 for(const item of data.invalid_links)problems.push(`Ошибочная связь: ${item.source} → ${item.target}`);
 for(const item of data.ambiguous)problems.push(`Неоднозначный владелец: ${item}`);
 if(data.version_problem)problems.push(data.version_problem);
 if(data.limit_reached)problems.push("Проверка ограничена; часть файлов не просмотрена.");
 $("#project-problems-count").textContent=String(problems.length);
 const problemList=$("#project-problems-list");problemList.replaceChildren();
 if(!problems.length)problemList.append(element("p","Локальная проверка не выявила проблем."));
 else for(const message of problems.slice(0,10))problemList.append(element("p",message));
 const at=new Date(data.checked_at);
 $("#project-monitor-status").textContent="Последняя проверка: "+(Number.isNaN(at.getTime())?data.checked_at:at.toLocaleString("ru-RU"));
 const lines=["Состояние проекта Reika",$("#project-monitor-status").textContent,
 "Зарегистрировано файлов: "+data.file_count,
 "Пропавших путей: "+data.missing.length,
 "Некорректных связей: "+data.invalid_links.length,
 "Неоднозначных владельцев: "+data.ambiguous.length,
 "Кандидатов на регистрацию: "+data.candidates.join(", "),
 "Проблемы сборки: "+(data.version_problem||"нет")];
 lastReport=lines.join("\n");
 const feed=$("#project-roadmap");
 feed.replaceChildren();
 for(const path of data.candidates)feed.append(element("p","Кандидат на регистрацию: "+path));
 for(const entry of data.missing)feed.append(element("p","Найден отсутствующий путь: "+entry.path));
 for(const note of cached.pending||[])feed.append(element("p",note.title));
 if(!feed.children.length)feed.textContent="Новых предложений по результатам проверки нет.";
 renderModules();renderMap();
 if(projectBaseline){
   const before=new Set(projectBaseline),after=new Set(Object.keys(cached.modules));
   const added=[...after].filter(id=>!before.has(id)),removed=[...before].filter(id=>!after.has(id));
   $("#project-architecture-diff").textContent=added.length||removed.length?"Состав архитектуры изменился: добавлены "+added.join(", ")+"; удалены "+removed.join(", "):"Изменений состава модулей после последней загрузки нет.";
 }
 projectBaseline=Object.keys(cached.modules);
}
async function refreshProjectMonitor(){
 try{
 const response=await fetch("/api/project/monitor",{cache:"no-store"});
 if(!response.ok)throw Error("API monitor");
 applyMonitor(await response.json());
 }catch{$("#project-monitor-status").textContent="Мониторинг недоступен; повторите проверку";}
}
function scheduleMonitor(){
 if(monitorTimer)clearInterval(monitorTimer);monitorTimer=null;
 const ms=Number($("#project-monitor-interval").value);
 if(ms>=30000)monitorTimer=setInterval(async()=>{
   // Fetch fresh metadata, allowing new modules to appear automatically.
   if(!document.querySelector("#view-project:not([hidden])"))return;
   await loadProject(true);
 },ms);
}
function initMonitorControls(){
 $("#project-monitor-now").onclick=async()=>{await loadProject(true);};
 $("#project-monitor-interval").onchange=scheduleMonitor;
 $("#project-monitor-report").onclick=()=>{if(lastReport)navigator.clipboard?.writeText(lastReport).catch(()=>{});};
 scheduleMonitor();
}

export async function loadProject(force=false){
 if(cached&&!force)return;
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),3500);
 try{
   const response=await fetch("/api/project",{cache:"no-store",signal:controller.signal});if(!response.ok)throw new Error("API");
   cached=await response.json();
   stats();
   const filter=$("#module-filter"),old=filter.value;
   filter.replaceChildren(element("option","Все модули"));filter.firstChild.value="";
   Object.entries(cached.modules).forEach(([id,item])=>{const option=element("option",item.name);option.value=id;filter.append(option);});
   filter.value=old&&cached.modules[old]?old:"";
   for(const id of ["module-filter","module-search","module-category","module-status"])$("#"+id).oninput=renderModules;
   for(const id of ["history-search","history-kind"])$("#"+id).oninput=renderHistory;
   $("#reset-project-filters").onclick=()=>{for(const id of ["module-search","module-category","module-status","module-filter"])$("#"+id).value="";renderModules();$("#module-search").focus();};
   renderModules();renderHistory();initProjectControls();initVisualControls();initMonitorControls();await refreshProjectMonitor();$("#project-health-label").textContent="Реестр доступен";
   $("#project-message").textContent=`Зарегистрировано модулей: ${Object.keys(cached.modules).length}. Данные из реестра Reika.`;
 }catch{
   $("#project-health-label").textContent="Нет соединения";$("#project-message").textContent="Не удалось получить сведения о проекте. Проверьте соединение и повторите загрузку.";
 }finally{clearTimeout(timeout);}
}

const aiRun=document.querySelector("#project-ai-run");
aiRun.addEventListener("click",async()=>{
 const output=document.querySelector("#project-ai-result");
 aiRun.disabled=true;aiRun.setAttribute("aria-busy","true");
 const started=Date.now();output.textContent="Cloud.ru анализирует проект…";
 const progress=setInterval(()=>{output.textContent=`Cloud.ru анализирует проект… ${Math.floor((Date.now()-started)/1000)} с. Большой обзор может занять до 150 секунд.`;},1000);
 try{
  const response=await fetch("/api/project/ai-review",{method:"POST",headers:{"Origin":location.origin},credentials:"same-origin"});
  const data=await response.json();
  if(!response.ok)throw Error(data.error||"Анализ не выполнен.");
  output.replaceChildren();
  const summary=document.createElement("p");summary.textContent=`Модель: ${data.model}. Проверено файлов: ${data.files.length}${data.truncated?" (часть файлов не вошла в лимит)":""}.`;
  const answer=document.createElement("p");answer.className="project-ai-answer";answer.textContent=data.answer;
  output.append(summary,answer);
  const records=historyRead();records.unshift({id:crypto.randomUUID(),at:new Date().toISOString(),model:data.model,count:data.files.length,answer:data.answer,resolved:false});historySave(records);renderReviewHistory();
 }catch(error){output.textContent=error.message;}
 finally{clearInterval(progress);aiRun.disabled=false;aiRun.removeAttribute("aria-busy");}
});

for(const [id,key] of [["notify-problems","problems"],["notify-changes","changes"]]){
 const box=$("#"+id);try{box.checked=localStorage.getItem("reika.notify."+key)==="true";}catch{}
 box.addEventListener("change",()=>{try{localStorage.setItem("reika.notify."+key,String(box.checked));}catch{}});
}
renderReviewHistory();

$("#project-command-check").onclick=()=>{$("#project-monitor-now").click();$("#project-problems").scrollIntoView({behavior:"smooth",block:"start"});};
$("#project-command-ai").onclick=()=>{$("#project-ai-run").click();$("#project-ai-title").scrollIntoView({behavior:"smooth",block:"start"});};
$("#project-command-problems").onclick=()=>{$("#project-problems").scrollIntoView({behavior:"smooth",block:"start"});};

$("#project-open-map").onclick=()=>{showProjectTab("links");$("#project-map-viewport").scrollIntoView({behavior:"smooth",block:"center"});};
