"""
Remove o fundo azul escuro uniforme do logo e grava PNG RGBA em alta definição.

Algoritmo:
1) BFS a partir de todas as bordas: marca como fundo tudo o que é ligado ao exterior
   com cor semelhante à de referência (fundo da folha).
2) Buracos interiores (ex.: «e», «d») com a mesma cor de fundo: removidos por
   limiar de distância à cor de referência (não ligados ao exterior pelo passo 1).

Executar a partir da pasta frontend:  python scripts/process-decide-logo.py

Depois (branco #FFFFFF no «decide», espaço até «POWERED BY AI», dimensões finais):
  python scripts/refine-decide-logo.py
"""
from __future__ import annotations

from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "public" / "images" / "logo-decide.png"
OUT = ROOT / "public" / "images" / "logo-decide.png"

# Ligação ao fundo na BFS: vizinhos com cor próxima da referência.
CONNECT_T = 42
# Buracos interiores (ex.: counters de «e»): só cores muito próximas do fundo.
# Valores altos removiam sombras azuis escuras *dentro* do D (faixa horizontal falsa).
HOLE_MAX_DIST = 10


def _dist2(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    r1, g1, b1 = a
    r2, g2, b2 = b
    return float((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)


def main() -> None:
    im = Image.open(SRC).convert("RGBA")
    rgb = im.convert("RGB")
    px = rgb.load()
    w, h = rgb.size

    ref = px[0, 0]

    q: deque[tuple[int, int]] = deque()
    vis = [[False] * w for _ in range(h)]

    def try_seed(x: int, y: int) -> None:
        if 0 <= x < w and 0 <= y < h and not vis[y][x]:
            if _dist2(px[x, y], ref) < CONNECT_T**2:
                vis[y][x] = True
                q.append((x, y))

    for x in range(w):
        try_seed(x, 0)
        try_seed(x, h - 1)
    for y in range(1, h - 1):
        try_seed(0, y)
        try_seed(w - 1, y)

    while q:
        x, y = q.popleft()
        for dx, dy in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not vis[ny][nx]:
                if _dist2(px[nx, ny], ref) < CONNECT_T**2:
                    vis[ny][nx] = True
                    q.append((nx, ny))

    hole_t2 = HOLE_MAX_DIST**2
    out = Image.new("RGBA", (w, h))
    out_px = out.load()

    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            d2 = _dist2((r, g, b), ref)
            if vis[y][x] or (not vis[y][x] and d2 < hole_t2):
                out_px[x, y] = (r, g, b, 0)
            else:
                out_px[x, y] = (r, g, b, 255)

    bbox = out.getbbox()
    if bbox:
        out = out.crop(bbox)

    # PNG sem perdas; compress_level alto = ficheiro mais pequeno, mesma qualidade.
    out.save(OUT, format="PNG", compress_level=9)
    print(f"OK: {OUT} size={out.size} mode={out.mode}")


if __name__ == "__main__":
    main()
