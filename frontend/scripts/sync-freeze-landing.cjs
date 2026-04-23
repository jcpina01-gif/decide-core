/**
 * Espelha `freeze/DECIDE_MODEL_V5_V2_3_SMOOTH/model_outputs/*.{csv,json}` para
 * `frontend/data/landing/freeze-cap15/` (igual ao Passo 2.5 do `run_daily_freeze_update.ps1`).
 *
 * Uso (na raiz do monorepo):
 *   node frontend/scripts/sync-freeze-landing.cjs
 *
 * Fecha o `next dev` antes, se tiveres "Acesso negado" no Windows (ficheiro aberto / OneDrive).
 */
"use strict";

const fs = require("fs");
const path = require("path");

const FREEZE_DIR = "DECIDE_MODEL_V5_V2_3_SMOOTH";

function main() {
  const here = __dirname;
  const frontend = path.resolve(here, "..");
  const monorepo = path.resolve(frontend, "..");
  const mout = path.join(monorepo, "freeze", FREEZE_DIR, "model_outputs");
  const land = path.join(frontend, "data", "landing", "freeze-cap15");

  if (!fs.existsSync(mout)) {
    console.error("[sync-freeze-landing] Não existe:", mout);
    process.exit(1);
  }
  if (!fs.existsSync(land)) {
    fs.mkdirSync(land, { recursive: true });
  }

  const names = fs.readdirSync(mout, { withFileTypes: true });
  let n = 0;
  for (const d of names) {
    if (!d.isFile()) continue;
    const ext = path.extname(d.name).toLowerCase();
    if (ext !== ".csv" && ext !== ".json") continue;
    const from = path.join(mout, d.name);
    const to = path.join(land, d.name);
    fs.copyFileSync(from, to);
    n += 1;
  }
  console.log(`[sync-freeze-landing] Copiados ${n} ficheiros para ${land}`);

  const bench = path.join(land, "benchmark_equity_final_20y.csv");
  if (fs.existsSync(bench)) {
    const raw = fs.readFileSync(bench, "utf8");
    const lines = raw.replace(/\r/g, "").split("\n").filter((l) => l.trim().length > 0);
    if (lines.length > 1) {
      const last = lines[lines.length - 1].split(",")[0];
      console.log(`[sync-freeze-landing] Última data em benchmark: ${String(last).trim()}`);
    }
  }
}

main();
