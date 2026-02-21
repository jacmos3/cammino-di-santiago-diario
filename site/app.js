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
    mini_map_empty: 'Nessun GPS per questo giorno.'
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
    mini_map_empty: 'No GPS for this day.'
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
};

let dataCache = null;
let trackByDay = null;
let miniMap = null;
let miniLayer = null;
let cleanupSectionSync = null;
let renderedDayOrder = [];
let modalZoomCleanup = null;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const PHOTO_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp']);

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
};

const modal = document.getElementById('live-modal');
const modalBody = document.getElementById('live-modal-body');
const modalClose = document.getElementById('live-modal-close');
const modalBackdrop = document.getElementById('live-modal-backdrop');
let modalImageItems = [];
let modalImageIndexById = new Map();
let modalImageIndex = -1;

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
  const onResetClick = () => zoomTo(1);

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

const openImageModal = (item, imageIndex = null) => {
  if (!item || !item.src) return;
  if (modalZoomCleanup) {
    modalZoomCleanup();
    modalZoomCleanup = null;
  }
  const resolvedIndex = Number.isInteger(imageIndex)
    ? imageIndex
    : (item.id ? modalImageIndexById.get(item.id) : -1);
  modalImageIndex = Number.isInteger(resolvedIndex) ? resolvedIndex : -1;
  modalBody.innerHTML = '';
  const shell = document.createElement('div');
  shell.className = 'modal__zoom-shell';
  const image = document.createElement('img');
  image.src = item.src;
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
  zoomControls.appendChild(zoomOutBtn);
  zoomControls.appendChild(zoomInBtn);
  zoomControls.appendChild(zoomResetBtn);
  modalBody.appendChild(zoomControls);
  const cleanupFns = [];

  if (modalImageItems.length > 1 && modalImageIndex >= 0) {
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
      const len = modalImageItems.length;
      if (!len || modalImageIndex < 0) return;
      const nextIndex = (modalImageIndex + offset + len) % len;
      openImageModal(modalImageItems[nextIndex], nextIndex);
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
  cleanupFns.push(attachImageZoom(image, {
    zoomIn: zoomInBtn,
    zoomOut: zoomOutBtn,
    reset: zoomResetBtn
  }));
  modalZoomCleanup = () => cleanupFns.forEach((fn) => fn && fn());
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
};

const openVideoModal = (item) => {
  if (!item || !item.src) return;
  if (modalZoomCleanup) {
    modalZoomCleanup();
    modalZoomCleanup = null;
  }
  modalImageIndex = -1;
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
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
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
  modalImageIndex = -1;
};

modalClose.addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', closeModal);
document.addEventListener('keydown', (e) => {
  if (!modal.classList.contains('open')) return;
  if (e.key === 'Escape') {
    closeModal();
    return;
  }
  if (modalImageIndex >= 0 && modalImageItems.length > 1) {
    if (e.key === 'ArrowLeft') {
      const nextIndex = (modalImageIndex - 1 + modalImageItems.length) % modalImageItems.length;
      openImageModal(modalImageItems[nextIndex], nextIndex);
    } else if (e.key === 'ArrowRight') {
      const nextIndex = (modalImageIndex + 1) % modalImageItems.length;
      openImageModal(modalImageItems[nextIndex], nextIndex);
    }
  }
});

const getNote = (day) => {
  const note = day.notes || {};
  return (currentLang === 'it' ? note.it : note.en) || '';
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

  header.appendChild(title);
  header.appendChild(meta);
  header.appendChild(count);

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

  day.items.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'media-card';

    if (item.type === 'image') {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = item.orig;
      img.src = item.src;
      card.appendChild(img);
      const imageIdx = item.id ? modalImageIndexById.get(item.id) : -1;
      img.addEventListener('click', () => openImageModal(item, imageIdx));
    } else {
      const video = document.createElement('video');
      video.controls = true;
      video.preload = 'metadata';
      video.playsInline = true;
      if (item.poster) video.poster = item.poster;
      const source = document.createElement('source');
      source.src = item.src;
      source.type = item.mime || 'video/mp4';
      video.appendChild(source);
      video.addEventListener('click', () => openVideoModal(item));
      card.appendChild(video);
    }

    const tag = document.createElement('div');
    tag.className = 'media-tag';
    const tagType = item.type === 'image' ? 'photo' : 'video';
    tag.setAttribute('data-tag', tagType);
    tag.textContent = item.type === 'image' ? I18N[currentLang].photo_tag : I18N[currentLang].video_tag;
    card.appendChild(tag);

    grid.appendChild(card);
  });

  section.appendChild(header);
  if (!isPortfolio || notesText) {
    section.appendChild(notes);
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

  const setActiveIndex = (idx) => {
    if (idx < 0 || idx >= sections.length || idx === activeIndex) return;
    activeIndex = idx;
    buttons.forEach((btn, i) => btn.classList.toggle('active', i === idx));
    ensureVisible(buttons[idx]);
    const dayKey = sections[idx].id.replace('day-', '');
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
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  setActiveIndex(0);
  onScroll();

  cleanupSectionSync = () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
  };
};

const renderView = () => {
  const data = dataCache;
  const list = currentView === 'portfolio' ? data.portfolio : data.days;
  renderedDayOrder = list.map((day) => day.date);
  modalImageItems = list.flatMap((day) => (day.items || []).filter((item) => item.type === 'image'));
  modalImageIndexById = new Map();
  modalImageItems.forEach((item, idx) => {
    if (item.id) modalImageIndexById.set(item.id, idx);
  });

  const content = document.getElementById('content');
  content.innerHTML = '';
  list.forEach((day, idx) => {
    content.appendChild(buildDay(day, idx, currentView === 'portfolio'));
  });

  buildTimelineNav(list);
  observeSections();
  renderDates();
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

    document.getElementById('stat-days').textContent = data.days.length;
    document.getElementById('stat-photos').textContent = data.counts.images;
    document.getElementById('stat-videos').textContent = data.counts.videos;
    document.getElementById('footer-meta').textContent = `Updated ${data.generated_at}`;

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
    init();
  } catch (err) {
    const content = document.getElementById('content');
    if (content) {
      content.innerHTML = `<div class="loading">Errore JS: ${err.message || err}</div>`;
    }
  }
});
