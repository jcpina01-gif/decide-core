/** Partilhado entre a página do plano (client) e `getServerSideProps` (servidor). Sem `fs`. */

export function safeNumber(x: unknown, fallback = 0): number {
  const v = typeof x === "number" ? x : Number(x);
  return Number.isFinite(v) ? v : fallback;
}

export function safeString(x: unknown, fallback = ""): string {
  return typeof x === "string" ? x : fallback;
}

/** UCITS MM em EUR (proxy `EUR_MM_PROXY` no plano) — alinhar com `EUR_MM_IB_TICKER` no backend. */
const PCT_DISPLAY_CAP = 400;

/** Limita percentagens mostradas (evita outliers absurdos na UI). */
export function capPctDisplay(p: number): number {
  if (!Number.isFinite(p)) return 0;
  return Math.max(-PCT_DISPLAY_CAP, Math.min(PCT_DISPLAY_CAP, p));
}

export function eurMmIbTicker(): string {
  const v = (
    process.env.NEXT_PUBLIC_EUR_MM_IB_TICKER ||
    process.env.EUR_MM_IB_TICKER ||
    "CSH2"
  )
    .trim()
    .toUpperCase();
  return v || "CSH2";
}
