/**
 * Calendário de recomendações de carteira (demo localStorage):
 * - Constituição inicial no dia em que o cliente marca "comecei a operar".
 * - Revisões mensais alinhadas a um ciclo global: 1.º dia útil (seg–sex) de cada mês.
 *
 * Isto não substitui feriados de bolsa; podes evoluir para calendário IBKR/XP later.
 */

export const PORTFOLIO_SCHEDULE_STORAGE_VERSION = "v1";
const STORAGE_PREFIX = `decide_client_portfolio_schedule_${PORTFOLIO_SCHEDULE_STORAGE_VERSION}_`;

export type ClientPortfolioScheduleState = {
  /** Data (local YYYY-MM-DD) em que o cliente marcou a constituição inicial */
  onboardingSnapshotAt: string;
  /** Opcional: última vez que o cliente confirmou ter aplicado a revisão mensal (só UX/auditoria leve) */
  lastMonthlyAckAt?: string;
  /** Perfil / nota livre para futura ligação ao modelo */
  profileKey?: string;
};

/** Telefone para SMS (pode existir antes da constituição inicial) */
const NOTIFY_PHONE_PREFIX = "decide_client_notify_phone_v1_";

export function getNotifyPhone(username: string | null): string {
  if (!username || typeof window === "undefined") return "";
  try {
    return String(window.localStorage.getItem(`${NOTIFY_PHONE_PREFIX}${username.trim().toLowerCase()}`) || "");
  } catch {
    return "";
  }
}

export function setNotifyPhone(username: string, phone: string): void {
  if (typeof window === "undefined") return;
  try {
    const k = `${NOTIFY_PHONE_PREFIX}${username.trim().toLowerCase()}`;
    const t = phone.trim();
    if (t) window.localStorage.setItem(k, t);
    else window.localStorage.removeItem(k);
  } catch {
    // ignore
  }
}

function storageKey(username: string): string {
  return `${STORAGE_PREFIX}${username.trim().toLowerCase()}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Data local como YYYY-MM-DD */
export function toLocalYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Início do dia local */
export function parseLocalYmd(ymd: string): Date {
  const [y, m, day] = ymd.split("-").map((x) => parseInt(x, 10));
  if (!y || !m || !day) return new Date(NaN);
  return new Date(y, m - 1, day, 0, 0, 0, 0);
}

/** 1.º dia da semana útil (seg–sex) do mês, hora local */
export function firstWeekdayOfMonth(year: number, monthIndex0: number): Date {
  const d = new Date(year, monthIndex0, 1, 0, 0, 0, 0);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

/** Compara só o dia civil local: -1 | 0 | 1 */
export function compareLocalYmd(a: Date, b: Date): number {
  const ta = a.getFullYear() * 10000 + (a.getMonth() + 1) * 100 + a.getDate();
  const tb = b.getFullYear() * 10000 + (b.getMonth() + 1) * 100 + b.getDate();
  return ta < tb ? -1 : ta > tb ? 1 : 0;
}

/**
 * Primeira data do ciclo mensal global **estritamente posterior** a `after` (dia civil local).
 * Ciclo = 1.º dia útil do mês.
 */
export function nextGlobalReviewAfter(after: Date): Date {
  let y = after.getFullYear();
  let m = after.getMonth();
  for (let guard = 0; guard < 36; guard++) {
    const candidate = firstWeekdayOfMonth(y, m);
    if (compareLocalYmd(candidate, after) > 0) return candidate;
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return firstWeekdayOfMonth(y, m);
}

/**
 * Próxima data de revisão mensal **ainda não passada** relativamente a `today` (ou igual = hoje é dia de revisão).
 * Avança o ciclo global enquanto a data calculada já passou.
 */
export function getUpcomingMonthlyReviewDate(onboardingLocal: Date, today: Date = new Date()): Date {
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
  let next = nextGlobalReviewAfter(onboardingLocal);
  while (compareLocalYmd(next, todayStart) < 0) {
    next = nextGlobalReviewAfter(next);
  }
  return next;
}

export function formatPtDate(ymd: string): string {
  const d = parseLocalYmd(ymd);
  if (Number.isNaN(d.getTime())) return ymd;
  try {
    return d.toLocaleDateString("pt-PT", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return ymd;
  }
}

export function getPortfolioSchedule(username: string | null): ClientPortfolioScheduleState | null {
  if (!username || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(username));
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || typeof o !== "object" || typeof o.onboardingSnapshotAt !== "string") return null;
    return o as ClientPortfolioScheduleState;
  } catch {
    return null;
  }
}

export function savePortfolioSchedule(username: string, state: ClientPortfolioScheduleState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(username), JSON.stringify(state));
  } catch {
    // ignore
  }
}

/** Marca constituição inicial com a data de hoje (local) e opcionalmente o perfil do modelo. */
export function setOnboardingSnapshotNow(username: string, profileKey?: string): ClientPortfolioScheduleState {
  const onboardingSnapshotAt = toLocalYmd(new Date());
  const prev = getPortfolioSchedule(username);
  const state: ClientPortfolioScheduleState = {
    onboardingSnapshotAt,
    lastMonthlyAckAt: prev?.lastMonthlyAckAt,
    profileKey: profileKey ?? prev?.profileKey,
  };
  savePortfolioSchedule(username, state);
  return state;
}

/** Cliente confirma que aplicou / leu a revisão mensal (não altera a regra do ciclo global). */
export function acknowledgeMonthlyReview(username: string): void {
  const prev = getPortfolioSchedule(username);
  if (!prev) return;
  savePortfolioSchedule(username, {
    ...prev,
    lastMonthlyAckAt: toLocalYmd(new Date()),
  });
}

export function describeScheduleForUi(
  schedule: ClientPortfolioScheduleState | null,
  today: Date = new Date()
): {
  hasOnboarding: boolean;
  onboardingYmd: string | null;
  nextReviewYmd: string | null;
  nextReviewPt: string | null;
  isReviewDueToday: boolean;
  /** Constituição ainda não marcada OU hoje é dia de revisão mensal global */
  actionRequired: boolean;
  ruleSummary: string;
} {
  const ruleSummary =
    "Constituição no arranque; depois, revisões no 1.º dia útil de cada mês (ciclo global), alinhado ao modelo mensal.";
  if (!schedule) {
    return {
      hasOnboarding: false,
      onboardingYmd: null,
      nextReviewYmd: null,
      nextReviewPt: null,
      isReviewDueToday: false,
      actionRequired: true,
      ruleSummary,
    };
  }
  const ob = parseLocalYmd(schedule.onboardingSnapshotAt);
  if (Number.isNaN(ob.getTime())) {
    return {
      hasOnboarding: false,
      onboardingYmd: null,
      nextReviewYmd: null,
      nextReviewPt: null,
      isReviewDueToday: false,
      actionRequired: true,
      ruleSummary,
    };
  }
  const upcoming = getUpcomingMonthlyReviewDate(ob, today);
  const nextYmd = toLocalYmd(upcoming);
  const todayYmd = toLocalYmd(today);
  const isReviewDueToday = nextYmd === todayYmd;
  return {
    hasOnboarding: true,
    onboardingYmd: schedule.onboardingSnapshotAt,
    nextReviewYmd: nextYmd,
    nextReviewPt: formatPtDate(nextYmd),
    isReviewDueToday,
    actionRequired: isReviewDueToday,
    ruleSummary,
  };
}
