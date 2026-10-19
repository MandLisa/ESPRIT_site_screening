// =====================================================================
// Screening of candidate focus sites (100 x 100 km)
// Google Earth Engine Code Editor script
//
// Purpose
//   Select ten focus sites, two per main Koeppen climate zone (A–E),
//   with one site of high and one of low clear-observation density per
//   zone. Candidates are tested against the criteria below; the passing
//   candidates with the highest and the lowest number of clear
//   observations per zone are selected.
//
// Criteria (thresholds are set in T below)
//   1  >= 80% of the land area in one main Koeppen zone, <= 5% permanent ice
//   2  per zone, one site with high and one with low number of clear observations
//   3  at least one strip covered by neighbouring orbits
//      (90th / 10th percentile of acquisitions within the site >= 1.25)
//   4  >= 2 broad surface classes with >= 10% of the land area each
//   5  <= 20% open water
//   6  <= 25% of the area steeper than 20 degrees
//   7  scenes in the weakest year >= 50% of the median year
//
// Data
//   Koeppen-Geiger map: Beck et al. (2018), 1 km, user-uploaded asset (see below)
//   Surface classes and water: ESA WorldCover 2021 v200
//   Terrain: Copernicus DEM GLO-30
//   Observations: Landsat 8/9 Collection 2 L2 and Sentinel-2 L1C (harmonized)
//                 with Cloud Score+, 2018–2025
//
// How to run
//   1  Download the present-day 1 km Koeppen-Geiger map of Beck et al. (2018)
//      and upload it as an image asset (Assets > New > GeoTIFF).
//      Expected class codes: 1–3 A, 4–7 B, 8–16 C, 17–28 D, 29 ET, 30 EF, 0 ocean.
//   2  Set KOPPEN_ASSET to the path of this asset.
//   3  Run the script. Stage 1 results are printed as two tables in the console.
//   4  In the Tasks tab, start the exports 'site_screening_stage1' and
//      'site_screening_stage2'. Stage 2 counts observations and takes several
//      minutes up to an hour.
//   5  Optional: showSite('<id>') maps clear observations per year for one
//      candidate. Orbit overlap strips appear as bands of higher counts.
//
// Notes
//   Observation counts use simple cloud masks (Landsat QA_PIXEL, Cloud Score+
//   threshold 0.6) and one mosaic per acquisition day. They are meant to rank
//   candidates and are not final sampling metrics.
//   Candidate centres are listed in CANDIDATES and can be extended, also with
//   gridCandidates() for a systematic search.
// =====================================================================


// ---- settings --------------------------------------------------------

var KOPPEN_ASSET = 'projects/YOUR_PROJECT/assets/koeppen_geiger';  // <- set your asset path

var START = '2018-01-01';
var END = '2026-01-01';   // exclusive, i.e. 2018–2025
var YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
var HALF_SIZE_M = 50000;  // 100 x 100 km sites

var T = {
  zone_share: 0.80,      // criterion 1
  ef_share: 0.05,        // criterion 1, permanent ice (EF)
  class_share: 0.10,     // criterion 4, minimum share per class
  min_broad_classes: 2,  // criterion 4, minimum number of classes
  water_share: 0.20,     // criterion 5
  steep_share: 0.25,     // criterion 6
  overlap_ratio: 1.25,   // criterion 3
  year_ratio: 0.5        // criterion 7
};

// Stage 2 is computed only for candidates that pass stage 1.
// Set to false to compute it for all candidates.
var STAGE2_ONLY_PASSED = true;


// ---- candidates (id, zone, centre lon, centre lat) -------------------

