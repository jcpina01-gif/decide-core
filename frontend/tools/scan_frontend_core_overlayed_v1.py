from __future__ import annotations

from pathlib import Path
import re

ROOT = Path(r"C:\Users\Joaquim\Documents\DECIDE_CORE22_CLONE")
FRONT = ROOT / "frontend"

TARGET_API_CLIENTS = [
    FRONT / "lib" / "api.ts",
    FRONT / "lib" / "api.js",
    FRONT / "src" / "lib" / "api.ts",
    FRONT / "src" / "lib" / "api.js",
    FRONT / "utils" / "api.ts",
    FRONT / "utils" / "api.js",
]

TARGET_PAGES = [
    FRONT / "pages",
    FRONT / "src" / "pages",
    FRONT / "app",
    FRONT / "src" / "app",
    FRONT / "components",
    FRONT / "src" / "components",
]

PATTERNS = {
    "fallback_used_flag": re.compile(r"\b(fallback_used|fallbackUsed|series_fallback\.used|seriesFallback\.used)\b", re.I),
    "legacy_2tuple_note": re.compile(r"\blegacy_2tuple\b", re.I),
    "series_fallback_block": re.compile(r"\b(series_fallback|seriesFallback)\b", re.I),
    "bench_equity": re.compile(r"\bbenchmark_equity\b", re.I),
    "core_overlayed_endpoint": re.compile(r"/api/performance/core_overlayed", re.I),
    "performance_core_overlayed": re.compile(r"\bcore_overlayed\b", re.I),
}

EXT_OK = {".ts", ".tsx", ".js", ".jsx", ".json", ".md"}

def read_text(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return p.read_text(encoding="utf-8", errors="replace")

def scan_file(p: Path):
    txt = read_text(p)
    hits = {}
    for k, rx in PATTERNS.items():
        if rx.search(txt):
            hits[k] = True
    return hits

def iter_files(base: Path):
    if not base.exists():
        return
    for p in base.rglob("*"):
        if p.is_file() and p.suffix.lower() in EXT_OK and "node_modules" not in p.parts and ".next" not in p.parts:
            yield p

def main():
    print("DECIDE scan_frontend_core_overlayed_v1")
    print(f"FRONT={FRONT}")

    found_any = False
    total_hits = {k: 0 for k in PATTERNS.keys()}

    # 1) api client files (if exist)
    print("\n=== 1) API client candidates ===")
    for p in TARGET_API_CLIENTS:
        if p.exists():
            hits = scan_file(p)
            found_any = True
            print(f"\nFILE: {p}")
            if hits:
                for k in hits.keys():
                    total_hits[k] += 1
                print("HITS:", ", ".join(sorted(hits.keys())))
            else:
                print("HITS: (none)")
        else:
            pass

    # 2) scan pages/components/app
    print("\n=== 2) Scan pages/app/components ===")
    scanned = 0
    for base in TARGET_PAGES:
        if not base.exists():
            continue
        for p in iter_files(base):
            scanned += 1
            hits = scan_file(p)
            if hits:
                found_any = True
                for k in hits.keys():
                    total_hits[k] += 1
                print(f"{p} => {', '.join(sorted(hits.keys()))}")

    print(f"\nScanned files: {scanned}")

    # Summary
    print("\n=== 3) SUMMARY (how many files mention each thing) ===")
    for k in sorted(total_hits.keys()):
        print(f"{k}: {total_hits[k]}")

    # Quick guidance
    print("\n=== 4) QUICK GUIDANCE ===")
    if total_hits["legacy_2tuple_note"] > 0 or total_hits["series_fallback_block"] > 0:
        print("- Frontend is referencing legacy_2tuple/series_fallback; it may be forcing UI into 'fallback' mode.")
    else:
        print("- No legacy_2tuple/series_fallback references found in scanned areas.")
    if total_hits["core_overlayed_endpoint"] == 0:
        print("- Did not find explicit '/api/performance/core_overlayed' string; maybe API is centralized elsewhere.")
    else:
        print("- Found references to '/api/performance/core_overlayed'.")

    if not found_any:
        print("\nNOTE: Nothing matched. Either paths differ or frontend structure is different.")
    print("\nDONE.")

if __name__ == "__main__":
    main()