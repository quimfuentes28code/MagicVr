// Iconos SVG dibujados a mano (trazo dorado) para la interfaz temática.

const P = {
  swords: '<path d="M4 4l9 9M4 4h4M4 4v4M20 4l-9 9M20 4h-4M20 4v4M8 15l-3 3 1.5 1.5 3-3M16 15l3 3-1.5 1.5-3-3"/>',
  crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 10H5L3 8z"/><path d="M5 21h14"/>',
  book: '<path d="M4 5c3-1.5 5.5-1.5 8 0v14c-2.5-1.5-5-1.5-8 0V5zM20 5c-3-1.5-5.5-1.5-8 0v14c2.5-1.5 5-1.5 8 0V5z"/>',
  hat: '<path d="M12 2l4 10H8l4-10z"/><path d="M3 15c2-2 16-2 18 0-2 2-16 2-18 0z"/><circle cx="12" cy="8" r=".6"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  scroll: '<path d="M6 3h11a2 2 0 012 2v1h-3M6 3a2 2 0 00-2 2v13a3 3 0 003 3h10a2 2 0 002-2V6M6 3a2 2 0 012 2v14a2 2 0 01-2 2"/><path d="M11 9h5M11 13h5"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
  grimoire: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 3v18M12 8h4M12 11h4"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/>',
  golem: '<rect x="6" y="4" width="12" height="10" rx="2"/><circle cx="9.5" cy="9" r="1"/><circle cx="14.5" cy="9" r="1"/><path d="M8 17h8l1 4H7l1-4zM12 1v3"/>',
  person: '<circle cx="12" cy="7" r="4"/><path d="M4 21c1-5 5-7 8-7s7 2 8 7"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  portal: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  next: '<path d="M5 12h13M13 6l6 6-6 6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  heart: '<path d="M12 21s-8-5.5-8-11a4.5 4.5 0 018-2.8A4.5 4.5 0 0120 10c0 5.5-8 11-8 11z"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  door: '<path d="M6 21V4a1 1 0 011-1h10a1 1 0 011 1v17M4 21h16"/><circle cx="14.5" cy="12" r=".8"/>',
  chest: '<path d="M3 10a4 4 0 014-4h10a4 4 0 014 4v9H3v-9z"/><path d="M3 12h18M10 12v3h4v-3"/><path d="M7 6V5M17 6V5"/>',
  cards: '<rect x="3" y="6" width="11" height="15" rx="1.5" transform="rotate(-8 8 13)"/><rect x="10" y="3" width="11" height="15" rx="1.5" transform="rotate(8 15 10)"/>',
};

export function icon(name, cls = '') {
  const span = document.createElement('span');
  span.className = 'ico ' + cls;
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${P[name] || ''}</svg>`;
  return span;
}
