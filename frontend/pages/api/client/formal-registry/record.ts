import type { NextApiRequest, NextApiResponse } from "next";
import {
  commitFormalClientRecord,
  FORMAL_CLIENT_MIN_BALANCE_EUR,
} from "../../../../lib/server/clientFormalRegistryStore";

type Body = {
  username?: string;
  email?: string;
  phone?: string;
  ibkrAccountId?: string;
  flowCompleted?: boolean;
  ibkrAccountOpened?: boolean;
  balanceEur?: number;
};

/**
 * Grava email/telemóvel na base formal de clientes (servidor) apenas quando:
 * fluxo concluído + conta IBKR aberta + saldo >= 5000 EUR.
 * O upstream (onboarding / integração IBKR) deve chamar isto após validar os dados reais.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  if (process.env.ALLOW_CLIENT_NOTIFY_API !== "1") {
    return res.status(503).json({ ok: false, error: "api_disabled" });
  }

  let body: Body = {};
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body as Body) || {};
  } catch {
    return res.status(400).json({ ok: false, error: "invalid_json" });
  }

  const result = commitFormalClientRecord({
    username: String(body.username || ""),
    email: String(body.email || ""),
    phone: body.phone != null ? String(body.phone) : undefined,
    ibkrAccountId: body.ibkrAccountId != null ? String(body.ibkrAccountId) : undefined,
    flowCompleted: body.flowCompleted === true,
    ibkrAccountOpened: body.ibkrAccountOpened === true,
    balanceEur: Number(body.balanceEur),
  });

  if (!result.ok) {
    const status =
      result.error === "balance_below_minimum" || result.error === "flow_not_completed" || result.error === "ibkr_not_opened"
        ? 422
        : 400;
    return res.status(status).json({
      ok: false,
      error: result.error,
      minBalanceEur: FORMAL_CLIENT_MIN_BALANCE_EUR,
    });
  }

  return res.status(200).json({ ok: true });
}
