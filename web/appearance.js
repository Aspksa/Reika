const choices={accent:["gold","sakura","jade","violet","custom"],rounding:["sharp","normal","round"],scale:["small","normal","large"]};
const colors={gold:"#9b6b32",sakura:"#a64f72",jade:"#287965",violet:"#7456aa"};
const root=document.documentElement;
const read=(key,fallback)=>{try{return localStorage.getItem(`reika.appearance.${key}`)||fallback;}catch{return fallback;}};
const save=(key,value)=>{try{localStorage.setItem(`reika.appearance.${key}`,value);}catch{/* Настройки остаются в текущей вкладке. */}};
function apply(key,value){
 if(!choices[key].includes(value))return;
 root.dataset[key]=value;
 save(key,value);
 document.querySelectorAll(`[data-appearance-${key}]`).forEach(button=>button.setAttribute("aria-pressed",String(button.dataset[`appearance${key[0].toUpperCase()+key.slice(1)}`]===value)));
 if(key==="accent"){
   const hex=value==="custom"?read("custom","#93507a"):colors[value];
   root.style.setProperty("--chosen-accent",hex);
   root.style.setProperty("--chosen-accent-soft",`color-mix(in srgb, ${hex} 13%, var(--surface))`);
 }
}
export function initAppearance(){
 for(const key of Object.keys(choices))apply(key,read(key,key==="accent"?"sakura":"normal"));
 document.querySelectorAll("[data-settings-target]").forEach(button=>button.addEventListener("click",()=>document.getElementById(button.dataset.settingsTarget).scrollIntoView({behavior:"smooth"})));
 document.querySelectorAll("[data-appearance-theme]").forEach(button=>button.addEventListener("click",()=>window.dispatchEvent(new CustomEvent("reika:set-theme",{detail:button.dataset.appearanceTheme}))));
 syncTheme();
 const picker=document.getElementById("appearance-custom-color");
 picker.value=/^#[0-9a-f]{6}$/i.test(read("custom","#93507a"))?read("custom","#93507a"):"#93507a";
 for(const key of Object.keys(choices))document.querySelectorAll(`[data-appearance-${key}]`).forEach(button=>button.addEventListener("click",()=>{
   apply(key,button.dataset[`appearance${key[0].toUpperCase()+key.slice(1)}`]);
   if(key==="accent" && button.dataset.appearanceAccent==="custom")picker.click();
 }));
 picker.addEventListener("input",()=>{save("custom",picker.value);apply("accent","custom");});
}

export function syncTheme(){document.querySelectorAll("[data-appearance-theme]").forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.appearanceTheme===root.dataset.theme)));}
