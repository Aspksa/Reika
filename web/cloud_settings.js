const capabilities={
 "openai/gpt-oss-120b":["Помогает разбирать сложные вопросы по шагам и сравнивать варианты решения.","Пишет и объясняет код, составляет планы и структурированные ответы."],
 "Qwen/Qwen3-Coder-Next":["Работает с программным кодом: предлагает реализацию, рефакторинг и тесты.","Помогает читать большие фрагменты проекта и искать причины ошибок."],
 "deepseek-ai/DeepSeek-V4-Pro":["Подходит для задач, где нужно подробное рассуждение и анализ условий.","Помогает проектировать алгоритмы, писать код и проверять гипотезы."],
 "moonshotai/Kimi-K2.6":["Удобна для разбора длинных документов и сопоставления большого объёма сведений.","Подходит для задач с текстом и другими типами входных данных, если их поддерживает выбранный API."],
 "GigaChat/GigaChat-3-Pro":["Помогает писать, редактировать и кратко пересказывать тексты на русском языке.","Подходит для диалогов, аналитических записок и ответов на вопросы."],
 "GigaChat/GigaChat-2-Max":["Помогает составлять деловые письма, инструкции и развёрнутые ответы.","Подходит для русскоязычных диалогов и обработки текстовых запросов."],
 "MiniMaxAI/MiniMax-M3":["Помогает писать код и разбирать многошаговые задачи.","Подходит для подготовки сценариев автоматизации и структурированных инструкций."]
};
let ready=false;
const $=id=>document.getElementById(id);
function render(data){
  $("cloud-key-status").textContent=data.configured?"Ключ сохранён на этом компьютере":"Ключ ещё не сохранён";
  $("cloud-key").value="";
  const selector=$("cloud-model");selector.replaceChildren();
  const cards=$("cloud-model-cards");cards.replaceChildren();
  for(const model of data.models){
    const option=document.createElement("option");option.value=model.id;option.textContent=model.name;selector.append(option);
    const article=document.createElement("article");article.className="cloud-model-card";
    const title=document.createElement("h3");title.textContent=model.name;
    const desc=document.createElement("p");desc.textContent=model.usage;
    const price=document.createElement("p");price.className="cloud-price";
    price.textContent="Ввод: "+model.input+" ₽ / 1 млн · Вывод: "+model.output+" ₽ / 1 млн";
    const id=document.createElement("small");id.textContent=model.id;
    const details=document.createElement("ul");details.className="cloud-capabilities";
    for(const text of capabilities[model.id]||[]) {const li=document.createElement("li");li.textContent=text;details.append(li);}
    article.append(title,desc,details,price,id);cards.append(article);
  }
  selector.value=data.model;
  $("cloud-save").disabled=!data.secure_storage;
  $("cloud-delete").disabled=!data.secure_storage;
  $("cloud-message").textContent=data.secure_storage?"Ключ сохраняется в профиле Windows. Выбор не отправляет запросы к модели.":"Защищённое сохранение ключа на этой системе пока недоступно.";
}
export async function loadCloudSettings(){
  try{
    const response=await fetch("/api/project/cloud",{cache:"no-store"});
    if(!response.ok)throw Error("Не удалось получить каталог");
    render(await response.json());
  }catch(e){$("cloud-message").textContent=e.message;}
  if(ready)return;ready=true;
  $("cloud-refresh").onclick=loadCloudSettings;
  $("cloud-save").onclick=async()=>{const payload={model:$("cloud-model").value};if($("cloud-key").value)payload.key=$("cloud-key").value;await save(payload);};
  $("cloud-delete").onclick=async()=>{if(window.confirm("Удалить сохранённый API-ключ Cloud.ru?"))await save({delete_key:true,model:$("cloud-model").value});};
}
async function save(data){
  $("cloud-message").textContent="Сохранение…";
  try{
    const response=await fetch("/api/project/cloud",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
    const result=await response.json();
    if(!response.ok)throw Error(result.error||"Ошибка сохранения");
    render(result);$("cloud-message").textContent="Настройки сохранены.";
  }catch(e){$("cloud-message").textContent=e.message;}
}
