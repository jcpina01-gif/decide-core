import fs from "fs";
import path from "path";
import { FREEZE_PLAFONADO_MODEL_DIR } from "../freezePlafonadoDir";

/** Ficheiro característico do *freeze* CAP15 plafonado (Vercel pode pôr `freeze/` debaixo de `/var/task`). */
function hasPlafonadoFreezeAt(root: string): boolean {
  try {
    return fs.existsSync(
      path.join(root, "freeze", FREEZE_PLAFONADO_MODEL_DIR, "model_outputs", "model_equity_final_20y.csv"),
    );
  } catch {
    return false;
  }
}

function hasRepoRootMarkers(root: string): boolean {
  try {
    if (hasPlafonadoFreezeAt(root)) return true;
    return (
      fs.existsSync(path.join(root, "freeze")) || fs.existsSync(path.join(root, "backend", "data"))
    );
  } catch {
    return false;
  }
}

/**
 * Resolve o root do monorepo DECIDE para leitura de `freeze/`, `backend/data/`, `tmp_diag/`.
 * Em Vercel o `cwd` pode ser `frontend/` ou a raiz do repo; evita `..` incorrecto.
 *
 * `DECIDE_PROJECT_ROOT` (absoluto): força a pasta do repo canónico quando o Next corre noutro clone
 * (ex. `DECIDE_CORE22_CLONE`) mas os dados de freeze / tmp_diag estão em `decide-core`.
 */
function findRepoRootWalkingUp(startDir: string, maxHops: number): string | null {
  let cur = path.resolve(startDir);
  for (let hop = 0; hop < maxHops; hop += 1) {
    if (hasRepoRootMarkers(cur)) return cur;
    const up = path.resolve(cur, "..");
    if (up === cur) break;
    cur = up;
  }
  return null;
}

export function resolveDecideProjectRoot(cwd: string = process.cwd()): string {
  const env = (process.env.DECIDE_PROJECT_ROOT || "").trim();
  if (env) {
    const r = path.resolve(env);
    if (hasRepoRootMarkers(r)) return r;
  }
  const walked = findRepoRootWalkingUp(cwd, 8);
  if (walked) return walked;
  const parent = path.resolve(cwd, "..");
  if (hasRepoRootMarkers(cwd)) return cwd;
  if (hasRepoRootMarkers(parent)) return parent;
  return parent;
}

/**
 * Onde a app Next e `data/landing/...` vivem: `decide-core/frontend` no monorepo, ou
 * a raiz do *deploy* Vercel (`package.json` decide-frontend) quando o *build* traz tudo
 * nessa pasta (sem `frontend/` de nível intermédio).
 */
export function resolveNextFrontendAppDir(cwd: string = process.cwd()): string {
  const project = resolveDecideProjectRoot(cwd);
  const front = path.join(project, "frontend");
  if (fs.existsSync(path.join(front, "package.json"))) {
    return path.resolve(front);
  }
  return project;
}
