"""
Gera `public/images/logo-decide-mark.png` (ícone D + «decide») a partir de `logo-decide.png`
(linha principal já refinada: «decide» em #FFFFFF na zona do wordmark).

Fluxo típico (assets estáticos; não usados na UI atual):
  python scripts/refine-decide-logo.py && python scripts/build-decide-logo-mark.py

Executar na pasta frontend:  python scripts/build-decide-logo-mark.py
Requer: pillow numpy (e `public/images/logo-decide.png`).
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "public" / "images" / "logo-decide.png"
OUT = ROOT / "public" / "images" / "logo-decide-mark.png"

# Cortes calibrados no asset 933×256 (refine-decide-logo)
ROW_MAIN = 173
ICON_RIGHT = 262  # coluna exclusiva: [0, ICON_RIGHT) ≈ ícone D
WORD_LEFT = 317  # coluna inclusiva onde começa «decide»
ICON_SCALE = 1.0  # D no tamanho original do recorte (sem encolher)
GAP_ICON_WORD = 14
TOP_SAFE_PX = 0


def main() -> None:
    im = Image.open(SRC).convert("RGBA")
    w, h = im.size
    if h < ROW_MAIN:
        raise SystemExit(f"Altura inesperada: {h}")

    top = im.crop((0, 0, w, ROW_MAIN))
    tw, th = top.size
    icon = top.crop((0, 0, min(ICON_RIGHT, tw), th))
    word = top.crop((min(WORD_LEFT, tw - 1), 0, tw, th))

    iw, ih = icon.size
    nw, nh = max(1, int(iw * ICON_SCALE)), max(1, int(ih * ICON_SCALE))
    icon_s = icon.resize((nw, nh), Image.Resampling.LANCZOS)

    out_w = icon_s.size[0] + GAP_ICON_WORD + word.size[0]
    # Alinhar ao topo no bloco; depois deslocar tudo para baixo com margem TOP_SAFE_PX.
    block_h = max(th, icon_s.size[1], word.size[1])
    out_h = block_h + TOP_SAFE_PX
    canvas = Image.new("RGBA", (out_w, out_h), (0, 0, 0, 0))
    y0 = TOP_SAFE_PX
    canvas.paste(icon_s, (0, y0), icon_s)
    canvas.paste(word, (icon_s.size[0] + GAP_ICON_WORD, y0), word)

    canvas.save(OUT, format="PNG", compress_level=9)
    print(f"OK: {OUT} size={canvas.size} (D scale={ICON_SCALE})")


if __name__ == "__main__":
    main()
