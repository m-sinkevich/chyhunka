# Шаг 2. Украшения, подписи рек, масштабная линейка и сборка поля для игры.
# Запуск из корня проекта (после compose.py): python3 tools/board_v2/decorate.py
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

# ---------- подписи рек ----------
small = cv2.resize(rivers.astype(np.uint8), (W, H), interpolation=cv2.INTER_AREA) > 0
bel_s = cv2.resize(bel.astype(np.uint8), (W, H), interpolation=cv2.INTER_NEAREST) > 0
small &= ~ndimage.binary_dilation(bel_s ^ ndimage.binary_erosion(bel_s, iterations=1), iterations=6)
occ_s = cv2.resize(occ.astype(np.uint8), (W, H), interpolation=cv2.INTER_AREA) > 0
RIVERS = [('Днепр', (700, 340, 740, 470)), ('Березина', (585, 330, 645, 480)), ('Припять', (455, 585, 610, 630)),
          ('Неман', (235, 405, 305, 450)), ('Западная Двина', (585, 135, 705, 205)), ('Вилия', (395, 265, 475, 325))]
labels = []
for name, (x0, y0, x1, y1) in RIVERS:
    win = np.zeros_like(small); win[y0:y1, x0:x1] = small[y0:y1, x0:x1]
    sk = skeletonize(ndimage.binary_closing(win, iterations=2))
    lab, n = ndimage.label(sk, structure=np.ones((3, 3)))
    if not n: print('нет реки', name); continue
    sz = ndimage.sum(sk, lab, range(1, n + 1)); comp = lab == (np.argmax(sz) + 1)
    ys, xs = np.nonzero(comp); pts = np.stack([xs, ys], 1).astype(float)
    c = pts.mean(0); _, _, vt = np.linalg.svd(pts - c); ax = vt[0]
    if ax[0] < 0: ax = -ax
    pts = pts[np.argsort((pts - c) @ ax)]
    k = min(15, max(3, len(pts) // 4))
    sm = np.stack([np.convolve(pts[:, i], np.ones(k) / k, mode='valid') for i in range(2)], 1)
    seg = np.r_[0, np.cumsum(np.hypot(*np.diff(sm, axis=0).T))]
    Lbl = len(name) * 4.3 + 8
    best = None
    for st in np.arange(0, max(1, seg[-1] - Lbl) + 0.1, 2):
        q = sm[(seg >= st) & (seg <= st + Lbl)]
        if len(q) < 3: continue
        qi = q.astype(int); c_ = occ_s[qi[:, 1], qi[:, 0]].sum()
        if best is None or c_ < best[0]: best = (c_, q)
    q = best[1]
    ql = np.r_[0, np.cumsum(np.hypot(*np.diff(q, axis=0).T))][-1]
    if ql < Lbl:   # русло на подложке короче подписи — продолжить концы по касательной
        ext = (Lbl - ql) / 2 + 1
        d0 = q[0] - q[min(4, len(q) - 1)]; d0 /= np.linalg.norm(d0) + 1e-9
        d1 = q[-1] - q[max(-5, -len(q))]; d1 /= np.linalg.norm(d1) + 1e-9
        q = np.vstack([q[0] + d0 * ext, q, q[-1] + d1 * ext])
    if q[-1, 0] < q[0, 0]: q = q[::-1]
    nrm = np.array([-(q[-1, 1] - q[0, 1]), q[-1, 0] - q[0, 0]]); nrm /= np.linalg.norm(nrm) + 1e-9
    if nrm[1] > 0: nrm = -nrm
    q = q + nrm * 2.4
    labels.append((name, q))
    for x, y in q:
        xi, yi = int(x * S), int(y * S); r_ = int(5 * S)
        taken[max(0, yi - r_):yi + r_, max(0, xi - r_):xi + r_] = True

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
GEO = {'minsk': (53.90, 27.56), 'brest': (52.10, 23.69), 'grodno': (53.68, 23.83), 'vitebsk': (55.19, 30.20), 'gomel': (52.44, 30.98),
       'mogilev': (53.91, 30.34), 'pinsk': (52.11, 26.10), 'polotsk': (55.49, 28.78), 'bobruisk': (53.15, 29.23), 'lida': (53.89, 25.30)}
def km(a, b):
    (la1, lo1), (la2, lo2) = GEO[a], GEO[b]
    p1, p2 = math.radians(la1), math.radians(la2)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lo2 - lo1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))