var CANDIDATES = [
  // A tropical
  ['A_matogrosso',       'A',  -55.5, -11.9],
  ['A_rondonia',         'A',  -62.5, -10.0],
  ['A_kalimantan',       'A',  113.9,  -2.3],
  ['A_kalimantan_south', 'A',  114.3,  -3.0],
  ['A_sumatra_riau',     'A',  101.8,   0.3],
  ['A_para',             'A',  -50.0,  -3.5],
  ['A_gabon',            'A',   11.8,  -0.7],
  // B arid
  ['B_imperial',         'B', -115.4,  32.9],
  ['B_sonora',           'B', -111.3,  29.0],
  ['B_senegal',          'B',  -14.8,  16.4],
  ['B_niger',            'B',    2.3,  13.6],
  ['B_caatinga',         'B',  -40.5,  -9.0],
  ['B_botswana',         'B',   25.5, -22.0],
  ['B_peru_coast',       'B',  -79.3,  -6.6],
  // C temperate
  ['C_extremadura',      'C',   -6.3,  39.0],
  ['C_centralvalley',    'C', -120.4,  37.0],
  ['C_southchile',       'C',  -73.0, -40.5],
  ['C_ireland',          'C',   -8.0,  53.0],
  // D continental
  ['D_saskatchewan',     'D', -105.5,  52.0],
  ['D_finland',          'D',   26.0,  62.5],
  ['D_westsiberia',      'D',   73.0,  61.0],
  ['D_lithuania',        'D',   24.5,  55.8],
  ['D_kostroma',         'D',   43.5,  58.2],
  ['D_claybelt',         'D',  -81.0,  49.0],
  // E polar and alpine tundra
  ['E_northslope',       'E', -152.0,  70.0],
  ['E_northslope_coast', 'E', -156.0,  70.6],
  ['E_yamal',            'E',   70.5,  68.8],
  ['E_yamal_north',      'E',   69.5,  71.0],
  ['E_yamal_6971',       'E',   69.0,  71.0],
  ['E_yamal_7172',       'E',   71.0,  72.0],
  ['E_taimyr',           'E',   98.0,  73.0],
  ['E_victoria_island',  'E', -110.0,  71.0],
  ['E_banks_island',     'E', -121.5,  72.5],
  ['E_kivalliq',         'E',  -96.0,  64.3],
  ['E_tibet_changtang',  'E',   88.0,  32.5],
  ['E_tibet_naqu',       'E',   92.0,  31.5],
  ['E_tibet_qinghai',    'E',   97.0,  34.5],
  ['E_altiplano',        'E',  -68.5, -17.5]
];

// Regular grid of candidate centres for a systematic search (step in degrees)
function gridCandidates(zone, lonMin, latMin, lonMax, latMax, step) {
  var out = [];
  for (var lat = latMin; lat <= latMax; lat += step) {
    for (var lon = lonMin; lon <= lonMax; lon += step) {
      out.push([zone + '_' + lon.toFixed(1) + '_' + lat.toFixed(1), zone, lon, lat]);
    }
  }
  return out;
}

// Example of the grid search used for zone E (Yamal/Gydan and Alaska North Slope):
// CANDIDATES = CANDIDATES.concat(gridCandidates('E', 67, 70, 80, 72.5, 1));
// CANDIDATES = CANDIDATES.concat(gridCandidates('E', -158, 69.5, -147, 70.5, 1));


// ---- candidate squares ----------------------------------------------

function siteGeom(lon, lat) {
  return ee.Geometry.Point([lon, lat]).buffer(HALF_SIZE_M).bounds();
}

var fc = ee.FeatureCollection(CANDIDATES.map(function (c) {
  return ee.Feature(siteGeom(c[2], c[3]), {id: c[0], zone: c[1], lon: c[2], lat: c[3]});
}));

Map.addLayer(fc, {color: 'red'}, 'candidates');


// ---- stage 1: climate, surface, water, terrain -----------------------

var koppen = ee.Image(KOPPEN_ASSET).select(0);
var toZone = [1,1,1, 2,2,2,2, 3,3,3,3,3,3,3,3,3, 4,4,4,4,4,4,4,4,4,4,4,4, 5,5];
var zoneImg = koppen.remap(ee.List.sequence(1, 30), toZone);
var efImg = koppen.eq(30).updateMask(koppen.gt(0));

var wc = ee.ImageCollection('ESA/WorldCover/v200').first().select('Map');
var land = wc.neq(80);  // 80 = permanent water bodies

// WorldCover classes grouped into broad surface classes
var BROAD = {
  woody: [10, 95],        // tree cover, mangroves
  shrub: [20],
  herbaceous: [30, 100],  // grassland, moss and lichen
  cropland: [40],
  built: [50],
  bare: [60],
  snow_ice: [70],
  wetland: [90]
};
var BROAD_KEYS = Object.keys(BROAD);

