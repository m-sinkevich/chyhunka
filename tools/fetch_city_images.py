#!/usr/bin/env python3
# Скачивает гербы городов и фото достопримечательностей из Википедии / Викисклада.
# Нужен только Python 3 (ничего ставить не надо). Запуск из папки игры:
#
#     py tools/fetch_city_images.py            (Windows)
#     python3 tools/fetch_city_images.py       (Linux, macOS)
#
# Что делает для каждого города из data/cities_info.json:
#   герб  -> img/cities/arms/<id>.png   (свойство «герб» в Викиданных)
#   фото  -> img/cities/<id>.jpg        (главная картинка статьи о достопримечательности, иначе — статьи о городе)
#   авторы и лицензии -> img/cities/credits.json (игра показывает их в окне города)
# Уже скачанные файлы не трогает: если что-то не скачалось, просто запустите ещё раз.
# Заменить картинку своей — положите файл с тем же именем.
#   тексты -> data/cities_wiki.json     (вступление и раздел «История» из статьи о городе — показываются в окне города)
#   --force              скачать заново всё
#   --only minsk,brest   только эти города
#   --no-texts           не трогать тексты
#
# Если герба города нет в Викиданных, скрипт ищет статью «Герб …», затем картинку герба в самой статье о городе,
# затем берёт герб района. Если нет фото — берёт ближайшую к городу фотографию с Викисклада (по координатам).
# Подробный журнал пишется в img/cities/fetch_log.txt.
#
# Википедия ограничивает частоту запросов (ошибка 429). Поэтому скрипт:
#   * спрашивает сведения сразу о всех городах несколькими большими запросами, а не сотнями мелких;
#   * берёт картинки только стандартных размеров (нестандартные Викисклад отдаёт неохотно);
#   * делает паузу между файлами и, получив 429, ждёт столько, сколько просит сервер, и пробует снова.
import json, os, re, sys, time, html, urllib.parse, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'img', 'cities')
UA = 'ChyhunkaBoardGame/1.1 (non-commercial hobby board game; city info cards) Python-urllib'
PHOTO_W, ARMS_W = 500, 250      # стандартные ширины миниатюр Викисклада
PAUSE = 1.5                     # секунд между скачиваниями файлов
SEARCH_PAUSE = 8                # секунд перед каждым поисковым запросом
API = 'https://ru.wikipedia.org/w/api.php'   # отдаёт и свои файлы, и файлы Викисклада
WD = 'https://www.wikidata.org/w/api.php'


def get(url, binary=False, tries=6):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Encoding': 'identity'})
            with urllib.request.urlopen(req, timeout=40) as r:
                data = r.read()
            return data if binary else json.loads(data.decode('utf-8'))
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504) or i == tries - 1:
                raise
            ra = e.headers.get('Retry-After', '')
            wait = min(120, max(int(ra) if ra.isdigit() else 0, 5 * 2 ** i)) + 2
            print(f'  сервер просит подождать ({e.code}) — пауза {wait} с, это нормально, скрипт продолжит сам…', flush=True)
            time.sleep(wait)
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(3 + 3 * i)


FINAL = {}   # запрошенное название статьи -> настоящее
LOG = []


def log(*a):
    LOG.append(' '.join(str(x) for x in a))


def chunks(a, n=40):
    a = list(a)
    for i in range(0, len(a), n):
        yield a[i:i + n]


def query(base, **params):
    params.update(format='json', formatversion='2')
    d = get(base + '?' + urllib.parse.urlencode(params))
    time.sleep(1)
    return d


def resolver(q):
    """Запрошенное название -> итоговое (после нормализации и перенаправлений)."""
    m = {}
    for k in ('normalized', 'redirects'):
        for x in q.get(k, []):
            m[x['from']] = x['to']
    def f(t):
        for _ in range(4):
            if t not in m:
                break
            t = m[t]
        return t
    return f


def pages(titles):
    """Статьи русской Википедии пачками: название -> (id в Викиданных, имя файла главной картинки)."""
    out = {}
    for part in chunks(set(titles)):
        q = query(API, action='query', titles='|'.join(part), redirects='1', prop='pageprops|pageimages', ppprop='wikibase_item|disambiguation', piprop='name', pilimit='50').get('query', {})
        by = {p['title']: p for p in q.get('pages', []) if not p.get('missing')}
        res = resolver(q)
        for t in part:
            p = by.get(res(t))
            pp = (p or {}).get('pageprops') or {}
            out[t] = (pp.get('wikibase_item'), p.get('pageimage')) if p and 'disambiguation' not in pp else (None, None)
            if p and 'disambiguation' not in pp:
                FINAL[t] = p['title']
    return out


