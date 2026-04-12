/**
 * Arranca o servidor Flask de KPIs (`kpi_server.py` na raiz do repo), porta 5000 por defeito.
 * Chamado por `npm run kpi` no `backend/package.json` ou pela raiz do repo.
 *
 * Python: `KPI_PYTHON` / `PYTHON`, senão `backend/.venv`, senão `py -3` (Win) ou `python`.
 *
 * Rede local (telefone / outro PC a abrir o Next pelo IP): `DECIDE_KPI_LAN=1 npm run kpi`
 * (define `KPI_BIND_HOST=0.0.0.0` para o Flask aceitar ligações na LAN).
 *
 * Antes de fazer bind, pede `GET /api/health` em 127.0.0.1:PORT — se a porta estiver ocupada por
 * algo que não é o Decide KPI actual (sem `build` / `X-Decide-Kpi-Build`), aborta com mensagem clara.
 */
"use strict";

const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn, execSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..", "..");
const kpiPy = path.join(repoRoot, "kpi_server.py");

/** Alinhado com `KPI_FLASK_BUILD_MIN_TOKEN` no frontend (substring dentro do tag). */
const MIN_BUILD_SUBSTRING =
  String(process.env.DECIDE_KPI_MIN_BUILD_SUBSTRING || "embed-diag-canon-v13").trim() || "embed-diag-canon-v13";

function pickPythonExe() {
  const fromEnv = (process.env.KPI_PYTHON || process.env.PYTHON || "").trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const winVenv = path.join(repoRoot, "backend", ".venv", "Scripts", "python.exe");
  if (process.platform === "win32" && fs.existsSync(winVenv)) return winVenv;

  const nixVenv = path.join(repoRoot, "backend", ".venv", "bin", "python3");
  if (fs.existsSync(nixVenv)) return nixVenv;
  const nixVenvPy = path.join(repoRoot, "backend", ".venv", "bin", "python");
  if (fs.existsSync(nixVenvPy)) return nixVenvPy;

  return process.platform === "win32" ? "py" : "python";
}

function printNetstatHint(port) {
  if (process.platform !== "win32") return;
  try {
    const o = execSync(`netstat -ano | findstr :${port}`, { encoding: "utf8", maxBuffer: 64 * 1024 });
    const lines = o.split(/\r?\n/).filter(Boolean).slice(0, 8);
    if (lines.length) {
      console.error("[kpi] Quem escuta a porta (netstat — coluna PID à direita):");
      for (const ln of lines) console.error(`  ${ln}`);
      console.error("[kpi] No Gestor de tarefas → Detalhes → termina o PID acima, ou: Stop-Process -Id <PID>");
    }
  } catch {
    /* ignorar */
  }
}

/**
 * @returns {Promise<"spawn"|"already"|"bad_occupant"|"old_decide">}
 */
function probeExistingKpi(port) {
  return new Promise((resolve) => {
    const req = http.get(
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/health",
        timeout: 3000,
        headers: { Accept: "application/json" },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          const hdr = String(res.headers["x-decide-kpi-build"] || "").trim();
          const m = body.match(/"build"\s*:\s*"([^"]*)"/);
          const build = hdr || (m ? m[1].trim() : "");
          if (res.statusCode !== 200) {
            resolve("spawn");
            return;
          }
          if (!build) {
            resolve("bad_occupant");
            return;
          }
          if (!build.includes("decide-kpi")) {
            resolve("bad_occupant");
            return;
          }
          if (MIN_BUILD_SUBSTRING && !build.includes(MIN_BUILD_SUBSTRING)) {
            resolve("old_decide");
            return;
          }
          resolve("already");
        });
      },
    );
    req.on("error", () => resolve("spawn"));
    req.on("timeout", () => {
      req.destroy();
      resolve("spawn");
    });
  });
}

function doSpawn(py, args, env, bind, port) {
  console.log(`[kpi] Repo: ${repoRoot}`);
  console.log(`[kpi] Python: ${py}`);
  console.log(`[kpi] Escuta ${bind}:${port} (PORT, KPI_BIND_HOST; LAN: DECIDE_KPI_LAN=1)\n`);

  const child = spawn(py, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env,
    windowsHide: false,
  });

  child.on("error", (err) => {
    console.error("[kpi] Falha ao arrancar Python:", err.message);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code == null ? 1 : code);
  });
}

async function main() {
  if (!fs.existsSync(kpiPy)) {
    console.error(`[kpi] Não encontrei kpi_server.py em:\n  ${kpiPy}`);
    console.error("[kpi] Corra este comando a partir do repositório decide-core (com kpi_server.py na raiz).");
    process.exit(1);
  }

  const py = pickPythonExe();
  const base = path.basename(py).toLowerCase();
  const usePyLauncher = base === "py" || base === "py.exe";
  const args = usePyLauncher ? ["-3", kpiPy] : [kpiPy];

  const port = Number(process.env.PORT || "5000") || 5000;
  const env = { ...process.env };
  if (!env.KPI_BIND_HOST && String(env.DECIDE_KPI_LAN || "").trim() === "1") {
    env.KPI_BIND_HOST = "0.0.0.0";
  }
  const bind = env.KPI_BIND_HOST || "127.0.0.1";

  const probe = await probeExistingKpi(port);
  if (probe === "already") {
    console.log(
      `[kpi] 127.0.0.1:${port} já tem Decide KPI com build ≥ ${MIN_BUILD_SUBSTRING}. Nada a arrancar.`,
    );
    console.log("[kpi] Para recarregar código novo, para esse processo e volta a correr npm run kpi.");
    process.exit(0);
  }
  if (probe === "bad_occupant") {
    console.error(`[kpi] ERRO: 127.0.0.1:${port} responde a /api/health com 200 mas sem build Decide (campo JSON + header).`);
    console.error("[kpi] É outro serviço ou um kpi_server muito antigo. Liberta a porta antes de arrancar o Decide KPI.");
    printNetstatHint(port);
    process.exit(1);
  }
  if (probe === "old_decide") {
    console.error(`[kpi] ERRO: na porta ${port} está um Decide KPI antigo (build sem ${MIN_BUILD_SUBSTRING}).`);
    console.error("[kpi] Para o processo e corre npm run kpi de novo a partir deste repo.");
    printNetstatHint(port);
    process.exit(1);
  }

  doSpawn(py, args, env, bind, port);
}

main().catch((e) => {
  console.error("[kpi]", e);
  process.exit(1);
});
