"""
Recorta margens escuras do lockup e grava `public/images/decide-logo-new.png`.

Origem por defeito: `public/images/imagem-final-logo-decide.png`
Substituir esse PNG pelo export oficial do branding antes de correr o script.

Uso (pasta frontend):  python scripts/trim-decide-logo.py
                        python scripts/trim-decide-logo.py entrada.png saida.png
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def trim_dark_margin(im: Image.Image) -> Image.Image:
    rgba = im.convert("RGBA")
    a = np.array(rgba)
    rgb = a[:, :, :3]
    alpha = a[:, :, 3]
    bright = rgb.max(axis=2) > 28
    content = bright | (alpha < 250)
    rows = np.any(content, axis=1)
    cols = np.any(content, axis=0)
    idx_r = np.where(rows)[0]
    idx_c = np.where(cols)[0]
    if len(idx_r) == 0 or len(idx_c) == 0:
        return rgba
    r0, r1 = int(idx_r[0]), int(idx_r[-1])
    c0, c1 = int(idx_c[0]), int(idx_c[-1])
    return rgba.crop((c0, r0, c1 + 1, r1 + 1))


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "public/images/imagem-final-logo-decide.png"
    dst = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "public/images/decide-logo-new.png"
    if not src.is_file():
        raise SystemExit(f"Ficheiro não encontrado: {src}")
    out = trim_dark_margin(Image.open(src))
    dst.parent.mkdir(parents=True, exist_ok=True)
    out.save(dst, optimize=True)
    print(f"OK: {dst.relative_to(ROOT)} size={out.size}")


if __name__ == "__main__":
    main()
