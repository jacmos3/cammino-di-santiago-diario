const map = L.map('map', { scrollWheelZoom: true });
const PHOTO_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp']);
const MAX_LINK_KM = 100;

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

const toRad = (deg) => (Number(deg) * Math.PI) / 180;
const distanceKm = (a, b) => {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const lat1 = Number(a[0]);
  const lon1 = Number(a[1]);
  const lat2 = Number(b[0]);
  const lon2 = Number(b[1]);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const rLat1 = toRad(lat1);
  const rLat2 = toRad(lat2);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

const midpoint = (a, b) => [
  (Number(a[0]) + Number(b[0])) / 2,
  (Number(a[1]) + Number(b[1])) / 2
];

const buildFlightCurve = (from, to, segments = 24) => {
  const lat1 = Number(from[0]);
  const lon1 = Number(from[1]);
  const lat2 = Number(to[0]);
  const lon2 = Number(to[1]);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return [from, to];

  const dx = lon2 - lon1;
  const dy = lat2 - lat1;
  const len = Math.hypot(dx, dy);
  if (!len) return [[lat1, lon1], [lat2, lon2]];

  // Perpendicular offset gives a lightweight arc without extra libs.
  const nx = -dy / len;
  const ny = dx / len;
  const bend = len * 0.22;
  const midLat = (lat1 + lat2) / 2;
  const midLon = (lon1 + lon2) / 2;
  const cLat = midLat - ny * bend;
  const cLon = midLon - nx * bend;

  const points = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const mt = 1 - t;
    const lat = mt * mt * lat1 + 2 * mt * t * cLat + t * t * lat2;
    const lon = mt * mt * lon1 + 2 * mt * t * cLon + t * t * lon2;
    points.push([lat, lon]);
  }
  return points;
};

Promise.all([
  fetch('data/track_points.json').then((res) => res.json()).catch(() => [])
])
  .then(([trackPoints]) => {
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
          file: p.file || '',
          date: p.date || ''
        }
      }));

    const lineSegments = [];
    const flightSegments = [];
    let currentSegment = [];
    pointFeatures.forEach((feature, idx) => {
      const [lon, lat] = feature.geometry.coordinates || [];
      const curr = [lat, lon];
      if (!currentSegment.length) {
        currentSegment.push(curr);
        return;
      }
      const prevFeature = pointFeatures[idx - 1];
      const [prevLon, prevLat] = prevFeature.geometry.coordinates || [];
      const prev = [prevLat, prevLon];
      const jumpKm = distanceKm(prev, curr);
      const split = jumpKm > MAX_LINK_KM;
      if (split) {
        if (Number.isFinite(jumpKm)) {
          flightSegments.push({ from: prev, to: curr, km: jumpKm });
        }
        if (currentSegment.length >= 2) lineSegments.push(currentSegment);
        currentSegment = [curr];
      } else {
        currentSegment.push(curr);
      }
    });
    if (currentSegment.length >= 2) lineSegments.push(currentSegment);

    let lineLayer = null;
    lineSegments.forEach((segment) => {
      const poly = L.polyline(segment, {
        color: '#b06c36',
        weight: 4,
        opacity: 0.9
      }).addTo(map);
      if (!lineLayer) lineLayer = poly;
    });

    flightSegments.forEach((segment) => {
      const curved = buildFlightCurve(segment.from, segment.to);
      L.polyline(curved, {
        color: '#5f7fa7',
        weight: 3,
        opacity: 0.9,
        dashArray: '8 8'
      }).addTo(map);

      const mid = curved[Math.floor(curved.length / 2)] || midpoint(segment.from, segment.to);
      const plane = L.marker(mid, {
        icon: L.divIcon({
          className: 'map-flight-icon',
          html: '✈',
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        })
      }).addTo(map);
      plane.bindPopup(`Tratto aereo ~${Math.round(segment.km)} km`);
    });

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
