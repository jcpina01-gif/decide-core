"""
Preenche falhas verticais no ícone D (faixas transparentes «sandwich» entre pixels opacos
na mesma coluna) — típico de `process-decide-logo.py` a remover sombras interiores como «buraco».

Não toca na zona do wordmark (x >= 300 por defeito).

Executar na pasta frontend:  python scripts/repair-decide-logo-gap.py
Requer: numpy pillow
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "public" / "images" / "logo-decide.png"
# Só colunas da zona do D / ícone (à esquerda de «decide»)
ICON_X_MAX = 300
ALPHA_IN = 40
ALPHA_OUT = 220


def repair_column(rgb: np.ndarray, a: np.ndarray, x: int) -> None:
    h = rgb.shape[0]
    y = 0
    while y < h:
        if a[y, x] >= ALPHA_OUT:
            y += 1
            continue
        if a[y, x] > ALPHA_IN:
            y += 1
            continue
        y0 = y
        while y < h and a[y, x] < ALPHA_IN:
            y += 1
        y1 = y - 1
        if y0 == 0 or y1 >= h - 1:
            continue
        if a[y0 - 1, x] < ALPHA_OUT or a[y1 + 1, x] < ALPHA_OUT:
            continue
        c0 = rgb[y0 - 1, x].astype(np.float32)
        c1 = rgb[y1 + 1, x].astype(np.float32)
        denom = float((y1 + 1) - (y0 - 1))
        if denom < 1:
            continue
        for yi in range(y0, y1 + 1):
            t = (yi - (y0 - 1)) / denom
            rgb[yi, x] = (1.0 - t) * c0 + t * c1
            a[yi, x] = 255.0


def main() -> None:
    im = Image.open(PATH).convert("RGBA")
    arr = np.array(im)
    rgb = arr[:, :, :3].astype(np.float32)
    a = arr[:, :, 3].astype(np.float32)
    w = im.size[0]
    for x in range(min(ICON_X_MAX, w)):
        repair_column(rgb, a, x)
    out = np.clip(np.round(np.dstack([rgb, a])), 0, 255).astype(np.uint8)
    Image.fromarray(out).save(PATH, format="PNG", compress_level=9)
    print(f"OK: {PATH} reparado (interpolação vertical na zona x < {ICON_X_MAX})")


if __name__ == "__main__":
    main()
