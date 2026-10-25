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
    article.append(title,desc,price,id);cards.append(article);
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
