const map = L.map('map', { scrollWheelZoom: true });
const PHOTO_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp']);
const MAX_LINK_KM = 100;
const selectedDay = new URLSearchParams(window.location.search).get('day') || '';
const selectedUptoDay = new URLSearchParams(window.location.search).get('upto') || '';

const isPhotoFile = (name) => {
  const file = (name ? String(name) : '').trim().toLowerCase();
  if (!file.includes('.')) return true;
  const ext = file.split('.').pop();
  return PHOTO_EXTENSIONS.has(ext);
};

const parsePointTs = (point) => {
  const ts = Date.parse(String(point && point.time ? point.time : ''));
  return Number.isNaN(ts) ? Number.NEGATIVE_INFINITY : ts;
};

const normalizeTrackPointsByActivityDay = (points) => {
  const list = Array.isArray(points) ? points : [];
  const groups = new Map();
  list.forEach((point) => {
    const file = String(point && point.file ? point.file : '');
    if (!file) return;
    if (!groups.has(file)) groups.set(file, []);
    groups.get(file).push(point);
  });

  const out = [];
  groups.forEach((entries, file) => {
    const isRuntastic = file.startsWith('RUNTASTIC_');
    if (!isRuntastic) {
      entries.forEach((point) => out.push({
        ...point,
        mapDate: String(point && point.date ? point.date : '').slice(0, 10)
      }));
      return;
    }

    const sorted = [...entries].sort((a, b) => parsePointTs(a) - parsePointTs(b));
    const dayCounts = new Map();
    sorted.forEach((point) => {
      const day = String(point && point.date ? point.date : '').slice(0, 10);
      if (!day) return;
      dayCounts.set(day, (dayCounts.get(day) || 0) + 1);
    });
    let anchorDate = String((sorted[0] && sorted[0].date) || '').slice(0, 10);
    let bestCount = -1;
    dayCounts.forEach((count, day) => {
      if (count > bestCount) {
        bestCount = count;
        anchorDate = day;
      }
    });
    sorted.forEach((point) => out.push({
      ...point,
      mapDate: anchorDate
    }));
  });
  return out;
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

const buildSegmentsFromFeatures = (features) => {
  const lineSegments = [];
  const flightSegments = [];
  let currentSegment = [];
  (features || []).forEach((feature, idx) => {
    const [lon, lat] = feature.geometry.coordinates || [];
    const curr = [lat, lon];
    if (!currentSegment.length) {
      currentSegment.push(curr);
      return;
    }
    const prevFeature = features[idx - 1];
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
  return { lineSegments, flightSegments };
};

Promise.all([
  fetch('data/track_points.json').then((res) => res.json()).catch(() => [])
])
  .then(([trackPoints]) => {
    const normalizedTrackPoints = normalizeTrackPointsByActivityDay(trackPoints);
    const pointFeatures = normalizedTrackPoints
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
          date: p.mapDate || p.date || ''
        }
      }));
    const { lineSegments, flightSegments } = buildSegmentsFromFeatures(pointFeatures);
    const selectedFeatures = selectedDay
      ? pointFeatures.filter((f) => String(f.properties && f.properties.date ? f.properties.date : '') === selectedDay)
      : [];
    const selectedUptoFeatures = selectedUptoDay
      ? pointFeatures.filter((f) => String(f.properties && f.properties.date ? f.properties.date : '') <= selectedUptoDay)
      : [];
    const selectedSplit = buildSegmentsFromFeatures(selectedFeatures);
    const selectedUptoSplit = buildSegmentsFromFeatures(selectedUptoFeatures);

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
          html: '<span class="map-flight-glyph">✈</span>',
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        })
      }).addTo(map);
      plane.bindPopup(`Tratto aereo ~${Math.round(segment.km)} km`);
    });

    let selectedLineLayer = null;
    selectedSplit.lineSegments.forEach((segment) => {
      const poly = L.polyline(segment, {
        color: '#da6c2c',
        weight: 6,
        opacity: 0.95
      }).addTo(map);
      if (!selectedLineLayer) selectedLineLayer = poly;
    });
    selectedSplit.flightSegments.forEach((segment) => {
      const curved = buildFlightCurve(segment.from, segment.to);
      L.polyline(curved, {
        color: '#da6c2c',
        weight: 4,
        opacity: 0.95,
        dashArray: '10 8'
      }).addTo(map);
      const mid = curved[Math.floor(curved.length / 2)] || midpoint(segment.from, segment.to);
      L.marker(mid, {
        icon: L.divIcon({
          className: 'map-flight-icon map-flight-icon--day',
          html: '<span class="map-flight-glyph">✈</span>',
          iconSize: [34, 34],
          iconAnchor: [17, 17]
        })
      }).addTo(map);
    });

    let selectedUptoLineLayer = null;
    selectedUptoSplit.lineSegments.forEach((segment) => {
      const poly = L.polyline(segment, {
        color: '#2b6cb0',
        weight: 5,
        opacity: 0.9
      }).addTo(map);
      if (!selectedUptoLineLayer) selectedUptoLineLayer = poly;
    });
    selectedUptoSplit.flightSegments.forEach((segment) => {
      const curved = buildFlightCurve(segment.from, segment.to);
      L.polyline(curved, {
        color: '#2b6cb0',
        weight: 3.5,
        opacity: 0.9,
        dashArray: '8 7'
      }).addTo(map);
      const mid = curved[Math.floor(curved.length / 2)] || midpoint(segment.from, segment.to);
      L.marker(mid, {
        icon: L.divIcon({
          className: 'map-flight-icon map-flight-icon--upto',
          html: '<span class="map-flight-glyph">✈</span>',
          iconSize: [32, 32],
          iconAnchor: [16, 16]
        })
      }).addTo(map);
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

    const selectedPointsLayer = L.geoJSON({ type: 'FeatureCollection', features: selectedFeatures }, {
      pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
        radius: 6,
        color: '#8d3f15',
        weight: 2,
        fillColor: '#f0a56f',
        fillOpacity: 0.95
      })
    }).addTo(map);

    const selectedUptoPointsLayer = L.geoJSON({ type: 'FeatureCollection', features: selectedUptoFeatures }, {
      pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
        radius: 5,
        color: '#1d4f86',
        weight: 2,
        fillColor: '#78aee6',
        fillOpacity: 0.9
      })
    }).addTo(map);

    const boundsCandidates = [];
    if (lineLayer && lineLayer.getBounds().isValid()) boundsCandidates.push(lineLayer.getBounds());
    if (pointsLayer && pointsLayer.getBounds().isValid()) boundsCandidates.push(pointsLayer.getBounds());
    if (selectedUptoLineLayer && selectedUptoLineLayer.getBounds().isValid()) boundsCandidates.unshift(selectedUptoLineLayer.getBounds());
    if (selectedUptoPointsLayer && selectedUptoPointsLayer.getBounds().isValid()) boundsCandidates.unshift(selectedUptoPointsLayer.getBounds());
    if (selectedLineLayer && selectedLineLayer.getBounds().isValid()) boundsCandidates.unshift(selectedLineLayer.getBounds());
    if (selectedPointsLayer && selectedPointsLayer.getBounds().isValid()) boundsCandidates.unshift(selectedPointsLayer.getBounds());
    if (boundsCandidates.length) {
      const bounds = boundsCandidates[0];
      for (let i = 1; i < boundsCandidates.length; i += 1) bounds.extend(boundsCandidates[i]);
      map.fitBounds(bounds, { padding: [20, 20] });
    } else {
      map.setView([0, 0], 2);
    }
  })
  .catch(() => map.setView([0, 0], 2));
