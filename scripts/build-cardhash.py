#!/usr/bin/env python3
"""
Genera public/cardhash.bin: la huella visual de cada ilustración de Magic
(unas 50.000), para reconocer cartas con la cámara por su imagen.

Uso:  python3 scripts/build-cardhash.py [carpeta_de_trabajo]
Necesita: Python 3 con Pillow y numpy. Descarga de Scryfall (con caché en la
carpeta de trabajo): la lista de ilustraciones únicas, todas las impresiones
(para la versión en español de cada ilustración) y la imagen "small" de cada una.

La huella debe calcularse EXACTAMENTE igual que en src/recognize.js.

Formato (little-endian):
  'MVH2'  n:u32  words:u32  noracle:u32
  hashes      n * 2*words * u32  (por entrada: huella clásica y huella de paso alto)
  oracle_idx  n * u16
  image_id    n * 16 bytes (uuid de Scryfall de la imagen a mostrar)
  flags       n * u8   (bit0: cara trasera, bit1: impresión en español)
Cada ilustración aparece dos veces si tiene impresión en español: la huella de la
imagen inglesa y la de la española (el texto cambia la huella; así una carta en
español se compara con su imagen en español).
  oracles     noracle * 16 bytes (uuid)
"""
import gzip, json, os, ssl, struct, sys, time, urllib.request, uuid
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '.cardhash-cache')
OUT = os.path.join(ROOT, 'public', 'cardhash.bin')
UA = {'User-Agent': 'MagicVR-build/1.0', 'Accept': 'application/json'}
ca = os.environ.get('NODE_EXTRA_CA_CERTS') or ('/root/.ccr/ca-bundle.crt' if os.path.exists('/root/.ccr/ca-bundle.crt') else None)
CTX = ssl.create_default_context(cafile=ca) if ca else ssl.create_default_context()

# --- huella (igual que src/recognize.js) ---
INNER = (0.055, 0.04, 0.945, 0.96)
GW, GH, NW, NH = 16, 22, 128, 176


def card_hash(im):
    w, h = im.size
    box = (INNER[0] * w, INNER[1] * h, INNER[2] * w, INNER[3] * h)
    a = np.asarray(im.convert('RGB').resize((NW, NH), Image.BILINEAR, box=box), np.float32)
    g = a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114
    cell = g.reshape(GH, NH // GH, GW, NW // GW).sum(axis=(1, 3)).astype(np.float64)
    # paso alto: restar la media 3x3 de alrededor (bordes replicados)
    p = np.pad(cell, 1, mode='edge')
    blur = sum(p[1 + dy:1 + dy + GH, 1 + dx:1 + dx + GW] for dy in (-1, 0, 1) for dx in (-1, 0, 1)) / 9
    hp = cell - blur
    words = (15 * 22 + 31) // 32
    out = np.zeros(2 * words, np.uint32)
    for k, src in enumerate((cell, hp)):  # 1) clásica  2) paso alto
        bits = (src[:, 1:] > src[:, :-1]).ravel()  # 15 x 22 = 330
        for b in np.nonzero(bits)[0]:
            out[k * words + (b >> 5)] |= np.uint32(1 << (b & 31))
    return out


def get(url, binary=True):
    for attempt in range(5):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), context=CTX, timeout=60).read()
        except Exception:
            time.sleep(1 + attempt * 2)
    raise RuntimeError('no se pudo descargar ' + url)


def bulk(kind, fn):
    path = os.path.join(WORK, fn)
    if not os.path.exists(path):
        meta = json.loads(get('https://api.scryfall.com/bulk-data'))
        uri = [b for b in meta['data'] if b['type'] == kind][0]['jsonl_download_uri']
        print('descargando', kind, flush=True)
        open(path, 'wb').write(get(uri))
    return path


SKIP = {'token', 'double_faced_token', 'art_series', 'emblem', 'vanguard', 'scheme', 'planar'}


