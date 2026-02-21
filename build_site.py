#!/usr/bin/env python3
import os
import json
import hashlib
import subprocess
from pathlib import Path
from datetime import datetime

ROOT = Path('/Volumes/HardDisk/Cammino di Santiago')
SITE = ROOT / 'site'
DATA = SITE / 'data'
ASSETS = SITE / 'assets'
IMG_DIR = ASSETS / 'img'
THUMB_DIR = ASSETS / 'thumb'
VID_DIR = ASSETS / 'video'
POSTER_DIR = ASSETS / 'poster'

IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.heic', '.heif'}
VIDEO_EXTS = {'.mov', '.mp4', '.m4v'}

TARGET_IMG_MAX = 1600
TARGET_THUMB_MAX = 480
TARGET_VIDEO_MAX_W = 1280
TRANSCODE_VIDEOS = True

HEIF_CONVERT = '/opt/homebrew/bin/heif-convert'


def run(cmd, quiet=True):
    try:
        if quiet:
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError:
        if quiet:
            subprocess.run(cmd, check=True)
        raise


def mdls_date(path: Path):
    try:
        out = subprocess.check_output(
            ['mdls', '-name', 'kMDItemContentCreationDate', '-raw', str(path)],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except Exception:
        out = ''
    if not out or out == '(null)':
        return None
    # Example: 2019-06-16 14:22:01 +0000
    try:
        return datetime.strptime(out, '%Y-%m-%d %H:%M:%S %z')
    except Exception:
        return None


def file_date(path: Path):
    dt = mdls_date(path)
    if dt:
        return dt
    st = path.stat()
    # macOS provides st_birthtime
    ts = getattr(st, 'st_birthtime', None) or st.st_mtime
    return datetime.fromtimestamp(ts)


def stable_id(path: Path):
    h = hashlib.sha1(str(path).encode('utf-8')).hexdigest()[:12]
    return h


def ensure_dirs():
    for d in [SITE, DATA, ASSETS, IMG_DIR, THUMB_DIR, VID_DIR, POSTER_DIR]:
        d.mkdir(parents=True, exist_ok=True)


def build_image(path: Path, hid: str):
    out_img = IMG_DIR / f'img_{hid}.jpg'
    out_thumb = THUMB_DIR / f'thumb_{hid}.jpg'
    ext = path.suffix.lower()
    is_heif = ext in {'.heic', '.heif'}
    tmp_heif = Path('/tmp') / f'heif_{hid}.jpg'
    if not out_img.exists():
        if is_heif:
            run([HEIF_CONVERT, str(path), str(tmp_heif)], quiet=False)
            run(['/usr/bin/sips', '-s', 'format', 'jpeg', '-Z', str(TARGET_IMG_MAX), str(tmp_heif), '--out', str(out_img)])
        else:
            run(['/usr/bin/sips', '-s', 'format', 'jpeg', '-Z', str(TARGET_IMG_MAX), str(path), '--out', str(out_img)])
    if not out_thumb.exists():
        if is_heif:
            if not tmp_heif.exists():
                run([HEIF_CONVERT, str(path), str(tmp_heif)], quiet=False)
            run(['/usr/bin/sips', '-s', 'format', 'jpeg', '-Z', str(TARGET_THUMB_MAX), str(tmp_heif), '--out', str(out_thumb)])
        else:
            run(['/usr/bin/sips', '-s', 'format', 'jpeg', '-Z', str(TARGET_THUMB_MAX), str(path), '--out', str(out_thumb)])
    return out_img.relative_to(SITE).as_posix(), out_thumb.relative_to(SITE).as_posix()


def build_video(path: Path, hid: str):
    out_poster = POSTER_DIR / f'poster_{hid}.jpg'
    if not out_poster.exists():
        # Grab a frame around 1s (or earliest frame if shorter)
        run([
            '/opt/homebrew/bin/ffmpeg', '-y', '-ss', '00:00:01.000', '-i', str(path),
            '-vframes', '1', '-q:v', '2', str(out_poster)
        ])

    if TRANSCODE_VIDEOS:
        out_vid = VID_DIR / f'vid_{hid}.mp4'
        if not out_vid.exists():
            # Transcode to web-friendly MP4 720p-ish for portability
            run([
                '/opt/homebrew/bin/ffmpeg', '-y', '-i', str(path),
                '-vf', f"scale='min({TARGET_VIDEO_MAX_W},iw)':-2",
                '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
                '-c:a', 'aac', '-b:a', '128k',
                '-movflags', '+faststart',
                str(out_vid)
            ])
        return out_vid.relative_to(SITE).as_posix(), out_poster.relative_to(SITE).as_posix(), 'video/mp4'

    # Use original video file for faster builds (local use).
    rel_src = (Path('..') / path.relative_to(ROOT)).as_posix()
    ext = path.suffix.lower()
    mime = 'video/quicktime' if ext == '.mov' else 'video/mp4'
    return rel_src, out_poster.relative_to(SITE).as_posix(), mime


def main():
    ensure_dirs()
    notes_path = DATA / 'notes.json'
    if not notes_path.exists():
        notes_path.write_text(json.dumps({}, ensure_ascii=True, indent=2))
    try:
        notes = json.loads(notes_path.read_text())
    except Exception:
        notes = {}
    items = []
    files = [p for p in sorted(ROOT.iterdir()) if p.is_file()]
    by_stem = {}
    for p in files:
        ext = p.suffix.lower()
        if ext in IMAGE_EXTS or ext in VIDEO_EXTS:
            by_stem.setdefault(p.stem, []).append(p)

    for stem, plist in by_stem.items():
        img = next((p for p in plist if p.suffix.lower() in IMAGE_EXTS), None)
        vid = next((p for p in plist if p.suffix.lower() in VIDEO_EXTS), None)

        if img and vid:
            dt = file_date(img)
            hid = stable_id(img)
            img_src, img_thumb = build_image(img, hid)
            vid_src, vid_poster, vid_mime = build_video(vid, stable_id(vid))
            items.append({
                'id': hid,
                'type': 'image',
                'date': dt.strftime('%Y-%m-%d'),
                'time': dt.strftime('%H:%M'),
                'src': img_src,
                'thumb': img_thumb,
                'poster': None,
                'mime': 'image/jpeg',
                'size': img.stat().st_size,
                'orig': img.name,
                'live_video': vid_src,
                'live_mime': vid_mime,
            })
            continue

        if img:
            dt = file_date(img)
            hid = stable_id(img)
            src, thumb = build_image(img, hid)
            items.append({
                'id': hid,
                'type': 'image',
                'date': dt.strftime('%Y-%m-%d'),
                'time': dt.strftime('%H:%M'),
                'src': src,
                'thumb': thumb,
                'poster': None,
                'mime': 'image/jpeg',
                'size': img.stat().st_size,
                'orig': img.name,
            })
            continue

        if vid:
            dt = file_date(vid)
            hid = stable_id(vid)
            src, poster, mime = build_video(vid, hid)
            items.append({
                'id': hid,
                'type': 'video',
                'date': dt.strftime('%Y-%m-%d'),
                'time': dt.strftime('%H:%M'),
                'src': src,
                'thumb': poster,
                'poster': poster,
                'mime': mime,
                'size': vid.stat().st_size,
                'orig': vid.name,
            })
    # group by date
    days = {}
    for it in items:
        days.setdefault(it['date'], []).append(it)
    day_list = []
    portfolio = []
    for d in sorted(days.keys()):
        day_items = sorted(days[d], key=lambda x: x['time'])
        # pick top 3 images by file size for portfolio recap
        day_images = [i for i in day_items if i['type'] == 'image']
        day_images.sort(key=lambda x: x['size'], reverse=True)
        portfolio_items = day_images[:3]
        day_list.append({
            'date': d,
            'items': day_items,
            'notes': notes.get(d, {}),
        })
        portfolio.append({
            'date': d,
            'items': portfolio_items,
            'notes': notes.get(d, {}),
        })
    out = {
        'generated_at': datetime.now().isoformat(timespec='seconds'),
        'days': day_list,
        'portfolio': portfolio,
        'counts': {
            'images': sum(1 for i in items if i['type'] == 'image'),
            'videos': sum(1 for i in items if i['type'] == 'video'),
            'live': sum(1 for i in items if i.get('live_video')),
        }
    }
    entries_json = json.dumps(out, ensure_ascii=True, indent=2)
    (DATA / 'entries.json').write_text(entries_json)
    # Also emit a JS wrapper for file:// usage without fetch restrictions
    (DATA / 'entries.js').write_text(f"window.__CAMMINO_ENTRIES__ = {entries_json};\n")


if __name__ == '__main__':
    main()
