import re
from pathlib import Path

FILE = Path(r"C:\Users\Joaquim\Documents\DECIDE_CORE22_CLONE\frontend\pages\performance\core_overlayed.tsx")

def die(msg):
    raise SystemExit(msg)

src = FILE.read_text(encoding="utf-8")

# Idempotency marker
MARK = "DECIDE_POST_OVERLAY_CHART_V1__2026_03_05"
if MARK in src:
    print("OK: already patched (marker found)")
    raise SystemExit(0)

# We patch in a robust way:
# - Find the place where the response is parsed to build chart data.
# - If we cannot find a stable anchor, we add a helper right after the fetch success where 'r' exists.
#
# Strategy:
# 1) Inject helpers:
#    - pickPostOverlayEquity(r): returns float[] from r.result.equity_curve (if present)
#    - pickPreOverlayEquity(r): returns float[] from r.series.equity
#    - pickDates(r): r.series.dates
#    - pickBench(r): r.series.benchmark_equity
# 2) Ensure chart data uses:
#    - model_post
#    - model_pre (optional toggle)
#    - bench
#
# We look for a common anchor: a function/component that sets state from fetched JSON.
# Typical pattern: const data = await res.json(); setData(data);
# We'll inject right after JSON is obtained (variable named r or data).

# Try to find a line like: "const r = await res.json()" or "const data = await res.json()"
m = re.search(r"(const\s+(r|data)\s*=\s*await\s+[^;]*\.json\(\)\s*;)", src)
if not m:
    # fallback: "let r =" or "var r ="
    m = re.search(r"((let|var)\s+(r|data)\s*=\s*await\s+[^;]*\.json\(\)\s*;)", src)

if not m:
    die("FAIL: couldn't find fetch json anchor (const r/data = await ...json())")

varname = re.search(r"\b(r|data)\b", m.group(1)).group(1)
anchor = m.group(1)

helper = f"""
// {MARK}
function _decide_toNumArray(x:any): number[] {{
  try {{
    if (!x || !Array.isArray(x)) return [];
    const out:number[] = [];
    for (const v of x) {{
      const n = typeof v === "number" ? v : parseFloat(String(v));
      if (!Number.isFinite(n)) return [];
      out.push(n);
    }}
    return out;
  }} catch {{
    return [];
  }}
}}

function _decide_pickDates(resp:any): any[] {{
  return (resp && resp.series && Array.isArray(resp.series.dates)) ? resp.series.dates : [];
}}

function _decide_pickBench(resp:any): number[] {{
  return _decide_toNumArray(resp && resp.series ? resp.series.benchmark_equity : null);
}}

function _decide_pickPre(resp:any): number[] {{
  return _decide_toNumArray(resp && resp.series ? resp.series.equity : null);
}}

function _decide_pickPost(resp:any): number[] {{
  // prefer result.equity_curve -> [{'{'}date,equity{'}'}]
  try {{
    const ec = resp && resp.result ? resp.result.equity_curve : null;
    if (Array.isArray(ec) && ec.length > 0 && typeof ec[0] === "object") {{
      const out:number[] = [];
      for (const p of ec) {{
        const n = typeof p?.equity === "number" ? p.equity : parseFloat(String(p?.equity));
        if (!Number.isFinite(n)) return [];
        out.push(n);
      }}
      return out;
    }}
  }} catch {{}}
  return [];
}}
"""

# Inject helper right after the json() line
insert_at = m.end(1)
src2 = src[:insert_at] + helper + src[insert_at:]

# Now patch chart-data creation:
# We look for a place that builds an array of points for chart, usually something like:
# const rows = dates.map((d,i)=>({ date:d, equity:..., bench:... }))
# We'll inject a canonical "decideChartRows" computation and then try to replace existing rows variable if found.

# Try to find existing dates.map usage near later in file
m2 = re.search(r"(\bconst\b\s+\w+\s*=\s*[^;\n]*dates\.map\(\s*\()", src2)
if not m2:
    # fallback: ".map((d, i) =>" over dates variable
    m2 = re.search(r"(dates\.map\(\s*\(\s*[^)]*\)\s*=>\s*\()", src2)

