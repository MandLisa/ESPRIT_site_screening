# Study site screening for embedding robustness in Earth observation

Screening of candidate study sites (100 x 100 km) for a project on how operational
sampling of optical satellite archives affects self-supervised embeddings.
Ten sites are selected, two per main Koeppen climate zone (A–E), one with high and
one with low clear-observation density.

## Criteria

| Criterion | Threshold | Data |
|---|---|---|
| Climate zone | ≥ 80% of land area in one main Koeppen zone, no permanent ice | Beck et al. (2018) |
| Observation density | Per zone, one site with high and one with low clear-observation count | Landsat 8/9, Sentinel-2 (2018–2025) |
| Orbit overlap | ≥ 1 strip covered by neighbouring orbits (90th/10th percentile of acquisitions ≥ 1.3) | Landsat 8/9, Sentinel-2 |
| Surface classes | ≥ 3 broad classes with ≥ 10% of land area | ESA WorldCover 2021 (Zanaga et al., 2022) |
| Exclusion | > 20% water, > 25% of area steeper than 20°, weakest year < 50% of median scene count | WorldCover, Copernicus DEM GLO-30, archive |

All thresholds are set in the `T` object at the top of each script.

## Files

- `site_screening_gee.js` – version for the Google Earth Engine Code Editor
- `site_screening.py` – same workflow with the Earth Engine Python API

## Usage (Code Editor)

1. Upload the present-day Koeppen-Geiger map of Beck et al. (2018), 1 km, as an image asset
   (classes 1–30, 0 = ocean) and set `KOPPEN_ASSET` to its path.
2. Run the script. Stage 1 results (climate, water, terrain, surface classes) are printed
   as tables in the console.
3. Start the two exports in the Tasks tab. `site_screening_stage2` counts clear observations
   for all candidates and takes several minutes.
4. `showSite('<id>')` maps clear observations per year for one site. Orbit overlap strips
   appear as bands of higher counts.

Observation counts use simple cloud masks (Landsat `QA_PIXEL`, Cloud Score+ for Sentinel-2,
threshold 0.6). They are meant to rank candidates, not as final sampling metrics.
Candidate centres in `CANDIDATES` are starting points and can be extended.

## References

Beck, H.E., Zimmermann, N.E., McVicar, T.R., Vergopolan, N., Berg, A., Wood, E.F., 2018.
Present and future Köppen-Geiger climate classification maps at 1-km resolution.
Scientific Data 5, 180214.

Zanaga, D., et al., 2022. ESA WorldCover 10 m 2021 v200. Zenodo.
https://doi.org/10.5281/zenodo.7254221

## Licence

MIT, see `LICENSE`.
