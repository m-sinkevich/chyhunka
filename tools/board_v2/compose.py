# Шаг 1. Основа фона поля «Чыгунки»: бумага, сепия, условный рельеф, леса, болота, реки и озёра.
# Запуск из корня проекта (после geo.py): python3 tools/board_v2/compose.py
# Выход: tools/board_v2/build/base.png и masks.npz (для шага 2 — decorate.py).
import json, math, os
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
os.makedirs(os.path.join(HERE, 'build'), exist_ok=True)
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

import sys
ZF = float(sys.argv[1]) if len(sys.argv) > 1 else 10.0   # сила рельефа
S = 3.0                        # px на мм
W, H = 1040, 760               # игровая область (вместе с треком очков), мм
PW, PH = int(W * S), int(H * S)
OFF = (36.6197, 38.0)
rng = np.random.default_rng(7)
L = json.load(open(os.path.join(HERE, 'src/layout_base.json')))['cities']
P = {k: np.array(v[:2]) for k, v in L.items()}

# ---------- исходная карта: маска Беларуси, вода, границы соседей ----------
crop = Image.open(os.path.join(HERE, 'src/map_src.jpg')).resize((PW, PH), Image.LANCZOS)   # старая карта: контур, реки
a = np.asarray(crop).astype(np.float32)
lum = a.mean(2)
blur = cv2.GaussianBlur(lum, (0, 0), 6)
bel = blur > (np.percentile(blur, 30) + np.percentile(blur, 85)) / 2
lab, n = ndimage.label(bel)
sizes = ndimage.sum(bel, lab, range(1, n + 1))
bel = lab == (np.argmax(sizes) + 1)
bel = ndimage.binary_fill_holes(bel)
bel = ndimage.binary_opening(bel, iterations=3)
water = ((a[:, :, 2] - a[:, :, 0]) > 6) & (lum > 120)
water = ndimage.binary_opening(water, iterations=1) | ((a[:, :, 2] - a[:, :, 0]) > 16)
_br = cv2.GaussianBlur(a[:, :, 2] - a[:, :, 0], (0, 0), 1.0)
_bg = cv2.GaussianBlur(a[:, :, 2] - a[:, :, 0], (0, 0), 8.0)
rivers_in = (_br - _bg > 2.2)
rivers_in = ndimage.binary_opening(rivers_in, structure=np.ones((2, 2)))
lab_r, nr = ndimage.label(rivers_in)
sz = ndimage.sum(rivers_in, lab_r, range(1, nr + 1))
keep = np.zeros(nr + 1, bool); keep[1:] = sz > 400
rivers_in = keep[lab_r]
# Граница, реки и озёра теперь векторные (geo.py → decorate.py): чёткие при любом масштабе.
# Здесь из них нужна только маска Беларуси; растровые реки и линии старой карты не рисуем.
_geo = json.load(open(os.path.join(HERE, 'build/geo.json'), encoding='utf-8'))
_m = np.zeros((PH, PW), np.uint8)
cv2.fillPoly(_m, [np.round(np.array(_geo['belarus']) * S).astype(np.int32)], 1)
bel = _m.astype(bool)
water = np.zeros_like(bel); rivers_in = np.zeros_like(bel)
local = cv2.GaussianBlur(lum, (0, 0), 10)
lines = (lum < local - 9) & ~water
edge_bel = cv2.morphologyEx(bel.astype(np.uint8), cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8)).astype(bool)
nb_lines = np.zeros_like(bel)

