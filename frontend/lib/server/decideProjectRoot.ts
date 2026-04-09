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
 */
export function resolveDecideProjectRoot(cwd: string = process.cwd()): string {
  const parent = path.resolve(cwd, "..");
  if (hasRepoRootMarkers(cwd)) return cwd;
  if (hasRepoRootMarkers(parent)) return parent;
  return parent;
}
