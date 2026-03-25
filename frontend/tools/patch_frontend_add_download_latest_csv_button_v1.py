import sys, re
from pathlib import Path

FRONT = Path(__file__).resolve().parents[1]

CANDIDATES = [
    FRONT / "pages" / "performance" / "core_overlayed.tsx",
    FRONT / "pages" / "performance" / "core_overlayed" / "index.tsx",
    FRONT / "pages" / "performance" / "core_overlayed.jsx",
    FRONT / "pages" / "performance" / "core_overlayed" / "index.jsx",
]

NEEDLE_ANY = [
    "core_overlayed",
    "Performance",
    "benchmark",
    "voltarget",
]

BTN_MARK = "DECIDE_DOWNLOAD_LATEST_CSV_BTN_V1"

DOWNLOAD_URL = "http://127.0.0.1:8067/api/equity_curves/core_overlayed/latest.csv"

def read(p: Path) -> str:
    return p.read_text(encoding="utf-8", errors="replace")

def write(p: Path, s: str) -> None:
    p.write_text(s, encoding="utf-8", newline="\n")

def pick_target() -> Path:
    for p in CANDIDATES:
        if p.exists():
            return p
    # fallback search
    hits = []
    for p in FRONT.rglob("*.tsx"):
        try:
            t = read(p).lower()
        except Exception:
            continue
        if "core_overlayed" in t and "performance" in t:
            hits.append(p)
    if hits:
        return hits[0]
    raise RuntimeError("Could not locate core_overlayed page .tsx")

def inject_button(src: str) -> str:
    if BTN_MARK in src:
        return src

    # heuristics: put button near top controls/header: after first <h1>... or after first <div ...> that looks like header
    # Try after a heading
    m = re.search(r'(<h1[^>]*>.*?</h1>)', src, flags=re.IGNORECASE|re.DOTALL)
    insert_after = None
    if m:
        insert_after = m.end()
    else:
        # fallback: after first return ( ... )
        m2 = re.search(r'\breturn\s*\(\s*', src)
        if m2:
            insert_after = m2.end()
        else:
            raise RuntimeError("Could not find insertion point")

    btn = f'''
      {{/* {BTN_MARK} */}}
      <div style={{display:"flex", gap:12, alignItems:"center", marginTop:12, marginBottom:12}}>
        <a
          href="{DOWNLOAD_URL}"
          target="_blank"
          rel="noreferrer"
          style={{
            display:"inline-flex",
            alignItems:"center",
            justifyContent:"center",
            padding:"10px 12px",
            borderRadius:10,
            border:"1px solid rgba(255,255,255,0.20)",
            background:"rgba(255,255,255,0.06)",
            color:"#fff",
            textDecoration:"none",
            fontSize:14,
            lineHeight:"14px",
            cursor:"pointer"
          }}
          title="Descarregar a curva mais recente (CSV)"
        >
          Descarregar curva (CSV)
        </a>
        <span style={{opacity:0.75, fontSize:12}}>
          (gera-se ao correr o modelo)
        </span>
      </div>
      {{/* END {BTN_MARK} */}}
'''
    return src[:insert_after] + btn + src[insert_after:]

def main():
    target = pick_target()
    src = read(target)

    bak = target.with_suffix(target.suffix + f".bak_download_btn_{__import__('datetime').datetime.now().strftime('%Y%m%d_%H%M%S')}")
    write(bak, src)

    out = inject_button(src)
    write(target, out)
    print(f"OK: patched => {target}")
    print(f"OK: backup  => {bak}")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("ERROR:", e)
        sys.exit(2)