mpk = float(np.median([np.hypot(*(P[a] - P[b])) / km(a, b) for i, a in enumerate(GEO) for b in list(GEO)[i + 1:]]))
KM = 100; bw = KM * mpk; bh = 16
occ2 = occ | taken
best = None
for y in np.arange(30, 740 - bh, 4):
    for x in np.arange(30, 1010 - bw, 4):
        sub = occ2[int(y * S):int((y + bh) * S), int(x * S):int((x + bw + 12) * S)]
        c = sub.sum() * 5 + 0.02 * ((x - 885) ** 2 + (y - 640) ** 2)   # по возможности над таблицей очков
        if best is None or c < best[0]: best = (c, x, y)
_, sx, sy = best

# ---------- векторный слой: подписи рек и масштаб (под перегонами) ----------
INK, RIVER_INK = '#4E3B2A', '#51666A'
parts = ['<g id="map-labels" pointer-events="none">']
for i, (name, q) in enumerate(labels):
    parts.append(f'<path id="rv{i}" d="M' + ' L'.join(f'{x:.1f} {y:.1f}' for x, y in q) + '" fill="none"/>')
    parts.append(f'<text font-family="Old Standard TT, serif" font-style="italic" font-size="7" letter-spacing="1.5" fill="{RIVER_INK}" '
                 f'stroke="#F3EBDA" stroke-width="1.6" stroke-opacity="0.85" paint-order="stroke">'
                 f'<textPath href="#rv{i}" startOffset="50%" text-anchor="middle">{name}</textPath></text>')
g = [f'<g transform="translate({sx:.1f} {sy:.1f})" font-family="Old Standard TT, serif" fill="{INK}">',
     '<text x="0" y="3.5" font-size="4.6" font-style="italic">Масштаб (примерно)</text>']
ry = 8
for k in range(0, KM + 1, 5): g.append(f'<line x1="{k * mpk:.2f}" y1="{ry - 2.2}" x2="{k * mpk:.2f}" y2="{ry + 2.2}" stroke="#6B5540" stroke-width="0.7"/>')
for k in range(0, KM, 25):
    g.append(f'<rect x="{k * mpk:.2f}" y="{ry - 0.9}" width="{25 * mpk:.2f}" height="1.8" fill="{INK if (k // 25) % 2 == 0 else "#F4ECD8"}" stroke="{INK}" stroke-width="0.35"/>')
for k in range(0, KM + 1, 25): g.append(f'<text x="{k * mpk:.2f}" y="{ry + 7}" font-size="4.2" text-anchor="middle">{k}</text>')
g.append(f'<text x="{bw + 3:.2f}" y="{ry + 1.5}" font-size="4.6">км</text></g>')
parts += g + ['</g>']

# ---------- сборка: фон, SVG, layout ----------
im.convert('RGB').save(os.path.join(ROOT, 'img/board_bg.jpg'), quality=86, optimize=True, progressive=True)
svg = open(os.path.join(HERE, 'src/board_base.svg'), encoding='utf-8').read()
svg = re.sub(r'<svg([^>]*) width="[^"]*" height="[^"]*" viewBox="[^"]*"', rf'<svg\1 width="{W}mm" height="{H}mm" viewBox="0 0 {W} {H}"', svg, count=1)
svg = re.sub(r'<image[^>]*board_bg\.jpg"/>', f'<image x="0" y="0" width="{W}" height="{H}" preserveAspectRatio="none" href="img/board_bg.jpg"/>', svg, count=1)
svg = svg.replace(f'<g transform="translate({OFF[0]:.3f} {OFF[1]:.3f})">', '<g>', 1)
svg = svg.replace('</defs>', '</defs>\n' + '\n'.join(parts), 1)
assert 'map-labels' in svg and '<g>' in svg, 'не удалось собрать SVG'
open(os.path.join(ROOT, 'img/board.svg'), 'w', encoding='utf-8').write(svg)
lay = dict(LAY); lay['size'] = [W, H]; lay['offset'] = [0, 0]
json.dump(lay, open(os.path.join(ROOT, 'data/layout.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
print('готово: подписей рек', len(labels), '· масштаб', round(mpk, 3), 'мм/км в', (sx, sy), '· украшений', len(decor))
