"""
Study site screening for Task 1.1 (FWF ESPRIT proposal).

Stage 1 (cheap, all candidates):
    climate zone share (Beck et al. 2018), permanent ice share, water share,
    share of steep terrain, number of broad surface classes (ESA WorldCover 2021).
Stage 2 (expensive, all candidates):
    clear Landsat 8/9 + Sentinel-2 observations per year, orbit overlap indicator,
    scene counts per year (gaps in the archive).

Observation counts use simple cloud masks (Landsat QA_PIXEL, Cloud Score+ for S2)
and are meant for ranking candidates, not as final S0 metrics (those come from FORCE).

Criteria (Task 1.1):
    1  >= 80 % of land area in one Koeppen main zone, permanent ice (EF) excluded
    2  per zone one site with high and one with low clear-observation count
    3  at least one orbit overlap strip inside the site
    4  >= 3 broad surface classes with >= 10 % of land area each
    5  exclusion: > 20 % water, > 25 % of area steeper than 20 deg, years with large gaps
"""

import ee
import pandas as pd

ee.Initialize(project="YOUR_GEE_PROJECT")

# Beck et al. (2018) present-day Koeppen-Geiger map at 1 km, uploaded as an asset.
# Classes: 1-3 A, 4-7 B, 8-16 C, 17-28 D, 29 ET, 30 EF, 0 ocean.
KOPPEN_ASSET = "projects/YOUR_GEE_PROJECT/assets/koppen_geiger"

START, END = "2018-01-01", "2026-01-01"
YEARS = list(range(2018, 2026))
HALF_SIZE_M = 50_000  # 100 x 100 km

T = dict(
    zone_share=0.80,
    ef_share=0.05,
    water_share=0.20,
    steep_share=0.25,
    class_share=0.10,
    min_broad_classes=3,
    overlap_ratio=1.3,   # acquisitions p90 / p10 inside the site
    year_ratio=0.5,      # scenes in weakest year / median year
)

ZONES = {1: "A", 2: "B", 3: "C", 4: "D", 5: "E"}

# Unverified starting candidates (centre lon, lat). Extend with grid_candidates().
CANDIDATES = [
    dict(id="A_matogrosso",   zone="A", lon=-55.5,  lat=-11.9),
    dict(id="A_rondonia",     zone="A", lon=-62.5,  lat=-10.0),
    dict(id="A_kalimantan",   zone="A", lon=113.9,  lat=-2.3),
    dict(id="A_gabon",        zone="A", lon=11.8,   lat=-0.7),
    dict(id="B_imperial",     zone="B", lon=-115.4, lat=32.9),
    dict(id="B_sonora",       zone="B", lon=-111.3, lat=29.0),
    dict(id="B_senegal",      zone="B", lon=-14.8,  lat=16.4),
    dict(id="B_niger",        zone="B", lon=2.3,    lat=13.6),
    dict(id="C_extremadura",  zone="C", lon=-6.3,   lat=39.0),
    dict(id="C_centralvalley",zone="C", lon=-120.4, lat=37.0),
    dict(id="C_southchile",   zone="C", lon=-73.0,  lat=-40.5),
    dict(id="C_ireland",      zone="C", lon=-8.0,   lat=53.0),
    dict(id="D_saskatchewan", zone="D", lon=-105.5, lat=52.0),
    dict(id="D_finland",      zone="D", lon=26.0,   lat=62.5),
    dict(id="D_westsiberia",  zone="D", lon=73.0,   lat=61.0),
    dict(id="E_northslope",   zone="E", lon=-152.0, lat=70.0),
    dict(id="E_yamal",        zone="E", lon=70.5,   lat=68.8),
    dict(id="E_kivalliq",     zone="E", lon=-96.0,  lat=64.3),
]


def grid_candidates(zone, lon_min, lat_min, lon_max, lat_max, step_deg=1.0):
    """Regular grid of candidate centres inside a bounding box, for a systematic search."""
    out, lat = [], lat_min
    while lat <= lat_max:
        lon = lon_min
        while lon <= lon_max:
            out.append(dict(id=f"{zone}_{lon:.1f}_{lat:.1f}", zone=zone, lon=lon, lat=lat))
            lon += step_deg
        lat += step_deg
    return out


