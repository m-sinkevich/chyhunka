# Шаг 0. Переносит настоящую географию (Natural Earth: граница, реки, озёра) на схему поля.
# Поле схематичное: города сдвинуты, чтобы поместились перегоны. Поэтому широта/долгота переводятся в мм поля
# гладким преобразованием (сплайн по 69 городам, у которых известны и координаты, и место на поле).
# Запуск из корня проекта: python3 tools/board_v2/geo.py  →  tools/board_v2/build/geo.json
import json, os
import numpy as np
from scipy.interpolate import RBFInterpolator

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
os.makedirs(os.path.join(HERE, 'build'), exist_ok=True)
MAP = json.load(open(os.path.join(ROOT, 'data/map.json'), encoding='utf-8'))
LAY = json.load(open(os.path.join(HERE, 'src/layout_base.json')))['cities']
NE = json.load(open(os.path.join(HERE, 'src/ne_region.json')))
cities = list(MAP['cities'].values()) if isinstance(MAP['cities'], dict) else MAP['cities']
K = np.cos(np.radians(53.8))
G = np.array([[c['lon'] * K, c['lat']] for c in cities])
B = np.array([LAY[c['id']][:2] for c in cities])
f = RBFInterpolator(G, B, kernel='thin_plate_spline', smoothing=0.002, degree=1)

def proj(pts):
    a = np.asarray(pts, float)
    return np.round(f(np.c_[a[:, 0] * K, a[:, 1]]), 2).tolist()

RU = {'Dnepr': 'Днепр', 'Dnepre': 'Днепр', 'Dnipro': 'Днепр', 'Daugava': 'Западная Двина', 'Neman': 'Неман',
      'Pripyat': 'Припять', 'Prypyat': 'Припять', 'Byarezina': 'Березина', 'Sozh': 'Сож', 'Neris': 'Вилия',
      'Bug': 'Западный Буг', 'Shchara': 'Щара', 'Ptsich': 'Птичь', 'Yasyelda': 'Ясельда', 'Druts': 'Друть',
      'Sluch': 'Случь', 'Haryn': 'Горынь', 'Iputs': 'Ипуть', 'Byesyedz': 'Беседь', 'Pronya': 'Проня', 'Drysa': 'Дрисса',
      'Dysna': 'Дисна', 'Ula': 'Улла', 'Mukhavyets': 'Мухавец', 'Narew': 'Нарев', 'Desna': 'Десна', 'Ubort': 'Уборть',
      'Styr': 'Стырь', 'Teteriv': 'Тетерев', 'Uzh': 'Уж', 'Kasplya': 'Каспля', 'Velikaya': 'Великая'}
MAJOR = {'Днепр', 'Западная Двина', 'Неман', 'Припять', 'Березина', 'Сож', 'Вилия', 'Западный Буг', 'Десна'}

out = {'belarus': proj(NE['belarus']), 'borders': [], 'rivers': [], 'lakes': []}
for b in NE['borders']:
    if b['c'] == 'BLR': continue
    out['borders'].append({'c': b['c'], 'pts': proj(b['pts'])})
for r in NE['rivers']:
    ru = RU.get(r['name'])
    out['rivers'].append({'name': ru, 'major': ru in MAJOR, 'pts': proj(r['pts'])})
# Верхнего Немана (по Беларуси) в Natural Earth нет — ведём русло по опорным точкам (долгота, широта).
NEMAN_UP = [(27.22, 53.47), (26.95, 53.47), (26.74, 53.49), (26.5, 53.58), (26.25, 53.7), (26.07, 53.75), (25.8, 53.72),
            (25.55, 53.66), (25.33, 53.64), (25.05, 53.55), (24.8, 53.47), (24.54, 53.41), (24.3, 53.47), (24.08, 53.56),
            (23.83, 53.68), (23.76, 53.8), (23.84, 53.92), (23.98, 54.02), (24.12, 54.12), (24.2, 54.2),
            (24.05, 54.4), (24.02, 54.6), (23.95, 54.78), (23.8366, 54.9076)]
out['rivers'].append({'name': 'Неман', 'major': True, 'pts': proj(NEMAN_UP)})
for l in NE['lakes']:
    out['lakes'].append({'name': l['name'], 'pts': proj(l['pts'])})

# проверка: города Беларуси внутри границы, зарубежные — снаружи
from matplotlib.path import Path
poly = Path(np.array(out['belarus']))
bad = [c['id'] for c in cities if poly.contains_point(LAY[c['id']][:2]) != (c['type'] != 'ext')]
print('рек', len(out['rivers']), 'озёр', len(out['lakes']), 'участков границ', len(out['borders']), '· города не на своей стороне границы:', bad or 'нет')
json.dump(out, open(os.path.join(HERE, 'build/geo.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
