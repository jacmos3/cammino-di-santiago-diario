const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const { createReadStream } = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');

const ROOT = path.resolve(__dirname);
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

let deleteInFlight = false;
let rotateInFlight = false;
const execFileAsync = promisify(execFile);

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function toFsPath(urlPath) {
  const sanitized = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const wanted = sanitized === '/' ? '/index.html' : sanitized;
  const resolved = path.resolve(ROOT, `.${wanted}`);
  if (!resolved.startsWith(ROOT + path.sep) && resolved !== ROOT) {
    return null;
  }
  return resolved;
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err && err.code === 'ENOENT' && typeof fallback !== 'undefined') return fallback;
    throw err;
  }
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function safeUnlink(filePath) {
  try {
    await fs.unlink(filePath);
    return true;
  } catch (err) {
    if (err && err.code === 'ENOENT') return false;
    throw err;
  }
}

async function parseJsonBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let rawBody = '';
    req.on('data', (chunk) => {
      rawBody += chunk;
      if (rawBody.length > maxBytes) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('error', reject);
    req.on('end', () => {
      try {
        resolve(rawBody ? JSON.parse(rawBody) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

function isInsideRoot(filePath) {
  return filePath.startsWith(ROOT + path.sep) || filePath === ROOT;
}

async function safeRotateFile(filePath, degrees) {
  try {
    await fs.access(filePath);
  } catch {
    return false;
  }
  await execFileAsync('sips', ['-r', String(degrees), filePath]);
  return true;
}

function normalizeDays(days) {
  return days
    .map((day) => ({ ...day, items: Array.isArray(day.items) ? day.items : [] }))
    .filter((day) => day.items.length > 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function rebuildCounts(days) {
  const counts = { images: 0, videos: 0, live: 0 };
  for (const day of days) {
    for (const item of day.items || []) {
      if (item.type === 'video') counts.videos += 1;
      else counts.images += 1;
      if (item.live) counts.live += 1;
    }
  }
  return counts;
}

async function rewriteEntriesJs(entries) {
  const entriesJsPath = path.join(ROOT, 'data', 'entries.js');
  const js = `window.__CAMMINO_ENTRIES__ = ${JSON.stringify(entries, null, 2)};\n`;
  await fs.writeFile(entriesJsPath, js, 'utf8');
}

function removeTrackFileRefs(trackPoints, removedOrigSet) {
  return trackPoints.filter((p) => !removedOrigSet.has(String(p.file || '')));
}

function rebuildTrackByDay(trackPoints) {
  const byDay = {};
  for (const point of trackPoints) {
    const key = String(point.date || '').slice(0, 10);
    if (!key) continue;
    if (!byDay[key]) byDay[key] = [];
    byDay[key].push(point);
  }
  return byDay;
}

function rebuildTrackGeoJson(trackPoints) {
  const coords = trackPoints
    .map((p) => [Number(p.lon), Number(p.lat)])
    .filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]));
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: coords
        },
        properties: {
          points: coords.length
        }
      }
    ]
  };
}

async function handleDelete(req, res) {
  if (deleteInFlight) {
    sendJson(res, 409, { error: 'Delete already in progress' });
    return;
  }

  try {
    deleteInFlight = true;
    const payload = await parseJsonBody(req);
      const ids = Array.isArray(payload.ids) ? payload.ids.map((v) => String(v)) : [];
      if (!ids.length) {
        sendJson(res, 400, { error: 'No ids provided' });
        return;
      }

      const entriesPath = path.join(ROOT, 'data', 'entries.json');
      const trackPointsPath = path.join(ROOT, 'data', 'track_points.json');
      const trackByDayPath = path.join(ROOT, 'data', 'track_by_day.json');
      const trackGeoJsonPath = path.join(ROOT, 'data', 'track.geojson');

      const entries = await readJson(entriesPath);
      const days = Array.isArray(entries.days) ? entries.days : [];
      const idSet = new Set(ids);
      const removedItems = [];

      const nextDays = days.map((day) => {
        const keepItems = [];
        for (const item of day.items || []) {
          if (item.id && idSet.has(String(item.id))) {
            removedItems.push(item);
          } else {
            keepItems.push(item);
          }
        }
        return { ...day, items: keepItems };
      });

      if (!removedItems.length) {
        sendJson(res, 200, {
          removed: 0,
          files_deleted: 0,
          data: entries
        });
        return;
      }

      const removedOrigSet = new Set(
        removedItems
          .map((item) => String(item.orig || '').trim())
          .filter(Boolean)
      );

      const filesToDelete = new Set();
      for (const item of removedItems) {
        for (const key of ['src', 'thumb', 'poster']) {
          const file = item[key];
          if (typeof file === 'string' && file.trim()) {
            filesToDelete.add(path.resolve(ROOT, file));
          }
        }
        const orig = String(item.orig || '').trim();
        if (orig) filesToDelete.add(path.join(ROOT, 'new', orig));
      }

      let filesDeleted = 0;
      for (const filePath of filesToDelete) {
        const withinRoot = filePath.startsWith(ROOT + path.sep) || filePath === ROOT;
        if (!withinRoot) continue;
        const ok = await safeUnlink(filePath);
        if (ok) filesDeleted += 1;
      }

      const normalizedDays = normalizeDays(nextDays);
      const updatedEntries = {
        ...entries,
        generated_at: new Date().toISOString(),
        days: normalizedDays,
        portfolio: normalizedDays,
        counts: rebuildCounts(normalizedDays)
      };

      const trackPoints = await readJson(trackPointsPath, []);
      const filteredTrackPoints = removeTrackFileRefs(trackPoints, removedOrigSet);
      const rebuiltTrackByDay = rebuildTrackByDay(filteredTrackPoints);
      const rebuiltTrackGeo = rebuildTrackGeoJson(filteredTrackPoints);

      await writeJson(entriesPath, updatedEntries);
      await rewriteEntriesJs(updatedEntries);
      await writeJson(trackPointsPath, filteredTrackPoints);
      await writeJson(trackByDayPath, rebuiltTrackByDay);
      await writeJson(trackGeoJsonPath, rebuiltTrackGeo);

    sendJson(res, 200, {
      removed: removedItems.length,
      files_deleted: filesDeleted,
      data: updatedEntries
    });
  } catch (err) {
    sendJson(res, 500, { error: err.message || String(err) });
  } finally {
    deleteInFlight = false;
  }
}

async function handleRotate(req, res) {
  if (rotateInFlight) {
    sendJson(res, 409, { error: 'Rotate already in progress' });
    return;
  }
  try {
    rotateInFlight = true;
    const payload = await parseJsonBody(req);
    const id = payload && payload.id ? String(payload.id) : '';
    const degreesRaw = Number(payload && payload.degrees ? payload.degrees : 90);
    const degrees = degreesRaw % 360;
    if (!id) {
      sendJson(res, 400, { error: 'Missing id' });
      return;
    }
    if (!degrees || !Number.isFinite(degrees)) {
      sendJson(res, 400, { error: 'Invalid degrees' });
      return;
    }

    const entriesPath = path.join(ROOT, 'data', 'entries.json');
    const entries = await readJson(entriesPath);
    const allItems = (entries.days || []).flatMap((day) => day.items || []);
    const item = allItems.find((x) => String(x.id || '') === id);
    if (!item) {
      sendJson(res, 404, { error: 'Item not found' });
      return;
    }
    if (String(item.type) !== 'image') {
      sendJson(res, 400, { error: 'Only image items can be rotated' });
      return;
    }

    const targets = new Set();
    for (const key of ['src', 'thumb']) {
      const val = item[key];
      if (typeof val === 'string' && val.trim()) {
        targets.add(path.resolve(ROOT, val));
      }
    }
    const orig = String(item.orig || '').trim();
    if (orig) {
      targets.add(path.join(ROOT, 'new', orig));
    }

    let rotatedFiles = 0;
    for (const filePath of targets) {
      if (!isInsideRoot(filePath)) continue;
      const rotated = await safeRotateFile(filePath, degrees);
      if (rotated) rotatedFiles += 1;
    }
    if (!rotatedFiles) {
      sendJson(res, 404, { error: 'No files rotated' });
      return;
    }

    const updatedEntries = {
      ...entries,
      generated_at: new Date().toISOString()
    };
    await writeJson(entriesPath, updatedEntries);
    await rewriteEntriesJs(updatedEntries);
    sendJson(res, 200, {
      ok: true,
      rotated_files: rotatedFiles,
      cache_bust: Date.now()
    });
  } catch (err) {
    sendJson(res, 500, { error: err.message || String(err) });
  } finally {
    rotateInFlight = false;
  }
}

async function serveStatic(req, res) {
  const fsPath = toFsPath(req.url || '/');
  if (!fsPath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  let stat;
  try {
    stat = await fs.stat(fsPath);
  } catch {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const finalPath = stat.isDirectory() ? path.join(fsPath, 'index.html') : fsPath;
  const ext = path.extname(finalPath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';

  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': ext === '.json' || ext === '.js' ? 'no-cache' : 'public, max-age=3600'
  });
  createReadStream(finalPath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  if (req.method === 'POST' && req.url.split('?')[0] === '/api/delete') {
    await handleDelete(req, res);
    return;
  }
  if (req.method === 'POST' && req.url.split('?')[0] === '/api/rotate') {
    await handleRotate(req, res);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    res.end('Method not allowed');
    return;
  }

  await serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});