# We'll inject a new block after the json load that computes:
#   const _decide_dates = _decide_pickDates(r)
#   const _decide_post = _decide_pickPost(r)
#   const _decide_pre  = _decide_pickPre(r)
#   const _decide_bench= _decide_pickBench(r)
#   const _decide_rows = ...
#
# Then, if we find a state setter like setSeries(...) or setChartData(...), we keep it as-is,
# but also attach r._decide_chart_rows so UI can use it.
#
# Best effort: find "setState(" right after fetch.
mset = re.search(rf"(set\w+\s*\(\s*{varname}\s*\)\s*;)", src2)
if not mset:
    # maybe setData(data) where varname is data; keep generic: any setX(varname)
    mset = re.search(rf"(set\w+\s*\(\s*{varname}\s*\)\s*;)", src2)

if not mset:
    # If we can't find it, inject anyway right after json load
    inj_point = insert_at + len(helper)
else:
    inj_point = mset.end(1)

calc = f"""
/* {MARK} chart rows (post vs pre vs bench) */
try {{
  const _decide_dates = _decide_pickDates({varname});
  const _decide_post  = _decide_pickPost({varname});
  const _decide_pre   = _decide_pickPre({varname});
  const _decide_bench = _decide_pickBench({varname});

  const n = _decide_dates.length;
  const ok_post  = _decide_post.length  === n && n > 0;
  const ok_pre   = _decide_pre.length   === n && n > 0;
  const ok_bench = _decide_bench.length === n && n > 0;

  const _decide_rows = [];
  for (let i=0; i<n; i++) {{
    _decide_rows.push({{
      date: _decide_dates[i],
      model_post: ok_post ? _decide_post[i] : null,
      model_pre:  ok_pre  ? _decide_pre[i]  : null,
      bench:      ok_bench? _decide_bench[i]: null,
    }});
  }}

  // attach for UI usage (non-breaking)
  ({varname} as any)._decide_rows = _decide_rows;
  ({varname} as any)._decide_has_post = ok_post;
  ({varname} as any)._decide_has_pre  = ok_pre;
  ({varname} as any)._decide_has_bench= ok_bench;
}} catch {{}}
"""

src3 = src2[:inj_point] + calc + src2[inj_point:]

# Finally: ensure UI uses _decide_rows if present.
# Common pattern: a variable used in chart like "chartData" or "data" etc.
# We'll do a conservative patch:
# - Replace occurrences of "data={SOMETHING}" (Recharts) not safe.
# - Instead, add a small fallback right after component state where "const chartData = ..."
#
# We search for "const chartData =" or "const rows =" near JSX.
mcd = re.search(r"(const\s+(chartData|rows)\s*=\s*)([^;]+);", src3)
if mcd:
    # Replace RHS with prefer response._decide_rows when available
    rhs = mcd.group(3).strip()
    new_rhs = f"((data as any)?._decide_rows || (r as any)?._decide_rows || {rhs})"
    # But we don't know state variable names; keep original and add a new const decideRows below.
    pass

# Best generic: if file contains "data?." or a state variable named "data", inject:
# const decideRows = (data as any)?._decide_rows || [];
# We'll find the first occurrence of "return (" and inject before it.

mret = re.search(r"\breturn\s*\(", src3)
if not mret:
    die("FAIL: couldn't find return( anchor to inject decideRows")

inject_ui = f"""
// {MARK} prefer computed rows for chart
const decideRows:any[] = ((data as any)?._decide_rows || (result as any)?._decide_rows || (r as any)?._decide_rows || []);
const decideHasPost:boolean = Boolean((data as any)?._decide_has_post || (result as any)?._decide_has_post || (r as any)?._decide_has_post);
const decideHasPre:boolean  = Boolean((data as any)?._decide_has_pre  || (result as any)?._decide_has_pre  || (r as any)?._decide_has_pre);
const decideHasBench:boolean= Boolean((data as any)?._decide_has_bench|| (result as any)?._decide_has_bench|| (r as any)?._decide_has_bench);
"""

src4 = src3[:mret.start()] + inject_ui + src3[mret.start():]

# Also add a tiny UI hint text if we can find a place with "Benchmark" label or similar.
# We'll just append an unobtrusive comment; UI rendering changes depend on your current JSX.
# Not forceful: keep as code-only patch.

FILE.write_text(src4, encoding="utf-8", newline="\n")
print(f"OK: patched => {FILE}")
print(f"OK: marker => {MARK}")