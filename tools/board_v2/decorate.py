# Шаг 2. Реки, озёра, границы, подписи рек, масштаб, украшения и сборка поля для игры.
# Запуск из корня проекта (после geo.py и compose.py): python3 tools/board_v2/decorate.py
# Пишет: img/board_bg.jpg, img/board.svg, data/layout.json.
#
# Картинки-украшения перечислены в tools/board_v2/decor.json (сейчас пусто).
# Пример со всеми картинками из макета — decor.example.json: скопируйте нужные строки в decor.json и перезапустите.
# Поле строится только из src/board_base.svg и src/layout_base.json, поэтому скрипт можно запускать сколько угодно раз.
import json, math, os, re
import numpy as np, cv2
from PIL import Image
from scipy import ndimage
from skimage.morphology import skeletonize

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
S = 3.0
W, H = 1040, 760            # поле = игровая область вместе с треком очков, мм
OFF = (36.6197, 38.0)       # сдвиг игровой области в старом поле с рамкой-рушником
PW, PH = int(W * S), int(H * S)
LAY = json.load(open(os.path.join(HERE, 'src/layout_base.json')))
P = {k: np.array(v[:2], float) for k, v in LAY['cities'].items()}
m = np.load(os.path.join(HERE, 'build/masks.npz')); rivers = m['rivers']; bel = m['bel']
im = Image.open(os.path.join(HERE, 'build/base.png')).convert('RGBA')

occ = np.asarray(Image.open(os.path.join(HERE, 'src/occ.png')).convert('L')) > 0   # перегоны, города, подписи, легенда
occ = ndimage.binary_dilation(occ, iterations=int(1.5 * S))
taken = np.zeros_like(occ)

# ---------- география (из geo.py): реки, озёра, границы — векторно ----------
GEO = json.load(open(os.path.join(HERE, 'build/geo.json'), encoding='utf-8'))
occ_s = cv2.resize(occ.astype(np.uint8), (W, H), interpolation=cv2.INTER_AREA) > 0
bel_s = cv2.resize(bel.astype(np.uint8), (W, H), interpolation=cv2.INTER_NEAREST) > 0

def chaikin(p, it=2):
    p = np.asarray(p, float)
    for _ in range(it):
        if len(p) < 3: break
        q = np.empty((2 * (len(p) - 1), 2)); q[0::2] = 0.75 * p[:-1] + 0.25 * p[1:]; q[1::2] = 0.25 * p[:-1] + 0.75 * p[1:]
        p = np.vstack([p[:1], q, p[-1:]])
    return p

# подписи рек: для каждой главной реки — ровный участок внутри Беларуси, не под перегонами
LABEL_RIVERS = ['Днепр', 'Западная Двина', 'Неман', 'Припять', 'Березина', 'Сож', 'Вилия', 'Западный Буг', 'Птичь', 'Щара']
labels = []
for name in LABEL_RIVERS:
    Lbl = len(name) * 4.3 + 8
    best = None
    for r in GEO['rivers']:
        if r['name'] != name: continue
        sm = chaikin(r['pts'], 2)
        seg = np.r_[0, np.cumsum(np.hypot(*np.diff(sm, axis=0).T))]
        for st in np.arange(0, max(0, seg[-1] - Lbl) + 0.1, 2):
            q = sm[(seg >= st) & (seg <= st + Lbl)]
            if len(q) < 3 or np.hypot(*(q[-1] - q[0])) < Lbl * 0.7: continue    # слишком извилисто
            qi = np.clip(q.astype(int), 0, [W - 1, H - 1])
            inside = bel_s[qi[:, 1], qi[:, 0]].mean()
            if inside < 0.3: continue                                               # хотя бы частью внутри страны
            c_ = (1 - inside) * 40 + occ_s[qi[:, 1], qi[:, 0]].sum() * 12 + taken[(qi[:, 1] * S).astype(int), (qi[:, 0] * S).astype(int)].sum() * 5
            ang = np.unwrap(np.arctan2(*np.diff(q, axis=0).T[::-1])); c_ += np.abs(ang - ang.mean()).max() * 8
            if best is None or c_ < best[0]: best = (c_, q)
    if best is None: print('нет места для подписи', name); continue
    q = best[1]
    if q[-1, 0] < q[0, 0]: q = q[::-1]
    nrm = np.array([-(q[-1, 1] - q[0, 1]), q[-1, 0] - q[0, 0]]); nrm /= np.linalg.norm(nrm) + 1e-9
    if nrm[1] > 0: nrm = -nrm
    q = q + nrm * 2.6
    labels.append((name, q))
    for x, y in q:
        xi, yi = int(x * S), int(y * S); r_ = int(5 * S)
        taken[max(0, yi - r_):yi + r_, max(0, xi - r_):xi + r_] = True