var demCol = ee.ImageCollection('COPERNICUS/DEM/GLO30').select('DEM');
var dem = demCol.mosaic().setDefaultProjection(demCol.first().projection());
var steep = ee.Terrain.slope(dem).gt(20);

var bands = [];
for (var z = 1; z <= 5; z++) bands.push(zoneImg.eq(z).rename('zone_' + z));
bands.push(efImg.rename('ef_share'));
bands.push(land.unmask(0).rename('land_share'));
bands.push(steep.rename('steep_share'));
BROAD_KEYS.forEach(function (k) {
  var v = BROAD[k];
  bands.push(wc.remap(v, v.map(function () { return 1; }), 0)
               .updateMask(land).rename('cls_' + k));
});
var stage1Img = ee.Image.cat(bands);

function stage1(f) {
  var s = stage1Img.reduceRegion({
    reducer: ee.Reducer.mean(), geometry: f.geometry(),
    scale: 100, maxPixels: 1e9, tileScale: 4
  });
  var zs = ee.List([1, 2, 3, 4, 5].map(function (z) { return s.get('zone_' + z); }));
  var zoneShare = ee.Number(zs.reduce(ee.Reducer.max()));
  var zoneDom = ee.List(['A', 'B', 'C', 'D', 'E']).get(zs.indexOf(zoneShare));
  var nClasses = ee.List(BROAD_KEYS.map(function (k) { return s.get('cls_' + k); }))
                   .filter(ee.Filter.gte('item', T.class_share)).size();
  var water = ee.Number(1).subtract(s.get('land_share'));
  var ef = ee.Number(ee.Algorithms.If(s.get('ef_share'), s.get('ef_share'), 0));
  var pass = ee.Number(ee.Algorithms.If(ee.String(zoneDom).equals(f.get('zone')), 1, 0))
    .and(zoneShare.gte(T.zone_share))
    .and(ef.lte(T.ef_share))
    .and(water.lte(T.water_share))
    .and(ee.Number(s.get('steep_share')).lte(T.steep_share))
    .and(nClasses.gte(T.min_broad_classes));
  return f.set(s).set({
    zone_dom: zoneDom, zone_share: zoneShare, water_share: water,
    n_broad_classes: nClasses, pass_stage1: pass
  });
}

var s1 = fc.map(stage1);

print('Stage 1: criteria', ui.Chart.feature.byFeature(s1, 'id', [
    'zone_dom', 'zone_share', 'ef_share', 'water_share', 'steep_share',
    'n_broad_classes', 'pass_stage1'])
  .setChartType('Table'));

print('Stage 1: surface classes (share of land area)', ui.Chart.feature.byFeature(s1, 'id',
    BROAD_KEYS.map(function (k) { return 'cls_' + k; }))
  .setChartType('Table'));

Export.table.toDrive({
  collection: s1.map(function (f) { return f.setGeometry(null); }),
  description: 'site_screening_stage1', fileFormat: 'CSV'
});


// ---- stage 2: observation density, orbit overlap, archive gaps -------

// Landsat: 'acq' = acquired pixel, 'valid' = clear pixel
function lsBands(img) {
  var qa = img.select('QA_PIXEL');
  var acq = qa.bitwiseAnd(1).eq(0);     // bit 0: fill
  var clear = qa.bitwiseAnd(31).eq(0);  // bits 0–4: fill, dilated cloud, cirrus, cloud, shadow
  return ee.Image.cat(acq.selfMask().rename('acq'), clear.selfMask().rename('valid'))
           .copyProperties(img, ['system:time_start']);
}

// Sentinel-2: clear if Cloud Score+ cs_cdf >= 0.6
function s2Bands(img) {
  var acq = img.select('B4').gt(0);
  var clear = acq.and(img.select('cs_cdf').gte(0.6));
  return ee.Image.cat(acq.selfMask().rename('acq'), clear.selfMask().rename('valid'))
           .copyProperties(img, ['system:time_start']);
}

