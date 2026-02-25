const I18N = {
  it: {
    eyebrow: 'Diario di viaggio',
    title: 'Cammino di Santiago',
    subtitle: 'Un recap giorno per giorno tra foto, video e ricordi di strada.',
    days: 'Giorni',
    photos: 'Foto',
    videos: 'Video',
    loading: 'Sto preparando il diario…',
    day_label: 'Giorno',
    items_label: 'contenuti',
    photo_tag: 'Foto',
    video_tag: 'Video',
    footer_note: 'Creato automaticamente a partire dagli scatti originali.',
    view_diary: 'Diario',
    view_portfolio: 'Portfolio',
    notes_label: 'Note del giorno',
    empty_note: 'Aggiungi un ricordo personale qui.',
    mini_map: 'Percorso del giorno',
    mini_map_cumulative: 'Percorso cumulativo',
    open_map: 'Apri la mappa',
    mini_map_empty: 'Nessun GPS per questo giorno.',
    gps_estimated: 'stimata',
    whatsapp_badge: 'Inoltrata su WhatsApp · orario non affidabile',
    share: 'Condividi',
    share_copied: 'Copiato',
    select_mode: 'Seleziona',
    clear_selected: 'Deseleziona tutto',
    unlock_day: 'Ricarica contenuti',
    day_locked: 'Contenuti non caricati per alleggerire la pagina.',
    delete_selected: 'Cancella selezionati',
    delete_confirm: 'Confermi la cancellazione definitiva di {count} file?',
    delete_success: '{count} file cancellati.',
    delete_error: 'Errore durante la cancellazione',
    deleting: 'Cancellazione...',
    carousel: 'Carosello'
  },
  en: {
    eyebrow: 'Travel diary',
    title: 'Camino de Santiago',
    subtitle: 'A day-by-day recap through photos, videos, and trail memories.',
    days: 'Days',
    photos: 'Photos',
    videos: 'Videos',
    loading: 'Preparing the diary…',
    day_label: 'Day',
    items_label: 'items',
    photo_tag: 'Photo',
    video_tag: 'Video',
    footer_note: 'Automatically generated from the original shots.',
    view_diary: 'Diary',
    view_portfolio: 'Portfolio',
    notes_label: 'Day notes',
    empty_note: 'Add a personal memory here.',
    mini_map: 'Daily route',
    mini_map_cumulative: 'Cumulative route',
    open_map: 'Open map',
    mini_map_empty: 'No GPS for this day.',
    gps_estimated: 'estimated',
    whatsapp_badge: 'Forwarded on WhatsApp · unreliable time',
    share: 'Share',
    share_copied: 'Copied',
    select_mode: 'Select',
    clear_selected: 'Clear selection',
    unlock_day: 'Load content',
    day_locked: 'Content not loaded yet to keep the page light.',
    delete_selected: 'Delete selected',
    delete_confirm: 'Confirm permanent deletion of {count} files?',
    delete_success: '{count} files deleted.',
    delete_error: 'Delete failed',
    deleting: 'Deleting...',
    carousel: 'Carousel'
  }
};

let currentLang = 'it';
let currentView = 'diary';

const setLang = (lang) => {
  currentLang = lang;
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (I18N[lang][key]) {
      el.textContent = I18N[lang][key];
    }
  });
  document.querySelectorAll('.lang__btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });
  document.querySelectorAll('[data-share-btn]').forEach((btn) => {
    if (btn.dataset.copied === '1') btn.textContent = '✓';
    else btn.textContent = '↗';
    btn.setAttribute('aria-label', I18N[lang].share);
    btn.setAttribute('title', I18N[lang].share);
  });
  renderDates();
  renderManageTools();
};

let dataCache = null;
let trackByDay = null;
let miniMap = null;
let miniLayer = null;
let dayMapRegistry = new Map();
let cleanupSectionSync = null;
let renderedDayOrder = [];
let modalZoomCleanup = null;
let lazyMediaObserver = null;
let deleteInFlight = false;
const selectedIds = new Set();
let unlockedDayKeys = new Set();

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const PHOTO_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp']);
const IMG_PLACEHOLDER =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const IS_FIREFOX =
  typeof navigator !== 'undefined' &&
  /firefox/i.test(String(navigator.userAgent || ''));
const SHOW_DAY_MEDIA_PINS = true;
const GPS_INFERENCE_EXCLUDED_ORIG = new Set(['PHOTO-2019-06-12-21-03-29.JPG']);
const firefoxHydrationQueue = [];
let firefoxHydrationDrainTimer = null;

const queueFirefoxHydration = (el, highPriority = false) => {
  if (!el || !el.dataset || !el.dataset.src) return;
  if (el.dataset.ffQueued === '1') return;
  el.dataset.ffQueued = '1';
  if (highPriority) firefoxHydrationQueue.unshift(el);
  else firefoxHydrationQueue.push(el);
  if (firefoxHydrationDrainTimer) return;
  const drain = () => {
    let budget = 10;
    while (budget > 0 && firefoxHydrationQueue.length > 0) {
      const next = firefoxHydrationQueue.shift();
      if (next && next.dataset) next.dataset.ffQueued = '0';
      if (next) hydrateLazyMedia(next);
      budget -= 1;
    }
    if (firefoxHydrationQueue.length > 0) {
      firefoxHydrationDrainTimer = window.setTimeout(drain, 40);
    } else {
      firefoxHydrationDrainTimer = null;
    }
  };
  firefoxHydrationDrainTimer = window.setTimeout(drain, 10);
};
const withCacheBust = (url, token) => {
  if (!url) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}v=${encodeURIComponent(String(token))}`;
};

const API_BASE_CANDIDATES = [
  'http://127.0.0.1:4173',
  'http://localhost:4173',
  ''
];

const postJsonWithApiFallback = async (path, payload) => {
  let lastError = null;
  for (const base of API_BASE_CANDIDATES) {
    const url = `${base}${path}`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (response.ok) {
        const json = await response.json();
        return { response, payload: json };
      }
      const detail = await response.text();
      const err = new Error(detail || `HTTP ${response.status}`);
      err.status = response.status;
      lastError = err;
      if (response.status === 405 || response.status === 501 || response.status === 404) {
        continue;
      }
      throw err;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('API unavailable');
};

const isPhotoTrackPoint = (point) => {
  const file = (point && point.file ? String(point.file) : '').trim().toLowerCase();
  if (!file.includes('.')) return true;
  const ext = file.split('.').pop();
  return PHOTO_EXTENSIONS.has(ext);
};

const toFiniteCoord = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const getGoogleMapsUrl = (lat, lon) => {
  const a = toFiniteCoord(lat);
  const b = toFiniteCoord(lon);
  if (a === null || b === null) return '';
  return `https://www.google.com/maps?q=${a},${b}`;
};

const hasMapsCoordinates = (item) => !!getGoogleMapsUrl(item && item.lat, item && item.lon);

const buildTrackPointIndex = (points) => {
  const index = new Map();
  (points || []).forEach((point) => {
    const file = point && point.file ? String(point.file).trim() : '';
    const lat = toFiniteCoord(point && point.lat);
    const lon = toFiniteCoord(point && point.lon);
    if (!file || lat === null || lon === null) return;
    const key = file.toUpperCase();
    if (!index.has(key)) index.set(key, { lat, lon });
  });
  return index;
};

const buildRuntasticPointsByDay = (points) => {
  const byDay = new Map();
  (points || []).forEach((point) => {
    const file = String(point && point.file ? point.file : '');
    if (!file.startsWith('RUNTASTIC_')) return;
    const date = String(point && point.date ? point.date : '').slice(0, 10);
    const lat = toFiniteCoord(point && point.lat);
    const lon = toFiniteCoord(point && point.lon);
    const time = String(point && point.time ? point.time : '');
    if (!date || lat === null || lon === null || !time) return;
    const ts = Date.parse(time);
    if (Number.isNaN(ts)) return;
    if (!byDay.has(date)) byDay.set(date, []);
    byDay.get(date).push({ lat, lon, ts });
  });
  byDay.forEach((arr) => arr.sort((a, b) => a.ts - b.ts));
  return byDay;
};

const parseItemLocalTimestamp = (date, time) => {
  const d = String(date || '').slice(0, 10);
  const t = String(time || '').trim();
  if (!d || !t) return null;
  const normalized = t.length === 5 ? `${t}:00` : t;
  const ts = Date.parse(`${d}T${normalized}`);
  return Number.isNaN(ts) ? null : ts;
};

const findNearestTrackPoint = (dayPoints, ts, maxDeltaMs) => {
  if (!Array.isArray(dayPoints) || !dayPoints.length || !Number.isFinite(ts)) return null;
  let best = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const p of dayPoints) {
    const delta = Math.abs(p.ts - ts);
    if (delta < bestDelta) {
      best = p;
      bestDelta = delta;
    }
  }
  if (!best || bestDelta > maxDeltaMs) return null;
  return best;
};

const enrichDataWithTrackPoints = (data, points) => {
  if (!data) return;
  const index = buildTrackPointIndex(points);
  const runtasticByDay = buildRuntasticPointsByDay(points);
  if (!index.size && !runtasticByDay.size) return;
  const MAX_NEAREST_DELTA_MS = 2 * 60 * 60 * 1000;
  const applyToDays = (days) => {
    (days || []).forEach((day) => {
      (day.items || []).forEach((item) => {
        const orig = item && item.orig ? String(item.orig).trim() : '';
        const exactMatch = orig ? index.get(orig.toUpperCase()) : null;
        if (exactMatch) {
          item.lat = exactMatch.lat;
          item.lon = exactMatch.lon;
          item.gpsInferred = false;
          return;
        }
        const existingLat = toFiniteCoord(item && item.lat);
        const existingLon = toFiniteCoord(item && item.lon);
        if (existingLat !== null && existingLon !== null) {
          item.gpsInferred = false;
          return;
        }
        const upperOrig = String(orig || '').toUpperCase();
        if (GPS_INFERENCE_EXCLUDED_ORIG.has(upperOrig)) return;
        const dayKey = String(day && day.date ? day.date : '').slice(0, 10);
        if (!dayKey) return;
        const ts = parseItemLocalTimestamp(dayKey, item && item.time);
        if (ts === null) return;
        const nearest = findNearestTrackPoint(runtasticByDay.get(dayKey), ts, MAX_NEAREST_DELTA_MS);
        if (!nearest) return;
        item.lat = nearest.lat;
        item.lon = nearest.lon;
        item.gpsInferred = true;
      });
    });
  };
  applyToDays(data.days);
  applyToDays(data.portfolio);
};

