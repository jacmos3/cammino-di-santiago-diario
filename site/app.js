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
    open_map: 'Apri la mappa',
    mini_map_empty: 'Nessun GPS per questo giorno.',
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
    open_map: 'Open map',
    mini_map_empty: 'No GPS for this day.',
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
  renderDates();
  renderManageTools();
};

let dataCache = null;
let trackByDay = null;
let miniMap = null;
let miniLayer = null;
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

const buildMediaCard = (groupItems) => {
  const items = Array.isArray(groupItems) && groupItems.length ? groupItems : [];
  const item = items[0];
  if (!item) return document.createElement('div');
  const card = document.createElement('div');
  card.className = 'media-card';
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
    durationBadge.textContent = '--:--';
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
      durationBadge.textContent = formatDuration(probe.duration);
    }, { once: true });
    probe.addEventListener('error', () => {
      durationBadge.textContent = '--:--';
    }, { once: true });
    if (!item.src) {
      durationBadge.textContent = '--:--';
    }
  }

  if (item.type === 'video') {
    const playIndicator = document.createElement('div');
    playIndicator.className = 'media-play-indicator';
    playIndicator.setAttribute('aria-hidden', 'true');
    playIndicator.textContent = '▶';
    card.appendChild(playIndicator);
  }

  card.appendChild(selectBtn);
  setCardSelectedState(card, selectBtn, itemSelected);
  if (selectedCount > 0 && selectedCount < itemIds.length) {
    selectBtn.textContent = String(selectedCount);
  }

  const tag = document.createElement('div');
  tag.className = 'media-tag';
  const tagType = item.type === 'image' ? 'photo' : 'video';
  tag.setAttribute('data-tag', tagType);
  tag.textContent = item.type === 'image' ? I18N[currentLang].photo_tag : I18N[currentLang].video_tag;
  card.appendChild(tag);
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

  const notesText = getNote(day);
  const notes = document.createElement('div');
  notes.className = 'notes';
  const notesLabel = document.createElement('div');
  notesLabel.className = 'notes__label';
  notesLabel.setAttribute('data-notes-label', '1');
  notesLabel.textContent = I18N[currentLang].notes_label;
  const notesBody = document.createElement('div');
  if (notesText) {
    notesBody.textContent = notesText;
  } else {
    notesBody.setAttribute('data-empty-note', '1');
    notesBody.textContent = I18N[currentLang].empty_note;
  }
  notes.appendChild(notesLabel);
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
  if (!isPortfolio || notesText) {
    section.appendChild(notes);
  }
  if (!unlockedDayKeys.has(dayKey)) {
    section.appendChild(lockPanel);
  }
  section.appendChild(grid);
  return section;
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
    if (dateEl) dateEl.textContent = formatDate(dayKey);

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
      const latlngs = pts.map((p) => [p.lat, p.lon]);
      const line = L.polyline(latlngs, {
        color: isCurrent ? '#b06c36' : '#cfa782',
        weight: isCurrent ? 3 : 2,
        opacity: isCurrent ? 0.9 : 0.6
      });
      line.addTo(miniLayer);
      latlngs.forEach((ll) => {
        L.circleMarker(ll, {
          radius: isCurrent ? 3 : 2.5,
          color: '#1f5f5b',
          weight: 1,
          fillOpacity: isCurrent ? 0.85 : 0.45
        }).addTo(miniLayer);
      });
      bounds = bounds ? bounds.extend(line.getBounds()) : line.getBounds();
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
  const unlockQueue = [];
  const unlockQueuedKeys = new Set();
  let unlockDrainTimer = null;
  const enqueueUnlock = (dayKey, sectionEl, highPriority = false) => {
    if (!dayKey || !sectionEl) return;
    if (unlockedDayKeys.has(dayKey) || unlockQueuedKeys.has(dayKey)) return;
    const task = { dayKey, sectionEl };
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
      unlockQueuedKeys.delete(next.dayKey);
      if (!unlockedDayKeys.has(next.dayKey)) {
        const unlockBtn = next.sectionEl.querySelector('.day-lock__btn');
        if (unlockBtn) unlockBtn.click();
      }
      unlockDrainTimer = window.setTimeout(drain, 140);
    };
    unlockDrainTimer = window.setTimeout(drain, 10);
  };
  const autoUnlockSection = (sectionEl) => {
    if (!sectionEl) return;
    const dayKey = sectionEl.id.replace('day-', '');
    enqueueUnlock(dayKey, sectionEl);
  };

  const setActiveIndex = (idx) => {
    if (idx < 0 || idx >= sections.length || idx === activeIndex) return;
    activeIndex = idx;
    buttons.forEach((btn, i) => btn.classList.toggle('active', i === idx));
    ensureVisible(buttons[idx]);
    const activeSection = sections[idx];
    const dayKey = activeSection.id.replace('day-', '');
    enqueueUnlock(dayKey, activeSection, true);
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

  const onScroll = () => {
    if (!ticking) {
      ticking = true;
      window.requestAnimationFrame(syncFromScroll);
    }
    window.requestAnimationFrame(recoverVisibleLazyMedia);
  };

  let sectionUnlockObserver = null;
  if (typeof IntersectionObserver !== 'undefined') {
    sectionUnlockObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          autoUnlockSection(entry.target);
        });
      },
      {
        root: null,
        rootMargin: '120px 0px',
        threshold: 0.01
      }
    );
    sections.forEach((section) => sectionUnlockObserver.observe(section));
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  setActiveIndex(0);
  onScroll();
  recoverVisibleLazyMedia();

  cleanupSectionSync = () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
    if (sectionUnlockObserver) {
      sectionUnlockObserver.disconnect();
      sectionUnlockObserver = null;
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
};

const init = async () => {
  const content = document.getElementById('content');
  const fail = (msg) => {
    if (content) {
      content.innerHTML = `<div class="loading">${msg}</div>`;
    }
  };
  try {
    let data = window.__CAMMINO_ENTRIES__;
    if (!data) {
      const res = await fetch('data/entries.json');
      data = await res.json();
    }
    dataCache = data;
    refreshStats();

    renderView();

    // Load mini-map data asynchronously (should never block photos)
    fetch('data/track_by_day.json')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        trackByDay = json || null;
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
    init();
  } catch (err) {
    const content = document.getElementById('content');
    if (content) {
      content.innerHTML = `<div class="loading">Errore JS: ${err.message || err}</div>`;
    }
  }
});