def site_geom(lon, lat):
    return ee.Geometry.Point([lon, lat]).buffer(HALF_SIZE_M).bounds()


def to_fc(cands):
    return ee.FeatureCollection([
        ee.Feature(site_geom(c["lon"], c["lat"]), dict(c)) for c in cands
    ])


# ---------------------------------------------------------------- stage 1

koppen = ee.Image(KOPPEN_ASSET).select(0)
zone_img = koppen.remap(list(range(1, 31)), [1]*3 + [2]*4 + [3]*9 + [4]*12 + [5]*2)
ef_img = koppen.eq(30).updateMask(koppen.gt(0))

wc = ee.ImageCollection("ESA/WorldCover/v200").first().select("Map")
land = wc.neq(80)  # masked over ocean if WorldCover has no data there

BROAD = {
    "woody": [10, 95], "shrub": [20], "herbaceous": [30, 100], "cropland": [40],
    "built": [50], "bare": [60], "snow_ice": [70], "wetland": [90],
}

dem_col = ee.ImageCollection("COPERNICUS/DEM/GLO30").select("DEM")
dem = dem_col.mosaic().setDefaultProjection(dem_col.first().projection())
steep = ee.Terrain.slope(dem).gt(20)

stage1_img = ee.Image.cat(
    [zone_img.eq(z).rename(f"zone_{z}") for z in ZONES]
    + [ef_img.rename("ef_share"),
       land.unmask(0).rename("land_share"),
       steep.rename("steep_share")]
    + [wc.remap(v, [1]*len(v), 0).updateMask(land).rename(f"cls_{k}")
       for k, v in BROAD.items()]
)


def stage1(f):
    stats = stage1_img.reduceRegion(
        reducer=ee.Reducer.mean(), geometry=f.geometry(),
        scale=100, maxPixels=1e9, tileScale=4,
    )
    return f.set(stats)


def evaluate_stage1(df):
    zcols = [f"zone_{z}" for z in ZONES]
    df["zone_dom"] = df[zcols].idxmax(axis=1).str[-1].astype(int).map(ZONES)
    df["zone_share"] = df[zcols].max(axis=1)
    df["water_share"] = 1 - df["land_share"]
    cls = [c for c in df.columns if c.startswith("cls_")]
    df["n_broad_classes"] = (df[cls] >= T["class_share"]).sum(axis=1)
    df["pass_stage1"] = (
        (df["zone_dom"] == df["zone"])
        & (df["zone_share"] >= T["zone_share"])
        & (df["ef_share"].fillna(0) <= T["ef_share"])
        & (df["water_share"] <= T["water_share"])
        & (df["steep_share"] <= T["steep_share"])
        & (df["n_broad_classes"] >= T["min_broad_classes"])
    )
    return df


# ---------------------------------------------------------------- stage 2

def ls_bands(img):
    qa = img.select("QA_PIXEL")
    acq = qa.bitwiseAnd(1).eq(0)            # not fill
    clear = qa.bitwiseAnd(0b11111).eq(0)    # no fill, dilated cloud, cirrus, cloud, shadow
    return ee.Image.cat(acq.selfMask().rename("acq"),
                        clear.selfMask().rename("valid")).copyProperties(img, ["system:time_start"])


def s2_bands(img):
    acq = img.select("B4").gt(0)
    clear = acq.And(img.select("cs_cdf").gte(0.6))
    return ee.Image.cat(acq.selfMask().rename("acq"),
                        clear.selfMask().rename("valid")).copyProperties(img, ["system:time_start"])


def daily(col):
    """One mosaic per acquisition day, so overlapping tiles/rows of the same pass count once."""
    days = col.aggregate_array("system:time_start") \
              .map(lambda t: ee.Date(t).format("YYYY-MM-dd")).distinct()
    return ee.ImageCollection.fromImages(days.map(
        lambda d: col.filterDate(ee.Date(d), ee.Date(d).advance(1, "day")).mosaic()))


