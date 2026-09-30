// Детерминированный генератор случайных чисел (mulberry32).
// Состояние — одно 32-битное число, хранится прямо в состоянии партии (st.rng),
// поэтому партию можно сохранить в JSON и переиграть по журналу.

export function nextRandom(st) {
  let t = (st.rng = (st.rng + 0x6D2B79F5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randInt(st, n) {
  return Math.floor(nextRandom(st) * n);
}

export function shuffle(st, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(st, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Криптостойкий seed для новой партии (браузер или Node 19+). */
export function newSeed() {
  const a = new Uint32Array(1);
  globalThis.crypto.getRandomValues(a);
  return a[0];
}

/** Отдельный генератор для ботов и тестов, не трогающий состояние партии. */
export function makeRng(seed) {
  const box = { rng: seed >>> 0 };
  return {
    next: () => nextRandom(box),
    int: (n) => randInt(box, n),
    pick: (arr) => arr[randInt(box, arr.length)],
    shuffle: (arr) => shuffle(box, arr),
  };
}
