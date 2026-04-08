"""
Gera `public/images/logo-decide-2.png`.

Ordem de preferencia (primeiro que exista e seja valido):
1. **`logo Decide 2.png`** em `%USERPROFILE%\\Imagens` ou `Pictures`, ou em `public/images/source/`
   (folha de marca escura ~1536×1024 → coluna compacta + wordmark #FFF).
2. **`Logo decide 3.png`** na mesma logica (folha branca → bbox + wordmark #FFF).
3. PNG **RGBA** com transparencia real — **só trim**.
4. **Export** largo — fundo cinzento -> alpha (S+V).

Uso:
  python scripts/build-logo-decide-2-asset.py [caminho.png]
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "images" / "logo-decide-2.png"
SOURCE_DIR = ROOT / "public" / "images" / "source"

BG_SHEET = np.array([1.0, 4.0, 13.0], dtype=np.float32)
BG_WHITE = np.array([252.0, 253.0, 253.0], dtype=np.float32)


def rgba_remove_bg_sheet(rgb: np.ndarray) -> np.ndarray:
    f = rgb.astype(np.float32)
    dist = np.sqrt(np.sum((f - BG_SHEET) ** 2, axis=2))
    alpha = np.clip((dist - 12.0) / 30.0 * 255.0, 0.0, 255.0).astype(np.uint8)
    return np.dstack([rgb, alpha])


def rgba_remove_bg_white(rgb: np.ndarray) -> np.ndarray:
    """Folha com fundo branco (~Logo decide 3.png)."""
    f = rgb.astype(np.float32)
    dist = np.sqrt(np.sum((f - BG_WHITE) ** 2, axis=2))
    alpha = np.clip((dist - 10.0) / 22.0 * 255.0, 0.0, 255.0).astype(np.uint8)
    return np.dstack([rgb, alpha])


def decide_wordmark_y_bounds(rgba: np.ndarray) -> tuple[int, int]:
    """
    Linhas [y0, y1) do wordmark «decide» (exclui «POWERED BY AI»).
    Coluna à direita do D (x >= ~34% W).

    - Folha **branca** (Logo decide 3): salto forte na média de alpha entre
      a última linha do «decide» e a faixa do tagline.
    - Folha **escura** (logo Decide 2, coluna compacta): esse salto nem sempre
      existe; usa-se fallback — tagline ciano tem saturação e (B−R) muito
      maiores que o «decide» gravado/cinza.
    """
    h, w = rgba.shape[:2]
    x0 = max(0, int(w * 0.34))
    sub = rgba[:, x0:, :]
    r = sub[:, :, 0].astype(np.float64)
    g = sub[:, :, 1].astype(np.float64)
    b = sub[:, :, 2].astype(np.float64)
    a = sub[:, :, 3].astype(np.float64)
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    sat = np.where(mx < 1e-6, 0.0, (mx - mn) / (mx + 1e-6))
    row_m = np.mean(a, axis=1).astype(np.float64)
    row_sat = np.zeros(h, dtype=np.float64)
    row_br = np.zeros(h, dtype=np.float64)
    for y in range(h):
        m = a[y, :] > 35.0
        if np.any(m):
            row_sat[y] = float(np.mean(sat[y, :][m]))
            row_br[y] = float(np.mean((b[y, :] - r[y, :])[m]))

    y_min = max(0, int(h * 0.12))
    y_start = 0
    for y in range(h):
        if row_m[y] > 42.0:
            y_start = y
            break
    y_start = max(y_start, y_min)

    y_scan_min = max(4, int(h * 0.18))
    y_split = h
    y_scan_max = h - max(14, int(h * 0.06))
    for y in range(y_scan_min, min(h - 1, y_scan_max + 1)):
        jump = float(row_m[y] - row_m[y - 1])
        if float(row_m[y]) >= 115.0 and jump >= 22.0:
            y_split = y
            break

    if y_split >= h - 3:
        y_start2 = 0
        for y in range(y_scan_min, h):
            if row_m[y] > 38.0 and row_sat[y] < 0.42:
                y_start2 = y
                break
        if y_start2 > 0:
            y_start = y_start2
        # «POWERED BY AI» vem *abaixo* do «decide»; o D na mesma coluna tem ciano
        # alto *antes* do wordmark — por isso y >> y_start e B−R forte no tagline.
        y_word = y_start + 22
        for y in range(y_word, h):
            if row_sat[y] > 0.58 and row_br[y] > 130.0:
                y_split = y
                break

    return y_start, y_split


def wordmark_lighten_for_dark_ui(rgba: np.ndarray) -> np.ndarray:
    """
    Wordmark «decide» (textura escura) -> #FFFFFF sólido no header.
    Inclui anti-aliasing (alpha baixo): sobre fundo #09090b, RGB ~245 com alpha ~25
    compõe-se escuro; por isso forçamos RGB e alpha a 255 nos pixéis da palavra.
    """
    out = rgba.copy()
    h, w = out.shape[:2]
    y0, y1 = decide_wordmark_y_bounds(rgba)
    x_min = int(w * 0.34)
    if y1 <= y0 or x_min >= w - 2:
        return out
    sub = out[y0:y1, x_min:w, :]
    # Limiar baixo: bordas do texto gravado ficam com alpha << 40
    ink = sub[:, :, 3] > 6
    sub[ink, 0] = 255
    sub[ink, 1] = 255
    sub[ink, 2] = 255
    sub[ink, 3] = 255
    return out


def rgba_remove_bg_export(rgb: np.ndarray) -> np.ndarray:
    f = rgb.astype(np.float32) / 255.0
    mx = np.max(f, axis=2)
    mn = np.min(f, axis=2)
    s = np.where(mx < 1e-5, 0.0, (mx - mn) / (mx + 1e-6))
    v = mx
    t = np.maximum(
        np.clip((v - 0.30) / 0.14, 0.0, 1.0),
        np.clip((s - 0.12) / 0.12, 0.0, 1.0),
    )
    alpha = (t * 255.0).astype(np.uint8)
    return np.dstack([rgb, alpha])


def trim_rgba_remove_bottom_caption_strip(rgba: np.ndarray) -> np.ndarray:
    """
    Remove faixa inferior estreita (ex.: «Version for dark backgrounds») no lockup
    de folha de marca: linhas com cobertura opaca << largura da imagem.
    """
    a = rgba[:, :, 3]
    h, w = a.shape
    if h < 80 or w < 80:
        return rgba
    frac = np.array([float(np.sum(a[y, :] > 50)) / w for y in range(h)])
    row_m = np.array([float(np.mean(a[y, :])) for y in range(h)])
    for y in range(int(h * 0.18), h - 3):
        # Legenda so no fundo do lockup (evita gaps verticais internos D / texto)
        if y < int(h * 0.72):
            continue
        if float(frac[y]) < 0.11 and float(frac[y + 1]) < 0.11 and float(frac[y + 2]) < 0.11:
            # Evitar margem/sitios com frac 0 no topo; legenda cinzenta tem alguma opacidade
            if row_m[y] > 3.5 or row_m[y + 1] > 3.5:
                return rgba[:y, :, :]
    return rgba


def trim_rgba_split_stacked_logos(rgba: np.ndarray) -> np.ndarray:
    """
    Folhas com 2 logos empilhados (ex. claro/escuro): cortar na faixa horizontal
    quase transparente e ficar só com o bloco **superior** (versao para fundo escuro).
    """
    a = rgba[:, :, 3]
    h, w = a.shape
    # Banner horizontal (1 linha): nao partir
    if w > h * 2.4:
        return rgba
    # Mini-icon: nao partir
    if h < 220:
        return rgba
    row_mean = a.mean(axis=1)
    # Linhas de «gola» entre os dois lockups (alpha muito baixa em quase toda a largura)
    # Primeira «queda» entre bloco superior e faixa vazia (evita escolher y~h/2 no meio do vazio).
    cut: int | None = None
    for y in range(int(h * 0.22), int(h * 0.58)):
        if float(row_mean[y]) < 4.0 and float(row_mean[y - 1]) > 8.0:
            cut = y
            break
    if cut is None:
        gap_candidates = [
            i
            for i in range(int(h * 0.2), int(h * 0.5))
            if row_mean[i] < 12.0 and np.sum(a[i, :] > 25) < w * 0.12
        ]
        if not gap_candidates:
            return rgba
        cut = min(gap_candidates)
    top = rgba[:cut, :, :]
    if np.sum(top[:, :, 3] > 25) < 500:
        return rgba
    top = trim_rgba_remove_bottom_caption_strip(top)
    return top


def trim_rgba(rgba: np.ndarray, alpha_threshold: int = 14) -> np.ndarray:
    a = rgba[:, :, 3]
    ys, xs = np.where(a > alpha_threshold)
    if len(xs) == 0:
        return rgba
    y0, y1 = ys.min(), ys.max() + 1
    x0, x1 = xs.min(), xs.max() + 1
    pad = 2
    y0 = max(0, y0 - pad)
    x0 = max(0, x0 - pad)
    y1 = min(rgba.shape[0], y1 + pad)
    x1 = min(rgba.shape[1], x1 + pad)
    return rgba[y0:y1, x0:x1]


def is_meaningful_rgba_transparency(rgba: np.ndarray) -> bool:
    if rgba.shape[2] < 4:
        return False
    a = rgba[:, :, 3].astype(np.float32) / 255.0
    # Parte significativa do canvas nao totalmente opaca (export com alpha real)
    return bool((a < 0.98).mean() > 0.03)


def is_brand_sheet(h: int, w: int) -> bool:
    return h >= 900 and w >= 1400 and (w / max(h, 1)) < 2.0


def is_white_corner_sheet(rgb: np.ndarray, h: int, w: int) -> bool:
    if not is_brand_sheet(h, w):
        return False
    pts = [rgb[0, 0], rgb[0, w - 1], rgb[h - 1, 0], rgb[h - 1, w - 1], rgb[h // 2, w // 2]]
    lum = [0.299 * float(p[0]) + 0.587 * float(p[1]) + 0.114 * float(p[2]) for p in pts]
    return float(np.median(lum)) > 232.0


def sheet_compact_crop(rgba_full: np.ndarray, h: int, w: int) -> np.ndarray:
    """
    Folha **escura** com 3 variantes na faixa inferior: coluna do meio = compacta.
    Margem horizontal para nao misturar com colunas vizinhas.
    """
    margin = max(4, w // 120)
    y0 = int(h * 0.62)
    y1 = h - 10
    x0 = w // 3 + margin
    x1 = (2 * w) // 3 - margin
    return rgba_full[y0:y1, x0:x1]


def sheet_white_lockup_bbox_crop(rgb: np.ndarray, h: int, w: int) -> np.ndarray:
    """
    Folha **branca** tipo «Logo decide 3.png»: o lockup fica na zona central (~40-60% H),
    nao na faixa inferior onde `sheet_compact_crop` apanharia so fundo branco.
    """
    f = rgb.astype(np.float32)
    dist = np.sqrt(np.sum((f - BG_WHITE) ** 2, axis=2))
    fg = dist > 12.0
    ys, xs = np.where(fg)
    if len(xs) < 500:
        margin = max(4, w // 120)
        y0 = int(h * 0.62)
        y1 = h - 10
        x0 = w // 3 + margin
        x1 = (2 * w) // 3 - margin
        return rgb[y0:y1, x0:x1]
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    pad_y = max(10, h // 64)
    pad_x = max(10, w // 64)
    y0 = max(0, y0 - pad_y)
    y1 = min(h, y1 + pad_y)
    x0 = max(0, x0 - pad_x)
    x1 = min(w, x1 + pad_x)
    return rgb[y0:y1, x0:x1]


def _user_photo_dirs() -> list[Path]:
    """Windows PT: «Imagens»; EN: «Pictures» — ambos podem existir."""
    home = Path.home()
    return [d for d in (home / "Imagens", home / "Pictures") if d.is_dir()]


def find_pictures_logo_decide_3() -> Path | None:
    for fname in ("Logo decide 3.png", "logo decide 3.png"):
        for base in _user_photo_dirs():
            p = base / fname
            if p.is_file():
                return p
    return None


def find_pictures_logo_decide_2() -> Path | None:
    """Folha de marca escura com variantes — ficheiro oficial «logo Decide 2.png»."""
    for fname in ("logo Decide 2.png", "Logo Decide 2.png", "logo decide 2.png"):
        for base in _user_photo_dirs():
            p = base / fname
            if p.is_file():
                return p
    return None


def find_pictures_rgba() -> Path | None:
    for pics in _user_photo_dirs():
        for f in pics.iterdir():
            if not f.suffix.lower() == ".png":
                continue
            low = f.name.lower()
            if "provis" in low and "decide" in low:
                return f
    return None


def main() -> None:
    src_arg = Path(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].strip() else None

    candidates: list[Path | None] = [
        src_arg,
        find_pictures_logo_decide_2(),
        SOURCE_DIR / "logo Decide 2.png",
        find_pictures_logo_decide_3(),
        SOURCE_DIR / "logo-decide-3-source.png",
        SOURCE_DIR / "decide-logo-rgba-source.png",
        find_pictures_rgba(),
    ]

    src: Path | None = None
    for c in candidates:
        if c is not None and c.is_file():
            src = c
            break

    if src is None:
        print("Uso: python scripts/build-logo-decide-2-asset.py <caminho para o PNG>", file=sys.stderr)
        print("Coloca em Imagens/Pictures ou public/images/source/ um destes:", file=sys.stderr)
        print("  - logo Decide 2.png (folha de marca escura)", file=sys.stderr)
        print("  - decide-logo-rgba-source.png (RGBA com transparencia)", file=sys.stderr)
        sys.exit(1)

    pil = Image.open(src)
    im = np.array(pil.convert("RGBA"))
    h, w = im.shape[0], im.shape[1]

    if im.shape[2] == 4 and is_meaningful_rgba_transparency(im):
        patch = trim_rgba_split_stacked_logos(im)
        patch = trim_rgba(patch)
        mode = "RGBA original (só lockup superior se folha dupla, depois trim)"
    elif is_brand_sheet(h, w):
        rgb = np.array(pil.convert("RGB"))
        if is_white_corner_sheet(rgb, h, w):
            rgb_lock = sheet_white_lockup_bbox_crop(rgb, h, w)
            patch = rgba_remove_bg_white(rgb_lock)
            mode = "folha branca (Logo decide 3 / gravado, bbox + wordmark claro)"
        else:
            rgba_full = rgba_remove_bg_sheet(rgb)
            mode = "folha escura (logo Decide 2, coluna compacta + wordmark #FFF)"
            patch = sheet_compact_crop(rgba_full, h, w)
        patch = wordmark_lighten_for_dark_ui(patch)
    else:
        rgb = np.array(pil.convert("RGB"))
        patch = rgba_remove_bg_export(rgb)
        mode = "export (fundo cinzento -> alpha)"

    patch = trim_rgba(patch)

    out_dir = OUT.parent
    out_dir.mkdir(parents=True, exist_ok=True)
    Image.fromarray(patch).convert("RGBA").save(OUT, optimize=True)
    print(f"OK {OUT.relative_to(ROOT)} size={patch.shape[1]}x{patch.shape[0]} mode=RGBA [{mode}]")
    print(f"src {src}")

    # Copia de referencia no repo (nome ASCII)
    if is_meaningful_rgba_transparency(np.array(pil.convert("RGBA"))):
        ref = SOURCE_DIR / "decide-logo-rgba-source.png"
        SOURCE_DIR.mkdir(parents=True, exist_ok=True)
        if src.resolve() != ref.resolve():
            try:
                shutil.copy2(src, ref)
                print(f"copiado para {ref.relative_to(ROOT)}")
            except OSError as e:
                print(f"aviso: copia ref RGBA ({e})", file=sys.stderr)

    ref3 = SOURCE_DIR / "logo-decide-3-source.png"
    if "decide 3" in src.name.lower():
        if src.resolve() != ref3.resolve():
            try:
                shutil.copy2(src, ref3)
                print(f"copiado para {ref3.relative_to(ROOT)}")
            except OSError as e:
                print(f"aviso: copia Logo decide 3 ({e})", file=sys.stderr)

    ref2 = SOURCE_DIR / "logo Decide 2.png"
    if "logo Decide 2" in src.name or src.name.lower().startswith("logo decide 2"):
        if src.resolve() != ref2.resolve():
            try:
                shutil.copy2(src, ref2)
                print(f"copiado para {ref2.relative_to(ROOT)}")
            except OSError as e:
                print(f"aviso: copia folha ({e})", file=sys.stderr)


if __name__ == "__main__":
    main()
