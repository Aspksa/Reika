"""Local Cloud.ru Foundation Models settings. Never expose saved credentials via GET."""
import ctypes
import json
import os
from ctypes import wintypes
from pathlib import Path

CATALOG = [
 {"id":"openai/gpt-oss-120b","name":"GPT-OSS 120B","usage":"Рассуждения, задачи по коду, структурированные ответы","input":15.86,"output":61},
 {"id":"Qwen/Qwen3-Coder-Next","name":"Qwen3 Coder Next","usage":"Разработка, анализ кода, рефакторинг и тесты","input":122,"output":244},
 {"id":"deepseek-ai/DeepSeek-V4-Pro","name":"DeepSeek V4 Pro","usage":"Сложные рассуждения, программирование и анализ","input":183,"output":732},
 {"id":"moonshotai/Kimi-K2.6","name":"Kimi K2.6","usage":"Большой контекст, анализ документов и мультимодальные задачи","input":175.68,"output":725.9},
 {"id":"GigaChat/GigaChat-3-Pro","name":"GigaChat 3 Pro","usage":"Русскоязычные диалоги, тексты и аналитика","input":73.03,"output":176.39},
 {"id":"GigaChat/GigaChat-2-Max","name":"GigaChat 2 Max","usage":"Деловые тексты, диалог и ответы на вопросы","input":569.3374,"output":569.3374},
 {"id":"MiniMaxAI/MiniMax-M3","name":"MiniMax M3","usage":"Код, рассуждения и автоматизация задач","input":240.218,"output":1008.8546},
]
SOURCE = "https://cloud.ru/products/evolution-ai-factory/catalog-foundation-models"
ENDPOINT = "https://foundation-models.api.cloud.ru/v1/"


class _Blob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]


def _protect(data: bytes, decrypt=False) -> bytes:
    if os.name != "nt":
        raise RuntimeError("Защищённое сохранение ключа пока доступно только в Windows.")
    library = ctypes.windll.crypt32
    kernel = ctypes.windll.kernel32
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    data_buffer = ctypes.create_string_buffer(data)
    inp = _Blob(len(data), ctypes.cast(data_buffer, ctypes.POINTER(ctypes.c_byte)))
    out = _Blob()
    fn = library.CryptUnprotectData if decrypt else library.CryptProtectData
    if decrypt:
        ok = fn(ctypes.byref(inp), None, None, None, None, 1, ctypes.byref(out))
    else:
        ok = fn(ctypes.byref(inp), "Reika Cloud.ru", None, None, None, 1, ctypes.byref(out))
    if not ok:
        raise RuntimeError("Windows не смогла обработать защищённый ключ.")
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        kernel.LocalFree(out.pbData)


class CloudSettings:
    def __init__(self, root: Path):
        # Application data is outside the Git repository and cannot be committed accidentally.
        base = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "Reika"
        self.file = base / "cloud-settings.json"
        self.model = CATALOG[0]["id"]
        self._load()

    def _load(self):
        try:
            item = json.loads(self.file.read_text(encoding="utf-8"))
            if item.get("model") in {entry["id"] for entry in CATALOG}:
                self.model = item["model"]
        except (OSError, ValueError, TypeError):
            pass

    def _save(self, payload):
        self.file.parent.mkdir(parents=True, exist_ok=True)
        if os.name != "nt":
            raise RuntimeError("Для безопасного сохранения ключа требуется Windows.")
        from tempfile import NamedTemporaryFile
        with NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.file.parent, delete=False) as temp:
            json.dump(payload, temp, ensure_ascii=False)
            name = temp.name
        os.replace(name, self.file)

    def has_key(self):
        try:
            return bool(json.loads(self.file.read_text(encoding="utf-8")).get("secret"))
        except (OSError, ValueError, TypeError):
            return False

    def public(self):
        return {"configured": self.has_key(), "model": self.model,
                "models": CATALOG, "source": SOURCE, "endpoint": ENDPOINT,
                "price_unit": "₽ за 1 млн токенов, ориентировочно; проверьте тарифы Cloud.ru",
                "secure_storage": os.name == "nt"}

    def update(self, data):
        if not isinstance(data, dict):
            raise ValueError("Неверный формат настроек.")
        if set(data) - {"model", "key", "delete_key"}:
            raise ValueError("Недопустимые поля настроек.")
        model = data.get("model", self.model)
        if model not in {item["id"] for item in CATALOG}:
            raise ValueError("Модель отсутствует в проверенном каталоге.")
        old = {}
        try:
            old = json.loads(self.file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
        secret = old.get("secret")
        if data.get("delete_key") is True:
            secret = None
        elif "key" in data:
            key = data["key"]
            if not isinstance(key, str) or not 8 <= len(key) <= 512 or "\n" in key or "\r" in key:
                raise ValueError("Неверный формат ключа.")
            secret = _protect(key.encode("utf-8")).hex()
        self._save({"model": model, "secret": secret})
        self.model = model
        return self.public()