# ---------- бумага ----------
paper = Image.open(os.path.join(HERE, 'src/paper.jpg')).convert('RGB').resize((PW, PH), Image.BICUBIC)
base = np.asarray(paper).astype(np.float32)
fine = rng.normal(0, 1, (PH // 2, PW // 2)).astype(np.float32)
fine = cv2.resize(cv2.GaussianBlur(fine, (0, 0), 1.2), (PW, PH))
base += fine[..., None] * 3.0

yy, xx = np.mgrid[0:PH, 0:PW].astype(np.float32)
X, Y = xx / S, yy / S   # мм

def gauss(c, s, hgt, sx=1.0, sy=1.0):
    return hgt * np.exp(-(((X - c[0]) / (s * sx)) ** 2 + ((Y - c[1]) / (s * sy)) ** 2) / 2)

def fbm(scale_mm, octaves=5, seed=0):
    r = np.random.default_rng(seed); out = np.zeros((PH, PW), np.float32); amp = 1.0; tot = 0
    for o in range(octaves):
        cell = max(int(3 * S), int(scale_mm * S / (2 ** o)))
        g = r.normal(0, 1, (PH // cell + 3, PW // cell + 3)).astype(np.float32)
        up = cv2.resize(g, ((PW // cell + 3) * cell, (PH // cell + 3) * cell), interpolation=cv2.INTER_CUBIC)[:PH, :PW]
        out += up * amp; tot += amp; amp *= 0.55
    return out / tot

def lerp(a_, b_, t): return a_ + (b_ - a_) * t

# ---------- условный рельеф (для макета; в финале — реальные высоты SRTM) ----------
hgt = np.zeros((PH, PW), np.float32)
up = [  # (центр, сигма мм, высота, растяжение x, y)
    (lerp(P['minsk'], P['baranovichi'], 0.25) + [-10, 0], 30, 1.0, 1.3, 0.8),
    (lerp(P['minsk'], P['molodechno'], 0.45), 28, 0.75, 1.2, 0.8),
    (P['novogrudok'] + [0, 4], 24, 0.95, 1.2, 0.9),
    (lerp(P['molodechno'], P['vilnius'], 0.55), 30, 0.6, 1.0, 1.0),
    (P['grodno'] + [8, 12], 24, 0.5, 1.0, 1.0),
    (P['volkovysk'] + [5, -5], 22, 0.45, 1.0, 1.0),
    (lerp(P['slutsk'], P['baranovichi'], 0.4), 24, 0.5, 1.4, 0.7),
    (P['braslav'] + [10, 0], 26, 0.5, 1.2, 1.0),
    (lerp(P['lyntupy'], P['postavy'], 0.5), 24, 0.45, 1.0, 1.0),
    (P['vitebsk'] + [28, -18], 32, 0.85, 1.0, 1.0),
    (lerp(P['vitebsk'], P['nevel'], 0.5), 30, 0.6, 1.0, 1.0),
    (lerp(P['orsha'], P['gorki'], 0.5), 36, 0.55, 1.4, 0.8),
    (lerp(P['lepel'], P['krulevshchizna'], 0.5), 22, 0.35, 1.0, 1.0),
    (P['mozyr'] + [10, -2], 16, 0.55, 2.2, 0.55),
    (P['mozyr'] + [45, 2], 14, 0.35, 1.8, 0.5),
]
for c, s, h_, sx, sy in up: hgt += gauss(c, s, h_, sx, sy)
ridge = 1 - np.abs(fbm(22, 5, seed=3))
upl = np.clip(hgt, 0, 1)
hgt = hgt * (0.8 + 0.4 * ridge) + (0.015 + 0.09 * upl) * fbm(10, 5, seed=5) + 0.02 * upl * fbm(4, 3, seed=9)
hgt = cv2.GaussianBlur(hgt, (0, 0), 1.5 * S)
dy, dx = np.gradient(hgt); dx *= S; dy *= S   # на мм
zf = ZF
nx, ny, nz = -dx * zf, -dy * zf, np.ones_like(hgt) * 1.0
nn = np.sqrt(nx ** 2 + ny ** 2 + nz ** 2)
lx, ly, lz = -0.55, -0.55, 0.63
shade = (nx * lx + ny * ly + nz * lz) / nn            # 1 — свет, меньше — тень
shade0 = lz / math.sqrt(lx * lx + ly * ly + lz * lz)
relief = np.clip((shade - shade0) * 1.6, -0.6, 0.6)
print('relief', np.percentile(relief, [1, 50, 99]))

# ---------- леса ----------
forest_w = np.zeros((PH, PW), np.float32)
fz = [
    (lerp(P['novogrudok'], P['minsk'], 0.35) + [0, -18], 34, 1.0),   # Налибоки
    (lerp(P['brest'], P['volkovysk'], 0.45) + [-18, 0], 26, 1.0),     # Беловежская пуща
    (lerp(P['pinsk'], P['luninets'], 0.5) + [0, 10], 36, 0.8),        # Полесье
    (lerp(P['luninets'], P['kalinkovichi'], 0.5) + [0, 14], 40, 0.9),
    (lerp(P['kalinkovichi'], P['khoiniki'], 0.5), 32, 0.8),
    (P['ivatsevichi'] + [8, 12], 22, 0.8),                              # Телеханы
    (lerp(P['lepel'], P['borisov'], 0.4), 30, 1.0),                    # Березинский
    (lerp(P['osipovichi'], P['bobruisk'], 0.5), 30, 0.8),
    (P['gomel'] + [22, -14], 26, 0.8), (P['kostyukovichi'], 26, 0.7),
    (lerp(P['postavy'], P['glubokoe'], 0.5), 26, 0.6), (P['braslav'] + [-5, 15], 22, 0.5),
    (lerp(P['svetlogorsk'], P['zhlobin'], 0.4), 26, 0.7),
]
for c, s, h_ in fz: forest_w += gauss(c, s, h_)
fn = fbm(9, 4, seed=11)
forest = (forest_w * 0.9 + 0.30 + 0.55 * fn) > 0.85
forest = ndimage.binary_opening(forest, iterations=2) & bel
marsh_w = gauss(lerp(P['pinsk'], P['luninets'], 0.5) + [0, 16], 40, 1.0, 1.6, 0.6) + gauss(lerp(P['luninets'], P['mozyr'], 0.5) + [0, 12], 40, 0.8, 1.6, 0.6)
print('forest frac', forest.mean(), bel.mean())
marsh = ((marsh_w + 0.4 * fbm(8, 3, seed=21)) > 0.75) & bel & ~forest

# ---------- цвета (однотонная сепия) ----------
img = base.copy()
inside = bel[..., None]
out_tint = np.array([214, 202, 178], np.float32)
img = np.where(inside, img, img * 0.72 + out_tint * 0.28 - 6)
ink = np.array([92, 70, 48], np.float32)
hi = np.array([250, 244, 228], np.float32)
r = relief[..., None]
rel_in = np.where(r < 0, img + (ink - img) * (-r) * 0.95, img + (hi - img) * r * 0.55)
rel_out = img
img = np.where(inside, rel_in, rel_out)
# высотная отмывка: выше — чуть теплее и темнее
img = img + (np.array([200, 175, 135], np.float32) - img) * (np.clip(hgt, 0, 1.2)[..., None] * 0.18) * inside
# лес: лёгкая заливка
fsoft = cv2.GaussianBlur(forest.astype(np.float32), (0, 0), 2.5)[..., None]
img = img + (np.array([168, 160, 128], np.float32) - img) * fsoft * 0.32
# вода
wsoft = cv2.GaussianBlur(water.astype(np.float32), (0, 0), 0.8)[..., None]
img = img + (np.array([118, 134, 134], np.float32) - img) * np.clip(wsoft * 1.4, 0, 0.85)
# реки
rs = cv2.GaussianBlur(rivers_in.astype(np.float32), (0, 0), 0.8)[..., None]
img = img + (np.array([112, 126, 124], np.float32) - img) * np.clip(rs * 1.2, 0, 1) * np.where(inside, 0.75, 0.45)
# границы соседей
nbl = cv2.GaussianBlur(nb_lines.astype(np.float32), (0, 0), 0.7)[..., None]
img = img + (np.array([140, 128, 110], np.float32) - img) * np.clip(nbl, 0, 0.7)
# граница Беларуси: внутренняя лента + линия
dist_in = ndimage.distance_transform_edt(bel)
band = np.clip(1 - dist_in / (4.0 * S), 0, 1) * bel
img = img + (np.array([176, 104, 78], np.float32) - img) * (band[..., None] * 0.35)
line = cv2.GaussianBlur(edge_bel.astype(np.float32), (0, 0), 1.0)
line = np.clip(line * 2.2, 0, 1)[..., None]
# линия границы — векторная, в board.svg

im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
d = ImageDraw.Draw(im, 'RGBA')

# деревья-значки
sp = 3.6 * S
for gy in np.arange(0, PH, sp):
    for gx in np.arange(0, PW, sp):
        x = gx + rng.uniform(-0.45, 0.45) * sp + (sp / 2 if int(gy / sp) % 2 else 0); y = gy + rng.uniform(-0.45, 0.45) * sp
        xi, yi = int(x), int(y)
        if not (0 <= xi < PW and 0 <= yi < PH) or not forest[yi, xi]: continue
        hgt_t = rng.uniform(2.6, 3.6) * S; wd = hgt_t * 0.55
        col = (80, 62, 42, 170)
        if rng.random() < 0.55:   # ель
            d.polygon([(x, y - hgt_t), (x - wd / 2, y), (x + wd / 2, y)], outline=col, fill=(120, 100, 72, 70))
        else:                     # лиственное
            rr = wd * 0.45
            d.ellipse([x - rr, y - hgt_t, x + rr, y - hgt_t + 2 * rr], outline=col, fill=(120, 100, 72, 70))
        d.line([(x, y), (x, y - hgt_t * 0.35)], fill=col, width=1)
# болота
sp = 5.0 * S
for gy in np.arange(0, PH, sp):
    for gx in np.arange(0, PW, sp):
        x = gx + rng.uniform(-0.4, 0.4) * sp; y = gy + rng.uniform(-0.4, 0.4) * sp
        xi, yi = int(x), int(y)
        if not (0 <= xi < PW and 0 <= yi < PH) or not marsh[yi, xi]: continue
        col = (96, 110, 110, 150)
        for j in range(3):
            w_ = (3.2 - j * 0.8) * S; yj = y + j * 1.0 * S
            d.line([(x - w_ / 2, yj), (x + w_ / 2, yj)], fill=col, width=1)
        d.line([(x - 0.6 * S, y - 0.2 * S), (x - 0.9 * S, y - 1.6 * S)], fill=col, width=1)
        d.line([(x + 0.4 * S, y - 0.2 * S), (x + 0.7 * S, y - 1.5 * S)], fill=col, width=1)

im.convert('RGB').save(os.path.join(HERE, 'build/base.png'))
np.savez_compressed(os.path.join(HERE, 'build/masks.npz'), rivers=rivers_in | water, bel=bel)
print('base saved')
