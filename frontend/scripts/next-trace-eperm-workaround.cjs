/**
 * Next.js escreve métricas em `<distDir>/trace`. Em Windows, com OneDrive/antivírus em
 * `Documents`, `open()` pode falhar com EPERM e o WriteStream rebenta o processo (evento
 * `error` sem handler). Este preload regista um handler e evita o crash.
 *
 * Em `next dev`, pastas sincronizadas (OneDrive) podem fazer o servidor ficar em
 * "Starting..." sem chegar a "Ready" — Watchpack/Chokidar com polling contorna isso.
 *
 * Carregar com: node -r ./scripts/next-trace-eperm-workaround.cjs ... next dev
 */
"use strict";

const path = require("path");
const argv = process.argv;
const isNextDev =
  argv.includes("dev") && !argv.includes("build") && !argv.includes("start");

if (isNextDev) {
  if (!process.env.NEXT_TELEMETRY_DISABLED) process.env.NEXT_TELEMETRY_DISABLED = "1";
  if (process.platform === "win32") {
    if (!process.env.WATCHPACK_POLLING) process.env.WATCHPACK_POLLING = "true";
    if (!process.env.CHOKIDAR_USEPOLLING) process.env.CHOKIDAR_USEPOLLING = "true";
  }
}

const fs = require("fs");

/** Evita EPERM ao criar `.next/types/routes.d.ts` (OneDrive / antivírus em Documents). */
function ensureNextTypesDir() {
  const run =
    argv.includes("dev") || argv.includes("build") || argv.includes("start");
  if (!run) return;
  try {
    const root = process.cwd();
    fs.mkdirSync(path.join(root, ".next"), { recursive: true });
    fs.mkdirSync(path.join(root, ".next", "types"), { recursive: true });
  } catch (_) {
    /* ignorar — Next tenta na mesma */
  }
}
ensureNextTypesDir();

/**
 * Next 15 escreve sempre `.next/types/routes.d.ts` (e `validator.ts`, `link.d.ts` se `typedRoutes`).
 * OneDrive/antivírus bloqueiam `open()` → EPERM. Em dev, ignorar a escrita falhada evita rebentar o processo.
 */
function isNextGeneratedTypesPath(filePath) {
  const p = String(filePath).replace(/\\/g, "/");
  if (!p.includes("/.next/types/")) return false;
  return (
    p.endsWith("/routes.d.ts") ||
    p.endsWith("/link.d.ts") ||
    p.endsWith("/validator.ts")
  );
}

if (isNextDev) {
  const origWriteFile = fs.promises.writeFile;
  fs.promises.writeFile = async function (filePath, ...args) {
    try {
      return await origWriteFile.apply(fs.promises, [filePath, ...args]);
    } catch (err) {
      if (
        err &&
        (err.code === "EPERM" || err.code === "EACCES") &&
        isNextGeneratedTypesPath(filePath)
      ) {
        console.warn(
          "[decide-next-workaround] EPERM ao escrever tipos em .next/types (OneDrive/antivírus). O dev continua; `routes.d.ts` pode faltar."
        );
        return undefined;
      }
      throw err;
    }
  };

  const origWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = function (filePath, ...args) {
    try {
      return origWriteFileSync.apply(fs, [filePath, ...args]);
    } catch (err) {
      if (
        err &&
        (err.code === "EPERM" || err.code === "EACCES") &&
        isNextGeneratedTypesPath(filePath)
      ) {
        console.warn(
          "[decide-next-workaround] EPERM ao escrever tipos em .next/types (sync). Ignorado."
        );
        return undefined;
      }
      throw err;
    }
  };
}

const orig = fs.createWriteStream;
fs.createWriteStream = function (path, options) {
  const stream = orig.call(fs, path, options);
  stream.on("error", (err) => {
    if (!err) return;
    if (err.code !== "EPERM" && err.code !== "EACCES") return;
    const last = String(path).replace(/\\/g, "/").split("/").pop();
    if (last === "trace") {
      // Erro tratado — não propagar como excepção não apanhada
    }
  });
  return stream;
};