const formatDate = (dateStr) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const fmt = new Intl.DateTimeFormat(currentLang, {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });
  return fmt.format(date);
};

const renderDates = () => {
  if (!dataCache) return;
  document.querySelectorAll('[data-date-label]').forEach((el) => {
    const dateStr = el.getAttribute('data-date-label');
    el.textContent = formatDate(dateStr);
  });
  document.querySelectorAll('[data-items-count]').forEach((el) => {
    const count = el.getAttribute('data-items-count');
    el.textContent = `${count} ${I18N[currentLang].items_label}`;
  });
  document.querySelectorAll('[data-tag="photo"]').forEach((el) => {
    el.textContent = I18N[currentLang].photo_tag;
  });
  document.querySelectorAll('[data-tag="video"]').forEach((el) => {
    el.textContent = I18N[currentLang].video_tag;
  });
  document.querySelectorAll('[data-day-label]').forEach((el) => {
    const idx = el.getAttribute('data-day-label');
    el.textContent = `${I18N[currentLang].day_label} ${idx}`;
  });
  document.querySelectorAll('[data-notes-label]').forEach((el) => {
    el.textContent = I18N[currentLang].notes_label;
  });
  document.querySelectorAll('[data-empty-note]').forEach((el) => {
    el.textContent = I18N[currentLang].empty_note;
  });
  document.querySelectorAll('[data-i18n="mini_map"]').forEach((el) => {
    el.textContent = I18N[currentLang].mini_map;
  });
  document.querySelectorAll('.day-track__open').forEach((el) => {
    el.textContent = I18N[currentLang].open_map;
  });
  document.querySelectorAll('[data-day-track-empty]').forEach((el) => {
    el.textContent = I18N[currentLang].mini_map_empty;
  });
  document.querySelectorAll('[data-day-lock-msg]').forEach((el) => {
    el.textContent = I18N[currentLang].day_locked;
  });
  document.querySelectorAll('[data-day-unlock-btn]').forEach((el) => {
    el.textContent = I18N[currentLang].unlock_day;
  });
};

const disconnectLazyMediaObserver = () => {
  if (lazyMediaObserver) {
    lazyMediaObserver.disconnect();
    lazyMediaObserver = null;
  }
};

const isNearViewport = (el, margin = 700) => {
  if (!el || typeof el.getBoundingClientRect !== 'function') return false;
  const rect = el.getBoundingClientRect();
  const vh = window.innerHeight || document.documentElement.clientHeight || 0;
  return rect.bottom >= -margin && rect.top <= vh + margin;
};

const hydrateLazyMedia = (el) => {
  if (!el) return;
  if (el.tagName === 'IMG') {
    const src = el.dataset.src;
    if (src && el.src !== src) el.src = src;
    el.removeAttribute('data-src');
    return;
  }
  if (el.tagName === 'VIDEO') {
    const poster = el.dataset.poster;
    if (poster) {
      el.poster = poster;
      el.removeAttribute('data-poster');
    }
    const videoSrc = el.dataset.src;
    if (videoSrc) {
      const source = el.querySelector('source');
      if (source && !source.src) {
        source.src = videoSrc;
        el.load();
      }
      el.removeAttribute('data-src');
    }
  }
};

const ensureLazyMediaObserver = () => {
  if (lazyMediaObserver || typeof IntersectionObserver === 'undefined') return lazyMediaObserver;
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        hydrateLazyMedia(entry.target);
        observer.unobserve(entry.target);
      });
    },
    {
      root: null,
      rootMargin: '400px 0px',
      threshold: 0.01
    }
  );
  lazyMediaObserver = observer;
  return lazyMediaObserver;
};

const registerLazyMedia = (el) => {
  if (IS_FIREFOX) {
    queueFirefoxHydration(el, isNearViewport(el, 900));
    return;
  }
  if (isNearViewport(el, 700)) {
    hydrateLazyMedia(el);
    return;
  }
  const observer = ensureLazyMediaObserver();
  if (!observer) {
    hydrateLazyMedia(el);
    return;
  }
  observer.observe(el);
};

const recoverVisibleLazyMedia = () => {
  const pending = document.querySelectorAll('img[data-src], video[data-src]');
  if (!pending.length) return;
  let hydrated = 0;
  pending.forEach((el) => {
    if (hydrated >= 36) return;
    if (!isNearViewport(el, 900)) return;
    if (IS_FIREFOX) queueFirefoxHydration(el, true);
    else hydrateLazyMedia(el);
    hydrated += 1;
  });
};

const modal = document.getElementById('live-modal');
const modalBody = document.getElementById('live-modal-body');
const modalClose = document.getElementById('live-modal-close');
const modalBackdrop = document.getElementById('live-modal-backdrop');
let modalItems = [];
let modalIndexById = new Map();
let modalGroupByItemId = new Map();
let modalIndex = -1;

const getModalPreviewSrc = (item) => {
  if (!item) return '';
  if (item.type === 'video') return item.poster || item.thumb || item.src || '';
  return item.thumb || item.src || '';
};

const appendModalGroupPanel = (currentItem) => {
  if (!currentItem || !currentItem.id) return;
  const group = modalGroupByItemId.get(String(currentItem.id));
  if (!group || group.length < 2) return;

  const panel = document.createElement('div');
  panel.className = 'modal__group-panel';
  const title = document.createElement('div');
  title.className = 'modal__group-title';
  title.textContent = I18N[currentLang].carousel || 'Carosello';
  panel.appendChild(title);

  const list = document.createElement('div');
  list.className = 'modal__group-list';
  list.setAttribute('role', 'listbox');
  group.forEach((groupItem) => {
    const thumbSrc = getModalPreviewSrc(groupItem);
    if (!thumbSrc) return;
    const row = document.createElement('div');
    row.className = 'modal__group-row';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'modal__group-item';
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-label', groupItem.orig || 'Elemento carosello');
    btn.dataset.itemId = String(groupItem.id || '');
    if (String(groupItem.id) === String(currentItem.id)) {
      btn.classList.add('is-active');
      btn.setAttribute('aria-selected', 'true');
    } else {
      btn.setAttribute('aria-selected', 'false');
    }
    const img = document.createElement('img');
    img.className = 'modal__group-thumb';
    img.src = thumbSrc;
    img.alt = groupItem.orig || '';
    btn.appendChild(img);
    btn.addEventListener('click', () => {
      list.querySelectorAll('.modal__group-item').forEach((el) => {
        el.classList.remove('is-active');
        el.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('is-active');
      btn.setAttribute('aria-selected', 'true');
      const idx = groupItem.id ? modalIndexById.get(groupItem.id) : -1;
      openModalItem(groupItem, idx);
    });
    row.appendChild(btn);

    if (groupItem.id) {
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'modal__group-delete';
      deleteBtn.setAttribute('aria-label', 'Cancella questo elemento');
      deleteBtn.title = 'Cancella questo elemento';
      deleteBtn.textContent = '×';
      deleteBtn.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const ok = window.confirm(formatI18N('delete_confirm', { count: 1 }));
        if (!ok) return;
        await deleteItemsByIds([String(groupItem.id)], { closeModalAfter: true, showSuccessAlert: false });
      });
      row.appendChild(deleteBtn);
    }

    list.appendChild(row);
  });

  panel.appendChild(list);
  modalBody.appendChild(panel);
};

