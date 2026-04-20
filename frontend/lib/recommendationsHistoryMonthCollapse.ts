/**
 * Colapso do histórico de pesos: **uma data por mês civil** (a mais tardia),
 * alinhado a `filterMergedWeightsToLatestRebalancePerCalendarMonth` no SSR.
 */

export function histMonthIsoYmd(date: string): string {
  const s = String(date || "").trim();
  const head = s.includes("T") ? s.split("T")[0]! : s.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(head)) return head;
  const slash = head.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    return `${slash[3]}-${slash[2]!.padStart(2, "0")}-${slash[1]!.padStart(2, "0")}`;
  }
  const loose = head.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (loose) {
    return `${loose[1]}-${loose[2]!.padStart(2, "0")}-${loose[3]!.padStart(2, "0")}`;
  }
  return head;
}

export function collapseHistMonthsToLatestPerCalendarMonth<
  T extends { date: string; chronologicalIndex?: number },
>(months: T[]): T[] {
  if (months.length <= 1) return months;
  const sortedAsc = [...months].sort((a, b) => histMonthIsoYmd(a.date).localeCompare(histMonthIsoYmd(b.date)));
  const byYm = new Map<string, T>();
  for (const mo of sortedAsc) {
    const ymd = histMonthIsoYmd(mo.date);
    if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) byYm.set(ymd.slice(0, 7), mo);
    else byYm.set(`__${mo.date}`, mo);
  }
  const asc = [...byYm.values()].sort((a, b) => histMonthIsoYmd(a.date).localeCompare(histMonthIsoYmd(b.date)));
  const indexed = asc.map((mo, i) => ({ ...mo, chronologicalIndex: i }));
  return indexed.slice().reverse();
}
