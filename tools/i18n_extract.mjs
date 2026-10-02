// Собирает все русские строки интерфейса в tools/i18n_keys.json (для перевода).
// Шаблонные строки превращаются в ключи с местами подстановки: `Ходит ${name}` → «Ходит {0}».
// Запуск: node tools/i18n_extract.mjs   (нужен пакет acorn)
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let acorn, walk;
try { acorn = require('acorn'); walk = require('acorn-walk'); } catch { acorn = require('/opt/node-tools/node_modules/acorn'); walk = require('/opt/node-tools/node_modules/acorn-walk'); }
const ROOT = new URL('..', import.meta.url).pathname;
const CYR = /[а-яёА-ЯЁ]/;
const files = [...readdirSync(ROOT + 'js/ui').filter((f) => f !== 'rules.js').map((f) => 'js/ui/' + f), 'js/app.js', 'js/bots/index.js',
  ...readdirSync(ROOT + 'js/engine').map((f) => 'js/engine/' + f), ...readdirSync(ROOT + 'js/net').map((f) => 'js/net/' + f)];
const keys = new Map();   // ключ → где встретился
const add = (k, where) => { k = k.trim(); if (CYR.test(k) && !keys.has(k)) keys.set(k, where); };
for (const f of files) {
  const src = readFileSync(ROOT + f, 'utf8');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
  const skip = [];   // памятка остаётся на русском
  walk.simple(ast, { FunctionDeclaration(n) { if (n.id?.name === 'helpDialogRu') skip.push([n.start, n.end]); } });
  const skipped = (n) => skip.some(([a, b]) => n.start >= a && n.end <= b);
  walk.simple(ast, {
    Literal(n) { if (typeof n.value === 'string' && !skipped(n)) add(n.value, f); },
    TemplateLiteral(n) { if (!skipped(n)) add(n.quasis.map((q, i) => q.value.cooked + (i < n.expressions.length ? `{${i}}` : '')).join(''), f); },
  });
}
const map = JSON.parse(readFileSync(ROOT + 'data/map.json', 'utf8'));
const visit = (x, path) => {
  if (typeof x === 'string') add(x, 'map:' + path);
  else if (Array.isArray(x)) x.forEach((y) => visit(y, path));
  else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) if (!['note'].includes(k)) visit(v, k);
};
visit(map, '');
for (const m of readFileSync(ROOT + 'img/board.svg', 'utf8').matchAll(/<text[^>]*>([^<]+)<\/text>/g)) add(m[1], 'svg');
for (const m of readFileSync(ROOT + 'img/board.svg', 'utf8').matchAll(/<tspan[^>]*>([^<]+)<\/tspan>/g)) add(m[1], 'svg');
const out = [...keys].map(([k, where]) => ({ k, where }));
writeFileSync(ROOT + 'tools/i18n_keys.json', JSON.stringify(out, null, 1));
console.log('строк:', out.length, '· шаблонов:', out.filter((x) => /\{\d+\}/.test(x.k)).length, '· символов:', out.reduce((s, x) => s + x.k.length, 0));
const by = {}; for (const x of out) by[x.where.split(':')[0] === 'map' ? 'map' : x.where] = (by[x.where.split(':')[0] === 'map' ? 'map' : x.where] || 0) + 1; console.log(by);