const attachImageZoom = (image, controls = null) => {
  let scale = 1;
  let tx = 0;
  let ty = 0;
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let startTx = 0;
  let startTy = 0;
  let activePointerId = null;
  const pointers = new Map();
  let pinchStartDistance = 0;
  let pinchStartScale = 1;
  const ZOOM_STEP = 1.2;

  const getPanLimits = () => {
    const maxX = (image.clientWidth * (scale - 1)) / 2;
    const maxY = (image.clientHeight * (scale - 1)) / 2;
    return { maxX, maxY };
  };

  const applyTransform = () => {
    const { maxX, maxY } = getPanLimits();
    tx = clamp(tx, -maxX, maxX);
    ty = clamp(ty, -maxY, maxY);
    image.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    image.classList.toggle('is-zoomed', scale > 1.001);
    if (controls) {
      if (controls.zoomOut) controls.zoomOut.disabled = scale <= 1.001;
      if (controls.zoomIn) controls.zoomIn.disabled = scale >= 4.999;
    }
  };

  const zoomTo = (nextScale) => {
    scale = clamp(nextScale, 1, 5);
    if (scale <= 1.001) {
      tx = 0;
      ty = 0;
    }
    applyTransform();
  };

  const pointerDistance = () => {
    const pts = Array.from(pointers.values());
    if (pts.length < 2) return 0;
    const dx = pts[0].x - pts[1].x;
    const dy = pts[0].y - pts[1].y;
    return Math.hypot(dx, dy);
  };

  const onWheel = (event) => {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0015);
    zoomTo(scale * factor);
  };

  const onDoubleClick = (event) => {
    event.preventDefault();
    zoomTo(scale > 1.1 ? 1 : 2);
  };
  const onZoomInClick = () => zoomTo(scale * ZOOM_STEP);
  const onZoomOutClick = () => zoomTo(scale / ZOOM_STEP);
  const onResetClick = () => {
    zoomTo(1);
  };

  const onPointerDown = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      pinchStartDistance = pointerDistance();
      pinchStartScale = scale;
      isDragging = false;
      activePointerId = null;
      image.classList.remove('is-dragging');
      return;
    }
    if (scale <= 1.001) return;
    event.preventDefault();
    activePointerId = event.pointerId;
    isDragging = true;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    startTx = tx;
    startTy = ty;
    image.setPointerCapture(event.pointerId);
    image.classList.add('is-dragging');
  };

  const onPointerMove = (event) => {
    if (pointers.has(event.pointerId)) {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (pointers.size >= 2 && pinchStartDistance > 0) {
      event.preventDefault();
      const distance = pointerDistance();
      if (distance > 0) zoomTo(pinchStartScale * (distance / pinchStartDistance));
      return;
    }
    if (!isDragging || event.pointerId !== activePointerId) return;
    event.preventDefault();
    tx = startTx + (event.clientX - dragStartX);
    ty = startTy + (event.clientY - dragStartY);
    applyTransform();
  };

  const endDragging = (event) => {
    if (event) pointers.delete(event.pointerId);
    if (pointers.size < 2) {
      pinchStartDistance = 0;
      pinchStartScale = scale;
    }
    if (event && activePointerId !== event.pointerId) return;
    isDragging = false;
    activePointerId = null;
    image.classList.remove('is-dragging');
  };

  image.addEventListener('wheel', onWheel, { passive: false });
  image.addEventListener('dblclick', onDoubleClick);
  image.addEventListener('pointerdown', onPointerDown);
  image.addEventListener('pointermove', onPointerMove);
  image.addEventListener('pointerup', endDragging);
  image.addEventListener('pointercancel', endDragging);
  if (controls) {
    if (controls.zoomIn) controls.zoomIn.addEventListener('click', onZoomInClick);
    if (controls.zoomOut) controls.zoomOut.addEventListener('click', onZoomOutClick);
    if (controls.reset) controls.reset.addEventListener('click', onResetClick);
  }

  applyTransform();

  return () => {
    image.removeEventListener('wheel', onWheel);
    image.removeEventListener('dblclick', onDoubleClick);
    image.removeEventListener('pointerdown', onPointerDown);
    image.removeEventListener('pointermove', onPointerMove);
    image.removeEventListener('pointerup', endDragging);
    image.removeEventListener('pointercancel', endDragging);
    if (controls) {
      if (controls.zoomIn) controls.zoomIn.removeEventListener('click', onZoomInClick);
      if (controls.zoomOut) controls.zoomOut.removeEventListener('click', onZoomOutClick);
      if (controls.reset) controls.reset.removeEventListener('click', onResetClick);
    }
  };
};

const openImageModal = (item, itemIndex = null) => {
  if (!item || !item.src) return;
  if (modalZoomCleanup) {
    modalZoomCleanup();
    modalZoomCleanup = null;
  }
  const resolvedIndex = Number.isInteger(itemIndex)
    ? itemIndex
    : (item.id ? modalIndexById.get(item.id) : -1);
  modalIndex = Number.isInteger(resolvedIndex) ? resolvedIndex : -1;
  modalBody.innerHTML = '';
  const whereRef = pickGroupWhereRef(getGroupContextItems(item), item);
  const whereLabel = buildItemWhereLabel(item);
  if (whereLabel) {
    const modalWhere = buildModalWhereBadge(whereLabel, whereRef);
    if (modalWhere) modalBody.appendChild(modalWhere);
  }
  const modalSource = buildSourceBadge(getGroupContextItems(item), 'modal__source');
  if (modalSource) modalBody.appendChild(modalSource);
  const shell = document.createElement('div');
  shell.className = 'modal__zoom-shell';
  const image = document.createElement('img');
  image.src = item.src || item.thumb || IMG_PLACEHOLDER;
  image.addEventListener('error', () => {
    if (item.thumb && image.src !== item.thumb) {
      image.src = item.thumb;
      return;
    }
    image.src = IMG_PLACEHOLDER;
  }, { once: true });
  image.alt = item.orig || '';
  image.className = 'modal__image';
  image.draggable = false;
  const zoomControls = document.createElement('div');
  zoomControls.className = 'modal__zoom-controls';
  const zoomOutBtn = document.createElement('button');
  zoomOutBtn.type = 'button';
  zoomOutBtn.className = 'modal__zoom-btn';
  zoomOutBtn.textContent = '−';
  const zoomInBtn = document.createElement('button');
  zoomInBtn.type = 'button';
  zoomInBtn.className = 'modal__zoom-btn';
  zoomInBtn.textContent = '+';
  const zoomResetBtn = document.createElement('button');
  zoomResetBtn.type = 'button';
  zoomResetBtn.className = 'modal__zoom-btn';
  zoomResetBtn.textContent = '100%';
  const rotateBtn = document.createElement('button');
  rotateBtn.type = 'button';
  rotateBtn.className = 'modal__zoom-btn';
  rotateBtn.textContent = '↻';
  rotateBtn.setAttribute('aria-label', 'Ruota foto');
  if (!item.id) rotateBtn.disabled = true;
  zoomControls.appendChild(zoomOutBtn);
  zoomControls.appendChild(zoomInBtn);
  zoomControls.appendChild(zoomResetBtn);
  zoomControls.appendChild(rotateBtn);
  modalBody.appendChild(zoomControls);
  const cleanupFns = [];

  if (modalItems.length > 1 && modalIndex >= 0) {
    const nav = document.createElement('div');
    nav.className = 'modal__nav';
    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'modal__nav-btn modal__nav-btn--prev';
    prevBtn.setAttribute('aria-label', 'Foto precedente');
    prevBtn.textContent = '‹';
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'modal__nav-btn modal__nav-btn--next';
    nextBtn.setAttribute('aria-label', 'Foto successiva');
    nextBtn.textContent = '›';
    nav.appendChild(prevBtn);
    nav.appendChild(nextBtn);
    modalBody.appendChild(nav);

    const openByOffset = (offset) => {
      const len = modalItems.length;
      if (!len || modalIndex < 0) return;
      const nextIndex = (modalIndex + offset + len) % len;
      openModalItem(modalItems[nextIndex], nextIndex);
    };
    const onPrev = () => openByOffset(-1);
    const onNext = () => openByOffset(1);
    prevBtn.addEventListener('click', onPrev);
    nextBtn.addEventListener('click', onNext);
    cleanupFns.push(() => {
      prevBtn.removeEventListener('click', onPrev);
      nextBtn.removeEventListener('click', onNext);
    });
  }

  shell.appendChild(image);
  modalBody.appendChild(shell);
  appendModalGroupPanel(item);
  cleanupFns.push(attachImageZoom(image, {
    zoomIn: zoomInBtn,
    zoomOut: zoomOutBtn,
    reset: zoomResetBtn
  }));
  const onRotate = async () => {
    if (!item.id || rotateBtn.disabled) return;
    rotateBtn.disabled = true;
    try {
      const { payload } = await postJsonWithApiFallback('/api/rotate', { id: String(item.id), degrees: 90 });
      const cacheBust = payload && payload.cache_bust ? payload.cache_bust : Date.now();
      const modalBase = item.src || item.thumb || '';
      if (modalBase) image.src = withCacheBust(modalBase, cacheBust);
      if (item.id) {
        document.querySelectorAll('img[data-item-id]').forEach((imgEl) => {
          if (imgEl.dataset.itemId !== String(item.id)) return;
          const base = imgEl.dataset.src || item.thumb || item.src || '';
          if (!base) return;
          const busted = withCacheBust(base, cacheBust);
          imgEl.dataset.src = busted;
          imgEl.src = busted;
        });
      }
    } catch (err) {
      window.alert(`Errore rotazione: ${err.message || err}`);
    } finally {
      rotateBtn.disabled = false;
    }
  };
  rotateBtn.addEventListener('click', onRotate);
  cleanupFns.push(() => rotateBtn.removeEventListener('click', onRotate));
  modalZoomCleanup = () => cleanupFns.forEach((fn) => fn && fn());
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
};

const openVideoModal = (item, itemIndex = null) => {
  if (!item || !item.src) return;
  if (modalZoomCleanup) {
    modalZoomCleanup();
    modalZoomCleanup = null;
  }
  const resolvedIndex = Number.isInteger(itemIndex)
    ? itemIndex
    : (item.id ? modalIndexById.get(item.id) : -1);
  modalIndex = Number.isInteger(resolvedIndex) ? resolvedIndex : -1;
  modalBody.innerHTML = '';
  const whereRef = pickGroupWhereRef(getGroupContextItems(item), item);
  const whereLabel = buildItemWhereLabel(item);
  if (whereLabel) {
    const modalWhere = buildModalWhereBadge(whereLabel, whereRef);
    if (modalWhere) modalBody.appendChild(modalWhere);
  }
  const modalSource = buildSourceBadge(getGroupContextItems(item), 'modal__source');
  if (modalSource) modalBody.appendChild(modalSource);
  const video = document.createElement('video');
  video.controls = true;
  video.autoplay = true;
  video.playsInline = true;
  video.preload = 'metadata';
  if (item.poster) video.poster = item.poster;
  const source = document.createElement('source');
  source.src = item.src;
  source.type = item.mime || 'video/mp4';
  video.appendChild(source);
  modalBody.appendChild(video);
  appendModalGroupPanel(item);

  if (modalItems.length > 1 && modalIndex >= 0) {
    const nav = document.createElement('div');
    nav.className = 'modal__nav';
    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'modal__nav-btn modal__nav-btn--prev';
    prevBtn.setAttribute('aria-label', 'Elemento precedente');
    prevBtn.textContent = '‹';
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'modal__nav-btn modal__nav-btn--next';
    nextBtn.setAttribute('aria-label', 'Elemento successivo');
    nextBtn.textContent = '›';
    nav.appendChild(prevBtn);
    nav.appendChild(nextBtn);
    modalBody.appendChild(nav);

    const openByOffset = (offset) => {
      const len = modalItems.length;
      if (!len || modalIndex < 0) return;
      const nextIndex = (modalIndex + offset + len) % len;
      openModalItem(modalItems[nextIndex], nextIndex);
    };
    prevBtn.addEventListener('click', () => openByOffset(-1));
    nextBtn.addEventListener('click', () => openByOffset(1));
  }
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
};

