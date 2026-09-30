// Пиктограммы интерфейса (SVG, цвет — currentColor). icon('wagon', 'подсказка') → <span class="ico">.
const P = {
  wagon: '<rect x="1.5" y="4" width="13" height="7" rx="1.5"/><rect x="3.5" y="5.8" width="2.4" height="2.2" fill="#fff" stroke="none"/><rect x="6.8" y="5.8" width="2.4" height="2.2" fill="#fff" stroke="none"/><rect x="10.1" y="5.8" width="2.4" height="2.2" fill="#fff" stroke="none"/><circle cx="4.5" cy="12.6" r="1.3"/><circle cx="11.5" cy="12.6" r="1.3"/>',
  cards: '<rect x="1.8" y="3" width="8" height="11" rx="1.3" transform="rotate(-12 5.8 8.5)" fill="#fff"/><rect x="6" y="2.3" width="8" height="11" rx="1.3" fill="currentColor"/>',
  deck: '<rect x="4" y="1.5" width="9" height="12" rx="1.3" fill="#fff"/><rect x="3" y="2.5" width="9" height="12" rx="1.3" fill="#fff"/><rect x="2" y="3.5" width="9" height="11" rx="1.3" fill="currentColor"/>',
  ticket: '<path d="M2 4h12v2.3a1.7 1.7 0 0 0 0 3.4V12H2V9.7a1.7 1.7 0 0 0 0-3.4z" fill="#fff"/><path d="M5 7h6M5 9h4" />',
  station: '<path d="M2 8 8 2.8 14 8" fill="none"/><path d="M3.6 7v7h8.8V7" fill="#fff"/><rect x="6.8" y="10" width="2.4" height="4" fill="currentColor" stroke="none"/>',
  postcard: '<rect x="1.5" y="3.5" width="13" height="9" rx="1" fill="#fff"/><path d="M1.8 4 8 8.8 14.2 4"/>',
  question: '<circle cx="8" cy="8" r="6.3" fill="#F2E3A0"/><path d="M6.2 6.3a1.9 1.9 0 1 1 2.6 1.8c-.6.3-.8.7-.8 1.3v.4"/><circle cx="8" cy="11.8" r=".7" fill="currentColor" stroke="none"/>',
  depot: '<path d="M2 14V6l6-3.5L14 6v8z" fill="#fff"/><path d="M5 14V9h6v5"/>',
  warehouse: '<rect x="2" y="5" width="12" height="9" rx="1" fill="#fff"/><path d="M2 5l6-3 6 3M5 8h6M5 11h6"/>',
  express: '<path d="M1.5 11.5h10.5l2.5-3.2V6.5H9V4H4.2v2.5H1.5z" fill="#fff"/><path d="M1 13.5h14" /><path d="M11 3.2 13.5 1" />',
  bolt: '<path d="M9.3 1.2 3.3 9h4l-1 5.8 6-7.9h-4z" fill="#F2C230"/>',
  customs: '<path d="M2 14V3h1.6v11M3.6 3.6h9.5l-2 2.5 2 2.5H3.6" fill="#fff"/>',
  trophy: '<path d="M4.5 2h7v3.5a3.5 3.5 0 0 1-7 0z" fill="#E8C35A"/><path d="M4.5 3.3H2.3v1a2.3 2.3 0 0 0 2.4 2.3M11.5 3.3h2.2v1a2.3 2.3 0 0 1-2.4 2.3M8 9v3M5.3 14h5.4M6 12h4"/>',
  swap: '<path d="M2.5 5.5h9l-2.5-2.5M13.5 10.5h-9l2.5 2.5"/>',
  flag: '<path d="M3 15V2" /><path d="M3 2.5h9l-2 3 2 3H3" fill="#E8C35A"/>',
  clock: '<circle cx="8" cy="8" r="6.2" fill="#fff"/><path d="M8 4.3V8l2.6 1.6"/>',
  bell: '<path d="M4 11.5V7.3a4 4 0 0 1 8 0v4.2l1.3 1.3H2.7z" fill="currentColor"/><path d="M6.6 14a1.6 1.6 0 0 0 2.8 0"/>',
  bellOff: '<path d="M4 11.5V7.3a4 4 0 0 1 8 0v4.2l1.3 1.3H2.7z" fill="none"/><path d="M2 2l12 12" />',
  chat: '<path d="M2 3.5h12v7H7l-3.2 2.8v-2.8H2z" fill="#fff"/>',
  book: '<path d="M2 3.2c2.3-.8 4.2-.6 6 .8 1.8-1.4 3.7-1.6 6-.8v10c-2.3-.8-4.2-.6-6 .8-1.8-1.4-3.7-1.6-6-.8z" fill="#fff"/><path d="M8 4v10"/>',
  gear: '<circle cx="8" cy="8" r="2.3"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/>',
  bot: '<rect x="3" y="5" width="10" height="8" rx="2" fill="#fff"/><path d="M8 5V2.5"/><circle cx="8" cy="2.2" r=".9" fill="currentColor"/><circle cx="6" cy="9" r="1" fill="currentColor" stroke="none"/><circle cx="10" cy="9" r="1" fill="currentColor" stroke="none"/>',
  arrow: '<path d="M3 8h10M9 4l4 4-4 4"/>',
  keep: '<path d="M2.5 8.5 6.3 12 13.5 4"/>',
  pass: '<path d="M4 3v10M12 3v10"/>',
  loco: '<path d="M1 11V6h6.5V3.5H11V6h1.8L15 8.5V11z" fill="currentColor"/><circle cx="4" cy="12.5" r="1.3" fill="#fff"/><circle cx="8" cy="12.5" r="1.3" fill="#fff"/><circle cx="12" cy="12.5" r="1.3" fill="#fff"/>',
  flagStart: '<path d="M3 15V2" /><path d="M3 2.5h9l-2 3 2 3H3" fill="#8BC34A"/>',
  finish: '<path d="M3 15V2" /><path d="M3 2.5h10v6H3z" fill="#fff"/><path d="M3 2.5h2.5v2h2.5v-2h2.5v2H13v2h-2.5v2H8v-2H5.5v2H3v-2h2.5v-2H3" fill="currentColor" stroke="none"/>',
  neighbor: '<circle cx="5" cy="8" r="3.5" fill="#fff"/><circle cx="11" cy="8" r="3.5" fill="#fff"/>',
  goal: '<circle cx="8" cy="8" r="6" fill="#fff"/><circle cx="8" cy="8" r="3.2"/><circle cx="8" cy="8" r="1" fill="currentColor"/>',
};

export function iconSvg(name, size = 16) {
  return `<svg class="ico-svg" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

export function icon(name, title, size = 16) {
  const s = document.createElement('span');
  s.className = 'ico';
  s.innerHTML = iconSvg(name, size);
  if (title) { s.title = title; s.setAttribute('aria-label', title); }
  return s;
}