def scenes_per_year(col):
    return ee.List(YEARS).map(lambda y: col.filter(ee.Filter.calendarRange(y, y, "year")).size())


def stage2(f):
    g = f.geometry()
    ls = (ee.ImageCollection("LANDSAT/LC08/C02/T1_L2")
          .merge(ee.ImageCollection("LANDSAT/LC09/C02/T1_L2"))
          .filterBounds(g).filterDate(START, END))
    s2 = (ee.ImageCollection("COPERNICUS/S2_HARMONIZED")
          .filterBounds(g).filterDate(START, END)
          .linkCollection(ee.ImageCollection("GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED"), ["cs_cdf"]))

    counts = (daily(ls.map(ls_bands)).count().unmask(0)
              .add(daily(s2.map(s2_bands)).count().unmask(0)))

    stats = counts.reduceRegion(
        reducer=ee.Reducer.mean().combine(ee.Reducer.percentile([10, 90]), sharedInputs=True),
        geometry=g, scale=300, maxPixels=1e9, tileScale=8,
    )

    per_year = ee.List(scenes_per_year(ls)).zip(scenes_per_year(s2)) \
        .map(lambda p: ee.Number(ee.List(p).get(0)).add(ee.List(p).get(1)))
    year_ratio = ee.Number(per_year.reduce(ee.Reducer.min())) \
        .divide(ee.Number(per_year.reduce(ee.Reducer.median())))

    return f.set(stats).set("year_ratio", year_ratio)


def evaluate_stage2(df):
    n = len(YEARS)
    df["clear_obs_per_year"] = df["valid_mean"] / n
    df["clear_p10_per_year"] = df["valid_p10"] / n
    df["clear_p90_per_year"] = df["valid_p90"] / n
    df["overlap_ratio"] = df["acq_p90"] / df["acq_p10"]
    df["pass_stage2"] = (df["overlap_ratio"] >= T["overlap_ratio"]) & (df["year_ratio"] >= T["year_ratio"])
    return df


def pick_pairs(df):
    """Per zone, the passing site with the most and the fewest clear observations."""
    ok = df[df["pass_stage1"] & df["pass_stage2"]]
    rows = []
    for z, sub in ok.groupby("zone"):
        sub = sub.sort_values("clear_obs_per_year")
        rows.append(sub.iloc[-1].assign(role="high density"))
        if len(sub) > 1:
            rows.append(sub.iloc[0].assign(role="low density"))
    return pd.DataFrame(rows)[["zone", "role", "id", "lon", "lat", "zone_share",
                               "clear_obs_per_year", "overlap_ratio", "n_broad_classes",
                               "water_share", "steep_share"]]


# ---------------------------------------------------------------- run

if __name__ == "__main__":
    cands = CANDIDATES  # + grid_candidates("E", -110, 62, -90, 70, 2.0)
    fc = to_fc(cands)

    # Stage 1 is small enough for getInfo
    s1 = fc.map(stage1).getInfo()
    df1 = pd.DataFrame([dict(x["properties"]) for x in s1])
    df1 = evaluate_stage1(df1)
    df1.to_csv("screening_stage1.csv", index=False)
    print(df1[["id", "zone", "zone_dom", "zone_share", "water_share",
               "steep_share", "n_broad_classes", "pass_stage1"]])

    # Stage 2 is heavy, so it runs as an export task
    fc2 = fc.map(stage2)
    task = ee.batch.Export.table.toDrive(
        collection=fc2, description="site_screening_stage2",
        fileFormat="CSV", selectors=["id", "acq_mean", "acq_p10", "acq_p90",
                                     "valid_mean", "valid_p10", "valid_p90", "year_ratio"],
    )
    task.start()
    print("Stage 2 export started. When finished, download the CSV and run:")
    print("  df2 = evaluate_stage2(pd.read_csv('site_screening_stage2.csv'))")
    print("  df = df1.merge(df2, on='id', how='left').fillna({'pass_stage2': False})")
    print("  print(pick_pairs(df))")
