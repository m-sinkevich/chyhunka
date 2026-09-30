# Экспорт поля для веб-версии из генератора печатного поля:
#   python3 make_web_board.py  → out/img/board.svg, out/img/board_bg.jpg, out/img/lm_*.webp, out/data/layout.json
# Фон и шрифты не встраиваются (страница грузит их сама), вагоны каждого перегона обёрнуты в <g data-r="id">.
import os, subprocess
from PIL import Image
s = open('print_board2.py', encoding='utf-8').read()
def rep(a, b):
    global s
    assert s.count(a) == 1, a[:60]
    s = s.replace(a, b)
rep("A('<style>'+open('fonts_embed.css').read()+'</style>')", "pass")
rep("""href="data:image/jpeg;base64,'+base64.b64encode(open('bg_board.jpg','rb').read()).decode()+'"/>')""", """href="img/board_bg.jpg"/>')""")
rep("""for (x, y, ang), ic in zip(lane, icons): car(x, y, ang, r, ic)""", """A(f'<g data-r="{r["id"]}">')
        for (x, y, ang), ic in zip(lane, icons): car(x, y, ang, r, ic)
        A('</g>')""")
rep("""    buf = io.BytesIO(); im_.save(buf, 'PNG', optimize=True)
    A(f'<image x="{x_:.2f}" y="{y_:.2f}" width="{ww:.2f}" height="{hh:.2f}" href="data:image/png;base64,'+_b64.b64encode(buf.getvalue()).decode()+'"/>')""",
"""    wfn = fn.replace('.png', '.webp'); im_.save('out/img/'+wfn, 'WEBP', quality=85, method=6)
    A(f'<image x="{x_:.2f}" y="{y_:.2f}" width="{ww:.2f}" height="{hh:.2f}" href="img/{wfn}"/>')""")
rep("""f'" fill="none" stroke="{col}" stroke-width="{sw}"{dash}/>')""", """f'" fill="none" stroke="{col}" stroke-width="{sw}"{dash} data-t="{r["id"]}"/>')""")
rep("open('board_v2.svg', 'w', encoding='utf-8').write(_out)", """open('out/img/board.svg', 'w', encoding='utf-8').write(_out)
LAY = {'size': [TW_, TH_], 'offset': [OFX, OFY], 'car': [CAR_L, CAR_W],
       'routes': {r['id']: [[round(x,2), round(y,2), round(a,2)] for (x,y,a) in lane] for g in GKEYS for r, lane in zip(groups[g], geo[g]['lanes'])},
       'tracks': {r['id']: [[round(x,1), round(y,1)] for x, y in geo[g]['track']] for g in GKEYS for r in groups[g]},
       'cities': {k: [round(v[0],2), round(v[1],2), rad(C[k])] for k, v in cities_pts.items()},
       'track': [[round(x,2), round(y,2), round(w,2), round(h,2)] for (x,y,w,h) in track_cells()]}
json.dump(LAY, open('out/data/layout.json','w'), ensure_ascii=False, separators=(',',':'))""")
open('print_board_web.py', 'w', encoding='utf-8').write(s)
os.makedirs('out/img', exist_ok=True); os.makedirs('out/data', exist_ok=True)
subprocess.run(['python3', 'print_board_web.py', 'map3.json'], env={**os.environ, 'BGART': '1', 'ATTEMPTS': '3'}, check=True)
# иллюстрации городов пока не показываем в веб-версии (LANDMARKS=1 — вернуть)
if os.environ.get('LANDMARKS') != '1':
    import re
    svg = open('out/img/board.svg', encoding='utf-8').read()
    open('out/img/board.svg', 'w', encoding='utf-8').write(re.sub(r'<image [^>]*href="img/lm_[^"]*"[^>]*/>\n?', '', svg))
    for f in os.listdir('out/img'):
        if f.startswith('lm_'): os.remove('out/img/' + f)
im = Image.open('bg_board.jpg'); w = 2800
im.resize((w, int(im.height*w/im.width)), Image.LANCZOS).save('out/img/board_bg.jpg', quality=80, optimize=True, progressive=True)
for f in os.listdir('out/img'):
    if f.startswith('lm_'):
        im = Image.open('out/img/'+f); k = 560/max(im.size)
        if k < 1: im.resize((int(im.width*k), int(im.height*k)), Image.LANCZOS).save('out/img/'+f, 'WEBP', quality=85, method=6)