print('подписи рек:', ', '.join(n for n, _ in labels))

# ---------- украшения из decor.json ----------
def cutout(path, box=None, erase=(), keep_below=None):
    a = np.asarray(Image.open(path).convert('L')).astype(np.float32).copy()
    bgl = np.percentile(a, 90)
    for (x0, y0, x1, y1) in erase: a[y0:y1, x0:x1] = bgl
    if keep_below is not None: a[keep_below:, :] = bgl
    if box:
        x0, y0, x1, y1 = box; a[:y0, :] = bgl; a[y1:, :] = bgl; a[:, :x0] = bgl; a[:, x1:] = bgl
    al = np.clip((bgl - a) / 90.0, 0, 1)
    ys, xs = np.nonzero(al > 0.15)
    v = np.zeros(a.shape + (4,), np.uint8); v[..., 0], v[..., 1], v[..., 2] = 78, 58, 40
    v[..., 3] = (al * 235).astype(np.uint8)
    return Image.fromarray(v).crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))

def place(v, width_mm, anchor, rmin=14, rmax=95, weight=0.8):
    v = v.resize((int(width_mm * S), int(width_mm * S * v.height / v.width)), Image.LANCZOS)
    vw, vh = v.size; va = np.asarray(v)[..., 3] > 40
    best = None; cx, cy = anchor[0] * S, anchor[1] * S
    for rad in np.arange(rmin, rmax, 5) * S:
        for ang in np.linspace(0, 2 * math.pi, 32, endpoint=False):
            x0 = int(cx + rad * math.cos(ang) - vw / 2); y0 = int(cy + rad * math.sin(ang) - vh / 2)
            if x0 < 20 * S or y0 < 20 * S or x0 + vw > PW - 20 * S or y0 + vh > PH - 20 * S: continue
            c = (occ[y0:y0 + vh, x0:x0 + vw] & va).sum() + 5 * (taken[y0:y0 + vh, x0:x0 + vw] & va).sum() + rad * weight
            if best is None or c < best[0]: best = (c, x0, y0)
    if best is None: return None
    _, x0, y0 = best
    im.alpha_composite(v, (x0, y0))
    taken[y0:y0 + vh, x0:x0 + vw] |= ndimage.binary_dilation(va, iterations=int(2 * S))
    return (x0 / S, y0 / S, vw / S, vh / S)

decor_path = os.path.join(HERE, 'decor.json')
decor = json.load(open(decor_path, encoding='utf-8')) if os.path.exists(decor_path) else []
for d in decor:
    near = d['near']
    anchor = P[near] if isinstance(near, str) else np.array(near, float)
    if 'shift' in d: anchor = anchor + d['shift']
    art = cutout(os.path.join(HERE, 'art', d['art']), d.get('box'), d.get('erase', ()), d.get('keep_below'))
    r = place(art, d['width'], anchor, d.get('rmin', 14), d.get('rmax', 95), d.get('weight', 0.8))
    print('украшение', d['art'], 'у', near, '→', 'не поместилось' if r is None else [round(x) for x in r])

# ---------- масштаб: по реальным расстояниям между городами ----------
GEOC = {'minsk': (53.90, 27.56), 'brest': (52.10, 23.69), 'grodno': (53.68, 23.83), 'vitebsk': (55.19, 30.20), 'gomel': (52.44, 30.98),
       'mogilev': (53.91, 30.34), 'pinsk': (52.11, 26.10), 'polotsk': (55.49, 28.78), 'bobruisk': (53.15, 29.23), 'lida': (53.89, 25.30)}
