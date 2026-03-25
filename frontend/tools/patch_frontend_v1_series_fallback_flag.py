import re
from pathlib import Path

root = Path(r"C:\Users\Joaquim\Documents\DECIDE_CORE22_CLONE\frontend")

targets = list(root.rglob("*.ts")) + list(root.rglob("*.tsx"))

patched=0

for f in targets:

    txt=f.read_text(encoding="utf-8")

    new=txt

    # replace any logic using note
    new=re.sub(
        r"series_fallback\?\.note",
        "series_fallback?.used",
        new
    )

    new=re.sub(
        r"fallback.*note",
        "fallback_used",
        new
    )

    if new!=txt:
        f.write_text(new,encoding="utf-8")
        patched+=1
        print("patched",f)

print("files patched:",patched)