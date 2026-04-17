/**
 * Landing / simulador de custos: série alinhada ao Modelo CAP15 (`compute_client_embed_plafonado_kpis` no kpi_server)
 * (CAP15 + m100; moderado alvo 1× no motor e alinhamento 1× no cliente como no KPI strict; conservador/dinâmico com alvo vs benchmark; no Flask `DECIDE_KPI_REAL_EQUITY=1` só mexe na escolha do CSV no embed).
 */

import type { NextApiRequest, NextApiResponse } from "next";
import {
  buildPlafonadoEmbedLikeSeries,
  normalizeRiskProfileKeyForKpi,
} from "../../../lib/plafonadoFeesSeries";

function normalizeProfileParam(raw: unknown): string {
  return normalizeRiskProfileKeyForKpi(
    raw === undefined || raw === null ? undefined : String(raw),
  );
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const profile = normalizeProfileParam(
    typeof req.query.profile === "string" ? req.query.profile : undefined,
  );

  const built = buildPlafonadoEmbedLikeSeries(profile, process.cwd());
  if (!built) {
    return res.status(404).json({
      ok: false,
      error:
        "Freeze CAP15 / m100 ou landing freeze-cap15 não encontrado. Coloca os CSV no monorepo ou em frontend/data/landing/freeze-cap15/.",
    });
  }

  return res.status(200).json({
    ok: true,
    series: {
      dates: built.dates,
      benchmark_equity: built.benchmark_equity,
      equity_overlayed: built.equity_overlayed,
      equity_raw: built.equity_raw,
    },
    result: {
      kind: "freeze_v5_plafonado_embed_aligned",
      profile: built.meta.profile,
      note:
        "Mesma construção que o cartão «Modelo CAP15» / `/api/embed-plafonado-cagr` (kpi_server): CAP15 + m100 plafonado; moderado ≈1× vol ref. (motor + alinhamento no cliente); conservador/dinâmico com alvo vs benchmark.",
      aligned_cap15_m100: built.meta.aligned_cap15_m100,
      force_synthetic_vol: built.meta.force_synthetic_vol,
      used_m100_profile_file: built.meta.used_m100_profile_file,
      /** Evita segundo filtro de vol no cliente (landing); a série do API já está final. */
      vol_matched_for_landing: true,
    },
  });
}
