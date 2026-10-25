import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./web", import.meta.url));

export default defineConfig(({ command }) => {
  let proxy = {};
  if (command === "serve") {
    let target;
    try {
      target = JSON.parse(readFileSync(new URL("./.runtime/instance.json", import.meta.url), "utf8")).url;
      if (typeof target !== "string" || !/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(target)) throw new Error();
    } catch {
      throw new Error("Сначала запустите Reika.bat или python run.py --no-browser --no-tray, затем npm run dev.");
    }
    proxy = {
      "^/api/(status|project(?:/.*)?)(?:\\?.*)?$": {
        target,
        changeOrigin: true,
        configure(server) {
          server.on("proxyReq", (request) => request.setHeader("Origin", target));
        },
      },
    };
  }
  return {
    root,
    publicDir: false,
    build: { outDir: "dist", emptyOutDir: true, assetsInlineLimit: 0, sourcemap: false },
    server: { host: "127.0.0.1", port: 5173, strictPort: false, cors: false, fs: { strict: true, allow: [root] }, proxy },
  };
});
