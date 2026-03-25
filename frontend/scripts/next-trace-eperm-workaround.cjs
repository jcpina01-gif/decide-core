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
