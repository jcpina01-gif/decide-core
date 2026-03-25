import React from "react";

type AnyObj = Record<string, any>;

function n(x: any): string {
  if (x === null || x === undefined) return "—";
  if (typeof x === "number") return Number.isFinite(x) ? x.toFixed(4) : String(x);
  return String(x);
}

export default function StructuralStageCard(props: { data: AnyObj }) {
  const data = props?.data || {};
  const detail = data?.detail || {};
  const st = detail?.structural_stage || {};
  const mults = st?.multipliers || {};

  const profile = st?.profile ?? data?.profile_effective ?? data?.profile ?? "—";

  const expMin = st?.exposure_min;
  const expMax = st?.exposure_max;
  const expTgt = st?.exposure_target;

  const mReg = mults?.multiplier_regime ?? data?.multiplier_regime;
  const mVol = mults?.multiplier_vol_target ?? data?.multiplier_vol_target;
  const mRaw = mults?.multiplier_total_raw ?? data?.multiplier_total_raw;
  const mUsed = mults?.multiplier_total_used ?? data?.multiplier_total_used;

  const clampReason = st?.clamp_reason ?? "—";

  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-white/90">Structural Stage</div>
        <div className="text-xs text-white/60">profile: {String(profile)}</div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="text-xs text-white/60">Exposure band</div>
          <div className="mt-1 text-sm text-white/90">
            min {n(expMin)} · max {n(expMax)} · target {n(expTgt)}
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="text-xs text-white/60">Multipliers</div>
          <div className="mt-1 text-sm text-white/90">
            regime {n(mReg)} · vol {n(mVol)}
          </div>
          <div className="mt-1 text-xs text-white/70">
            raw {n(mRaw)} · used {n(mUsed)}
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="text-xs text-white/60">Clamp</div>
          <div className="mt-1 text-sm text-white/90">{String(clampReason)}</div>
          <div className="mt-1 text-xs text-white/70">
            {mRaw !== null && mRaw !== undefined && mUsed !== null && mUsed !== undefined
              ? `Δ ${(Number(mUsed) - Number(mRaw)).toFixed(6)}`
              : "—"}
          </div>
        </div>
      </div>
    </div>
  );
}