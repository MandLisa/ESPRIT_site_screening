// =====================================================================
// Study site screening for Task 1.1 (FWF ESPRIT proposal)
// Google Earth Engine Code Editor version
//
// Stage 1 (all candidates, printed in the console):
//   climate zone share, permanent ice, water share, steep terrain,
//   number of broad surface classes (ESA WorldCover 2021)
// Stage 2 (all candidates, exported to Drive):
//   clear Landsat 8/9 + Sentinel-2 observations per year,
//   orbit overlap indicator, scenes per year
//
// Observation counts use simple cloud masks and are only meant for
// ranking candidates. Final S0 metrics come from FORCE.
// =====================================================================

// ---- settings --------------------------------------------------------

// Beck et al. (2018) present-day Koeppen-Geiger map, 1 km, uploaded as asset.
// Classes: 1-3 A, 4-7 B, 8-16 C, 17-28 D, 29 ET, 30 EF, 0 ocean
// Replace with the path of your own uploaded asset.
var KOPPEN_ASSET = 'projects/YOUR_GEE_PROJECT/assets/koppen_geiger';

var START = '2018-01-01';
var END = '2026-01-01';
var YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
var HALF_SIZE_M = 50000; // 100 x 100 km

var T = {
  zone_share: 0.80,
  ef_share: 0.05,
  water_share: 0.20,
  steep_share: 0.25,
  class_share: 0.10,
  min_broad_classes: 3,
  overlap_ratio: 1.3,  // acquisitions p90 / p10 inside the site
  year_ratio: 0.5      // scenes in weakest year / median year
};

// Unverified starting candidates (centre lon, lat)
var CANDIDATES = [
  ['A_matogrosso',    'A', -55.5, -11.9],
  ['A_rondonia',      'A', -62.5, -10.0],
  ['A_kalimantan',    'A', 113.9,  -2.3],
  ['A_gabon',         'A',  11.8,  -0.7],
  ['B_imperial',      'B', -115.4, 32.9],
  ['B_sonora',        'B', -111.3, 29.0],
  ['B_senegal',       'B', -14.8,  16.4],
  ['B_niger',         'B',   2.3,  13.6],
  ['C_extremadura',   'C',  -6.3,  39.0],
  ['C_centralvalley', 'C', -120.4, 37.0],
  ['C_southchile',    'C', -73.0, -40.5],
  ['C_ireland',       'C',  -8.0,  53.0],
  ['D_saskatchewan',  'D', -105.5, 52.0],
  ['D_finland',       'D',  26.0,  62.5],
  ['D_westsiberia',   'D',  73.0,  61.0],
  ['E_northslope',    'E', -152.0, 70.0],
  ['E_yamal',         'E',  70.5,  68.8],
  ['E_kivalliq',      'E', -96.0,  64.3]
];

// ---- candidates as FeatureCollection --------------------------------

function siteGeom(lon, lat) {
  return ee.Geometry.Point([lon, lat]).buffer(HALF_SIZE_M).bounds();
}

var fc = ee.FeatureCollection(CANDIDATES.map(function (c) {
  return ee.Feature(siteGeom(c[2], c[3]), {id: c[0], zone: c[1], lon: c[2], lat: c[3]});
}));

Map.addLayer(fc, {color: 'red'}, 'candidates');

// ---- stage 1 ---------------------------------------------------------

var koppen = ee.Image(KOPPEN_ASSET).select(0);
var fromK = ee.List.sequence(1, 30);
var toZ = [1,1,1, 2,2,2,2, 3,3,3,3,3,3,3,3,3, 4,4,4,4,4,4,4,4,4,4,4,4, 5,5];
var zoneImg = koppen.remap(fromK, toZ);
var efImg = koppen.eq(30).updateMask(koppen.gt(0));

var wc = ee.ImageCollection('ESA/WorldCover/v200').first().select('Map');
var land = wc.neq(80);

var BROAD = {
  woody: [10, 95], shrub: [20], herbaceous: [30, 100], cropland: [40],
  built: [50], bare: [60], snow_ice: [70], wetland: [90]
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
print(ui.Chart.feature.byFeature(s1, 'id', [
    'zone_share', 'ef_share', 'water_share', 'steep_share',
    'n_broad_classes', 'pass_stage1']).setChartType('Table'));
print(ui.Chart.feature.byFeature(s1, 'id', [
    'cls_woody', 'cls_shrub', 'cls_herbaceous', 'cls_cropland',
    'cls_built', 'cls_bare', 'cls_snow_ice', 'cls_wetland']).setChartType('Table'));

Export.table.toDrive({
  collection: s1, description: 'site_screening_stage1', fileFormat: 'CSV'
});

// ---- stage 2 ---------------------------------------------------------

function lsBands(img) {
  var qa = img.select('QA_PIXEL');
  var acq = qa.bitwiseAnd(1).eq(0);              // not fill
  var clear = qa.bitwiseAnd(31).eq(0);           // no fill, dilated cloud, cirrus, cloud, shadow
  return ee.Image.cat(acq.selfMask().rename('acq'), clear.selfMask().rename('valid'))
           .copyProperties(img, ['system:time_start']);
}

function s2Bands(img) {
  var acq = img.select('B4').gt(0);
  var clear = acq.and(img.select('cs_cdf').gte(0.6));
  return ee.Image.cat(acq.selfMask().rename('acq'), clear.selfMask().rename('valid'))
           .copyProperties(img, ['system:time_start']);
}

// one mosaic per acquisition day, so overlapping tiles of one pass count once
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

var s2res = s1.map(stage2)
  .sort('clear_obs_per_year').sort('zone');

Export.table.toDrive({
  collection: s2res, description: 'site_screening_stage2', fileFormat: 'CSV',
  selectors: ['id', 'zone', 'lon', 'lat', 'zone_share', 'water_share', 'steep_share',
              'pass_stage1', 'n_broad_classes', 'clear_obs_per_year', 'clear_p10_per_year',
              'clear_p90_per_year', 'overlap_ratio', 'year_ratio', 'pass_stage2']
});

// ---- visual check of one site -----------------------------------------
// Shows clear observations per year; overlap strips appear as bands of higher counts.

function showSite(id) {
  var f = ee.Feature(fc.filter(ee.Filter.eq('id', id)).first());
  var g = f.geometry();
  var img = countImage(g).divide(YEARS.length).clip(g);
  Map.centerObject(g, 8);
  Map.addLayer(img.select('valid'), {min: 10, max: 120, palette: ['#440154', '#21918c', '#fde725']},
               id + ' clear obs / year');
  Map.addLayer(img.select('acq'), {min: 30, max: 200, palette: ['#000004', '#bc3754', '#fcffa4']},
               id + ' acquisitions / year', false);
}

// showSite('D_finland');
