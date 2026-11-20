// Pequeñas utilidades de DOM (sin frameworks).

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, sv);
        else el.style[sk] = sv;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}

export function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

/** Vacía un elemento. Devuelve un objeto con append() que ignora null/false. */
export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return { el, append: (...kids) => (append(el, kids), el) };
}

/** Cajón lateral de pergamino (en horizontal se abre desde la derecha). Devuelve close(). */
export function sheet(content, { onClose, className = '' } = {}) {
  const backdrop = h('div', { class: 'drawer-backdrop' });
  let close;
  const panel = h('div', { class: 'drawer parchment ' + className },
    h('button', { class: 'drawer-x', 'aria-label': 'Cerrar', onClick: () => close() }, '✕'), content);
  backdrop.append(panel);
  let closed = false;
  close = () => {
    if (closed) return;
    closed = true;
    backdrop.classList.add('closing');
    setTimeout(() => backdrop.remove(), 220);
    onClose && onClose();
  };
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.body.append(backdrop);
  return close;
}

export function toast(text, kind = 'info', ms = 2600) {
  let box = document.querySelector('.toasts');
  if (!box) document.body.append((box = h('div', { class: 'toasts' })));
  const t = h('div', { class: 'toast parchment ' + kind }, text);
  box.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

const MANA_COLORS = { W: '#f8f3d6', U: '#3a8de0', B: '#5b4a5e', R: '#e2533c', G: '#33a35a', C: '#b9b4ad' };
export const manaColor = (c) => MANA_COLORS[c] || MANA_COLORS.C;

/** Renderiza un coste de maná como circulitos de colores. */
export function manaCost(cost) {
  const wrap = h('span', { class: 'mana-cost' });
  for (const m of (cost || '').matchAll(/\{([^}]+)\}/g)) {
    const p = m[1];
    const col = p.split('/').find((x) => 'WUBRG'.includes(x));
    wrap.append(h('span', { class: 'pip', style: { background: col ? manaColor(col) : manaColor('C'), color: col === 'W' ? '#333' : '#fff' } }, /^\d+$|X/.test(p) ? p : col || p));
  }
  return wrap;
}

/** Explosión de partículas en la posición de un elemento. */
export function burst(el, color = 'C', count = 18) {
  if (!el || !el.isConnected) return;
  const r = el.getBoundingClientRect();
  const layer = document.querySelector('.fx-layer') || document.body;
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  for (let i = 0; i < count; i++) {
    const a = (Math.PI * 2 * i) / count + Math.random() * 0.4;
    const d = 40 + Math.random() * 70;
    const p = h('div', {
      class: 'particle',
      style: {
        left: cx + 'px', top: cy + 'px', background: manaColor(color),
        '--dx': Math.cos(a) * d + 'px', '--dy': Math.sin(a) * d + 'px',
      },
    });
    layer.append(p);
    setTimeout(() => p.remove(), 900);
  }
}

/** Número flotante (+3 / -2) sobre un elemento. */
export function floatText(el, text, kind) {
  if (!el || !el.isConnected) return;
  const r = el.getBoundingClientRect();
  const f = h('div', { class: 'float-text ' + kind, style: { left: r.left + r.width / 2 + 'px', top: r.top + 'px' } }, text);
  (document.querySelector('.fx-layer') || document.body).append(f);
  setTimeout(() => f.remove(), 1300);
}
