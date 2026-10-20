"""
Select ten focus sites from the stage 2 table of site_screening.js.

Rule
    Per Koeppen zone, one site with high and one with low clear-observation density.
    Among all candidates that pass stage 1 and stage 2, the pair per zone with the
    largest ratio of clear observations (high / low) is chosen, subject to
      - at most two sites per country (criterion 8),
      - no overlap between any two selected 100 x 100 km sites.
    The pairs of all zones are chosen jointly. First, the smallest of the five
    within-zone ratios is made as large as possible, so that every zone keeps a clear
    contrast. Among the selections that reach this value, the one with the largest
    product of the five ratios is taken. Without the country limit this reduces to
    the candidate with the most and the one with the fewest clear observations in
    each zone.

Usage
    python select_sites.py stage2_batch1.csv [stage2_batch2.csv ...] [--out site_selection.csv]

    Several stage 2 tables (batches) are combined; for duplicate ids the last file wins.
    If a table has no 'country' column, the country is taken from the candidate id.
"""

import argparse
import math
from itertools import combinations

import pandas as pd

MAX_PER_COUNTRY = 2
HALF_SIZE_KM = 50.0
ZONES = ["A", "B", "C", "D", "E"]

# Country by candidate id prefix (longest matching prefix wins), as in site_screening.js
COUNTRY_BY_PREFIX = {
    "A_matogrosso": "BR", "A_rondonia": "BR", "A_para": "BR", "A_kalimantan": "ID",
    "A_sumatra": "ID", "A_gabon": "GA", "A_ghana": "GH", "A_cotedivoire": "CI",
    "A_nigeria": "NG", "A_cameroon": "CM", "A_uganda": "UG", "A_madagascar": "MG",
    "B_imperial": "US", "B_sonora": "MX", "B_senegal": "SN", "B_niger": "NE",
    "B_caatinga": "BR", "B_botswana": "BW", "B_peru": "PE",
    "C_extremadura": "ES", "C_centralvalley": "US", "C_southchile": "CL", "C_ireland": "IE",
    "D_saskatchewan": "CA", "D_finland": "FI", "D_westsiberia": "RU", "D_lithuania": "LT",
    "D_kostroma": "RU", "D_claybelt": "CA", "D_belarus": "BY", "D_ukraine": "UA",
    "D_wisconsin": "US", "D_songnen": "CN", "D_sanjiang": "CN", "D_hokkaido": "JP",
    "E_northslope": "US", "E_yamal": "RU", "E_taimyr": "RU", "E_victoria": "CA",
    "E_banks": "CA", "E_kivalliq": "CA", "E_tibet": "CN", "E_altiplano": "BO",
}


def country_of(site_id):
    hits = [p for p in COUNTRY_BY_PREFIX if site_id.startswith(p)]
    if not hits:
        raise SystemExit(f"No country known for candidate '{site_id}'.")
    return COUNTRY_BY_PREFIX[max(hits, key=len)]


def overlaps(a, b):
    """True if two 100 x 100 km squares (given by centre lon/lat) overlap."""
    dlat_km = abs(a.lat - b.lat) * 111.32
    mean_lat = math.radians((a.lat + b.lat) / 2)
    dlon = abs(a.lon - b.lon)
    dlon = min(dlon, 360 - dlon)
    dlon_km = dlon * 111.32 * math.cos(mean_lat)
    return dlat_km < 2 * HALF_SIZE_KM and dlon_km < 2 * HALF_SIZE_KM


def zone_pairs(df_zone):
    """All (high, low) pairs within a zone, sorted by ratio (largest first)."""
    rows = list(df_zone.itertuples(index=False))
    pairs = []
    for a, b in combinations(rows, 2):
        high, low = (a, b) if a.clear_obs_per_year >= b.clear_obs_per_year else (b, a)
        if high.clear_obs_per_year == low.clear_obs_per_year or overlaps(high, low):
            continue
        ratio = high.clear_obs_per_year / low.clear_obs_per_year
        pairs.append((math.log(ratio), high, low))
    pairs.sort(key=lambda p: p[0], reverse=True)
    return pairs


def select(df):
    ok = df[(df["pass_stage1"] == 1) & (df["pass_stage2"] == 1)].copy()
    pairs = {z: zone_pairs(ok[ok["zone"] == z]) for z in ZONES}
    for z in ZONES:
        if not pairs[z]:
            raise SystemExit(f"Zone {z}: fewer than two candidates pass all criteria.")

    def feasible(i, chosen, allowed):
        if i == len(ZONES):
            return True
        for p in allowed[ZONES[i]]:
            if compatible(chosen, p):
                chosen.append(p)
                if feasible(i + 1, chosen, allowed):
                    chosen.pop()
                    return True
                chosen.pop()
        return False

    def compatible(chosen, p):
        _, high, low = p
        sites = [x for q in chosen for x in q[1:]]
        countries = pd.Series([x.country for x in sites + [high, low]]).value_counts()
        if (countries > MAX_PER_COUNTRY).any():
            return False
        return not any(overlaps(n, o) for n in (high, low) for o in sites)

    # 1) largest achievable minimum ratio across zones
    thresholds = sorted({p[0] for z in ZONES for p in pairs[z]}, reverse=True)
    t_best = None
    for t in thresholds:
        allowed = {z: [p for p in pairs[z] if p[0] >= t] for z in ZONES}
        if all(allowed.values()) and feasible(0, [], allowed):
            t_best = t
            break
    if t_best is None:
        raise SystemExit("No selection satisfies the country limit.")

    # 2) among selections reaching this minimum, the largest product of ratios
    allowed = {z: [p for p in pairs[z] if p[0] >= t_best] for z in ZONES}
    best_rest = [sum(allowed[z][0][0] for z in ZONES[i:]) for i in range(len(ZONES))] + [0.0]
    best = {"score": -math.inf, "choice": None}

    def search(i, chosen, score):
        if score + best_rest[i] <= best["score"]:
            return
        if i == len(ZONES):
            best["score"], best["choice"] = score, list(chosen)
            return
        for p in allowed[ZONES[i]]:
            if compatible(chosen, p):
                chosen.append(p)
                search(i + 1, chosen, score + p[0])
                chosen.pop()

    search(0, [], 0.0)

    out = []
    for z, (s, high, low) in zip(ZONES, best["choice"]):
        for role, r in (("high", high), ("low", low)):
            out.append({"zone": z, "sampling": role, "id": r.id, "country": r.country,
                        "lon": r.lon, "lat": r.lat,
                        "clear_obs_per_year": round(r.clear_obs_per_year, 2),
                        "overlap_ratio": round(r.overlap_ratio, 2),
                        "ratio_within_zone": round(math.exp(s), 2)})
    return pd.DataFrame(out)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("stage2_csv", nargs="+")
    ap.add_argument("--out", default="site_selection.csv")
    args = ap.parse_args()

    df = pd.concat([pd.read_csv(f) for f in args.stage2_csv], ignore_index=True)
    df = df.drop_duplicates(subset="id", keep="last")
    if "country" not in df.columns:
        df["country"] = None
    df["country"] = [c if isinstance(c, str) and c else country_of(i)
                     for i, c in zip(df["id"], df["country"])]
    sel = select(df)
    sel.to_csv(args.out, index=False)
    print(sel.to_string(index=False))
    print(f"\nSaved to {args.out}")
