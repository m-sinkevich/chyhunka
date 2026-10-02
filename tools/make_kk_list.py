#!/usr/bin/env python3
# Записывает список картинок из img/kk в img/kk/list.json (для пасхалки «Змеючка»).
# Запуск из папки игры:  py tools/make_kk_list.py
import json, os
D = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'img', 'kk')
files = sorted(f for f in os.listdir(D) if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp', '.gif')))
json.dump(files, open(os.path.join(D, 'list.json'), 'w', encoding='utf-8'), ensure_ascii=False)
print('Картинок в списке:', len(files))
