const map = L.map('map', { scrollWheelZoom: true });

const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
});

tiles.addTo(map);

fetch('data/track.geojson')
  .then((res) => res.json())
  .then((geojson) => {
    const lineLayer = L.geoJSON(geojson, {
      filter: (feature) => feature.geometry.type === 'LineString',
      style: {
        color: '#b06c36',
        weight: 4,
        opacity: 0.9
      }
    }).addTo(map);

    const pointsLayer = L.geoJSON(geojson, {
      filter: (feature) => feature.geometry.type === 'Point',
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

    const bounds = lineLayer.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [20, 20] });
    } else {
      map.setView([0, 0], 2);
    }
  })
  .catch(() => map.setView([0, 0], 2));
