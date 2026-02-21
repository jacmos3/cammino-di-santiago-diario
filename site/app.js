const I18N = {
  it: {
    eyebrow: 'Diario di viaggio',
    title: 'Cammino di Santiago',
    subtitle: 'Un recap giorno per giorno tra foto, video e ricordi di strada.',
    days: 'Giorni',
    photos: 'Foto',
    videos: 'Video',
    live: 'Live',
    loading: 'Sto preparando il diario…',
    day_label: 'Giorno',
    items_label: 'contenuti',
    photo_tag: 'Foto',
    video_tag: 'Video',
    live_tag: 'Live',
    footer_note: 'Creato automaticamente a partire dagli scatti originali.',
    view_diary: 'Diario',
    view_portfolio: 'Portfolio',
    notes_label: 'Note del giorno',
    empty_note: 'Aggiungi un ricordo personale qui.',
    mini_map: 'Percorso del giorno',
    mini_map_empty: 'Nessun GPS per questo giorno.'
  },
  en: {
    eyebrow: 'Travel diary',
    title: 'Camino de Santiago',
    subtitle: 'A day-by-day recap through photos, videos, and trail memories.',
    days: 'Days',
    photos: 'Photos',
    videos: 'Videos',
    live: 'Live',
    loading: 'Preparing the diary…',
    day_label: 'Day',
    items_label: 'items',
    photo_tag: 'Photo',
    video_tag: 'Video',
    live_tag: 'Live',
    footer_note: 'Automatically generated from the original shots.',
    view_diary: 'Diary',
    view_portfolio: 'Portfolio',
    notes_label: 'Day notes',
    empty_note: 'Add a personal memory here.',
    mini_map: 'Daily route',
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
  document.querySelectorAll('[data-tag="live"]').forEach((el) => {
    el.textContent = I18N[currentLang].live_tag;
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

const openImageModal = (item) => {
  if (!item || !item.src) return;
  modalBody.innerHTML = '';
  const image = document.createElement('img');
  image.src = item.src;
  image.alt = item.orig || '';
  image.className = 'modal__image';
  modalBody.appendChild(image);
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
};

const openVideoModal = (item) => {
  if (!item || !item.src) return;
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
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  modalBody.innerHTML = '';
};

modalClose.addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', closeModal);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
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
      img.addEventListener('click', () => openImageModal(item));
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

const renderMiniMap = (dayKey) => {
  try {
    const body = document.getElementById('mini-map-body');
    const dateEl = document.getElementById('mini-map-date');
    if (dateEl) dateEl.textContent = formatDate(dayKey);
    if (!trackByDay || !trackByDay[dayKey] || trackByDay[dayKey].length === 0) {
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
    const pts = trackByDay[dayKey];
    const latlngs = pts.map((p) => [p.lat, p.lon]);
    const line = L.polyline(latlngs, { color: '#b06c36', weight: 3, opacity: 0.9 });
    line.addTo(miniLayer);
    latlngs.forEach((ll) => {
      L.circleMarker(ll, { radius: 3, color: '#1f5f5b', weight: 1, fillOpacity: 0.8 }).addTo(miniLayer);
    });
    map.fitBounds(line.getBounds(), { padding: [10, 10], animate: false });
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
    renderMiniMap(dayKey);
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
          renderMiniMap(data.days[0].date);
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
