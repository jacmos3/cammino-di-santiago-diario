const map = L.map('map', { scrollWheelZoom: true });
const PHOTO_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp']);

const isPhotoFile = (name) => {
  const file = (name ? String(name) : '').trim().toLowerCase();
  if (!file.includes('.')) return true;
  const ext = file.split('.').pop();
  return PHOTO_EXTENSIONS.has(ext);
};

const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
});

tiles.addTo(map);

fetch('data/track.geojson')
  .then((res) => res.json())
  .then((geojson) => {
    const pointFeatures = (geojson.features || [])
      .filter((feature) => feature && feature.geometry && feature.geometry.type === 'Point')
      .filter((feature) => isPhotoFile(feature.properties && feature.properties.file))
      .sort((a, b) => {
        const ta = Date.parse((a.properties && a.properties.time) || '');
        const tb = Date.parse((b.properties && b.properties.time) || '');
        if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
        if (Number.isNaN(ta)) return 1;
        if (Number.isNaN(tb)) return -1;
        return ta - tb;
      });

    const latlngs = pointFeatures.map((feature) => {
      const [lon, lat] = feature.geometry.coordinates || [];
      return [lat, lon];
    });

    let lineLayer = null;
    if (latlngs.length >= 2) {
      lineLayer = L.polyline(latlngs, {
        color: '#b06c36',
        weight: 4,
        opacity: 0.9
      }).addTo(map);
    }

    const pointsLayer = L.geoJSON({ type: 'FeatureCollection', features: pointFeatures }, {
      pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
        radius: 4,
        color: '#1f5f5b',
        weight: 1,
        fillColor: '#1f5f5b',
        fillOpacity: 0.7
      }),
      onEachFeature: (feature, layer) => {
        if (feature.properties && feature.properties.time) {
          layer.bindPopup(`${feature.properties.time}<br>${feature.properties.file}`);
        }
      }
    }).addTo(map);

    const bounds = lineLayer ? lineLayer.getBounds() : pointsLayer.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [20, 20] });
    } else {
      map.setView([0, 0], 2);
    }
  })
  .catch(() => map.setView([0, 0], 2));
