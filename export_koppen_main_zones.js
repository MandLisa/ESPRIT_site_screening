// Export the Beck et al. (2018) Koeppen-Geiger map as main zones (1 = A ... 5 = E, 0 = ocean)
// at about 0.1 degree, for the overview map of the focus sites (focus_sites_map.py).
var KOPPEN_ASSET = 'projects/ee-lisamandl-chm-alps/assets/koeppen_geiger';  // <- set your asset path

var koppen = ee.Image(KOPPEN_ASSET).select(0);
var toZone = [1,1,1, 2,2,2,2, 3,3,3,3,3,3,3,3,3, 4,4,4,4,4,4,4,4,4,4,4,4, 5,5];
var zones = koppen.remap(ee.List.sequence(1, 30), toZone, 0).unmask(0).toByte();

Export.image.toDrive({
  image: zones,
  description: 'koppen_main_zones',
  region: ee.Geometry.Rectangle([-180, -90, 180, 90], 'EPSG:4326', false),
  crs: 'EPSG:4326',
  crsTransform: [0.1, 0, -180, 0, -0.1, 90],
  maxPixels: 1e9,
  fileFormat: 'GeoTIFF'
});
