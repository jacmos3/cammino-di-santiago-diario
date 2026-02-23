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

Promise.all([
  fetch('data/track.geojson').then((res) => res.json()).catch(() => null),
  fetch('data/track_points.json').then((res) => res.json()).catch(() => [])
])
  .then(([geojson, trackPoints]) => {
    const lineFeature = (geojson && geojson.features || [])
      .find((feature) => feature && feature.geometry && feature.geometry.type === 'LineString');

    let lineLayer = null;
    if (lineFeature) {
      lineLayer = L.geoJSON(lineFeature, {
        style: {
          color: '#b06c36',
          weight: 4,
          opacity: 0.9
        }
      }).addTo(map);
    }

    const pointFeatures = (Array.isArray(trackPoints) ? trackPoints : [])
      .filter((p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon)))
      .filter((p) => isPhotoFile(p.file))
      .sort((a, b) => {
        const ta = Date.parse(String(a.time || ''));
        const tb = Date.parse(String(b.time || ''));
        if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
        if (Number.isNaN(ta)) return 1;
        if (Number.isNaN(tb)) return -1;
        return ta - tb;
      })
      .map((p) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [Number(p.lon), Number(p.lat)]
        },
        properties: {
          time: p.time || '',
          file: p.file || ''
        }
      }));

    const pointsLayer = L.geoJSON({ type: 'FeatureCollection', features: pointFeatures }, {
      pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
        radius: 4,
        color: '#1f5f5b',
        weight: 1,
        fillColor: '#1f5f5b',
        fillOpacity: 0.72
      }),
      onEachFeature: (feature, layer) => {
        const time = feature.properties && feature.properties.time ? feature.properties.time : '';
        const file = feature.properties && feature.properties.file ? feature.properties.file : '';
        if (time || file) layer.bindPopup(`${time}${time && file ? '<br>' : ''}${file}`);
      }
    }).addTo(map);

    const boundsCandidates = [];
    if (lineLayer && lineLayer.getBounds().isValid()) boundsCandidates.push(lineLayer.getBounds());
    if (pointsLayer && pointsLayer.getBounds().isValid()) boundsCandidates.push(pointsLayer.getBounds());
    if (boundsCandidates.length) {
      const bounds = boundsCandidates[0];
      for (let i = 1; i < boundsCandidates.length; i += 1) bounds.extend(boundsCandidates[i]);
      map.fitBounds(bounds, { padding: [20, 20] });
    } else {
      map.setView([0, 0], 2);
    }
  })
  .catch(() => map.setView([0, 0], 2));
