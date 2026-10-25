let busy = false;
let release = null;
let generation = 0;
const $ = (id) => document.getElementById(id);

export async function loadUpdates() {
  if (busy) return;
  busy = true;
  generation++;
  release = null;
  document.querySelector(".updates-hero").dataset.state = "loading";
  $("check-updates").disabled = true;
  $("update-file").disabled = true;
  $("update-file").value = "";
  $("verify-result").textContent = "";
  $("verify-result").dataset.state = "";
  $("update-download").hidden = true;
  $("update-download").removeAttribute("href");
  $("update-available").textContent = "—";
  $("update-notes").textContent = "";
  $("updates-message").textContent = "Проверяем официальный выпуск…";
  try {
    const response = await fetch("/api/updates", {cache: "no-store", signal: AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error();
    const data = await response.json();
    $("update-current").textContent = data.current;
    $("updates-checked").textContent = `Проверено: ${new Date(data.checked_at).toLocaleString("ru-RU")}. Повторный запрос к GitHub — не чаще раза в минуту.`;
    if (data.error) {
      document.querySelector(".updates-hero").dataset.state = "error";
      $("updates-message").textContent = data.error;
      $("update-notes").textContent = "Описание станет доступно после успешной проверки выпуска.";
      return;
    }
    release = data.release;
    document.querySelector(".updates-hero").dataset.state = release.newer ? "new" : "current";
    $("update-available").textContent = release.version;
    $("updates-message").textContent = release.newer ? "Доступна новая версия Reika." : release.version === data.current ? "Установлена актуальная версия." : "Ваша версия новее последнего опубликованного выпуска.";
    // Release text is untrusted: preserve the full Russian report as plain text.
    $("update-notes").textContent = release.notes;
    const archive = release.archive;
    if (archive) {
      $("update-download").href = archive.url;
      $("update-download").textContent = `Скачать ${archive.name}`;
      $("update-download").hidden = false;
    }
    $("update-file").disabled = !archive?.sha256;
    $("verify-result").textContent = archive?.sha256 ? "Выберите скачанный ZIP, чтобы сравнить размер и SHA-256 с данными официального выпуска." : "Проверка недоступна: у выпуска отсутствует архив или контрольная сумма SHA-256.";
  } catch {
    document.querySelector(".updates-hero").dataset.state = "error";
    $("updates-message").textContent = "Нет ответа от Reika. Проверьте соединение и повторите проверку.";
    $("update-notes").textContent = "Описание станет доступно после успешной проверки выпуска.";
  } finally {
    busy = false;
    $("check-updates").disabled = false;
  }
}

export async function verifyArchive(file) {
  const archive = release?.archive;
  const task = ++generation;
  if (!file || !archive?.sha256) return;
  const show = (message, state = "") => {
    if (task === generation) {
      $("verify-result").textContent = message;
      $("verify-result").dataset.state = state;
    }
  };
  if (file.size !== archive.size) { show("Проверка не пройдена: размер файла отличается от официального архива. Скачайте его заново.", "failed"); return; }
  if (file.size > 256 * 1024 * 1024) { show("Файл превышает лимит проверки в браузере: 256 МБ.", "failed"); return; }
  show("Вычисляем SHA-256…");
  try {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    const actual = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const valid = actual === archive.sha256;
    show(valid ? "Проверка пройдена: размер и SHA-256 совпадают с официальным архивом." : "Проверка не пройдена: SHA-256 не совпадает. Файл повреждён или изменён; скачайте его заново.", valid ? "passed" : "failed");
  } catch { show("Не удалось прочитать файл или вычислить SHA-256. Выберите файл повторно.", "failed"); }
}
