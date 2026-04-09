import pandas as pd
import json
import os

ROOT = r"C:\Users\Joaquim\Documents\DECIDE_CORE22_CLONE"
DATA = os.path.join(ROOT, "backend", "data")

PRICES_FILE = os.path.join(DATA, "prices_close_global_20y_from_tws.csv")
META_FILE = os.path.join(DATA, "universe_metadata.json")
META_CSV_FILES = [
    os.path.join(DATA, "company_meta_global_enriched.csv"),
    os.path.join(DATA, "company_meta_combined.csv"),
    os.path.join(DATA, "company_meta_global.csv"),
]

ALLOWED_ZONES = {"US", "EU", "JP", "CAN"}


def load_prices():
    df = pd.read_csv(PRICES_FILE, index_col=0, parse_dates=True)
    return df


def load_metadata():
    if os.path.exists(META_FILE):
        with open(META_FILE, "r", encoding="utf-8") as f:
            meta = json.load(f)
        return meta if isinstance(meta, dict) else {}

    for path in META_CSV_FILES:
        if not os.path.exists(path):
            continue

        df = pd.read_csv(path)
        if "ticker" not in df.columns:
            continue

        meta = {}
        for _, row in df.iterrows():
            ticker = str(row.get("ticker") or "").strip()
            if not ticker:
                continue

            rec = {}
            for key, value in row.to_dict().items():
                if pd.isna(value):
                    continue
                rec[str(key)] = value

            region = str(rec.get("zone") or rec.get("country") or "").strip()
            if region:
                rec["region"] = region
            meta[ticker] = rec

        if meta:
            return meta

    return {}


def filter_universe(prices, metadata):
    if not metadata:
        return prices

    allowed_tickers = []

    for ticker in prices.columns:

        info = metadata.get(ticker)

        if info is None:
            continue

        region = info.get("region")

        if region in ALLOWED_ZONES:
            allowed_tickers.append(ticker)

    if not allowed_tickers:
        return prices

    prices = prices[allowed_tickers]

    return prices


def compute_momentum(prices, lookback=120):

    mom = prices.pct_change(lookback)
    mom = mom.iloc[-1]

    return mom


def build_portfolio(prices):

    momentum = compute_momentum(prices)

    ranking = momentum.sort_values(ascending=False)

    top = ranking.head(20)

    weights = top / top.sum()

    portfolio = pd.DataFrame({
        "ticker": weights.index,
        "weight": weights.values
    })

    return portfolio


def run_model(profile="moderado", top_q=20, **kwargs):
    """
    Payload completo para /api/run-model (dashboard, simulador de custos).
    O adapter engine_research_v2_constrained escolhe run_model antes de run().
    """
    import engine_v2 as ev2

    return ev2.run_model(profile=profile, top_q=top_q, **kwargs)


def run():

    prices = load_prices()

    metadata = load_metadata()

    prices = filter_universe(prices, metadata)

    portfolio = build_portfolio(prices)

    return portfolio


if __name__ == "__main__":

    p = run()

    print(p)