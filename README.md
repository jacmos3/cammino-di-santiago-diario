# Cammino di Santiago — Diario Visivo

Sito statico per ripercorrere giorno per giorno il Cammino con foto, video e mappa.

## Contenuto
- `site/` contiene la UI del sito
- `build_site.py` genera immagini, video e `site/data/entries.json`
- `build_map.py` genera i dati GPS (`site/data/track_by_day.json`, `track.geojson`)

## Build
Dalla root del progetto:

```bash
python3 build_site.py
python3 build_map.py
```

## Avvio in locale
Il sito usa fetch e mappe: serve un server locale.

```bash
cd site
python3 -m http.server 5174
```

Apri `http://localhost:5174/`.

## Note
Le cartelle di output `site/assets/` e i file in `site/data/` (json/js generati) sono ignorati dal git.

Se vuoi includere i media nel repo, rimuovi le regole da `.gitignore`.
