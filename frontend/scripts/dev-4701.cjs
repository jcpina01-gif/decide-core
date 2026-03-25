/**
 * Mata o que estiver à escuta na porta 4701 e arranca `next dev` (sem PowerShell aninhado).
 * Opcional: DECIDE_DEV_CLEAR_NEXT=1 apaga `.next` antes (corrige cache estragado).
 *
 * Uso: npm run dev:clean
 */
"use strict";

const { spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const root = path.join(__dirname, "..");
const port = String(process.env.DECIDE_DEV_PORT || "4701");

function killPortWindows(p) {
  try {
    const out = execSync("netstat -ano", { encoding: "utf8" });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes("LISTENING")) continue;
      if (!line.includes(`:${p}`) && !line.includes(`]:${p}`)) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (/^\d+$/.test(pid)) pids.add(pid);
    }
    for (const pid of pids) {
      console.log(`[dev-4701] A terminar PID ${pid} (porta ${p})...`);
      try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: "inherit" });
      } catch (_) {
        /* ignorar */
      }
    }
  } catch (_) {
    /* ignorar */
  }
}

if (process.platform === "win32") {
  killPortWindows(port);
}

/**
 * Apagar `.next` sem falhar no Windows quando `trace` (OneDrive/antivírus) está bloqueado.
 * `fs.rmSync` falha com EPERM em `lstat` desse ficheiro.
 */
function rmDirBestEffort(dir, depth = 0) {
  if (!fs.existsSync(dir)) return { ok: true, skipped: [] };
  const skipped = [];
  let names;
  try {
    // withFileTypes faz lstat por entrada; "trace" bloqueado rebenta antes do loop.
    names = fs.readdirSync(dir);
  } catch (e) {
    skipped.push({ path: dir, code: e.code });
    return { ok: false, skipped };
  }
  for (const name of names) {
    const p = path.join(dir, name);
    let st;
    try {
      st = fs.lstatSync(p);
    } catch (e) {
      skipped.push({ path: p, code: e.code });
      continue;
    }
    try {
      if (st.isDirectory()) {
        const sub = rmDirBestEffort(p, depth + 1);
        skipped.push(...sub.skipped);
        try {
          fs.rmdirSync(p);
        } catch (e) {
          skipped.push({ path: p, code: e.code });
        }
      } else {
        try {
          fs.unlinkSync(p);
        } catch (e) {
          skipped.push({ path: p, code: e.code });
        }
      }
    } catch (e) {
      skipped.push({ path: p, code: e.code || e.message });
    }
  }
  if (depth === 0) {
    try {
      fs.rmdirSync(dir);
    } catch (e) {
      skipped.push({ path: dir, code: e.code });
    }
  }
  return { ok: skipped.length === 0, skipped };
}

function clearNextCaches() {
  const dirs = [path.join(root, ".next")];
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    dirs.push(path.join(process.env.LOCALAPPDATA, "DecideFrontendNext", "next-cache"));
  }
  if (process.platform === "win32") {
    try {
      execSync("timeout /t 1 /nobreak >nul 2>&1", { stdio: "ignore" });
    } catch (_) {}
  }
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    console.log("[dev-4701] A limpar cache:", d);
    const { skipped } = rmDirBestEffort(d);
    if (skipped.length) {
      console.warn(
        "[dev-4701] Alguns ficheiros nao foram apagados (OneDrive/antivirus). O Next recria o resto.",
      );
      for (const s of skipped.slice(0, 8)) {
        console.warn(`  - ${s.code}: ${s.path}`);
      }
      if (skipped.length > 8) console.warn(`  ... e mais ${skipped.length - 8}`);
    } else {
      console.log("[dev-4701] Pasta apagada:", d);
    }
  }
}

if (process.env.DECIDE_DEV_CLEAR_NEXT === "1") {
  clearNextCaches();
}

if (!process.env.NEXT_TELEMETRY_DISABLED) process.env.NEXT_TELEMETRY_DISABLED = "1";
if (process.platform === "win32") {
  if (!process.env.WATCHPACK_POLLING) process.env.WATCHPACK_POLLING = "true";
  if (!process.env.CHOKIDAR_USEPOLLING) process.env.CHOKIDAR_USEPOLLING = "true";
}

const preload = path.join(__dirname, "next-trace-eperm-workaround.cjs");
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");

console.log(`[dev-4701] A arrancar Next em http://127.0.0.1:${port} — mantém esta janela aberta.`);

const child = spawn(
  process.execPath,
  ["-r", preload, nextBin, "dev", "-H", "127.0.0.1", "-p", port],
  { cwd: root, stdio: "inherit", env: process.env },
);

child.on("exit", (code) => process.exit(code ?? 0));
