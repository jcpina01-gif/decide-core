import type { NextApiRequest, NextApiResponse } from "next";
import { resolveDecideProjectRoot } from "../../../lib/server/decideProjectRoot";
import { loadApprovalAlignedProposedTrades } from "../../../lib/server/approvalTradePlan";

function safeNumber(x: unknown, fallback = 0): number {
  const v = typeof x === "number" ? x : Number(x);
  return Number.isFinite(v) ? v : fallback;
}

const MAX_REFERENCE_NAV_EUR = 50_000_000;

type OkBody = {
  ok: true;
  navEur: number;
  trades: Awaited<ReturnType<typeof loadApprovalAlignedProposedTrades>>["trades"];
  coverageNote: string;
  csvRowCount: number;
};

type ErrBody = { ok: false; error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<OkBody | ErrBody>,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  let body: unknown = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body) as unknown;
    } catch {
      res.status(400).json({ ok: false, error: "JSON inválido" });
      return;
    }
  }
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const referenceNavEur = safeNumber(b.referenceNavEur, 0);
  if (!(referenceNavEur > 0) || referenceNavEur > MAX_REFERENCE_NAV_EUR) {
    res.status(400).json({ ok: false, error: "referenceNavEur inválido" });
    return;
  }

  try {
    const projectRoot = resolveDecideProjectRoot();
    const { trades, navEur, coverageNote, csvRowCount } = await loadApprovalAlignedProposedTrades(projectRoot, {
      navOverrideEur: Math.round(referenceNavEur),
    });
    res.status(200).json({ ok: true, trades, navEur, coverageNote, csvRowCount });
  } catch (e) {
    console.error("[api/client/approval-plan]", e);
    res.status(500).json({ ok: false, error: "Falha ao construir o plano" });
  }
}
