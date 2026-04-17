/**
 * Pasta do freeze CAP15 plafonado (≤100% NAV) usada em produto: iframe Flask, APIs Next, simulador.
 * Alinhar com `MODEL_PATHS["v5_overlay_cap15_max100exp"]` no kpi_server.py.
 */
export const FREEZE_PLAFONADO_MODEL_DIR = "DECIDE_MODEL_V5_V2_3_SMOOTH";

/** Cabeçalhos do Plano / relatório — mesmo freeze que o simulador (V2.3 smooth). */
export const PLAFONADO_MODEL_DISPLAY_NAME_PT =
  "Modelo DECIDE V2.3 smooth (plafonado CAP15, ≤100% NV, momentum prudente)";

/** Frase curta para texto corrido (Carteira, avisos). */
export const PLAFONADO_MODEL_INLINE_PT =
  "modelo DECIDE V2.3 smooth (plafonado CAP15, momentum prudente)";
