/**
 * Pares cambiais disponíveis para preferência de hedge (segmento Private).
 * O backend usa ficheiros `backend/data/fx_{PAIR}_daily.csv` (ex.: fx_EURUSD_daily.csv).
 */

export type FxHedgePairId = "EURUSD" | "GBPUSD" | "USDCHF" | "EURGBP" | "AUDUSD";

export type ResidenceOption = {
  code: string;
  label: string;
};

/** Lista curta para o onboarding — expandível. */
export const RESIDENCE_OPTIONS: ResidenceOption[] = [
  { code: "PT", label: "Portugal" },
  { code: "ES", label: "Espanha" },
  { code: "FR", label: "França" },
  { code: "DE", label: "Alemanha" },
  { code: "IT", label: "Itália" },
  { code: "NL", label: "Países Baixos" },
  { code: "BE", label: "Bélgica" },
  { code: "AT", label: "Áustria" },
  { code: "IE", label: "Irlanda" },
  { code: "GB", label: "Reino Unido" },
  { code: "CH", label: "Suíça" },
  { code: "US", label: "Estados Unidos" },
  { code: "BR", label: "Brasil" },
  { code: "OTHER", label: "Outro" },
];

export type FxPairChoice = { id: FxHedgePairId; label: string; hint: string };

const EU_AREA_PAIRS: FxPairChoice[] = [
  {
    id: "EURUSD",
    label: "EUR/USD",
    hint: "Cobre exposição cambial típica quando o investimento global está em dólares e a sua referência é o euro.",
  },
  {
    id: "EURGBP",
    label: "EUR/GBP",
    hint: "Útil se quiser focar hedge face ao esterlino (exposição UK vs euro).",
  },
];

const UK_PAIRS: FxPairChoice[] = [
  {
    id: "GBPUSD",
    label: "GBP/USD",
    hint: "Hedge da exposição USD vs libra — comum em carteiras globais domiciliadas em GBP.",
  },
  {
    id: "EURGBP",
    label: "EUR/GBP",
    hint: "Para gerir exposição euro vs libra.",
  },
];

const CH_PAIRS: FxPairChoice[] = [
  {
    id: "USDCHF",
    label: "USD/CHF",
    hint: "Hedge típico CHF vs USD para componentes dolarizados da carteira.",
  },
  {
    id: "EURUSD",
    label: "EUR/USD",
    hint: "Alternativa quando a referência de investimento é euro.",
  },
];

const US_PAIRS: FxPairChoice[] = [
  {
    id: "EURUSD",
    label: "EUR/USD",
    hint: "Se a carteira tiver componente europeia em EUR e quiser neutralizar parte do risco USD/EUR.",
  },
  {
    id: "AUDUSD",
    label: "AUD/USD",
    hint: "Contexto de exposição vs dólar australiano.",
  },
];

const DEFAULT_OTHER: FxPairChoice[] = [
  {
    id: "EURUSD",
    label: "EUR/USD",
    hint: "Par mais líquido para hedge ilustrativo; confirme com o seu assessor a moeda de referência.",
  },
];

/** Pares sugeridos por país (residência). */
export const FX_PAIRS_BY_RESIDENCE: Record<string, FxPairChoice[]> = {
  PT: EU_AREA_PAIRS,
  ES: EU_AREA_PAIRS,
  FR: EU_AREA_PAIRS,
  DE: EU_AREA_PAIRS,
  IT: EU_AREA_PAIRS,
  NL: EU_AREA_PAIRS,
  BE: EU_AREA_PAIRS,
  AT: EU_AREA_PAIRS,
  IE: EU_AREA_PAIRS,
  GB: UK_PAIRS,
  CH: CH_PAIRS,
  US: US_PAIRS,
  BR: DEFAULT_OTHER,
  OTHER: DEFAULT_OTHER,
};

export function fxPairChoicesForResidence(residenceCode: string): FxPairChoice[] {
  const c = (residenceCode || "OTHER").toUpperCase();
  return FX_PAIRS_BY_RESIDENCE[c] || FX_PAIRS_BY_RESIDENCE.OTHER;
}