const openModalItem = (item, index = null) => {
  if (!item) return;
  if (item.type === 'video') {
    openVideoModal(item, index);
    return;
  }
  openImageModal(item, index);
};

const closeModal = () => {
  if (!modal.classList.contains('open')) return;
  if (modalZoomCleanup) {
    modalZoomCleanup();
    modalZoomCleanup = null;
  }
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  modalBody.innerHTML = '';
  modalIndex = -1;
};

const formatI18N = (key, vars = {}) => {
  let text = I18N[currentLang][key] || '';
  Object.entries(vars).forEach(([name, value]) => {
    text = text.replace(`{${name}}`, String(value));
  });
  return text;
};

const buildShareUrl = (anchorId) => {
  const url = new URL(window.location.href);
  url.hash = String(anchorId || '').trim();
  return url.toString();
};

const copyTextToClipboard = async (text) => {
  const value = String(text || '');
  if (!value) return false;
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    await navigator.clipboard.writeText(value);
    return true;
  }
  const ta = document.createElement('textarea');
  ta.value = value;
  ta.setAttribute('readonly', 'readonly');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return !!ok;
  } catch {
    document.body.removeChild(ta);
    return false;
  }
};

const setShareButtonCopied = (btn) => {
  if (!btn) return;
  btn.dataset.copied = '1';
  btn.textContent = '✓';
  if (btn._shareCopiedTimer) window.clearTimeout(btn._shareCopiedTimer);
  btn._shareCopiedTimer = window.setTimeout(() => {
    btn.dataset.copied = '0';
    btn.textContent = '↗';
  }, 1300);
};

const createShareButton = (anchorId, className) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.setAttribute('data-share-btn', '1');
  btn.dataset.copied = '0';
  btn.textContent = '↗';
  btn.setAttribute('aria-label', I18N[currentLang].share);
  btn.setAttribute('title', I18N[currentLang].share);
  btn.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const url = buildShareUrl(anchorId);
    const copied = await copyTextToClipboard(url);
    if (copied) {
      setShareButtonCopied(btn);
      if (history && typeof history.replaceState === 'function') {
        history.replaceState(null, '', `#${anchorId}`);
      }
      return;
    }
    window.prompt('Copia questo link:', url);
  });
  return btn;
};

const highlightLinkedTarget = (el) => {
  if (!el) return;
  el.classList.add('is-linked-target');
  window.setTimeout(() => el.classList.remove('is-linked-target'), 6000);
};

const findDayKeyByItemId = (id) => {
  const key = String(id || '').trim();
  if (!key || !dataCache || !Array.isArray(dataCache.days)) return '';
  for (const day of dataCache.days) {
    const found = (day.items || []).some((it) => String(it && it.id) === key);
    if (found) return String(day.date || '');
  }
  return '';
};

const updateDaySectionHydration = (dayKey) => {
  const key = String(dayKey || '').trim();
  if (!key) return;
  const section = document.getElementById(`day-${key}`);
  if (!section) return;
  const unlockBtn = section.querySelector('.day-lock__btn');
  if (unlockBtn) unlockBtn.click();
};

const focusHashAnchor = (hashValue, attempts = 6) => {
  const raw = String(hashValue || window.location.hash || '').replace(/^#/, '');
  if (!raw) return;
  const anchor = decodeURIComponent(raw);

  if (anchor.startsWith('media-')) {
    const itemId = anchor.slice('media-'.length);
    const dayKey = findDayKeyByItemId(itemId);
    if (dayKey && !unlockedDayKeys.has(dayKey)) {
      unlockedDayKeys.add(dayKey);
      updateDaySectionHydration(dayKey);
    }
  }

  const target = document.getElementById(anchor);
  if (!target) {
    if (attempts > 0) {
      window.setTimeout(() => focusHashAnchor(anchor, attempts - 1), 220);
    }
    return;
  }
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  highlightLinkedTarget(target);
};

const renderManageTools = () => {
  const toggleBtn = document.getElementById('toggle-select');
  const deleteBtn = document.getElementById('delete-selected');
  if (!toggleBtn || !deleteBtn) return;
  toggleBtn.textContent = selectedIds.size > 0 ? I18N[currentLang].clear_selected : I18N[currentLang].select_mode;
  toggleBtn.classList.remove('active');
  toggleBtn.disabled = deleteInFlight;
  const count = selectedIds.size;
  deleteBtn.textContent = count
    ? `${I18N[currentLang].delete_selected} (${count})`
    : I18N[currentLang].delete_selected;
  deleteBtn.disabled = deleteInFlight || count === 0;
};

const setCardSelectedState = (card, selectBtn, isSelected) => {
  card.classList.toggle('is-selected', isSelected);
  if (!selectBtn) return;
  selectBtn.setAttribute('aria-checked', isSelected ? 'true' : 'false');
  selectBtn.textContent = isSelected ? '✓' : '';
};

const syncSelectedIdsWithCurrentData = () => {
  const validIds = new Set(modalItems.map((item) => item.id).filter(Boolean));
  Array.from(selectedIds).forEach((id) => {
    if (!validIds.has(id)) selectedIds.delete(id);
  });
};

const refreshStats = () => {
  if (!dataCache) return;
  document.getElementById('stat-days').textContent = dataCache.days.length;
  document.getElementById('stat-photos').textContent = dataCache.counts.images;
  document.getElementById('stat-videos').textContent = dataCache.counts.videos;
  document.getElementById('footer-meta').textContent = `Updated ${dataCache.generated_at}`;
};

const toggleSelectionById = (itemId, card, selectBtn) => {
  if (!itemId) return;
  if (selectedIds.has(itemId)) selectedIds.delete(itemId);
  else selectedIds.add(itemId);
  setCardSelectedState(card, selectBtn, selectedIds.has(itemId));
  renderManageTools();
};

const toggleSelectionMode = () => {
  if (!selectedIds.size) return;
  selectedIds.clear();
  renderView();
};

const deleteItemsByIds = async (ids, options = {}) => {
  const {
    closeModalAfter = false,
    showSuccessAlert = true
  } = options;
  const uniqueIds = Array.from(new Set((ids || []).map((id) => String(id)).filter(Boolean)));
  if (deleteInFlight || uniqueIds.length === 0) return false;
  deleteInFlight = true;
  renderManageTools();
  const deleteBtn = document.getElementById('delete-selected');
  if (deleteBtn) deleteBtn.textContent = I18N[currentLang].deleting;

  try {
    const { payload } = await postJsonWithApiFallback('/api/delete', { ids: uniqueIds });
    if (payload && payload.data) {
      dataCache = payload.data;
    } else {
      const reload = await fetch(`data/entries.json?t=${Date.now()}`, { cache: 'no-store' });
      dataCache = await reload.json();
    }
    uniqueIds.forEach((id) => selectedIds.delete(id));
    if (closeModalAfter) closeModal();
    refreshStats();
    renderView();
    if (showSuccessAlert) {
      window.alert(formatI18N('delete_success', { count: payload.removed || uniqueIds.length }));
    }
    return true;
  } catch (err) {
    window.alert(`${I18N[currentLang].delete_error}: ${err.message || err}`);
    return false;
  } finally {
    deleteInFlight = false;
    renderManageTools();
  }
};

const deleteSelectedItems = async () => {
  if (deleteInFlight || selectedIds.size === 0) return;
  const count = selectedIds.size;
  const accepted = window.confirm(formatI18N('delete_confirm', { count }));
  if (!accepted) return;
  await deleteItemsByIds(Array.from(selectedIds), { closeModalAfter: true, showSuccessAlert: true });
};

modalClose.addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', closeModal);
document.addEventListener('keydown', (e) => {
  if (!modal.classList.contains('open')) return;
  const target = e.target;
  if (target && (target.tagName === 'VIDEO' || target.closest?.('video'))) return;
  if (e.key === 'Escape') {
    closeModal();
    return;
  }
  if (modalIndex >= 0 && modalItems.length > 1) {
    if (e.key === 'ArrowLeft') {
      const nextIndex = (modalIndex - 1 + modalItems.length) % modalItems.length;
      openModalItem(modalItems[nextIndex], nextIndex);
    } else if (e.key === 'ArrowRight') {
      const nextIndex = (modalIndex + 1) % modalItems.length;
      openModalItem(modalItems[nextIndex], nextIndex);
    }
  }
});

const getNote = (day) => {
  const note = day.notes || {};
  return (currentLang === 'it' ? note.it : note.en) || '';
};

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const renderNoteHtml = (text) => {
  const safe = escapeHtml(text);
  return safe
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\r?\n/g, '<br>');
};

const parseItemTimestamp = (item) => {
  const date = String(item && item.date ? item.date : '').trim();
  const time = String(item && item.time ? item.time : '').trim();
  if (!date || !time) return Number.NaN;
  const parts = time.split(':').map(Number);
  const hh = Number.isFinite(parts[0]) ? parts[0] : 0;
  const mm = Number.isFinite(parts[1]) ? parts[1] : 0;
  return new Date(`${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`).getTime();
};

const parseOrigSequence = (orig) => {
  const name = String(orig || '').toUpperCase();
  const match = name.match(/IMG_(\d+)/);
  return match ? Number(match[1]) : Number.NaN;
};

const formatDuration = (seconds) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const total = Math.round(seconds);
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  if (hh > 0) {
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
};

