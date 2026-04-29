import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Valor canónico da fee Premium (€/mês). Manter igual a `DECIDE_PREMIUM_MONTHLY_FEE_EUR` em
 * `decidePremiumFeeEur.ts`. Resposta aqui em literal para o JSON não depender do bundle do import.
 */
const PREMIUM_MONTHLY_FEE_EUR_API = 25;

/**
 * Valor canónico da fee Premium (€/mês) para o simulador — pedido no cliente com `no-store`
 * para sobrepor bundles/HTML antigos em cache quando o deploy já está actualizado.
 */
export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  res.status(200).json({ premiumMonthlyFeeEur: PREMIUM_MONTHLY_FEE_EUR_API });
}
