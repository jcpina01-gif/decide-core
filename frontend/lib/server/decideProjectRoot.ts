import fs from "fs";
import path from "path";

function hasRepoRootMarkers(root: string): boolean {
  try {
    return (
      fs.existsSync(path.join(root, "freeze")) ||
      fs.existsSync(path.join(root, "backend", "data"))
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
export function resolveDecideProjectRoot(cwd: string = process.cwd()): string {
  const env = (process.env.DECIDE_PROJECT_ROOT || "").trim();
  if (env) {
    const r = path.resolve(env);
    if (hasRepoRootMarkers(r)) return r;
  }
  const parent = path.resolve(cwd, "..");
  if (hasRepoRootMarkers(cwd)) return cwd;
  if (hasRepoRootMarkers(parent)) return parent;
  return parent;
}