def km(a, b):
    (la1, lo1), (la2, lo2) = GEOC[a], GEOC[b]
    p1, p2 = math.radians(la1), math.radians(la2)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lo2 - lo1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))
mpk = float(np.median([np.hypot(*(P[a] - P[b])) / km(a, b) for i, a in enumerate(GEOC) for b in list(GEOC)[i + 1:]]))
KM = 100; bw = KM * mpk; bh = 16
occ2 = occ | taken
occ2[int(640 * S):int(735 * S), int(860 * S):int(1015 * S)] = True   # таблица очков (увеличенная)
best = None
for y in np.arange(30, 740 - bh, 4):
    for x in np.arange(30, 1010 - bw, 4):
        sub = occ2[int(y * S):int((y + bh) * S), int(x * S):int((x + bw + 12) * S)]
        c = sub.sum() * 5 + 0.02 * ((x - 885) ** 2 + (y - 640) ** 2)   # по возможности над таблицей очков
        if best is None or c < best[0]: best = (c, x, y)
_, sx, sy = best

# ---------- векторный слой под перегонами: вода, границы, подписи рек, масштаб ----------
INK, RIVER, WATER = '#4E3B2A', '#58777E', '#A7BDB9'
def d_of(p, close=False): return 'M' + ' L'.join(f'{x:.1f} {y:.1f}' for x, y in p) + (' Z' if close else '')
parts = ['<g id="map-geo" pointer-events="none" stroke-linejoin="round" stroke-linecap="round">']
parts.append(f'<clipPath id="board-clip"><rect x="0" y="0" width="{W}" height="{H}"/></clipPath><g clip-path="url(#board-clip)">')
for b_ in GEO['borders']:   # границы соседей
    parts.append(f'<path d="{d_of(chaikin(b_["pts"], 1))}" fill="none" stroke="#9A8E76" stroke-width="0.8" stroke-dasharray="4 1.6 1 1.6" opacity="0.9"/>')
for l in GEO['lakes']:
    parts.append(f'<path d="{d_of(chaikin(l["pts"], 2), True)}" fill="{WATER}" stroke="{RIVER}" stroke-width="0.35"/>')
for r in sorted(GEO['rivers'], key=lambda r: r['major']):
    w_ = 1.15 if r['major'] else 0.6
    parts.append(f'<path d="{d_of(chaikin(r["pts"], 2))}" fill="none" stroke="{RIVER}" stroke-width="{w_}" opacity="{0.95 if r["major"] else 0.75}"/>')
bp = chaikin(GEO['belarus'] + GEO['belarus'][:1], 1)   # граница Беларуси: лента + чёткая линия
parts.append(f'<path d="{d_of(bp, True)}" fill="none" stroke="#B3262E" stroke-width="3.2" opacity="0.22"/>')
parts.append(f'<path d="{d_of(bp, True)}" fill="none" stroke="#F6F0E2" stroke-width="2.1" opacity="0.8"/>')
parts.append(f'<path d="{d_of(bp, True)}" fill="none" stroke="#4A2C1C" stroke-width="1.05"/>')
parts.append('</g>')
for i, (name, q) in enumerate(labels):
    parts.append(f'<path id="rv{i}" d="{d_of(q)}" fill="none"/>')
    parts.append(f'<text font-family="Old Standard TT, serif" font-style="italic" font-size="7" letter-spacing="1.5" fill="#3F5C63" '
                 f'stroke="#F3EBDA" stroke-width="1.8" stroke-opacity="0.9" paint-order="stroke">'
                 f'<textPath href="#rv{i}" startOffset="50%" text-anchor="middle">{name}</textPath></text>')
g = [f'<g transform="translate({sx:.1f} {sy:.1f})" font-family="Old Standard TT, serif" fill="{INK}">',
     '<text x="0" y="3.5" font-size="5.2" font-style="italic">Масштаб (примерно)</text>']
