# -*- coding: utf-8 -*-
"""Limpeza de séries de fechos — glitches Yahoo (saltos absurdos) que distorcem momentum no motor."""
from __future__ import annotations

import os
import re

import numpy as np
import pandas as pd

_TSE_CSV_SUFFIX = re.compile(r"\.[Tt]$|[-][Tt]$")


def _patch_stale_plateau_before_jpy_spike(s: pd.Series, *, ratio: float = 40.0, min_post: float = 2500.0) -> pd.Series:
    """Corrige plataforma Yahoo errada (ex. ~11) seguida de JPY real (~40k) nos últimos meses."""
    s2 = s.astype(float).copy()
    for _ in range(30):
        if len(s2) < 5:
            break
        hit_idx = None
        for pos in range(len(s2) - 1, 0, -1):
            a, b = float(s2.iloc[pos - 1]), float(s2.iloc[pos])
            if not (np.isfinite(a) and np.isfinite(b) and a > 0):
                continue
            if b < min_post or a >= b / ratio:
                continue
            if b / a < ratio:
                continue
            hit_idx = pos
            break
        if hit_idx is None:
            break
        post = float(s2.iloc[hit_idx])
        thresh = post / ratio
        n = 0
        k = hit_idx - 1
        # Yahoo pode manter escala errada durante anos; apagar até 600 sessões ou até preço coerente
        while k >= 0 and n < 600 and float(s2.iloc[k]) < thresh:
            s2.iloc[k] = np.nan
            k -= 1
            n += 1
        s2 = s2.bfill().ffill()
    return s2


def sanitize_extreme_daily_closes(
    df: pd.DataFrame,
    *,
    max_abs_daily: float | None = None,
    max_iterations: int = 25,
) -> pd.DataFrame:
    """
    Anula fechos em dias com |retorno diário| > limiar e re-preenche com ffill/bfill por coluna.

    Repete até não haver saltos (corrige sequências p.ex. Yahoo a colar 11.54 e depois ~40k JPY).

    `max_abs_daily`: fração (1.0 = 100% num dia). Defeito: env ``DECIDE_PRICES_SANITIZE_MAX_DAILY_PCT``
    ou 1.0; use 0 para desactivar.
    """
    if df.empty:
        return df
    raw = (os.environ.get("DECIDE_PRICES_SANITIZE_MAX_DAILY_PCT") or "").strip()
    lim = max_abs_daily
    if lim is None:
        try:
            lim = float(raw) if raw else 1.0
        except ValueError:
            lim = 1.0
    if lim <= 0:
        return df

    out = df.copy()
    for col in out.columns:
        s2 = pd.to_numeric(out[col], errors="coerce")
        for _ in range(max(1, max_iterations)):
            ch = s2.pct_change()
            bad = ch.abs() > lim
            if not bad.any():
                break
            s2 = s2.copy()
            s2.loc[bad.fillna(False).astype(bool)] = np.nan
            # bfill primeiro: corrige plataforma errada seguida de fechos reais (ex. .T Yahoo)
            s2 = s2.bfill().ffill()
        if _TSE_CSV_SUFFIX.search(str(col)):
            s2 = _patch_stale_plateau_before_jpy_spike(s2)
        out[col] = s2
    return out
