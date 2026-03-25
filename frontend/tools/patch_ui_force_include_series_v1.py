import os, re, sys

ROOT = r"C:\Users\Joaquim\Documents\DECIDE_CORE22_CLONE\frontend"

TARGETS = [
    os.path.join(ROOT, "pages", "performance", "core_overlayed.tsx"),
    os.path.join(ROOT, "pages", "kpis_overlay.tsx"),
    os.path.join(ROOT, "pages", "kpis_overlay", "ddcap.tsx"),
    os.path.join(ROOT, "pages", "debug_markers.tsx"),
]

def patch_text(txt: str) -> tuple[str, int]:
    """
    Force include_series via querystring on any '/api/performance/core_overlayed' URL.
    Works for GET/POST because querystring is independent of body.
    """
    reps = 0

    # Match "/api/performance/core_overlayed" or '/api/performance/core_overlayed'
    pat = re.compile(r"([\"'])/api/performance/core_overlayed(?![A-Za-z0-9_])([^\"']*)\1")

    def repl(m):
        nonlocal reps
        quote = m.group(1)
        tail  = m.group(2)  # may include ?... or nothing
        url = "/api/performance/core_overlayed" + tail

        # If already has include_series, leave as-is
        if re.search(r"(?:\?|&)include_series=", url):
            return f"{quote}{url}{quote}"

        if "?" in url:
            url2 = url + "&include_series=1"
        else:
            url2 = url + "?include_series=1"

        reps += 1
        return f"{quote}{url2}{quote}"

    out = pat.sub(repl, txt)
    return out, reps

def main():
    total_files = 0
    total_reps = 0
    patched = 0

    for f in TARGETS:
        total_files += 1
        if not os.path.exists(f):
            print(f"SKIP (missing): {f}")
            continue

        with open(f, "r", encoding="utf-8") as fh:
            src = fh.read()

        dst, reps = patch_text(src)
        if reps > 0 and dst != src:
            with open(f, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(dst)
            patched += 1
            total_reps += reps
            print(f"PATCHED: {f}  (replacements={reps})")
        else:
            print(f"NOCHANGE: {f}")

    print(f"\nDONE: files_patched={patched} total_replacements={total_reps} scanned={total_files}")

if __name__ == "__main__":
    main()