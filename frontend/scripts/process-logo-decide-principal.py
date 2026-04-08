"""
Gera `public/images/logo-decide-principal.png`.

Fonte **oficial** (sem argumento): **`logo Decide 2 imagem principal.png`**
em `%USERPROFILE%\\Imagens` ou `Pictures`, ou cópia em `public/images/source/`.

Dois modos após carregar RGB:
- **Folha de marca** (cantos escuros, cartão claro): fundo azul + branco do cartão → alpha;
  wordmark «decide» → #FFF para o header escuro.
- **Export fundo preto** (cantos muito escuros, lockup): só transparentar o preto.

Fallback (só se o principal não existir): `logo-decide-lockup-fundo-preto.png` em source.

Uso (na pasta frontend):
  python scripts/process-logo-decide-principal.py [--raw] [caminho.png]

  **--process** — aplica fundo transparente + wordmark #FFF (legado; pode alterar o aspeto
  do texto «decide»).

  Por omissão, com **«logo Decide 2 imagem principal.png»**, faz-se **cópia fiel** (igual ao ficheiro).
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
BUILD_LOGO = ROOT / "scripts" / "build-logo-decide-2-asset.py"
BG_D = np.array([1.5, 4.4, 13.7], dtype=np.float32)
BG_W = np.array([252.0, 253.0, 253.0], dtype=np.float32)


def _user_photo_dirs() -> list[Path]:
    home = Path.home()
    return [d for d in (home / "Imagens", home / "Pictures") if d.is_dir()]


def _wordmark_white_fff(rgba: np.ndarray) -> np.ndarray:
    import importlib.util

    spec = importlib.util.spec_from_file_location("decide_logo_build", BUILD_LOGO)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod.wordmark_lighten_for_dark_ui(rgba)


def _corner_median_lum(rgb: np.ndarray) -> float:
    h, w = rgb.shape[:2]
    pts = [rgb[0, 0], rgb[0, w - 1], rgb[-1, 0], rgb[-1, w - 1]]
    lums = [0.299 * float(p[0]) + 0.587 * float(p[1]) + 0.114 * float(p[2]) for p in pts]
    return float(np.median(lums))


def _rgba_black_bg_to_transparent(rgb: np.ndarray) -> np.ndarray:
    """Fundo ~#000 — alpha por distância ao preto (bordas suaves)."""
    f = rgb.astype(np.float32)
    dist = np.sqrt(np.sum(f**2, axis=2))
    alpha = np.clip((dist - 6.0) / 28.0 * 255.0, 0.0, 255.0).astype(np.uint8)
    return np.dstack([rgb.astype(np.uint8), alpha])


def _trim_rgba(rgba: np.ndarray, thr: int = 22, pad: int = 2) -> np.ndarray:
    a = rgba[:, :, 3]
    ys, xs = np.where(a > thr)
    if len(xs) == 0:
        return rgba
    h, w = rgba.shape[:2]
    y0, y1 = max(0, int(ys.min()) - pad), min(h, int(ys.max()) + 1 + pad)
    x0, x1 = max(0, int(xs.min()) - pad), min(w, int(xs.max()) + 1 + pad)
    return rgba[y0:y1, x0:x1, :]


def resolve_source(explicit: Path | None) -> Path | None:
    if explicit is not None and explicit.is_file():
        return explicit

    principal_names = ("logo Decide 2 imagem principal.png", "Logo Decide 2 imagem principal.png")
    cands: list[Path] = []
    for name in principal_names:
        for base in _user_photo_dirs():
            cands.append(base / name)
    for name in principal_names:
        cands.append(SOURCE_DIR / name)
    cands.append(SOURCE_DIR / "logo-decide-lockup-fundo-preto.png")
    for name in ("logo decide lockup fundo preto.png", "Logo decide lockup fundo preto.png"):
        for base in _user_photo_dirs():
            cands.append(base / name)

    for c in cands:
        if c.is_file():
            return c
    return None


def main() -> None:
    cli = [a for a in sys.argv[1:] if a.strip()]
    do_process = "--process" in cli
    raw_flag = "--raw" in cli
    cli = [a for a in cli if a not in ("--process", "--raw")]
    explicit = Path(cli[0]) if cli else None

    src = resolve_source(explicit)
    if src is None:
        print(
            "Coloca «logo Decide 2 imagem principal.png» em Imagens ou Pictures, "
            f"ou em:\n  {SOURCE_DIR / 'logo Decide 2 imagem principal.png'}\n"
            "Alternativa: passa o caminho do PNG como argumento.",
            file=sys.stderr,
        )
        sys.exit(1)

    use_fiel = (not do_process) and (
        raw_flag or "imagem principal" in src.name.lower()
    )

    if use_fiel:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, OUT)
        SOURCE_DIR.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, SOURCE_DIR / "logo Decide 2 imagem principal.png")
        shutil.copy2(src, SOURCE_DIR / "logo-decide-principal-source.png")
        im = Image.open(OUT)
        print(f"OK cópia fiel {OUT.relative_to(ROOT)} {im.size[0]}x{im.size[1]} <- {src}")
        return

    rgb = np.array(Image.open(src).convert("RGB")).astype(np.float32)
    lum_corner = _corner_median_lum(rgb.astype(np.uint8))
    # «logo Decide 2 imagem principal.png» tem cantos da folha escura mas cartão claro — não é banner 100% preto.
    force_folha = "imagem principal" in src.name.lower()

    if lum_corner < 48.0 and not force_folha:
        # Export tipo banner preto — «decide» já branco; só transparentar o fundo.
        rgba = _rgba_black_bg_to_transparent(rgb)
        mode = "lockup fundo preto -> alpha (sem recolorir texto)"
    else:
        dist_d = np.sqrt(np.sum((rgb - BG_D) ** 2, axis=2))
        a_d = np.clip((dist_d - 12.0) / 30.0 * 255.0, 0.0, 255.0)
        dist_w = np.sqrt(np.sum((rgb - BG_W) ** 2, axis=2))
        a_w = np.clip((dist_w - 10.0) / 22.0 * 255.0, 0.0, 255.0)
        alpha = np.minimum(a_d, a_w).astype(np.uint8)
        rgba = np.dstack([rgb.astype(np.uint8), alpha])
        mode = "folha marca + wordmark #FFF"
        rgba = _wordmark_white_fff(rgba)

    # Recorte apertado só ao lockup (menos margem transparente).
    cropped = _trim_rgba(rgba, thr=8, pad=2)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(cropped).save(OUT, optimize=True)

    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, SOURCE_DIR / "logo-decide-principal-source.png")
    if "imagem principal" in src.name.lower():
        try:
            shutil.copy2(src, SOURCE_DIR / "logo Decide 2 imagem principal.png")
        except OSError:
            pass

    print(f"OK {OUT.relative_to(ROOT)} {cropped.shape[1]}x{cropped.shape[0]} [{mode}] <- {src}")


if __name__ == "__main__":
    main()
