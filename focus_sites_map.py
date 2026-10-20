"""
Map of the selected focus sites on the main Koeppen-Geiger climate zones (Figure 2).

Usage
    python focus_sites_map.py --koppen koppen_main_zones.tif [--sites results/site_selection.csv]

The climate raster is a GeoTIFF in geographic coordinates (EPSG:4326) with the main
zones coded 1 = A, 2 = B, 3 = C, 4 = D, 5 = E and 0 = ocean / no data. It can be exported
from Earth Engine with export_koppen_main_zones.js. Coarse resolution (about 0.1 degree)
is enough for a global map.

Requires: pandas, numpy, matplotlib, rasterio, geopandas<1.0 (bundled Natural Earth outlines)
"""

import argparse
import warnings

import geopandas as gpd
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import rasterio
from matplotlib.colors import ListedColormap
from matplotlib.lines import Line2D
from matplotlib.patches import Patch
from shapely.geometry import Point

warnings.filterwarnings("ignore")
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 7})

CRS = "EPSG:8857"  # Equal Earth

ZONES = {
    1: ("A tropical", "#009E73"),
    2: ("B arid", "#E69F00"),
    3: ("C temperate", "#0072B2"),
    4: ("D continental", "#D55E00"),
    5: ("E polar and alpine tundra", "#6A3D9A"),
}
ZONE_NUM = {"A": 1, "B": 2, "C": 3, "D": 4, "E": 5}


def tint(hex_colour, f):
    """Mix a colour with white (f = share of the original colour)."""
    rgb = np.array([int(hex_colour[i:i + 2], 16) for i in (1, 3, 5)]) / 255
    return tuple(1 - f * (1 - rgb))


# Labels and label offsets (points) for the selected sites
LABELS = {
    "A_matogrosso": ("Mato Grosso, Brazil", (4, -11), "center"),
    "A_cameroon": ("Central Cameroon", (7, 4), "left"),
    "B_sonora": ("Sonora, Mexico", (-7, -3), "right"),
    "B_caatinga_e10": ("Caatinga, Brazil", (7, -3), "left"),
    "C_extremadura": ("Extremadura, Spain", (-7, -6), "right"),
    "C_ireland": ("Central Ireland", (-7, 3), "right"),
    "D_songnen_w05": ("Songnen Plain, China", (-7, 7), "right"),
    "D_wisconsin_e05": ("Wisconsin, USA", (7, 3), "left"),
    "E_yamal_6971": ("Yamal Peninsula, Russia", (7, 3), "left"),
    "E_tibet_changtang": ("Changtang, Tibet, China", (7, -6), "left"),
}


def read_zones(path, res=15000):
    """Resample the lon/lat zone raster to an Equal Earth grid (nearest neighbour)."""
    from pyproj import Transformer
    with rasterio.open(path) as src:
        data = src.read(1)
        inv = ~src.transform
    fwd = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
    back = Transformer.from_crs(CRS, "EPSG:4326", always_xy=True)
    xmax, _ = fwd.transform(180, 0)
    _, ymax = fwd.transform(0, 90)
    xs = np.arange(-xmax, xmax, res) + res / 2
    ys = np.arange(ymax, -ymax, -res) - res / 2
    X, Y = np.meshgrid(xs, ys)
    lon, lat = back.transform(X, Y)
    ok = np.isfinite(lon) & np.isfinite(lat) & (np.abs(lon) <= 180)
    col, row = inv * (np.where(ok, lon, 0), np.where(ok, lat, 0))
    col = np.clip(col.astype(int), 0, data.shape[1] - 1)
    row = np.clip(row.astype(int), 0, data.shape[0] - 1)
    out = np.where(ok, data[row, col], 0).astype(np.uint8)
    extent = (-xmax, -xmax + len(xs) * res, ymax - len(ys) * res, ymax)
    return out, extent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--koppen", required=True)
    ap.add_argument("--sites", default="results/site_selection.csv")
    ap.add_argument("--out", default="results/focus_sites_map")
    args = ap.parse_args()

    zones, extent = read_zones(args.koppen)
    world = gpd.read_file(gpd.datasets.get_path("naturalearth_lowres"))
    world = world[world["continent"] != "Antarctica"].to_crs(CRS)

    fig, ax = plt.subplots(figsize=(6.3, 3.2))
    ax.set_facecolor("white")

    # climate zones as light tints, Antarctica and ocean left white
    cmap = ListedColormap([(1, 1, 1, 0)] + [tint(c, 0.35) for _, c in ZONES.values()])
    ax.imshow(np.ma.masked_equal(zones, 0), cmap=cmap, vmin=0, vmax=5,
              extent=extent, interpolation="nearest", zorder=1)
    world.boundary.plot(ax=ax, color="white", linewidth=0.25, zorder=2)

    sel = pd.read_csv(args.sites)
    pts = gpd.GeoSeries([Point(x, y) for x, y in zip(sel.lon, sel.lat)], crs="EPSG:4326").to_crs(CRS)
    for r, p in zip(sel.itertuples(), pts):
        c = ZONES[ZONE_NUM[r.zone]][1]
        name, off, ha = LABELS.get(r.id, (r.id, (7, 3), "left"))
        ax.plot(p.x, p.y, marker="s", markersize=6.5, linestyle="none",
                markerfacecolor=c if r.sampling == "high" else "white",
                markeredgecolor=c, markeredgewidth=1.6, zorder=4)
        ax.plot(p.x, p.y, marker="s", markersize=8.3, linestyle="none",
                markerfacecolor="none", markeredgecolor="#333333", markeredgewidth=0.5, zorder=3)
        txt = ax.annotate(f"{name} ({int(r.clear_obs_per_year + 0.5)})", (p.x, p.y), xytext=off,
                          textcoords="offset points", ha=ha, va="center",
                          fontsize=7, color="#1a1a1a", zorder=5)
        txt.set_path_effects([__import__("matplotlib.patheffects").patheffects.withStroke(
            linewidth=1.8, foreground="white")])

    xmin, ymin, xmax, ymax = world.total_bounds
    ax.set_xlim(xmin, xmax)
    ax.set_ylim(ymin - 2e5, ymax + 2e5)
    ax.set_axis_off()

    h_zone = [Patch(facecolor=tint(c, 0.35), edgecolor="none", label=lab) for lab, c in ZONES.values()]
    h_samp = [Line2D([], [], marker="s", linestyle="none", markersize=6, markerfacecolor="#555555",
                     markeredgecolor="#555555", markeredgewidth=1.4,
                     label="high observation density"),
              Line2D([], [], marker="s", linestyle="none", markersize=6, markerfacecolor="white",
                     markeredgecolor="#555555", markeredgewidth=1.4,
                     label="low observation density")]
    blank = Line2D([], [], linestyle="none", label=" ")
    ax.legend(handles=h_zone + [blank] + h_samp, loc="lower left", bbox_to_anchor=(0.0, 0.0),
              frameon=False, fontsize=7, handletextpad=0.4, borderaxespad=0.2,
              labelspacing=0.35, handlelength=1.2)

    plt.tight_layout(pad=0.1)
    for ext in ("pdf", "svg", "png"):
        fig.savefig(f"{args.out}.{ext}", dpi=300, bbox_inches="tight")
    print("saved", args.out)


if __name__ == "__main__":
    main()