def main():
    os.makedirs(os.path.join(WORK, 'img'), exist_ok=True)
    entries = []
    for line in gzip.open(bulk('unique_artwork', 'ua.jsonl.gz'), 'rt'):
        c = json.loads(line)
        if 'paper' not in c.get('games', []) or c.get('layout') in SKIP or c.get('set_type') in ('token', 'memorabilia', 'minigame'):
            continue
        faces = [c] if c.get('image_uris') else (c.get('card_faces') or [])
        for fi, f in enumerate(faces):
            iu = f.get('image_uris') or {}
            oracle = c.get('oracle_id') or f.get('oracle_id')
            if not iu.get('small') or not oracle:
                continue
            entries.append({'id': c['id'], 'face': fi, 'oracle': oracle, 'ill': f.get('illustration_id') or c.get('illustration_id'), 'url': iu['small']})
    print('ilustraciones', len(entries), flush=True)

    # impresión en español más reciente de cada ilustración
    es = {}
    for line in gzip.open(bulk('all_cards', 'all.jsonl.gz'), 'rt'):
        if '"lang":"es"' not in line:
            continue
        c = json.loads(line)
        if c.get('lang') != 'es' or 'paper' not in c.get('games', []) or c.get('image_status') in ('missing', 'placeholder'):
            continue
        faces = [c] if c.get('image_uris') else (c.get('card_faces') or [])
        for fi, f in enumerate(faces):
            ill = f.get('illustration_id') or c.get('illustration_id')
            if not ill or not (f.get('image_uris') or {}).get('normal'):
                continue
            rank = (c.get('image_status') == 'highres_scan', c.get('released_at', ''))
            if ill not in es or rank > es[ill][0]:
                es[ill] = (rank, c['id'], fi)
    print('con impresión en español', len(es), flush=True)

    def fetch(e):
        fn = os.path.join(WORK, 'img', f"{e['id']}_{e['face']}.jpg")
        if not (os.path.exists(fn) and os.path.getsize(fn) > 0):
            open(fn, 'wb').write(get(e['url']))
        return fn

    with ThreadPoolExecutor(12) as ex:
        files = list(ex.map(fetch, entries))

    # entradas extra: la imagen en español de cada ilustración que la tenga
    os.makedirs(os.path.join(WORK, 'img_es'), exist_ok=True)
    extra = []
    seen = set()
    for e in entries:
        sp = es.get(e['ill'])
        if not sp or (sp[1], sp[2]) in seen or sp[1] == e['id']:
            continue
        seen.add((sp[1], sp[2]))
        sid, face = sp[1], sp[2]
        extra.append({'id': sid, 'face': face, 'oracle': e['oracle'], 'ill': e['ill'], 'es': True,
                      'url': f"https://cards.scryfall.io/small/{'back' if face else 'front'}/{sid[0]}/{sid[1]}/{sid}.jpg"})

    def fetch_es(e):
        fn = os.path.join(WORK, 'img_es', f"{e['id']}_{e['face']}.jpg")
        if not (os.path.exists(fn) and os.path.getsize(fn) > 0):
            open(fn, 'wb').write(get(e['url']))
        return fn

    with ThreadPoolExecutor(12) as ex:
        files += list(ex.map(fetch_es, extra))
    entries += extra
    print('entradas en total (inglés + español)', len(entries), flush=True)

    oracles = sorted({e['oracle'] for e in entries})
    oidx = {o: i for i, o in enumerate(oracles)}
    assert len(oracles) < 65536
    n = len(entries)
    words = (15 * 22 + 31) // 32
    hashes = np.zeros((n, 2 * words), np.uint32)
    for i, fn in enumerate(files):
        hashes[i] = card_hash(Image.open(fn))
        if i % 5000 == 0:
            print('huellas', i, flush=True)
    with open(OUT, 'wb') as f:
        f.write(b'MVH2' + struct.pack('<III', n, words, len(oracles)))
        f.write(hashes.astype('<u4').tobytes())
        f.write(np.array([oidx[e['oracle']] for e in entries], '<u2').tobytes())
        flags = bytearray()
        for e in entries:
            # la imagen a mostrar es la de esa misma entrada (la edición reconocida)
            f.write(uuid.UUID(e['id']).bytes)
            flags.append((1 if e['face'] else 0) | (2 if e.get('es') else 0))
        f.write(bytes(flags))
        for o in oracles:
            f.write(uuid.UUID(o).bytes)
    print('escrito', OUT, os.path.getsize(OUT), 'bytes', flush=True)


if __name__ == '__main__':
    main()
