"""
Recorta só o lockup DECIDE a partir de um **screenshot** do dashboard (fundo escuro).

Procura conteúdo claro na zona superior central (exclui botões à direita).
Grava `public/images/logo-decide-principal.png` e copia o resultado para source.

Uso (na pasta frontend):
  python scripts/extract-logo-from-dashboard-screenshot.py [screenshot.png]

Sem argumento: `public/images/source/dashboard-header-screenshot.png` se existir.
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "images" / "logo-decide-principal.png"
SOURCE_DIR = ROOT / "public" / "images" / "source"


def find_screenshot() -> Path | None:
    if len(sys.argv) > 1 and sys.argv[1].strip():
        p = Path(sys.argv[1])
        return p if p.is_file() else None
    cand = SOURCE_DIR / "dashboard-header-screenshot.png"
    return cand if cand.is_file() else None


def extract_lockup_rgb(rgb: np.ndarray) -> np.ndarray:
    """Recorte RGB do lockup; fundo ~preto/gradiente escuro."""
    h, w = rgb.shape[:2]
    r = rgb[:, :, 0].astype(np.float32)
    g = rgb[:, :, 1].astype(np.float32)
    b = rgb[:, :, 2].astype(np.float32)
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    sat = np.where(mx < 1e-3, 0.0, (mx - mn) / (mx + 1e-6))

    # Zona típica do logo (topo, centro; evita botões muito à direita)
    y1 = min(h, int(h * 0.42))
    x0, x1 = int(w * 0.06), int(w * 0.78)

    fg = np.zeros((h, w), dtype=bool)
    sub_lum = lum[:y1, x0:x1]
    sub_sat = sat[:y1, x0:x1]
    # Conteúdo do logo: mais claro que o fundo ou ciano/azul saturado
    part = (sub_lum > 26.0) | (sub_sat > 0.12)
    fg[:y1, x0:x1] = part

    ys, xs = np.where(fg)
    if len(xs) < 80:
        # fallback mais permissivo
        fg = (lum > 22.0) | (sat > 0.08)
        fg[int(h * 0.45) :, :] = False
        ys, xs = np.where(fg)

    if len(xs) == 0:
        raise SystemExit("Não foi possível detetar o logo — ajusta o screenshot ou o ROI.")

    pad = 10
    y0, y2 = max(0, int(ys.min()) - pad), min(h, int(ys.max()) + 1 + pad)
    x0b, x1b = max(0, int(xs.min()) - pad), min(w, int(xs.max()) + 1 + pad)
    return rgb[y0:y2, x0b:x1b, :].astype(np.uint8)


def black_bg_to_rgba(rgb: np.ndarray) -> np.ndarray:
    f = rgb.astype(np.float32)
    dist = np.sqrt(np.sum(f**2, axis=2))
    alpha = np.clip((dist - 5.0) / 30.0 * 255.0, 0.0, 255.0).astype(np.uint8)
    return np.dstack([rgb.astype(np.uint8), alpha])


def trim(rgba: np.ndarray, thr: int = 8, pad: int = 2) -> np.ndarray:
    a = rgba[:, :, 3]
    ys, xs = np.where(a > thr)
    if len(xs) == 0:
        return rgba
    h, w = rgba.shape[:2]
    y0, y1 = max(0, int(ys.min()) - pad), min(h, int(ys.max()) + 1 + pad)
    x0, x1 = max(0, int(xs.min()) - pad), min(w, int(xs.max()) + 1 + pad)
    return rgba[y0:y1, x0:x1, :]


def main() -> None:
    src = find_screenshot()
    if src is None:
        print(
            "Passa o caminho do PNG ou guarda o screenshot como:\n"
            f"  {SOURCE_DIR / 'dashboard-header-screenshot.png'}",
            file=sys.stderr,
        )
        sys.exit(1)

    rgb = np.array(Image.open(src).convert("RGB"))
    crop = extract_lockup_rgb(rgb)
    rgba = black_bg_to_rgba(crop)
    rgba = trim(rgba)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba).save(OUT, optimize=True)
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(OUT, SOURCE_DIR / "logo-decide-principal-from-screenshot.png")

    print(f"OK {OUT.relative_to(ROOT)} {rgba.shape[1]}x{rgba.shape[0]} <- {src}")


if __name__ == "__main__":
    main()
