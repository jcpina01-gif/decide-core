"""
Refina o PNG do logo após remoção de fundo:
- Exporta só a linha principal (ícone D + «decide»).
- Texto «decide» em #FFFFFF apenas na zona do wordmark (direita). O ícone D à esquerda
  NÃO é alterado — branquear o canvas inteiro estragava realces do D (faixa horizontal).

Opcional: coloca `public/images/logo-decide-master.png` (export original completo, ex. 933×256)
e este script gera `logo-decide.png` a partir dele. Se não existir, usa `logo-decide.png`
como entrada (deve ter altura ≥ 173px).

Requer: pip install pillow numpy

Se o D tiver uma «faixa» transparente horizontal (buraco do remove-fundo), antes:
  python scripts/repair-decide-logo-gap.py

Executar na pasta frontend:  python scripts/refine-decide-logo.py
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PATH_OUT = ROOT / "public" / "images" / "logo-decide.png"
PATH_MASTER = ROOT / "public" / "images" / "logo-decide-master.png"

# Linha principal no master típico 933×256 (ícone + «decide»; tagline abaixo não entra).
ROW_END_MAIN = 173
# Coluna onde começa a palavra «decide» (à direita do D) — igual a `build-decide-logo-mark.py`.
WORD_LEFT = 317


def whiten_decide_text(rgba: np.ndarray) -> np.ndarray:
    """Força #FFFFFF no «decide» (cinzentos / off-white), preservando ícones saturados."""
    arr = rgba.astype(np.float32).copy()
    r = arr[:, :, 0]
    g = arr[:, :, 1]
    b = arr[:, :, 2]
    a = arr[:, :, 3]

    avg = (r + g + b) / 3.0
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    chroma = mx - mn

    core = (a > 25) & (avg >= 232) & (chroma <= 22)
    edge = (a > 25) & (avg >= 205) & (avg < 232) & (chroma <= 28)

    arr[core, 0] = 255.0
    arr[core, 1] = 255.0
    arr[core, 2] = 255.0
    arr[edge, 0] = 255.0
    arr[edge, 1] = 255.0
    arr[edge, 2] = 255.0

    out = np.clip(arr, 0, 255).astype(np.uint8)
    # 2.ª passagem: restos de cinza no texto (avg alto, baixa croma — não azuis do D)
    arr2 = out.astype(np.float32)
    r2, g2, b2, a2 = arr2[:, :, 0], arr2[:, :, 1], arr2[:, :, 2], arr2[:, :, 3]
    avg2 = (r2 + g2 + b2) / 3.0
    mx2 = np.maximum(np.maximum(r2, g2), b2)
    mn2 = np.minimum(np.minimum(r2, g2), b2)
    chroma2 = mx2 - mn2
    rest = (a2 > 12) & (avg2 >= 168) & (chroma2 < 55)
    arr2[rest, 0] = 255.0
    arr2[rest, 1] = 255.0
    arr2[rest, 2] = 255.0
    return np.clip(arr2, 0, 255).astype(np.uint8)


def main() -> None:
    src = PATH_MASTER if PATH_MASTER.exists() else PATH_OUT
    if not src.exists():
        raise SystemExit(f"Ficheiro em falta: {PATH_OUT} (ou {PATH_MASTER})")

    im = Image.open(src).convert("RGBA")
    w, h = im.size
    arr = np.array(im)

    if h < ROW_END_MAIN:
        raise SystemExit(f"Altura insuficiente ({h}px): precisa de pelo menos {ROW_END_MAIN}px na linha principal.")

    main_block = arr[:ROW_END_MAIN, :, :].copy()
    if w <= WORD_LEFT:
        raise SystemExit(f"Largura insuficiente ({w}px) para WORD_LEFT={WORD_LEFT}")

    right = main_block[:, WORD_LEFT:, :].copy()
    right = whiten_decide_text(right)
    main_block[:, WORD_LEFT:, :] = right

    new_im = Image.fromarray(main_block)
    new_im.save(PATH_OUT, format="PNG", compress_level=9)
    used = "logo-decide-master.png" if src == PATH_MASTER else "logo-decide.png"
    print(f"OK: {PATH_OUT} size={new_im.size} (wordmark x>={WORD_LEFT} branqueado; D intacto; fonte={used})")


if __name__ == "__main__":
    main()
