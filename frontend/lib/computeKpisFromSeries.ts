/**
 * KPIs a partir de datas + curva de equity (mesma lógica que kpis_overlay.tsx).
 * Usa anos civis entre primeira e última data (UTC) e vol/Sharpe em base diária × √252.
 */

function parseYmd(s: string): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo, d, 0, 0, 0));
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function yearsBetween(d0: Date, d1: Date): number | null {
  const t0 = d0.getTime();
  const t1 = d1.getTime();
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return null;
  const days = (t1 - t0) / (1000 * 60 * 60 * 24);
  return days / 365.25;
}

function returnsFromEquity(eq: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < eq.length; i++) {
    const a = eq[i - 1];
    const b = eq[i];
    if (!(a > 0) || !Number.isFinite(a) || !Number.isFinite(b)) continue;
    r.push(b / a - 1);
  }
  return r;
}

function mean(x: number[]): number | null {
  if (!x.length) return null;
  let s = 0;
  for (const v of x) s += v;
  return s / x.length;
}

function stdev(x: number[]): number | null {
  if (x.length < 2) return null;
  const m = mean(x);
  if (m === null) return null;
  let ss = 0;
  for (const v of x) {
    const d = v - m;
    ss += d * d;
  }
  return Math.sqrt(ss / (x.length - 1));
}

function maxDrawdown(eq: number[]): number | null {
  if (!eq.length) return null;
  let peak = eq[0];
  let mdd = 0;
  for (const v of eq) {
    if (v > peak) peak = v;
    const dd = peak > 0 ? v / peak - 1 : 0;
    if (dd < mdd) mdd = dd;
  }
  return mdd;
}

export type KpisFromSeries = {
  cagr: number;
  vol: number;
  sharpe: number;
  mdd: number;
  years: number;
  n: number;
  totalReturn: number;
};

export function computeKpisFromSeries(dates: string[], equity: number[]): KpisFromSeries | null {
  if (!dates?.length || !equity?.length) return null;
  const n = Math.min(dates.length, equity.length);
  const d0 = parseYmd(dates[0]);
  const d1 = parseYmd(dates[n - 1]);
  if (!d0 || !d1) return null;

  const years = yearsBetween(d0, d1);
  if (!years || years <= 0) return null;

  const eq = equity.slice(0, n).map((v) => Number(v));
  const first = eq[0];
  const last = eq[eq.length - 1];
  if (!(first > 0) || !(last > 0)) return null;

  const cagr = Math.pow(last / first, 1 / years) - 1;
  const totalReturn = last / first - 1;

  const rets = returnsFromEquity(eq);
  const mu = mean(rets);
  const sd = stdev(rets);

  const vol = sd === null ? 0 : sd * Math.sqrt(252);
  const sharpe = mu === null || sd === null || sd === 0 ? 0 : (mu / sd) * Math.sqrt(252);
  const mddRaw = maxDrawdown(eq);
  const mdd = mddRaw === null ? 0 : mddRaw;

  return { cagr, vol, sharpe, mdd, years, n: eq.length, totalReturn };
}
