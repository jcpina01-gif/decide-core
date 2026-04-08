/**
 * Back-office interno: em produção só activo com `DECIDE_BACKOFFICE_ENABLED=1`.
 * Em `NODE_ENV=development` fica acessível sem variável (equipa local).
 */
export function isBackofficeEnabled(): boolean {
  if (process.env.NODE_ENV === "development") return true;
  return String(process.env.DECIDE_BACKOFFICE_ENABLED ?? "").trim() === "1";
}
