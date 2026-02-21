#!/usr/bin/env python3
import json
import subprocess
from pathlib import Path
from datetime import datetime

ROOT = Path('/Volumes/HardDisk/Cammino di Santiago')
SITE = ROOT / 'site'
DATA = SITE / 'data'

EXIFTOOL = '/opt/homebrew/bin/exiftool'


def parse_date(s: str):
    if not s:
        return None
    for fmt in ('%Y:%m:%d %H:%M:%S', '%Y:%m:%d %H:%M:%S%z'):
        try:
            return datetime.strptime(s, fmt)
        except Exception:
            continue
    return None


def main():
    DATA.mkdir(parents=True, exist_ok=True)

    cmd = [
        EXIFTOOL,
        '-r',
        '-q', '-q',
        '-n',
        '-if', '$GPSLatitude and $GPSLongitude',
        '-T',
        '-GPSLatitude', '-GPSLongitude',
        '-DateTimeOriginal', '-CreateDate', '-FileModifyDate',
        '-FileName', '-Directory'
    ]
    out = subprocess.check_output(cmd + [str(ROOT)], text=True)

    points = []
    for line in out.splitlines():
        parts = line.split('\t')
        if len(parts) < 7:
            continue
        lat, lon, dto, cdt, fmd, fname, dpath = parts[:7]
        if '/site' in dpath:
            continue
        try:
            lat_f = float(lat)
            lon_f = float(lon)
        except Exception:
            continue
        dt = parse_date(dto) or parse_date(cdt) or parse_date(fmd)
        if not dt:
            continue
        points.append({
            'lat': lat_f,
            'lon': lon_f,
            'time': dt.isoformat(),
            'file': fname,
            'dir': dpath,
        })

    points.sort(key=lambda x: x['time'])

    coords = [[p['lon'], p['lat']] for p in points]
    features = []
    if coords:
        features.append({
            'type': 'Feature',
            'geometry': {
                'type': 'LineString',
                'coordinates': coords
            },
            'properties': {
                'name': 'Cammino track'
            }
        })
    for p in points:
        features.append({
            'type': 'Feature',
            'geometry': {
                'type': 'Point',
                'coordinates': [p['lon'], p['lat']]
            },
            'properties': {
                'time': p['time'],
                'file': p['file']
            }
        })

    geojson = {
        'type': 'FeatureCollection',
        'features': features
    }

    (DATA / 'track.geojson').write_text(json.dumps(geojson, ensure_ascii=True))
    (DATA / 'track_points.json').write_text(json.dumps(points, ensure_ascii=True, indent=2))
    (DATA / 'track.js').write_text(f"window.__CAMMINO_TRACK__ = {json.dumps(geojson, ensure_ascii=True)};\\n")

    # Group points by day for mini-map overlay
    by_day = {}
    for p in points:
        day = p['time'][:10]
        by_day.setdefault(day, []).append({
            'lat': p['lat'],
            'lon': p['lon'],
            'time': p['time'],
            'file': p['file'],
        })
    (DATA / 'track_by_day.json').write_text(json.dumps(by_day, ensure_ascii=True))


if __name__ == '__main__':
    main()
