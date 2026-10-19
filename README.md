# Screening of focus sites for embedding robustness in Earth observation

Google Earth Engine script to select ten focus sites of 100 x 100 km, two per main
Koeppen climate zone (A tropical, B arid, C temperate, D continental, E polar and alpine
tundra). Within each zone, one site has a high and one a low number of clear Landsat and
Sentinel-2 observations.

## Criteria

| Criterion | Threshold | Data |
|---|---|---|
| 1. Climate zone | ≥ 80% of land area in one main Koeppen zone, ≤ 5% permanent ice | Beck et al. (2018) |
| 2. Observation density | Per zone, one site with a high and one with a low number of clear observations | Landsat 8/9, Sentinel-2 (2018–2025) |
| 3. Orbit overlap | ≥ 1 strip covered by neighbouring orbits (90th/10th percentile of acquisitions ≥ 1.25) | Landsat 8/9, Sentinel-2 |
| 4. Surface classes | ≥ 2 broad classes with ≥ 10% of land area each | ESA WorldCover 2021 |
| 5. Water | ≤ 20% open water | ESA WorldCover 2021 |
| 6. Terrain | ≤ 25% of the area steeper than 20° | Copernicus DEM GLO-30 |
| 7. Archive gaps | Scenes in the weakest year ≥ 50% of the median year | Landsat 8/9, Sentinel-2 (2018–2025) |

All thresholds are set in the `T` object at the top of the script.

## How to run

1. Download the present-day 1 km Koeppen-Geiger map of Beck et al. (2018) and upload it
   to Earth Engine as an image asset (class codes 1–30, 0 = ocean).
2. Open `site_screening.js` in the Earth Engine Code Editor and set `KOPPEN_ASSET`
   to the path of your asset.
3. Run the script. Stage 1 (climate, surface classes, water, terrain) is printed as
   tables in the console.
4. In the Tasks tab, start the exports `site_screening_stage1` and
   `site_screening_stage2`. Stage 2 counts clear observations and acquisitions for all
   candidates that pass stage 1.
5. Per zone, select the candidates with the highest and the lowest
   `clear_obs_per_year` among those with `pass_stage1 = 1` and `pass_stage2 = 1`.

`showSite('<id>')` maps clear observations per year for one candidate. Orbit overlap
strips appear as bands of higher counts.

## Notes

Observation counts use simple cloud masks (Landsat `QA_PIXEL`, Cloud Score+ threshold
0.6) with one mosaic per acquisition day. They are meant to rank candidates, not as final
sampling metrics. Candidate centres are listed in `CANDIDATES` and can be extended, for
example with `gridCandidates()`.

## References

Beck, H.E., Zimmermann, N.E., McVicar, T.R., Vergopolan, N., Berg, A., Wood, E.F., 2018.
Present and future Köppen-Geiger climate classification maps at 1-km resolution.
Scientific Data 5, 180214.

Zanaga, D., et al., 2022. ESA WorldCover 10 m 2021 v200. Zenodo.
https://doi.org/10.5281/zenodo.7254221

## Licence

MIT, see `LICENSE`.