ry = 8.5
for k in range(0, KM + 1, 5): g.append(f'<line x1="{k * mpk:.2f}" y1="{ry - 2.2}" x2="{k * mpk:.2f}" y2="{ry + 2.2}" stroke="#6B5540" stroke-width="0.7"/>')
for k in range(0, KM, 25):
    g.append(f'<rect x="{k * mpk:.2f}" y="{ry - 0.9}" width="{25 * mpk:.2f}" height="1.8" fill="{INK if (k // 25) % 2 == 0 else "#F4ECD8"}" stroke="{INK}" stroke-width="0.35"/>')
for k in range(0, KM + 1, 25): g.append(f'<text x="{k * mpk:.2f}" y="{ry + 7.5}" font-size="5" text-anchor="middle">{k}</text>')
g.append(f'<text x="{bw + 3:.2f}" y="{ry + 1.7}" font-size="5.2">км</text></g>')
parts += g + ['</g>']

# ---------- сборка: фон, SVG, layout ----------
im.convert('RGB').save(os.path.join(ROOT, 'img/board_bg.jpg'), quality=86, optimize=True, progressive=True)
svg = open(os.path.join(HERE, 'src/board_base.svg'), encoding='utf-8').read()
svg = re.sub(r'<svg([^>]*) width="[^"]*" height="[^"]*" viewBox="[^"]*"', rf'<svg\1 width="{W}mm" height="{H}mm" viewBox="0 0 {W} {H}"', svg, count=1)
svg = re.sub(r'<image[^>]*board_bg\.jpg"/>', f'<image x="0" y="0" width="{W}" height="{H}" preserveAspectRatio="none" href="img/board_bg.jpg"/>', svg, count=1)
svg = svg.replace(f'<g transform="translate({OFF[0]:.3f} {OFF[1]:.3f})">', '<g>', 1)
svg = svg.replace('</defs>', '</defs>\n' + '\n'.join(parts), 1)
# заголовок «БЕЛАРУСЬ» с подзаголовком — убрать
svg = re.sub(r'<text [^>]*>БЕЛАРУСЬ</text>\n<line [^>]*/>\n<text [^>]*>железные дороги[^<]*</text>\n', '', svg)
# легенда: крупнее и выше (на место заголовка)
LK = 1.3
i0 = svg.index('<rect x="26" y="70" width="160" height="140"'); i1 = svg.index('</g>', svg.index('Зарубежный пункт'))
svg = svg[:i0] + f'<g id="legend" transform="translate(26 24) scale({LK}) translate(-26 -70)">' + svg[i0:i1] + '</g>\n' + svg[i1:]
# таблица очков: чуть крупнее, мелкий текст крупнее
i0 = svg.index('<rect x="878" y="658" width="132" height="74"'); i1 = svg.index('\n', svg.index('вагонов → очков')) + 1
tbl = svg[i0:i1].replace('font-size="3.8"', 'font-size="4.1"').replace('font-size="4.2"', 'font-size="4.8"')
svg = svg[:i0] + '<g id="score-table" transform="translate(0 0)">' + tbl + '</g>\n' + svg[i1:]
# подписи городов крупнее: малые города 5.4 → 6.4, узловые 6.2 → 7
svg = re.sub(r'(<text [^>]*font-size=")5\.4("[^>]*paint-order="stroke">)', r'\g<1>6.4\2', svg)
svg = re.sub(r'(<text [^>]*font-size=")6\.2("[^>]*paint-order="stroke">)', r'\g<1>7\2', svg)
# «ЛИТВА» — ниже, чтобы не прятаться под легендой
svg = svg.replace('<text x="218.4" y="143.3" text-anchor="middle"', '<text x="120" y="262" text-anchor="middle"')

assert 'map-geo' in svg and 'id="legend"' in svg and 'БЕЛАРУСЬ' not in svg, 'не удалось собрать SVG'
open(os.path.join(ROOT, 'img/board.svg'), 'w', encoding='utf-8').write(svg)
lay = dict(LAY); lay['size'] = [W, H]; lay['offset'] = [0, 0]
json.dump(lay, open(os.path.join(ROOT, 'data/layout.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
print('готово: подписей рек', len(labels), '· масштаб', round(mpk, 3), 'мм/км в', (sx, sy), '· украшений', len(decor))