const shouldGroupAsBurst = (prev, curr) => {
  if (!prev || !curr) return false;
  if (prev.type !== curr.type) return false;
  if (prev.date !== curr.date) return false;
  const prevTs = parseItemTimestamp(prev);
  const currTs = parseItemTimestamp(curr);
  if (!Number.isFinite(prevTs) || !Number.isFinite(currTs)) return false;
  if (Math.abs(currTs - prevTs) > 90 * 1000) return false;

  const prevSeq = parseOrigSequence(prev.orig);
  const currSeq = parseOrigSequence(curr.orig);
  if (Number.isFinite(prevSeq) && Number.isFinite(currSeq)) {
    return Math.abs(currSeq - prevSeq) <= 3;
  }
  return true;
};

const groupDayItems = (items) => {
  const groups = [];
  let current = [];
  (items || []).forEach((item) => {
    if (!current.length) {
      current = [item];
      return;
    }
    const prev = current[current.length - 1];
    const prevCarousel = String(prev && prev.carouselKey ? prev.carouselKey : '').trim();
    const currCarousel = String(item && item.carouselKey ? item.carouselKey : '').trim();
    if (prevCarousel || currCarousel) {
      if (prevCarousel && prevCarousel === currCarousel) {
        current.push(item);
        return;
      }
      groups.push(current);
      current = [item];
      return;
    }
    if (shouldGroupAsBurst(prev, item)) {
      current.push(item);
      return;
    }
    groups.push(current);
    current = [item];
  });
  if (current.length) groups.push(current);
  return groups;
};

const getGroupThumbSrc = (item) => {
  if (!item) return '';
  if (item.type === 'video') return item.poster || item.thumb || '';
  return item.thumb || item.src || '';
};

const formatItemTimeLabel = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return raw;
  const hh = String(Number(match[1])).padStart(2, '0');
  const mm = match[2];
  return `${hh}:${mm}`;
};

const buildGroupTimeRangeLabel = (items) => {
  const times = (items || [])
    .map((it) => formatItemTimeLabel(it && it.time))
    .filter(Boolean);
  if (!times.length) return '';
  if (times.length === 1) return times[0];
  const start = times[0];
  const end = times[times.length - 1];
  return start === end ? start : `${start}-${end}`;
};

const hasWhatsAppSharedItems = (items) => (items || []).some((it) => !!(it && it.whatsappShared));

const buildSourceBadge = (items, className) => {
  if (!hasWhatsAppSharedItems(items)) return null;
  const badge = document.createElement('div');
  badge.className = className;
  badge.textContent = I18N[currentLang].whatsapp_badge;
  badge.title = I18N[currentLang].whatsapp_badge;
  return badge;
};

const buildGroupPlaceLabel = (items) => {
  const places = (items || [])
    .map((it) => String(it && it.place ? it.place : '').trim())
    .filter(Boolean);
  if (!places.length) return '';
  const unique = [...new Set(places)];
  if (unique.length === 1) return unique[0];
  return `${unique[0]}...`;
};

const buildWhereLabel = (timeLabel, placeLabel) => {
  const time = String(timeLabel || '').trim();
  const place = String(placeLabel || '').trim();
  if (time && place) return `h${time} a ${place}`;
  if (time) return `h${time}`;
  return place;
};

const buildWhereBadge = (whereLabel, item, className) => {
  const label = String(whereLabel || '').trim();
  if (!label) return null;
  const mapsUrl = getGoogleMapsUrl(item && item.lat, item && item.lon);
  const estimated = !!(item && item.gpsInferred);
  const displayLabel = estimated ? `${label} · ${I18N[currentLang].gps_estimated}` : label;
  if (mapsUrl) {
    const link = document.createElement('a');
    link.className = `${className} ${className}--link`;
    if (estimated) link.classList.add(`${className}--estimated`);
    link.href = mapsUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = displayLabel;
    link.title = `${displayLabel}`;
    return link;
  }
  const badge = document.createElement('div');
  badge.className = className;
  badge.textContent = displayLabel;
  badge.title = displayLabel;
  return badge;
};

const buildModalWhereBadge = (whereLabel, item) => {
  const label = String(whereLabel || '').trim();
  if (!label) return null;
  const mapsUrl = getGoogleMapsUrl(item && item.lat, item && item.lon);
  const estimated = !!(item && item.gpsInferred);
  const displayLabel = estimated ? `${label} · ${I18N[currentLang].gps_estimated}` : label;
  if (!mapsUrl) return buildWhereBadge(displayLabel, item, 'modal__where');
  const link = document.createElement('a');
  link.className = 'modal__where modal__where--link';
  if (estimated) link.classList.add('modal__where--estimated');
  link.href = mapsUrl;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.title = `${displayLabel} · Google Maps`;
  const main = document.createElement('span');
  main.className = 'modal__where-main';
  main.textContent = displayLabel;
  const cta = document.createElement('span');
  cta.className = 'modal__where-cta';
  cta.textContent = 'Google Maps ↗';
  link.appendChild(main);
  link.appendChild(cta);
  return link;
};

const getGroupContextItems = (item) => {
  if (!item || !item.id) return [item];
  const group = modalGroupByItemId.get(String(item.id));
  if (Array.isArray(group) && group.length) return group;
  return [item];
};

const pickGroupWhereRef = (items, fallback) =>
  (items || []).find((it) => hasMapsCoordinates(it) && !it.gpsInferred)
  || (items || []).find(hasMapsCoordinates)
  || fallback;

const buildItemWhereLabel = (item) => {
  if (!item) return '';
  const contextItems = getGroupContextItems(item);
  const time = contextItems.length > 1
    ? buildGroupTimeRangeLabel(contextItems)
    : formatItemTimeLabel(item.time);
  const place = contextItems.length > 1
    ? buildGroupPlaceLabel(contextItems)
    : String(item.place || '').trim();
  return buildWhereLabel(time, place);
};

const buildMediaCard = (groupItems) => {
  const items = Array.isArray(groupItems) && groupItems.length ? groupItems : [];
  const item = items[0];
  if (!item) return document.createElement('div');
  const card = document.createElement('div');
  card.className = 'media-card';
  if (item.id) card.id = `media-${item.id}`;
  const itemIds = items.map((it) => String(it.id || '')).filter(Boolean);
  const selectedCount = itemIds.filter((id) => selectedIds.has(id)).length;
  const itemSelected = selectedCount > 0;
  const selectBtn = document.createElement('button');
  selectBtn.type = 'button';
  selectBtn.className = 'media-select';
  selectBtn.setAttribute('aria-checked', 'false');
  selectBtn.setAttribute('aria-label', 'Seleziona elemento');
  selectBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const beforeCount = itemIds.filter((id) => selectedIds.has(id)).length;
    const shouldSelectAll = beforeCount !== itemIds.length;
    itemIds.forEach((id) => {
      if (shouldSelectAll) selectedIds.add(id);
      else selectedIds.delete(id);
    });
    const afterCount = itemIds.filter((id) => selectedIds.has(id)).length;
    setCardSelectedState(card, selectBtn, afterCount > 0);
    if (afterCount > 0 && afterCount < itemIds.length) {
      selectBtn.textContent = String(afterCount);
    }
    renderManageTools();
  });

  if (item.type === 'image') {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = item.orig;
    if (item.id) img.dataset.itemId = String(item.id);
    img.src = IMG_PLACEHOLDER;
    img.dataset.src = item.thumb || item.src;
    img.decoding = 'async';
    img.addEventListener('error', () => {
      if (item.src && img.src !== item.src) {
        img.src = item.src;
        return;
      }
      img.src = IMG_PLACEHOLDER;
    });
    registerLazyMedia(img);
    card.appendChild(img);
    const itemIdx = item.id ? modalIndexById.get(item.id) : -1;
    img.addEventListener('click', () => {
      openImageModal(item, itemIdx);
    });
  } else {
    card.classList.add('media-card--video');
    const itemIdx = item.id ? modalIndexById.get(item.id) : -1;
    const durationBadge = document.createElement('div');
    durationBadge.className = 'media-duration';
    durationBadge.textContent = 'video --:--';
    card.appendChild(durationBadge);
    const posterImg = document.createElement('img');
    posterImg.loading = 'lazy';
    posterImg.alt = item.orig || 'Video';
    posterImg.src = IMG_PLACEHOLDER;
    posterImg.dataset.src = item.poster || item.thumb || item.src;
    posterImg.decoding = 'async';
    posterImg.addEventListener('error', () => {
      posterImg.src = IMG_PLACEHOLDER;
    });
    registerLazyMedia(posterImg);
    posterImg.addEventListener('click', () => {
      openVideoModal(item, itemIdx);
    });
    card.appendChild(posterImg);

    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.src = item.src;
    probe.addEventListener('loadedmetadata', () => {
      durationBadge.textContent = `video ${formatDuration(probe.duration)}`;
    }, { once: true });
    probe.addEventListener('error', () => {
      durationBadge.textContent = 'video --:--';
    }, { once: true });
    if (!item.src) {
      durationBadge.textContent = 'video --:--';
    }
  }

  if (item.type === 'video') {
    const playIndicator = document.createElement('div');
    playIndicator.className = 'media-play-indicator';
    playIndicator.setAttribute('aria-hidden', 'true');
    playIndicator.textContent = '▶';
    card.appendChild(playIndicator);
  }

  const whereLabel = buildWhereLabel(
    items.length > 1 ? buildGroupTimeRangeLabel(items) : formatItemTimeLabel(item.time),
    items.length > 1 ? buildGroupPlaceLabel(items) : String(item.place || '').trim()
  );
  if (whereLabel) {
    const whereRef = pickGroupWhereRef(items, item);
    const whereBadge = buildWhereBadge(whereLabel, whereRef, 'media-where');
    if (whereBadge) card.appendChild(whereBadge);
  }
  const sourceBadge = buildSourceBadge(items, 'media-source');
  if (sourceBadge) card.appendChild(sourceBadge);
  if (item.id) {
    const shareBtn = createShareButton(`media-${item.id}`, 'media-share');
    card.appendChild(shareBtn);
  }

  card.appendChild(selectBtn);
  setCardSelectedState(card, selectBtn, itemSelected);
  if (selectedCount > 0 && selectedCount < itemIds.length) {
    selectBtn.textContent = String(selectedCount);
  }

  if (items.length > 1) {
    card.classList.add('media-card--group');
    const burst = document.createElement('div');
    burst.className = 'media-burst';
    burst.textContent = `+${items.length - 1}`;
    card.appendChild(burst);

    const strip = document.createElement('div');
    strip.className = 'media-strip';
    const thumbsWrap = document.createElement('div');
    thumbsWrap.className = 'media-strip__thumbs';
    items.slice(1, 5).forEach((subItem) => {
      const thumbSrc = getGroupThumbSrc(subItem);
      if (!thumbSrc) return;
      const thumbBtn = document.createElement('button');
      thumbBtn.type = 'button';
      thumbBtn.className = 'media-strip__thumb-btn';
      const thumbImg = document.createElement('img');
      thumbImg.className = 'media-strip__thumb-img';
      thumbImg.loading = 'lazy';
      thumbImg.decoding = 'async';
      thumbImg.alt = subItem.orig || '';
      thumbImg.src = thumbSrc;
      thumbBtn.appendChild(thumbImg);
      thumbBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const subIdx = subItem.id ? modalIndexById.get(subItem.id) : -1;
        openModalItem(subItem, subIdx);
      });
      thumbsWrap.appendChild(thumbBtn);
    });

    if (items.length > 5) {
      const more = document.createElement('div');
      more.className = 'media-strip__more';
      more.textContent = `+${items.length - 5}`;
      thumbsWrap.appendChild(more);
    }

    strip.appendChild(thumbsWrap);
    card.appendChild(strip);
  }
  return card;
};

