import re
from pathlib import Path
from datetime import datetime

ROOT = Path(r"C:\Users\Joaquim\Documents\DECIDE_CORE22_CLONE\frontend")

def iter_files():
    exts = {".ts",".tsx",".js",".jsx"}
    for p in ROOT.rglob("*"):
        if not p.is_file(): 
            continue
        if p.suffix.lower() not in exts:
            continue
        s = str(p).lower()
        if "\\node_modules\\" in s or "\\.next\\" in s:
            continue
        yield p

def patch_text(txt: str) -> tuple[str,int]:
    n = 0
    new = txt

    # Normalize accessors: series_fallback.note -> series_fallback.used
    patterns = [
        (r"(series_fallback\s*\?\.\s*)note\b", r"\1used"),
        (r"(series_fallback\s*\.\s*)note\b",   r"\1used"),
        (r"(seriesFallback\s*\?\.\s*)note\b",  r"\1used"),
        (r"(seriesFallback\s*\.\s*)note\b",    r"\1used"),

        # fbNote/fallbackNote variable usage -> prefer used flag
        (r"\bfbNote\b", "fbUsed"),
        (r"\bfallbackNote\b", "fallbackUsed"),

        # comparisons against legacy_2tuple => use used flag instead (best-effort)
        (r"note\s*===\s*['\"]legacy_2tuple(_ok)?['\"]", "series_fallback?.used === true"),
        (r"note\s*==\s*['\"]legacy_2tuple(_ok)?['\"]",  "series_fallback?.used === true"),
        (r"['\"]legacy_2tuple(_ok)?['\"]",              "true"),  # last resort if UI only shows text
    ]

    for a,b in patterns:
        newer, k = re.subn(a,b,new, flags=re.M)
        if k:
            new = newer
            n += k

    return new, n

def main():
    touched = []
    total_changes = 0

    for f in iter_files():
        txt = f.read_text(encoding="utf-8", errors="ignore")
        new, n = patch_text(txt)
        if n > 0 and new != txt:
            stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            bak = f.with_name(f.name + f".bak_{stamp}")
            bak.write_text(txt, encoding="utf-8")
            f.write_text(new, encoding="utf-8")
            touched.append((str(f), n))
            total_changes += n

    print("files patched:", len(touched))
    print("total replacements:", total_changes)
    for path, n in touched[:50]:
        print(f"  {n}  {path}")
    if len(touched) > 50:
        print("  ... (more files patched)")

if __name__ == "__main__":
    main()