// One mosaic per acquisition day, so overlapping tiles of one pass count once
function daily(col) {
  var days = col.aggregate_array('system:time_start').map(function (t) {
    return ee.Date(t).format('YYYY-MM-dd');
  }).distinct();
  return ee.ImageCollection.fromImages(days.map(function (d) {
    d = ee.Date(d);
    return col.filterDate(d, d.advance(1, 'day')).mosaic();
  }));
}

function collections(g) {
  var ls = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
    .merge(ee.ImageCollection('LANDSAT/LC09/C02/T1_L2'))
    .filterBounds(g).filterDate(START, END);
  var s2 = ee.ImageCollection('COPERNICUS/S2_HARMONIZED')
    .filterBounds(g).filterDate(START, END)
    .linkCollection(ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED'), ['cs_cdf']);
  return {ls: ls, s2: s2};
}

// Total acquisitions ('acq') and clear observations ('valid') per pixel, 2018–2025
function countImage(g) {
  var c = collections(g);
  return daily(c.ls.map(lsBands)).count().unmask(0)
    .add(daily(c.s2.map(s2Bands)).count().unmask(0));
}

function scenesPerYear(col) {
  return ee.List(YEARS).map(function (y) {
    return col.filter(ee.Filter.calendarRange(y, y, 'year')).size();
  });
}

function stage2(f) {
  var g = f.geometry();
  var c = collections(g);
  var s = countImage(g).reduceRegion({
    reducer: ee.Reducer.mean().combine(ee.Reducer.percentile([10, 90]), null, true),
    geometry: g, scale: 300, maxPixels: 1e9, tileScale: 8
  });
  var nY = YEARS.length;
  var perYear = scenesPerYear(c.ls).zip(scenesPerYear(c.s2)).map(function (p) {
    p = ee.List(p);
    return ee.Number(p.get(0)).add(p.get(1));
  });
  var yearRatio = ee.Number(perYear.reduce(ee.Reducer.min()))
    .divide(ee.Number(perYear.reduce(ee.Reducer.median())));
  var overlap = ee.Number(s.get('acq_p90')).divide(s.get('acq_p10'));
  var pass = overlap.gte(T.overlap_ratio).and(yearRatio.gte(T.year_ratio));
  return f.set(s).set({
    clear_obs_per_year: ee.Number(s.get('valid_mean')).divide(nY),
    clear_p10_per_year: ee.Number(s.get('valid_p10')).divide(nY),
    clear_p90_per_year: ee.Number(s.get('valid_p90')).divide(nY),
    overlap_ratio: overlap, year_ratio: yearRatio, pass_stage2: pass
  });
}

var s2input = STAGE2_ONLY_PASSED ? s1.filter(ee.Filter.eq('pass_stage1', 1)) : s1;
var s2res = s2input.map(stage2).sort('clear_obs_per_year').sort('zone');

Export.table.toDrive({
  collection: s2res, description: 'site_screening_stage2', fileFormat: 'CSV',
  selectors: ['id', 'zone', 'lon', 'lat', 'zone_share', 'water_share', 'steep_share',
              'pass_stage1', 'n_broad_classes', 'clear_obs_per_year', 'clear_p10_per_year',
              'clear_p90_per_year', 'overlap_ratio', 'year_ratio', 'pass_stage2']
});

// Selection: per zone, among candidates with pass_stage1 = 1 and pass_stage2 = 1,
// the one with the highest and the one with the lowest clear_obs_per_year.


// ---- visual check of one candidate -----------------------------------

function showSite(id) {
  var f = ee.Feature(fc.filter(ee.Filter.eq('id', id)).first());
  var g = f.geometry();
  var img = countImage(g).divide(YEARS.length).clip(g);
  Map.centerObject(g, 8);
  Map.addLayer(wc.clip(g), {}, id + ' WorldCover', false);
  Map.addLayer(img.select('valid'), {min: 10, max: 120, palette: ['#440154', '#21918c', '#fde725']},
               id + ' clear observations / year');
  Map.addLayer(img.select('acq'), {min: 30, max: 200, palette: ['#000004', '#bc3754', '#fcffa4']},
               id + ' acquisitions / year', false);
}

// showSite('C_extremadura');
