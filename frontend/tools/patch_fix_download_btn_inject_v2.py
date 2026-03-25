import sys, re
from pathlib import Path
from datetime import datetime

FILE = Path(r"C:\Users\Joaquim\Documents\DECIDE_CORE22_CLONE\frontend\pages\performance\core_overlayed.tsx")

BTN_MARK = "DECIDE_DOWNLOAD_LATEST_CSV_BTN_V1"
START = f"{{/* {BTN_MARK} */}}"
END   = f"{{/* END {BTN_MARK} */}}"
URL   = "http://127.0.0.1:8067/api/equity_curves/core_overlayed/latest.csv"

BTN_BLOCK = f"""
      {START}
      <div style={{display:"flex", gap:12, alignItems:"center", marginTop:12, marginBottom:12}}>
        <a
          href="{URL}"
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
      {END}
""".rstrip() + "\n"

def read(p: Path) -> str:
    return p.read_text(encoding="utf-8", errors="replace")

def write(p: Path, s: str) -> None:
    p.write_text(s, encoding="utf-8", newline="\n")

def remove_old_block(src: str) -> str:
    # Remove any previously injected block (even if duplicated)
    pattern = re.compile(r"\{\s*/\*\s*" + re.escape(BTN_MARK) + r"\s*\*/\}.*?\{\s*/\*\s*END\s+" + re.escape(BTN_MARK) + r"\s*\*/\}", re.DOTALL)
    return re.sub(pattern, "", src)

def insert_inside_root_jsx(src: str) -> str:
    # Find "return (" then the first JSX opening tag "<...>" and insert right after that tag.
    mret = re.search(r"\breturn\s*\(\s*", src)
    if not mret:
        raise RuntimeError("Could not find `return (` in file")

    tail = src[mret.end():]

    # Find first JSX opening tag after return( : <div ...> or <main ...> etc.
    mtag = re.search(r"<[A-Za-z][A-Za-z0-9:_-]*\b[^>]*>", tail)
    if not mtag:
        raise RuntimeError("Could not find first JSX tag after return(")

    insert_at = mret.end() + mtag.end()

    # If block already present (after removal it won't), just insert once
    return src[:insert_at] + "\n" + BTN_BLOCK + src[insert_at:]

def main():
    if not FILE.exists():
        raise RuntimeError(f"File not found: {FILE}")

    src = read(FILE)

    bak = FILE.with_suffix(FILE.suffix + ".bak_fix_inject_" + datetime.now().strftime("%Y%m%d_%H%M%S"))
    write(bak, src)

    src2 = remove_old_block(src)
    out = insert_inside_root_jsx(src2)

    write(FILE, out)
    print(f"OK: patched => {FILE}")
    print(f"OK: backup  => {bak}")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("ERROR:", e)
        sys.exit(2)