const buildDay = (day, idx, isPortfolio) => {
  const section = document.createElement('section');
  section.className = 'day reveal';
  section.style.setProperty('--delay', `${Math.min(idx * 0.05, 0.4)}s`);
  section.id = `day-${day.date}`;

  const header = document.createElement('div');
  header.className = 'day__header';

  const title = document.createElement('h2');
  title.className = 'day__title';
  title.setAttribute('data-date-label', day.date);
  title.textContent = formatDate(day.date);

  const meta = document.createElement('div');
  meta.className = 'day__meta';
  meta.setAttribute('data-day-label', idx + 1);

  const count = document.createElement('div');
  count.className = 'day__meta';
  count.setAttribute('data-items-count', day.items.length);
  count.textContent = `${day.items.length} ${I18N[currentLang].items_label}`;

  const reloadDayBtn = document.createElement('button');
  reloadDayBtn.type = 'button';
  reloadDayBtn.className = 'day__reload';
  reloadDayBtn.setAttribute('aria-label', 'Ricarica contenuti giorno');
  reloadDayBtn.setAttribute('title', 'Ricarica contenuti');
  reloadDayBtn.textContent = '↻';

  header.appendChild(title);
  header.appendChild(meta);
  header.appendChild(count);
  header.appendChild(reloadDayBtn);
  
  const dayTrackCard = buildDayTrackCard(day.date);

  const notesText = getNote(day);
  const notes = document.createElement('div');
  notes.className = 'notes';
  notes.id = `note-${day.date}`;
  const notesHead = document.createElement('div');
  notesHead.className = 'notes__head';
  const notesLabel = document.createElement('div');
  notesLabel.className = 'notes__label';
  notesLabel.setAttribute('data-notes-label', '1');
  notesLabel.textContent = I18N[currentLang].notes_label;
  const notesShare = createShareButton(`note-${day.date}`, 'notes__share');
  notesHead.appendChild(notesLabel);
  notesHead.appendChild(notesShare);
  const notesBody = document.createElement('div');
  if (notesText) {
    notesBody.innerHTML = renderNoteHtml(notesText);
  } else {
    notesBody.setAttribute('data-empty-note', '1');
    notesBody.textContent = I18N[currentLang].empty_note;
  }
  notes.appendChild(notesHead);
  notes.appendChild(notesBody);

  const grid = document.createElement('div');
  grid.className = isPortfolio ? 'grid grid--portfolio' : 'grid';
  const lockPanel = document.createElement('div');
  lockPanel.className = 'day-lock';
  const lockMsg = document.createElement('div');
  lockMsg.className = 'day-lock__msg';
  lockMsg.setAttribute('data-day-lock-msg', '1');
  lockMsg.textContent = I18N[currentLang].day_locked;
  const unlockBtn = document.createElement('button');
  unlockBtn.type = 'button';
  unlockBtn.className = 'day-lock__btn';
  unlockBtn.setAttribute('data-day-unlock-btn', '1');
  unlockBtn.textContent = I18N[currentLang].unlock_day;
  lockPanel.appendChild(lockMsg);
  lockPanel.appendChild(unlockBtn);

  const fillGrid = () => {
    if (grid.childElementCount > 0) return;
    (day.uiGroups || []).forEach((group) => {
      const card = buildMediaCard(group);
      grid.appendChild(card);
    });
  };
  const refillGrid = () => {
    grid.innerHTML = '';
    (day.uiGroups || []).forEach((group) => {
      const card = buildMediaCard(group);
      grid.appendChild(card);
    });
    recoverVisibleLazyMedia();
  };

  const dayKey = day.date;
  reloadDayBtn.addEventListener('click', () => {
    unlockedDayKeys.add(dayKey);
    refillGrid();
    if (lockPanel.parentNode) lockPanel.remove();
  });
  if (unlockedDayKeys.has(dayKey)) {
    fillGrid();
  } else {
    unlockBtn.addEventListener('click', () => {
      unlockedDayKeys.add(dayKey);
      fillGrid();
      lockPanel.remove();
    });
  }

  section.appendChild(header);
  section.appendChild(dayTrackCard);
  if (!isPortfolio || notesText) {
    section.appendChild(notes);
  }
  if (!unlockedDayKeys.has(dayKey)) {
    section.appendChild(lockPanel);
  }
  section.appendChild(grid);
  return section;
};

const toRad = (deg) => (Number(deg) * Math.PI) / 180;
const MINI_MAP_MAX_LINK_KM = 100;
const distanceMeters = (a, b) => {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const lat1 = Number(a.lat);
  const lon1 = Number(a.lon);
  const lat2 = Number(b.lat);
  const lon2 = Number(b.lon);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const rLat1 = toRad(lat1);
  const rLat2 = toRad(lat2);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};

