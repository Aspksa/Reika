const $ = selector => document.querySelector(selector);
const types = {runtime: "Получает данные или запускает", build: "Использует при сборке", design: "Использует оформление", verification: "Проверяет", documentation: "Описывает"};
const statuses = {active: "Действующий", experimental: "Разрабатывается", deprecated: "Устаревает"};
const groups = {core:"Ядро",frontend:"Интерфейс",styles:"Интерфейс",launcher:"Запуск",tray:"Запуск",build:"Разработка",checks:"Разработка",docs:"Документация",config:"Разработка",release:"Обновления"};
let cached;

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
  card.append(element("h4","Затронутые модули"),element("p",Object.keys(note.components||{}).map(id=>cached?.modules[id]?.name||id).join(", ")));
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
   const card=element("article",undefined,"module-card");card.dataset.module=id;
   const heading=element("div",undefined,"module-heading");
   heading.append(element("h3",item.name),element("span",item.version,"outline-label"));
   card.append(heading);
   const meta=element("div",undefined,"module-meta");
   const status=element("span",statuses[item.status]||item.status,"module-status");
   status.dataset.status=item.status;meta.append(status,element("span",category(id),"module-category-label"));card.append(meta,element("p",item.description));
   const details=element("details",undefined,"module-details");
   details.append(element("summary",`Подробнее · ${(item.paths||[]).length} путей · ${(item.dependencies||[]).length} исходящих связей`));
   details.append(element("h4","Файлы и каталоги"));
   const paths=element("ul",undefined,"module-paths");
   (item.paths||[]).forEach(path=>paths.append(element("li",path)));details.append(paths);
   details.append(element("h4","Исходящие связи"));
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
   details.append(element("h4","Входящие связи"),element("p",incoming.map(([,source])=>source.name).join(", ")||"Нет зарегистрированных входящих связей."));
   card.append(details);container.append(card);
 }
 if(!visible.length)container.append(element("p","По выбранным условиям модули не найдены.","project-empty"));
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
   section.append(element("summary",`Reika ${release.version} · ${(release.changes||[]).length} изменений`));
   section.append(element("p",`Предыдущая версия: ${release.previous}. Исходный коммит: ${String(release.source||"").slice(0,12)}.`,"muted"));
   const versions=element("ul");
   (release.components||[]).forEach(item=>versions.append(element("li",`${item.name}: ${item.from||"новый модуль"} → ${item.version}. ${item.reason}.`)));
   section.append(versions);
   (release.changes||[]).filter(note=>!kind||note.kind===kind).forEach(note=>section.append(changeCard(note)));
   const files=element("details");files.append(element("summary",`Затронутые файлы: ${(release.files||[]).length}`));
   const ul=element("ul"),actions={added:"Добавлен",modified:"Изменён",deleted:"Удалён"};
   (release.files||[]).forEach(item=>ul.append(element("li",`${actions[item.action]||"Учтён"}: ${item.path}`)));
   files.append(ul);section.append(files);history.append(section);
 }
 if(!pending.length&&!releases.length)history.append(element("p","По выбранным условиям обновлений нет.","project-empty"));
}
function stats(){
 const modules=Object.values(cached.modules);
 const links=modules.reduce((n,item)=>n+(item.dependencies||[]).length,0);
 const paths=new Set(modules.flatMap(item=>item.paths||[]));
 for(const [id,value] of [["project-count-modules",modules.length],["project-count-links",links],["project-count-paths",paths.size],["project-count-releases",(cached.history||[]).length]])$("#"+id).textContent=String(value);
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
   renderModules();renderHistory();
   $("#project-message").textContent=`Зарегистрировано модулей: ${Object.keys(cached.modules).length}. Данные из реестра Reika.`;
 }catch{
   $("#project-message").textContent="Не удалось получить сведения о проекте. Проверьте соединение и повторите загрузку.";
 }finally{clearTimeout(timeout);}
}
