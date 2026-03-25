from __future__ import annotations
from pathlib import Path
from datetime import datetime
import re

ROOT = Path(r"C:\Users\Joaquim\Documents\DECIDE_CORE22_CLONE")
FRONT = ROOT / "frontend"

TARGETS = [
    FRONT / "pages" / "api" / "performance" / "core_overlayed.ts",
    FRONT / "pages" / "api" / "performance" / "_debug_core_overlayed.ts",
    FRONT / "pages" / "api" / "proxy" / "performance" / "core_overlayed.ts",
]

MARK = "// DECIDE PATCH v3: normalize series_fallback (keep only when used==true)"

SNIPPET = r'''
{mark}
try {{
  const d: any = (data as any)?.detail;
  const sf: any = d?.series_fallback;
  // Keep series_fallback ONLY when backend explicitly says used===true
  if (sf && sf.used !== true) {{
    if (d && typeof d === "object") {{
      delete d.series_fallback;
    }}
  }}
}} catch (_) {{}}
'''.strip("\n")

def backup(p: Path, txt: str) -> Path:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    bak = p.with_name(p.name + f".bak_{stamp}")
    bak.write_text(txt, encoding="utf-8")
    return bak

def patch_one(p: Path) -> tuple[bool, int]:
    if not p.exists():
        print(f"SKIP (missing): {p}")
        return (False, 0)

    src = p.read_text(encoding="utf-8", errors="replace")

    if MARK in src:
        print(f"OK (already patched): {p}")
        return (False, 0)

    # Pattern A: "const data = await res.json();" or "let data = await res.json();"
    m = re.search(r"(?m)^(?P<indent>[ \t]*)(const|let)\s+data\s*=\s*await\s+[A-Za-z0-9_$.]+\s*\.json\s*\(\s*\)\s*;\s*$", src)
    if m:
        indent = m.group("indent")
        block = "\n" + "\n".join(indent + line if line.strip() else line for line in SNIPPET.format(mark=MARK).splitlines()) + "\n"
        insert_at = m.end()
        out = src[:insert_at] + block + src[insert_at:]
        bak = backup(p, src)
        p.write_text(out, encoding="utf-8")
        print(f"OK: patched (after res.json) => {p}")
        print(f"   backup => {bak.name}")
        return (True, 1)

    # Pattern B: "data = await res.json();" (rare)
    m = re.search(r"(?m)^(?P<indent>[ \t]*)data\s*=\s*await\s+[A-Za-z0-9_$.]+\s*\.json\s*\(\s*\)\s*;\s*$", src)
    if m:
        indent = m.group("indent")
        block = "\n" + "\n".join(indent + line if line.strip() else line for line in SNIPPET.format(mark=MARK).splitlines()) + "\n"
        insert_at = m.end()
        out = src[:insert_at] + block + src[insert_at:]
        bak = backup(p, src)
        p.write_text(out, encoding="utf-8")
        print(f"OK: patched (after data = await res.json) => {p}")
        print(f"   backup => {bak.name}")
        return (True, 1)

    print(f"WARN: could not find 'await <x>.json()' to anchor patch => {p}")
    return (False, 0)

def main():
    patched_files = 0
    reps = 0
    for p in TARGETS:
        ok, n = patch_one(p)
        if ok:
            patched_files += 1
            reps += n
    print(f"files patched: {patched_files}")
    print(f"total replacements: {reps}")

if __name__ == "__main__":
    main()