const buildFlightCurve = (from, to, segments = 20) => {
  const lat1 = Number(from && from[0]);
  const lon1 = Number(from && from[1]);
  const lat2 = Number(to && to[0]);
  const lon2 = Number(to && to[1]);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return [from, to];
  const dx = lon2 - lon1;
  const dy = lat2 - lat1;
  const len = Math.hypot(dx, dy);
  if (!len) return [[lat1, lon1], [lat2, lon2]];
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

const splitTrackForFlights = (points, maxJumpKm = MINI_MAP_MAX_LINK_KM) => {
  const latlngs = (points || [])
    .map((p) => [Number(p.lat), Number(p.lon)])
    .filter((ll) => Number.isFinite(ll[0]) && Number.isFinite(ll[1]));
  if (!latlngs.length) return { ground: [], flights: [] };

  const ground = [];
  const flights = [];
  let current = [latlngs[0]];
  for (let i = 1; i < latlngs.length; i += 1) {
    const prev = latlngs[i - 1];
    const curr = latlngs[i];
    const jumpKm = distanceMeters(
      { lat: prev[0], lon: prev[1] },
      { lat: curr[0], lon: curr[1] }
    ) / 1000;
    if (Number.isFinite(jumpKm) && jumpKm > maxJumpKm) {
      if (current.length >= 2) ground.push(current);
      flights.push({ from: prev, to: curr, km: jumpKm });
      current = [curr];
    } else {
      current.push(curr);
    }
  }
  if (current.length >= 2) ground.push(current);
  return { ground, flights };
};

const simplifyTrackPoints = (points, minDistM = 10) => {
  if (!Array.isArray(points) || points.length <= 2) return points || [];
  const out = [points[0]];
  let last = points[0];
  for (let i = 1; i < points.length - 1; i += 1) {
    const p = points[i];
    if (distanceMeters(last, p) >= minDistM) {
      out.push(p);
      last = p;
    }
  }
  out.push(points[points.length - 1]);
  return out;
};

const getDayTrackSegments = (dayKey) => {
  const raw = ((trackByDay && trackByDay[dayKey]) || [])
    .filter(isPhotoTrackPoint)
    .map((p) => ({
      lat: Number(p.lat),
      lon: Number(p.lon),
      file: String(p.file || ''),
      ts: Date.parse(String(p.time || ''))
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Number.isFinite(p.ts));

  if (!raw.length) return [];

  // If Runtastic track exists for the day, use it as authoritative path.
  const hasRuntastic = raw.some((p) => p.file.startsWith('RUNTASTIC_'));
  const source = hasRuntastic ? raw.filter((p) => p.file.startsWith('RUNTASTIC_')) : raw;
  source.sort((a, b) => a.ts - b.ts);

  const groups = new Map();
  source.forEach((p) => {
    const key = p.file || '__single__';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ lat: p.lat, lon: p.lon, ts: p.ts });
  });

  const segments = [];
  groups.forEach((pts) => {
    const simplified = simplifyTrackPoints(pts, 10);
    if (simplified.length >= 2) segments.push(simplified);
  });
  return segments;
};

const getDayMediaPinGroups = (dayKey) => {
  if (!dataCache || !Array.isArray(dataCache.days)) return [];
  const day = dataCache.days.find((d) => String(d && d.date) === String(dayKey));
  if (!day || !Array.isArray(day.items)) return [];

  const groups = new Map();
  day.items.forEach((item) => {
    // Requested pins for photos of the day.
    if (!item || item.type !== 'image') return;
    const lat = toFiniteCoord(item.lat);
    const lon = toFiniteCoord(item.lon);
    if (lat === null || lon === null) return;
    const key = `${lat.toFixed(5)}|${lon.toFixed(5)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });

  const out = [];
  groups.forEach((items, key) => {
    const [latStr, lonStr] = key.split('|');
    out.push({
      lat: Number(latStr),
      lon: Number(lonStr),
      items: items.sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')))
    });
  });
  return out;
};

const clearDayMapRegistry = () => {
  dayMapRegistry.forEach((entry) => {
    if (!entry || !entry.map) return;
    try {
      entry.map.remove();
    } catch {
      // no-op
    }
  });
  dayMapRegistry = new Map();
};

const buildDayTrackCard = (dayKey) => {
  const wrap = document.createElement('div');
  wrap.className = 'day-track';
  wrap.setAttribute('data-day-track', dayKey);

  const head = document.createElement('div');
  head.className = 'day-track__head';
  const label = document.createElement('span');
  label.setAttribute('data-i18n', 'mini_map');
  label.textContent = I18N[currentLang].mini_map;
  const open = document.createElement('a');
  open.className = 'day-track__open';
  open.href = `map.html?day=${encodeURIComponent(String(dayKey || ''))}`;
  open.textContent = I18N[currentLang].open_map;
  head.appendChild(label);
  head.appendChild(open);

  const body = document.createElement('div');
  body.className = 'day-track__body';

  const segments = getDayTrackSegments(dayKey);
  const totalPoints = segments.reduce((acc, s) => acc + s.length, 0);
  if (!segments.length || totalPoints < 2) {
    body.classList.add('is-empty');
    body.setAttribute('data-day-track-empty', '1');
    body.textContent = I18N[currentLang].mini_map_empty;
    wrap.appendChild(head);
    wrap.appendChild(body);
    return wrap;
  }

  const mapEl = document.createElement('div');
  mapEl.className = 'day-track__map';
  mapEl.setAttribute('data-day-track-map', dayKey);
  body.appendChild(mapEl);

  const meta = document.createElement('div');
  meta.className = 'day-track__meta';
  meta.textContent = `${totalPoints} pts`;
  body.appendChild(meta);

  wrap.appendChild(head);
  wrap.appendChild(body);
  return wrap;
};

const initDayTrackMap = (mapEl) => {
  if (!mapEl || typeof L === 'undefined') return;
  const dayKey = mapEl.getAttribute('data-day-track-map');
  if (!dayKey || dayMapRegistry.has(dayKey)) return;
  const segments = getDayTrackSegments(dayKey);
  if (!segments.length) return;

  const map = L.map(mapEl, {
    zoomControl: true,
    attributionControl: false,
    dragging: true,
    scrollWheelZoom: false,
    doubleClickZoom: true,
    boxZoom: false,
    keyboard: false,
    touchZoom: true,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
  }).addTo(map);

  let bounds = null;
  segments.forEach((segment) => {
    const latlngs = segment.map((p) => [p.lat, p.lon]);
    const line = L.polyline(latlngs, {
      color: '#b06c36',
      weight: 4,
      opacity: 0.9
    }).addTo(map);
    bounds = bounds ? bounds.extend(line.getBounds()) : line.getBounds();
  });

  const first = segments[0][0];
  const lastSeg = segments[segments.length - 1];
  const last = lastSeg[lastSeg.length - 1];
  if (!first || !last) return;
  L.circleMarker([first.lat, first.lon], {
    radius: 5,
    color: '#1f5f5b',
    weight: 2,
    fillColor: '#1f5f5b',
    fillOpacity: 0.95
  }).addTo(map);

  L.circleMarker([last.lat, last.lon], {
    radius: 5,
    color: '#d08643',
    weight: 2,
    fillColor: '#d08643',
    fillOpacity: 0.95
  }).addTo(map);

  if (bounds && bounds.isValid()) {
    map.fitBounds(bounds, { padding: [18, 18], animate: false });
  }

  if (SHOW_DAY_MEDIA_PINS) {
    const pinGroups = getDayMediaPinGroups(dayKey);
    pinGroups.forEach((group) => {
      const count = group.items.length;
      const pin = L.circleMarker([group.lat, group.lon], {
        radius: count > 1 ? 6 : 4.5,
        color: '#153d70',
        weight: 2,
        fillColor: '#4b83c7',
        fillOpacity: 0.95
      }).addTo(map);
      const first = group.items[0] || {};
      const place = first.place ? `<br>${first.place}` : '';
      const title = count > 1
        ? `${count} foto${place}`
        : `${first.time || ''}${place}`;
      pin.bindPopup(title);
      pin.on('click', () => {
        const target = group.items[0];
        if (!target) return;
        const idx = target.id ? modalIndexById.get(target.id) : -1;
        openModalItem(target, idx);
      });
    });
  }

  dayMapRegistry.set(dayKey, { map, el: mapEl });
  window.setTimeout(() => map.invalidateSize(), 0);
};

const ensureVisibleDayTrackMaps = () => {
  document.querySelectorAll('.day-track__map').forEach((el) => {
    if (!isNearViewport(el, 300)) return;
    initDayTrackMap(el);
  });
};

const refreshDayTrackCards = () => {
  clearDayMapRegistry();
  document.querySelectorAll('.day').forEach((section) => {
    const dayKey = String(section.id || '').replace('day-', '');
    if (!dayKey) return;
    const oldCard = section.querySelector('.day-track');
    if (!oldCard) return;
    const nextCard = buildDayTrackCard(dayKey);
    oldCard.replaceWith(nextCard);
  });
  ensureVisibleDayTrackMaps();
};

const buildTimelineNav = (days) => {
  const nav = document.getElementById('timeline-nav');
  nav.innerHTML = '';
  days.forEach((day, idx) => {
    const btn = document.createElement('button');
    btn.textContent = formatDate(day.date);
    btn.addEventListener('click', () => {
      document.getElementById(`day-${day.date}`).scrollIntoView({ behavior: 'smooth' });
    });
    if (idx === 0) btn.classList.add('active');
    nav.appendChild(btn);
  });
};

const ensureMiniMap = () => {
  const body = document.getElementById('mini-map-body');
  if (!body || typeof L === 'undefined') return null;
  if (!miniMap) {
    miniMap = L.map(body, {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
    }).addTo(miniMap);
    miniLayer = L.layerGroup().addTo(miniMap);
  }
  return miniMap;
};

const renderMiniMap = (dayKey, dayIndex = null) => {
  try {
    const body = document.getElementById('mini-map-body');
    const dateEl = document.getElementById('mini-map-date');
    const openLink = document.querySelector('.mini-map__open');
    if (dateEl) dateEl.textContent = formatDate(dayKey);
    if (openLink) {
      openLink.href = `map.html?upto=${encodeURIComponent(String(dayKey || ''))}`;
    }

    const hasIndex = Number.isInteger(dayIndex) && dayIndex >= 0 && dayIndex < renderedDayOrder.length;
    const dayKeysToDraw = hasIndex ? renderedDayOrder.slice(0, dayIndex + 1) : [dayKey];

    const dayTracks = [];
    dayKeysToDraw.forEach((key) => {
      const pts = ((trackByDay && trackByDay[key]) || []).filter(isPhotoTrackPoint);
      if (pts.length) dayTracks.push(pts);
    });

    if (!dayTracks.length) {
      if (body) {
        body.classList.add('is-empty');
        body.setAttribute('data-empty-message', I18N[currentLang].mini_map_empty);
      }
      if (miniLayer) miniLayer.clearLayers();
      return;
    }
    if (body) {
      body.classList.remove('is-empty');
      body.removeAttribute('data-empty-message');
    }
    const map = ensureMiniMap();
    if (!map) return;
    miniLayer.clearLayers();

    let bounds = null;
    dayTracks.forEach((pts, idx) => {
      const isCurrent = idx === dayTracks.length - 1;
      const split = splitTrackForFlights(pts, MINI_MAP_MAX_LINK_KM);
      split.ground.forEach((segment) => {
        const line = L.polyline(segment, {
          color: isCurrent ? '#b06c36' : '#cfa782',
          weight: isCurrent ? 3 : 2,
          opacity: isCurrent ? 0.9 : 0.6
        });
        line.addTo(miniLayer);
        bounds = bounds ? bounds.extend(line.getBounds()) : line.getBounds();
      });
      split.flights.forEach((flight) => {
        const curve = buildFlightCurve(flight.from, flight.to);
        const flightLine = L.polyline(curve, {
          color: isCurrent ? '#5f7fa7' : '#9db0c9',
          weight: isCurrent ? 2.5 : 2,
          opacity: isCurrent ? 0.9 : 0.65,
          dashArray: '6 6'
        }).addTo(miniLayer);
        const mid = curve[Math.floor(curve.length / 2)] || flight.from;
        L.marker(mid, {
          icon: L.divIcon({
            className: 'map-flight-icon map-flight-icon--mini',
            html: '<span class="map-flight-glyph">✈</span>',
            iconSize: [22, 22],
            iconAnchor: [11, 11]
          })
        }).addTo(miniLayer);
        bounds = bounds ? bounds.extend(flightLine.getBounds()) : flightLine.getBounds();
      });
      const latlngs = pts.map((p) => [p.lat, p.lon]).filter((ll) => Number.isFinite(ll[0]) && Number.isFinite(ll[1]));
      latlngs.forEach((ll) => {
        L.circleMarker(ll, {
          radius: isCurrent ? 3 : 2.5,
          color: '#1f5f5b',
          weight: 1,
          fillOpacity: isCurrent ? 0.85 : 0.45
        }).addTo(miniLayer);
      });
    });
    if (bounds && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [10, 10], animate: false });
    }
  } catch (err) {
    const body = document.getElementById('mini-map-body');
    if (body) {
      body.classList.add('is-empty');
      body.setAttribute('data-empty-message', `Errore mappa: ${err.message || err}`);
    }
  }
};

const observeSections = () => {
  if (cleanupSectionSync) {
    cleanupSectionSync();
    cleanupSectionSync = null;
  }

  const nav = document.getElementById('timeline-nav');
  const buttons = Array.from(document.querySelectorAll('.timeline-nav__inner button'));
  const sections = Array.from(document.querySelectorAll('.day'));
  if (!sections.length) return;

  const ensureVisible = (btn) => {
    if (!nav || !btn) return;
    const navRect = nav.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    if (btnRect.left < navRect.left || btnRect.right > navRect.right) {
      const offset = btnRect.left - navRect.left - (navRect.width / 2 - btnRect.width / 2);
      nav.scrollTo({ left: nav.scrollLeft + offset, behavior: 'smooth' });
    }
  };

  let activeIndex = -1;
  let ticking = false;
  const SCROLL_IDLE_DELAY_MS = 1000;
  const unlockQueue = [];
  const unlockQueuedKeys = new Set();
  const sectionIndexByDayKey = new Map(
    sections.map((sectionEl, idx) => [sectionEl.id.replace('day-', ''), idx])
  );
  let unlockDrainTimer = null;
  let scrollIdleTimer = null;
  const clickUnlockIfNeeded = (sectionEl) => {
    if (!sectionEl) return false;
    const dayKey = sectionEl.id.replace('day-', '');
    if (unlockedDayKeys.has(dayKey)) return false;
    const unlockBtn = sectionEl.querySelector('.day-lock__btn');
    if (!unlockBtn) return false;
    unlockBtn.click();
    return true;
  };
  const unlockNeighbors = (dayKey) => {
    const idx = sectionIndexByDayKey.get(dayKey);
    if (!Number.isInteger(idx)) return;
    const prev = sections[idx - 1] || null;
    const next = sections[idx + 1] || null;
    clickUnlockIfNeeded(prev);
    clickUnlockIfNeeded(next);
  };
  const enqueueUnlock = (dayKey, sectionEl, highPriority = false) => {
    if (!dayKey || !sectionEl) return;
    if (unlockedDayKeys.has(dayKey) || unlockQueuedKeys.has(dayKey)) return;
    const task = {
      dayKey,
      sectionEl,
      notBeforeTs: Date.now()
    };
    if (highPriority) unlockQueue.unshift(task);
    else unlockQueue.push(task);
    unlockQueuedKeys.add(dayKey);
    if (unlockDrainTimer) return;
    const drain = () => {
      const next = unlockQueue.shift();
      if (!next) {
        unlockDrainTimer = null;
        return;
      }
      const waitMs = next.notBeforeTs - Date.now();
      if (waitMs > 0) {
        unlockQueue.unshift(next);
        unlockDrainTimer = window.setTimeout(drain, waitMs);
        return;
      }
      unlockQueuedKeys.delete(next.dayKey);
      // Skip auto-unlock if user has already scrolled far away.
      if (!unlockedDayKeys.has(next.dayKey) && isNearViewport(next.sectionEl, 260)) {
        const unlocked = clickUnlockIfNeeded(next.sectionEl);
        if (unlocked) {
          // When a day gets unlocked, preload adjacent days as requested.
          unlockNeighbors(next.dayKey);
        }
      }
      unlockDrainTimer = window.setTimeout(drain, 140);
    };
    unlockDrainTimer = window.setTimeout(drain, 10);
  };
  const setActiveIndex = (idx) => {
    if (idx < 0 || idx >= sections.length || idx === activeIndex) return;
    activeIndex = idx;
    buttons.forEach((btn, i) => btn.classList.toggle('active', i === idx));
    ensureVisible(buttons[idx]);
    const activeSection = sections[idx];
    const dayKey = activeSection.id.replace('day-', '');
    renderMiniMap(dayKey, idx);
  };

  const pickIndexFromScroll = () => {
    const anchorY = Math.max(120, window.innerHeight * 0.35);
    let idx = 0;
    for (let i = 0; i < sections.length; i += 1) {
      const top = sections[i].getBoundingClientRect().top;
      if (top <= anchorY) idx = i;
      else break;
    }
    return idx;
  };

  const syncFromScroll = () => {
    ticking = false;
    setActiveIndex(pickIndexFromScroll());
  };

  const scheduleIdleUnlock = () => {
    if (scrollIdleTimer) window.clearTimeout(scrollIdleTimer);
    scrollIdleTimer = window.setTimeout(() => {
      const idx = pickIndexFromScroll();
      const sectionEl = sections[idx];
      if (!sectionEl) return;
      const dayKey = sectionEl.id.replace('day-', '');
      enqueueUnlock(dayKey, sectionEl, true);
    }, SCROLL_IDLE_DELAY_MS);
  };

  const onScroll = () => {
    if (!ticking) {
      ticking = true;
      window.requestAnimationFrame(syncFromScroll);
    }
    window.requestAnimationFrame(recoverVisibleLazyMedia);
    window.requestAnimationFrame(ensureVisibleDayTrackMaps);
    scheduleIdleUnlock();
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  setActiveIndex(0);
  onScroll();
  scheduleIdleUnlock();
  recoverVisibleLazyMedia();
  ensureVisibleDayTrackMaps();

  cleanupSectionSync = () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
    if (scrollIdleTimer) {
      window.clearTimeout(scrollIdleTimer);
      scrollIdleTimer = null;
    }
    if (unlockDrainTimer) {
      window.clearTimeout(unlockDrainTimer);
      unlockDrainTimer = null;
    }
    unlockQueue.length = 0;
    unlockQueuedKeys.clear();
  };
};

const renderView = () => {
  clearDayMapRegistry();
  disconnectLazyMediaObserver();
  firefoxHydrationQueue.length = 0;
  if (firefoxHydrationDrainTimer) {
    window.clearTimeout(firefoxHydrationDrainTimer);
    firefoxHydrationDrainTimer = null;
  }
  const data = dataCache;
  const rawList = currentView === 'portfolio' ? data.portfolio : data.days;
  const list = rawList.map((day) => ({
    ...day,
    uiGroups: groupDayItems(day.items || [])
  }));
  if (!unlockedDayKeys.size && list.length) {
    unlockedDayKeys.add(list[0].date);
  }
  renderedDayOrder = list.map((day) => day.date);
  modalItems = list.flatMap((day) => (day.items || []));
  syncSelectedIdsWithCurrentData();
  modalIndexById = new Map();
  modalGroupByItemId = new Map();
  modalItems.forEach((item, idx) => {
    if (item.id) modalIndexById.set(item.id, idx);
  });
  list.forEach((day) => {
    (day.uiGroups || []).forEach((group) => {
      if (!group || group.length < 2) return;
      group.forEach((item) => {
        if (item && item.id) modalGroupByItemId.set(String(item.id), group);
      });
    });
  });

  const content = document.getElementById('content');
  content.innerHTML = '';
  list.forEach((day, idx) => {
    content.appendChild(buildDay(day, idx, currentView === 'portfolio'));
  });

  buildTimelineNav(list);
  observeSections();
  renderDates();
  renderManageTools();
  if (window.location.hash) {
    window.setTimeout(() => focusHashAnchor(window.location.hash), 20);
  }
};

const init = async () => {
  const content = document.getElementById('content');
  const cacheBust = Date.now();
  const fail = (msg) => {
    if (content) {
      content.innerHTML = `<div class="loading">${msg}</div>`;
    }
  };
  try {
    let data = window.__CAMMINO_ENTRIES__;
    if (!data) {
      const res = await fetch(withCacheBust('data/entries.json', cacheBust), {
        cache: 'no-store'
      });
      data = await res.json();
    }
    try {
      const resTrackPoints = await fetch(withCacheBust('data/track_points.json', cacheBust), {
        cache: 'no-store'
      });
      if (resTrackPoints.ok) {
        const trackPoints = await resTrackPoints.json();
        enrichDataWithTrackPoints(data, trackPoints);
      }
    } catch {
      // Optional enrichment: keep rendering even if GPS file is unavailable.
    }
    dataCache = data;
    refreshStats();

    renderView();

    // Load mini-map data asynchronously (should never block photos)
    fetch(withCacheBust('data/track_by_day.json', cacheBust), { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        trackByDay = json || null;
        refreshDayTrackCards();
        if (data.days.length) {
          renderMiniMap(data.days[0].date, 0);
        }
      })
      .catch(() => {
        trackByDay = null;
      });
  } catch (err) {
    fail(`Errore nel caricamento: ${err.message || err}`);
  }
};

window.addEventListener('DOMContentLoaded', () => {
  try {
    const toggleSelectBtn = document.getElementById('toggle-select');
    const deleteSelectedBtn = document.getElementById('delete-selected');
    const timelineActions = document.getElementById('timeline-nav-actions');
    if (timelineActions && deleteSelectedBtn) timelineActions.appendChild(deleteSelectedBtn);
    if (toggleSelectBtn) toggleSelectBtn.addEventListener('click', toggleSelectionMode);
    if (deleteSelectedBtn) {
      deleteSelectedBtn.addEventListener('click', () => {
        deleteSelectedItems().catch(() => {});
      });
    }
    document.querySelectorAll('.lang__btn').forEach((btn) => {
      btn.addEventListener('click', () => setLang(btn.dataset.lang));
    });
    document.querySelectorAll('.view-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentView = btn.dataset.view;
        document.querySelectorAll('.view-btn').forEach((b) => {
          b.classList.toggle('active', b.dataset.view === currentView);
        });
        renderView();
      });
    });
    document.querySelectorAll('.view-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.view === currentView);
    });
    setLang('it');
    renderManageTools();
    window.addEventListener('hashchange', () => {
      focusHashAnchor(window.location.hash);
    });
    init();
  } catch (err) {
    const content = document.getElementById('content');
    if (content) {
      content.innerHTML = `<div class="loading">Errore JS: ${err.message || err}</div>`;
    }
  }
});
