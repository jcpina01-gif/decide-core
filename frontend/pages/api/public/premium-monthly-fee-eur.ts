import type { NextApiRequest, NextApiResponse } from "next";
import { DECIDE_PREMIUM_MONTHLY_FEE_EUR } from "../../../lib/decidePremiumFeeEur";

/**
 * Valor canónico da fee Premium (€/mês) para o simulador — pedido no cliente com `no-store`
 * para sobrepor bundles/HTML antigos em cache quando o deploy já está actualizado.
 */
export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  res.status(200).json({ premiumMonthlyFeeEur: DECIDE_PREMIUM_MONTHLY_FEE_EUR });
}