def claims(qids):
    """Викиданные пачками: id -> {'P94': файл герба, 'P18': файл изображения}."""
    out = {}
    for part in chunks(set(qids)):
        ents = query(WD, action='wbgetentities', ids='|'.join(part), props='claims|labels', languages='ru').get('entities', {})
        for qid, e in ents.items():
            r = {}
            for prop in ('P94', 'P18'):
                for c in (e.get('claims') or {}).get(prop, []):
                    v = c.get('mainsnak', {}).get('datavalue', {}).get('value')
                    if isinstance(v, str):
                        r[prop] = v
                        break
            for c in (e.get('claims') or {}).get('P131', []):
                v = c.get('mainsnak', {}).get('datavalue', {}).get('value')
                if isinstance(v, dict) and v.get('id'):
                    r.setdefault('P131', []).append(v['id'])
            r['label'] = ((e.get('labels') or {}).get('ru') or {}).get('value', '')
            out[qid] = r
    return out


def strip(s):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', s or ''))).strip()


def file_infos(names, width):
    """Файлы пачками: имя -> ссылка на миниатюру стандартной ширины, автор, лицензия."""
    out = {}
    for part in chunks(set(names), 25):
        q = query(API, action='query', titles='|'.join('File:' + n for n in part), prop='imageinfo', iiprop='url|extmetadata', iiurlwidth=str(width), iiextmetadatafilter='Artist|LicenseShortName').get('query', {})
        by = {p['title']: p for p in q.get('pages', [])}
        res = resolver(q)
        for n in part:
            p = by.get(res('File:' + n)) or by.get(res('File:' + n.replace('_', ' ')))
            ii = ((p or {}).get('imageinfo') or [None])[0]
            if not ii:
                continue
            m = ii.get('extmetadata') or {}
            val = lambda k: strip((m.get(k) or {}).get('value', ''))
            out[n] = {'url': ii.get('thumburl') or ii['url'], 'author': val('Artist')[:120], 'license': val('LicenseShortName'), 'source': ii.get('descriptionurl', '')}
    return out


norm = lambda t: t.lower().replace('ё', 'е')
ARMS_RE = re.compile(r'герб|coat[ _]of[ _]arms|\bcoa\b|herb|gerb|wappen|escut', re.I)
NOT_CITY_RE = re.compile(r'облас|район|voblast|oblast|region|raion|rajon|district|province|беларус|belarus|россии|russia|ukrain|украин|poland|польш|lithuan|литв|latvia|латви|flag|флаг', re.I)


def geo_title(name, lat, lon):
    """Статья о населённом пункте рядом с координатами, название которой начинается с имени города."""
    q = query(API, action='query', list='geosearch', gscoord=f'{lat}|{lon}', gsradius='10000', gslimit='50').get('query', {})
    hits = [g for g in q.get('geosearch', []) if norm(g['title']).startswith(norm(name))]
    hits.sort(key=lambda g: (len(g['title']), g.get('dist', 0)))
    return hits[0]['title'] if hits else None


def arms_article(name):
    """Статья «Герб …» об этом городе -> файл её главной картинки."""
    stem = norm(name)[:max(4, len(name) - 2)]
    time.sleep(SEARCH_PAUSE)   # поиск Википедия ограничивает строже всего — не чаще раза в несколько секунд
    q = query(API, action='query', list='search', srsearch=f'intitle:Герб {name}', srlimit='5').get('query', {})
    for hit in q.get('search', []):
        t = hit['title']
        if norm(t).startswith('герб ') and stem in norm(t) and 'район' not in norm(t) and 'област' not in norm(t):
            f = pages([t]).get(t, (None, None))[1]
            if f:
                return f, t
    return None, None


def arms_in_article(title, name):
    """Картинка герба среди файлов статьи о городе (обычно стоит в карточке)."""
    q = query(API, action='query', titles=title, prop='images', imlimit='200').get('query', {})
    files = [i['title'].split(':', 1)[1] for p in q.get('pages', []) for i in p.get('images', [])]
    cand = [f for f in files if ARMS_RE.search(f) and not NOT_CITY_RE.search(f)]
    stem = norm(name)[:4]
    cand.sort(key=lambda f: (stem not in norm(f), len(f)))
    return cand[0] if cand else None


def nearby_photo(lat, lon):
    """Ближайшая фотография с Викисклада по координатам."""
    d = get('https://commons.wikimedia.org/w/api.php?' + urllib.parse.urlencode(dict(action='query', list='geosearch', gscoord=f'{lat}|{lon}', gsradius='5000', gsnamespace='6', gslimit='20', format='json', formatversion='2')))
    time.sleep(1)
    for g in d.get('query', {}).get('geosearch', []):
        t = g['title'].split(':', 1)[1]
        if t.lower().endswith(('.jpg', '.jpeg')) and not re.search(r'map|карта|schema|plan', t, re.I):
            return t
    return None


def section(text, rx):
    m = re.search(r'^==\s*(' + rx + r')[^=\n]*==\s*$', text, re.M | re.I)
    if not m:
        return ''
    rest = text[m.end():]
    n = re.search(r'^==[^=]', rest, re.M)
    body = rest[:n.start()] if n else rest
    return re.sub(r'\n{2,}', '\n', re.sub(r'^=+[^=\n]+=+\s*$', '', body, flags=re.M)).strip()


def cut(t, limit):
    t = re.sub(r'\[\d+\]', '', t).strip()
    if len(t) <= limit:
        return t
    k = max(t.rfind('. ', 0, limit), t.rfind('.\n', 0, limit))
    return (t[:k + 1] if k > limit * 0.5 else t[:limit].rsplit(' ', 1)[0] + '…').strip()


def fetch_texts(todo_titles, path):
    """Вступление и раздел «История» из статей Википедии."""
    out = json.load(open(path, encoding='utf-8')) if os.path.exists(path) else {}
    for n, (cid, title) in enumerate(todo_titles.items(), 1):
        try:
            q = query(API, action='query', titles=title, redirects='1', prop='extracts', explaintext='1', exsectionformat='wiki').get('query', {})
            p = (q.get('pages') or [{}])[0]
            text = p.get('extract') or ''
            if not text:
                log('текст: пусто', cid, title); continue
            intro = text.split('\n==', 1)[0].strip()
            out[cid] = {'title': p.get('title', title), 'url': 'https://ru.wikipedia.org/wiki/' + urllib.parse.quote(p.get('title', title).replace(' ', '_')),
                        'intro': cut(intro, 700), 'history': cut(section(text, 'История|Історія'), 1100)}
            print(f'[{n}/{len(todo_titles)}] {title} — текст: готово', flush=True)
        except Exception as e:
            log('текст: ошибка', cid, e); print(f'[{n}/{len(todo_titles)}] {title} — текст: ошибка — {e}', flush=True)
        json.dump(out, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    return out



def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    args = sys.argv[1:]
    force = '--force' in args
    only = set(args[args.index('--only') + 1].split(',')) if '--only' in args else None
    os.makedirs(os.path.join(OUT, 'arms'), exist_ok=True)
    cities = json.load(open(os.path.join(ROOT, 'data', 'cities_info.json'), encoding='utf-8'))
    MAP = json.load(open(os.path.join(ROOT, 'data', 'map.json'), encoding='utf-8'))['cities']
    MAP = {c['id']: c for c in (MAP.values() if isinstance(MAP, dict) else MAP)}
    cpath = os.path.join(OUT, 'credits.json')
    credits = json.load(open(cpath, encoding='utf-8')) if os.path.exists(cpath) else {}
    tpath = os.path.join(ROOT, 'data', 'cities_wiki.json')
    texts = json.load(open(tpath, encoding='utf-8')) if os.path.exists(tpath) else {}
    arms_path = lambda cid: os.path.join(OUT, 'arms', cid + '.png')
    photo_path = lambda cid: os.path.join(OUT, cid + '.jpg')
    need_a = lambda cid: force or not os.path.exists(arms_path(cid))
    need_p = lambda cid: force or not os.path.exists(photo_path(cid))
    need_t = lambda cid: '--no-texts' not in args and (force or cid not in texts)
    todo = {cid: c for cid, c in cities.items() if (not only or cid in only) and (need_a(cid) or need_p(cid) or need_t(cid))}
    if not todo:
        print('Все картинки и тексты уже на месте.')
        return

    print(f'Городов к обработке: {len(todo)}. Шаг 1 из 4: статьи Википедии…', flush=True)
    pg = pages([c['wiki'] for c in todo.values()] + [c['sight_wiki'] for c in todo.values() if c.get('sight_wiki')])
    title = {}
    for cid, c in todo.items():      # статья не нашлась или это страница значений — ищем по координатам
        t = c['wiki']
        if not pg.get(t, (None, None))[0]:
            m = MAP[cid]
            g = geo_title(m['name'], m['lat'], m['lon'])
            log('статья по координатам:', cid, t, '->', g)
            if g:
                pg.update(pages([g])); t = g
        title[cid] = FINAL.get(t, t)
        pg.setdefault(t, (None, None)); c['_t'] = t
    cl = claims([q for q, _ in pg.values() if q])

    report = {'герб района вместо герба города': [], 'нет герба': [], 'нет фото': [], 'фото рядом с городом (по координатам)': [], 'не скачалось (запустите ещё раз)': []}
    want = []   # (город, вид, имя файла, путь, примечание)
    print('Шаг 2 из 4: поиск гербов и фотографий…', flush=True)
    for cid, c in todo.items():
        name = MAP[cid]['name']
        qid, city_img = pg.get(c['_t'], (None, None))
        wd = cl.get(qid, {})
        try:
            if need_a(cid):
                f, note = wd.get('P94'), ''
                if not f and qid:
                    f = arms_in_article(title[cid], name)
                    if f: log('герб из картинок статьи', cid, f)
                if not f:
                    f, art = arms_article(name)
                    if f: log('герб из статьи', cid, art, f)
                if not f:                         # герб района / вышестоящей единицы
                    seen, level = set(), wd.get('P131', [])
                    for _ in range(2):
                        level = [x for x in level if x not in seen]
                        if not level or f:
                            break
                        up = claims(level); seen.update(level); nxt = []
                        for x in level:
                            if up.get(x, {}).get('P94') and not f:
                                f, note = up[x]['P94'], up[x].get('label', '')
                            nxt += up.get(x, {}).get('P131', [])
                        level = nxt
                    if f:
                        report['герб района вместо герба города'].append(f'{cid} ({note})'); log('герб района', cid, note, f)
                if f:
                    want.append((cid, 'arms', f, arms_path(cid), note))
                else:
                    report['нет герба'].append(cid)
            if need_p(cid):
                f = pg.get(c.get('sight_wiki') or '', (None, None))[1] or city_img or wd.get('P18')
                if f and f.lower().endswith('.svg'):
                    f = wd.get('P18') if not (wd.get('P18') or '').lower().endswith('.svg') else None
                if not f:
                    f = nearby_photo(MAP[cid]['lat'], MAP[cid]['lon'])
                    if f:
                        report['фото рядом с городом (по координатам)'].append(cid); log('фото по координатам', cid, f)
                if f:
                    want.append((cid, 'photo', f, photo_path(cid), ''))
                else:
                    report['нет фото'].append(cid)
        except Exception as e:
            log('поиск: ошибка', cid, e); print(f'  {name}: ошибка поиска — {e}', flush=True)

    info = {'arms': file_infos([w[2] for w in want if w[1] == 'arms'], ARMS_W), 'photo': file_infos([w[2] for w in want if w[1] == 'photo'], PHOTO_W)}

    print(f'Шаг 3 из 4: скачивание {len(want)} файлов (пауза {PAUSE} с между файлами)…', flush=True)
    for n, (cid, kind, name, path, note) in enumerate(want, 1):
        label = f'[{n}/{len(want)}] {MAP[cid]["name"]} — {"герб" if kind == "arms" else "фото"}'
        i = info[kind].get(name)
        if not i:
            report['нет герба' if kind == 'arms' else 'нет фото'].append(cid); log('файл не найден', cid, kind, name)
            print(label, ': файл не найден')
            continue
        try:
            data = get(i['url'], binary=True)
            with open(path, 'wb') as f:
                f.write(data)
            credits.setdefault(cid, {})[kind] = {**{k: i[k] for k in ('author', 'license', 'source')}, **({'note': note} if note else {})}
            json.dump(credits, open(cpath, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
            print(label, ': готово', flush=True)
        except Exception as e:
            report['не скачалось (запустите ещё раз)'].append(f'{cid} ({kind})'); log('скачивание: ошибка', cid, kind, e)
            print(label, ': ошибка —', e, flush=True)
        time.sleep(PAUSE)

    tt = {cid: title[cid] for cid in todo if need_t(cid) and pg.get(todo[cid]['_t'], (None, None))[0]}
    if tt:
        print(f'Шаг 4 из 4: тексты из Википедии ({len(tt)} статей)…', flush=True)
        fetch_texts(tt, tpath)

    open(os.path.join(OUT, 'fetch_log.txt'), 'w', encoding='utf-8').write('\n'.join(LOG))
    print('\nГотово. Картинки — в img/cities, авторы и лицензии — в img/cities/credits.json, тексты — в data/cities_wiki.json.')
    for k, v in report.items():
        if v:
            print(f'  {k}: {", ".join(sorted(set(v)))}')
    if report['нет герба'] or report['нет фото']:
        print('Для городов без картинок положите свои файлы: img/cities/<id>.jpg (фото, ширина около 500) и img/cities/arms/<id>.png (герб).')
    print('Журнал: img/cities/fetch_log.txt')


if __name__ == '__main__':
    main()
