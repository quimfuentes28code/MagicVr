// Pantalla partida en las partidas online: media pantalla con tu mesa y tu
// cámara, y la otra media con la cámara del rival y SUS zonas dibujadas encima
// de su mesa. También: ventana pequeña flotante, vista general con todas las
// cámaras y el panel «Pantalla y cámaras».

import { h, clear, sheet, toast } from './dom.js';
import { icon } from './icons.js';
import { rectToQuad, cssMatrix } from '../homography.js';

const KEY = 'mtgvr-split';
export const SHARE_KEY = 'mtgvr-share-cam';
export const SPLIT_DEFAULTS = { mode: 'split', ratio: 0.5, swap: false, flip: false, quality: 'normal', safe: 8, seeRival: true };
/** Distribución de tus zonas cuando tu mesa ocupa media pantalla. */
export const SPLIT_LAYOUT = { bl: 0, br: 60, sx: 81, sy: 27, sh: 40, zx: 81, zy: 80, zh: 34 };
export const MODES = { split: 'Pantalla partida', pip: 'Ventana pequeña', solo: 'Sólo mi mesa' };

export function loadSplit() {
  try { return { ...SPLIT_DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...SPLIT_DEFAULTS }; }
}
const saveSplit = (st) => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* */ } };
export const clampRatio = (r) => Math.min(0.75, Math.max(0.25, Number(r) || 0.5));

/** Rectángulo donde se ve el vídeo dentro de su caja (object-fit contain o cover). */
export function fitRect(boxW, boxH, vw, vh, fit = 'contain') {
  if (!vw || !vh || !boxW || !boxH) return { x: 0, y: 0, w: boxW, h: boxH };
  const s = fit === 'cover' ? Math.max(boxW / vw, boxH / vh) : Math.min(boxW / vw, boxH / vh);
  const w = vw * s;
  const hh = vh * s;
  return { x: (boxW - w) / 2, y: (boxH - hh) / 2, w, h: hh };
}

/** Esquinas (0..1 del vídeo) → píxeles dentro del rectángulo del vídeo; flip: vídeo girado 180°. */
export function mapQuad(quad, rect, flip = false) {
  const pts = quad.map(([u, v]) => (flip ? [1 - u, 1 - v] : [u, v]));
  // girado, la esquina de arriba-izquierda pasa a ser la de abajo-derecha: se reordena
  const ordered = flip ? [pts[2], pts[3], pts[0], pts[1]] : pts;
  return ordered.map(([u, v]) => [rect.x + u * rect.w, rect.y + v * rect.h]);
}

/** Tamaño (ancho, alto) de un cuadrilátero: media de sus lados opuestos. */
export function quadSize(p) {
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  return { w: (d(p[0], p[1]) + d(p[3], p[2])) / 2, h: (d(p[0], p[3]) + d(p[1], p[2])) / 2 };
}

/** ¿Vale la pena dibujar las zonas encima de su vídeo? (cuadrilátero razonable) */
export function quadUsable(q) {
  if (!Array.isArray(q) || q.length !== 4 || q.some((p) => !Array.isArray(p) || !p.every(Number.isFinite))) return false;
  const { w, h: hh } = quadSize(q);
  return w > 0.08 && hh > 0.05 && q.every(([u, v]) => u > -0.5 && u < 1.5 && v > -0.5 && v < 1.5);
}

/**
 * o: { screen, mid, video, oppRow, oppAvatar, mat, divider, media, session, ui, myQuad, rerender, onLayout, players }
 */
export function mountSplit(o) {
  const { screen, mid, video, oppRow, oppAvatar, mat, divider, media, session, ui } = o;
  const st = loadSplit();
  let shareChoice = null;
  try { shareChoice = localStorage.getItem(SHARE_KEY); } catch { /* */ }

  const rvideo = h('video', { class: 'rcam', autoplay: true, playsinline: true, muted: true });
  const overlay = h('div', { class: 'rival-overlay' });
  const label = h('div', { class: 'rival-label' });
  const handle = h('div', { class: 'split-handle', title: 'Arrastra para cambiar el tamaño' }, h('span', {}));
  const pane = h('div', { class: 'rival-pane' }, rvideo, overlay, label, handle);
  const slot = h('div', { class: 'rival-slot' });
  const shade = screen.querySelector('.cam-shade');
  screen.append(slot, pane);
  let overview = null;
  let ask = null;

  const isSplit = () => st.mode === 'split';
  const portrait = () => screen.clientWidth < screen.clientHeight;
  const rivalId = () => ui.viewOpp;
  const rivalPlayer = () => session.state.players.find((p) => p.id === rivalId());

  // ------------------------------------------------------------ preferencias
  const syncMedia = () => {
    const others = session.state.players.filter((p) => p.id !== session.me).map((p) => p.id);
    const wants = {};
    for (const id of others) wants[id] = !!st.seeRival;
    media.set({ sharing: shareChoice === 'yes', wants, quality: st.quality });
  };

  // ------------------------------------------------------------ distribución
  function apply() {
    screen.classList.toggle('split', isSplit());
    screen.classList.toggle('split-pip', st.mode === 'pip');
    screen.classList.toggle('split-swap', !!st.swap);
    const r = clampRatio(st.ratio);
    if (isSplit()) {
      const me = (1 - r).toFixed(3);
      const riv = r.toFixed(3);
      if (portrait()) {
        screen.style.gridTemplateColumns = 'minmax(0, 1fr)';
        screen.style.gridTemplateRows = st.swap ? `auto minmax(0, ${me}fr) minmax(0, ${riv}fr) auto` : `auto minmax(0, ${riv}fr) minmax(0, ${me}fr) auto`;
        screen.style.gridTemplateAreas = st.swap ? "'top' 'mid' 'rival' 'hud'" : "'top' 'rival' 'mid' 'hud'";
      } else {
        screen.style.gridTemplateRows = '';
        screen.style.gridTemplateColumns = st.swap ? `minmax(0, ${riv}fr) minmax(0, ${me}fr)` : `minmax(0, ${me}fr) minmax(0, ${riv}fr)`;
        screen.style.gridTemplateAreas = st.swap ? "'top top' 'rival mid' 'hud hud'" : "'top top' 'mid rival' 'hud hud'";
      }
      const s = (st.safe || 0) + 'px';
      mid.style.margin = portrait() ? (st.swap ? `0 0 ${s} 0` : `${s} 0 0 0`) : (st.swap ? `0 0 0 ${s}` : `0 ${s} 0 0`);
      if (oppRow.parentNode !== overlay) overlay.append(oppRow);
      if (oppAvatar.parentNode !== pane) pane.append(oppAvatar);
    } else {
      screen.style.gridTemplateColumns = screen.style.gridTemplateRows = screen.style.gridTemplateAreas = '';
      mid.style.margin = '';
      if (oppRow.parentNode !== mat) mat.insertBefore(oppRow, divider);
      if (oppAvatar.parentNode !== mid) mid.append(oppAvatar);
    }
    requestAnimationFrame(place);
  }

  const setBox = (el, b) => {
    for (const k of ['left', 'top', 'width', 'height', 'right', 'bottom']) el.style[k] = b && b[k] != null ? b[k] + 'px' : '';
  };

  function place() {
    if (isSplit()) {
      if (portrait()) {
        const top = mid.offsetTop;
        const b = st.swap ? { left: 0, top: 0, width: screen.clientWidth, height: mid.offsetTop + mid.offsetHeight + (st.safe || 0) } : { left: 0, top, width: screen.clientWidth, height: screen.clientHeight - top };
        setBox(video, b); setBox(shade, b);
      } else {
        const b = { left: mid.offsetLeft, top: 0, width: mid.offsetWidth, height: screen.clientHeight };
        setBox(video, b); setBox(shade, b);
      }
      setBox(pane, { left: slot.offsetLeft, top: slot.offsetTop, width: slot.offsetWidth, height: slot.offsetHeight });
    } else if (st.mode === 'pip') {
      setBox(video, null); setBox(shade, null);
      const w = Math.min(screen.clientWidth * 0.24, 230);
      const hh = w * 0.75;
      const pos = st.pip || { x: 0.36, y: 0.11 };
      setBox(pane, { left: Math.max(0, Math.min(screen.clientWidth - w, pos.x * screen.clientWidth)), top: Math.max(0, Math.min(screen.clientHeight - hh, pos.y * screen.clientHeight)), width: w, height: hh });
    } else {
      setBox(video, null); setBox(shade, null); setBox(pane, null);
    }
    layoutOverlay();
    o.onLayout && o.onLayout();
  }

  // Vídeo y zonas del rival
  function layoutOverlay() {
    const rid = rivalId();
    const rp = rid ? media.remote(rid) : null;
    const p = rivalPlayer();
    const show = !!(rp && st.seeRival && rp.sharing && rp.stream);
    if (show && rvideo.srcObject !== rp.stream) { rvideo.srcObject = rp.stream; rvideo.play().catch(() => {}); }
    if (!show && rvideo.srcObject) rvideo.srcObject = null;
    pane.classList.toggle('has-video', show);
    rvideo.classList.toggle('flip', !!st.flip);
    // texto del recuadro
    let txt = '';
    if (!p) txt = '';
    else if (p.isBot) txt = `${p.name} · golem sin cámara`;
    else if (!st.seeRival) txt = `${p.name} · has ocultado las cámaras`;
    else if (!rp || !rp.online) txt = `${p.name} · conectando…`;
    else if (!rp.info.sharing) txt = `${p.name} · no enseña su cámara`;
    else if (!rp.stream) txt = `${p.name} · conectando la cámara…`;
    else txt = p.name;
    label.textContent = txt;
    // zonas encima de su mesa
    const q = rp && rp.info && rp.info.quad;
    if (isSplit() && show && quadUsable(q) && rvideo.videoWidth) {
      const rect = fitRect(pane.clientWidth, pane.clientHeight, rvideo.videoWidth, rvideo.videoHeight, 'contain');
      const pts = mapQuad(q, rect, st.flip);
      const { w, h: hh } = quadSize(pts);
      overlay.classList.add('on-video');
      overlay.style.inset = 'auto';
      overlay.style.left = '0px'; overlay.style.top = '0px';
      overlay.style.width = w + 'px'; overlay.style.height = hh + 'px';
      overlay.style.transform = cssMatrix(rectToQuad(w, hh, pts));
    } else {
      overlay.classList.remove('on-video');
      overlay.style.left = overlay.style.top = overlay.style.width = overlay.style.height = overlay.style.transform = '';
      overlay.style.inset = isSplit() ? `${(st.safe || 0) + 34}px ${st.safe || 0}px ${st.safe || 0}px` : '';
    }
  }
  rvideo.addEventListener('loadedmetadata', () => layoutOverlay());
  rvideo.addEventListener('resize', () => layoutOverlay());

  // Arrastrar la línea del centro
  handle.addEventListener('pointerdown', (e) => {
    if (!isSplit()) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const sr = screen.getBoundingClientRect();
    const move = (ev) => {
      const f = portrait() ? (ev.clientY - sr.top) / sr.height : (ev.clientX - sr.left) / sr.width;
      // ratio = parte del rival
      const rivalFirst = portrait() ? !st.swap : st.swap;
      st.ratio = clampRatio(rivalFirst ? f : 1 - f);
      apply();
    };
    const up = () => { handle.removeEventListener('pointermove', move); saveSplit(st); };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up, { once: true });
    handle.addEventListener('pointercancel', up, { once: true });
  });

  // Mover la ventana pequeña
  pane.addEventListener('pointerdown', (e) => {
    if (st.mode !== 'pip' || e.target.closest('button')) return;
    e.preventDefault();
    pane.setPointerCapture(e.pointerId);
    const sr = screen.getBoundingClientRect();
    const dx = e.clientX - pane.offsetLeft - sr.left;
    const dy = e.clientY - pane.offsetTop - sr.top;
    const move = (ev) => {
      st.pip = { x: (ev.clientX - sr.left - dx) / sr.width, y: (ev.clientY - sr.top - dy) / sr.height };
      place();
    };
    const up = () => { pane.removeEventListener('pointermove', move); saveSplit(st); };
    pane.addEventListener('pointermove', move);
    pane.addEventListener('pointerup', up, { once: true });
    pane.addEventListener('pointercancel', up, { once: true });
  });

  // ------------------------------------------------------------ mi mesa → los demás
  let lastQuad = '';
  function reportQuad() {
    const q = o.myQuad();
    const key = q ? JSON.stringify(q.map((p) => p.map((v) => Math.round(v * 1000) / 1000))) : '';
    if (key === lastQuad) return;
    lastQuad = key;
    media.set({ quad: key ? JSON.parse(key) : null, aspect: video.videoWidth ? video.videoWidth / video.videoHeight : null });
  }
  const quadTimer = setInterval(reportQuad, 2500);

  // ------------------------------------------------------------ preguntar si enseña la cámara
  function askShare() {
    if (shareChoice || ask) return;
    const choose = (v) => {
      shareChoice = v;
      try { localStorage.setItem(SHARE_KEY, v); } catch { /* */ }
      ask?.remove(); ask = null;
      syncMedia();
      o.rerender();
      toast(v === 'yes' ? 'Tus rivales verán tu cámara. Puedes cambiarlo en Ajustes → Pantalla y cámaras.' : 'Tu cámara no se enseña. Puedes cambiarlo en Ajustes → Pantalla y cámaras.', 'info', 4500);
    };
    ask = h('div', { class: 'share-ask parchment' },
      h('b', {}, '📷 ¿Enseñar tu cámara a tus rivales?'),
      h('span', { class: 'muted' }, 'Verán tu mesa y tus cartas de verdad. Sólo la imagen, sin sonido.'),
      h('div', { class: 'row-btns' },
        h('button', { class: 'act primary', onClick: () => choose('yes') }, 'Sí, enseñarla'),
        h('button', { class: 'act', onClick: () => choose('no') }, 'No')));
    screen.append(ask);
  }

  // ------------------------------------------------------------ vista general
  const ovVideos = new Map(); // un <video> por jugador, reutilizado para que no parpadee
  const tileVideo = (pid, stream) => {
    let v = ovVideos.get(pid);
    if (!v) { v = h('video', { autoplay: true, playsinline: true, muted: true }); ovVideos.set(pid, v); }
    if (v.srcObject !== stream) v.srcObject = stream;
    return v;
  };
  function openOverview() {
    closeOverview();
    overview = h('div', { class: 'cam-overview' });
    screen.append(overview);
    renderOverview();
  }
  function closeOverview() { overview?.remove(); overview = null; ovVideos.clear(); }
  function renderOverview() {
    if (!overview) return;
    const s = session.state;
    const act = s.players[s.active];
    const tiles = s.players.map((p) => {
      const mine = p.id === session.me;
      const rp = mine ? null : media.remote(p.id);
      let body;
      if (mine && video.srcObject && shareChoice === 'yes') body = tileVideo(p.id, video.srcObject);
      else if (!mine && rp && st.seeRival && rp.sharing && rp.stream) body = tileVideo(p.id, rp.stream);
      else {
        body = h('div', { class: 'ov-off' }, icon(p.isBot ? 'golem' : 'person'),
          h('span', {}, p.isBot ? 'Golem' : mine ? (shareChoice === 'yes' ? 'Cámara apagada' : 'No enseñas tu cámara') : !st.seeRival ? 'Cámaras ocultas' : 'Sin cámara'));
      }
      return h('button', {
        class: 'ov-tile' + (act && act.id === p.id ? ' turn' : '') + (p.eliminated ? ' out' : '') + (p.id === ui.viewOpp ? ' on' : ''),
        onClick: () => { if (!mine) ui.viewOpp = p.id; closeOverview(); o.rerender(); },
      }, body, h('div', { class: 'ov-cap' }, h('b', {}, mine ? p.name + ' (tú)' : p.name), h('span', { class: 'life-gem' }, p.life), act && act.id === p.id ? h('span', { class: 'turn-dot' }) : null));
    });
    clear(overview).append(
      h('div', { class: 'ov-head' }, h('span', {}, 'Vista general'), h('button', { class: 'rune-btn', title: 'Cerrar', onClick: closeOverview }, icon('close'))),
      h('div', { class: 'ov-grid n' + tiles.length }, tiles));
    for (const v of overview.querySelectorAll('video')) v.play().catch(() => {});
  }

  // ------------------------------------------------------------ panel de ajustes
  function openPanel() {
    let close;
    const body = h('div', {});
    const render = () => {
      const seg = (opts, cur, set) => h('div', { class: 'seg' }, Object.entries(opts).map(([k, l]) => h('button', { class: 'sigil-opt' + (cur === k ? ' on' : ''), onClick: () => { set(k); render(); } }, l)));
      const toggle = (label, val, set) => h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: !!val, onChange: (e) => { set(e.target.checked); render(); } }), label);
      const changed = () => { saveSplit(st); syncMedia(); apply(); o.rerender(); };
      clear(body).append(
        h('h3', {}, 'Pantalla y cámaras'),
        toggle('📷 Enseñar mi cámara a los rivales', shareChoice === 'yes', (v) => {
          shareChoice = v ? 'yes' : 'no';
          try { localStorage.setItem(SHARE_KEY, shareChoice); } catch { /* */ }
          ask?.remove(); ask = null;
          changed();
        }),
        toggle('👁️ Ver las cámaras de los rivales', st.seeRival, (v) => { st.seeRival = v; changed(); }),
        h('div', { class: 'field-label' }, 'Diseño'),
        seg(MODES, st.mode, (v) => { st.mode = v; changed(); }),
        st.mode === 'split' ? [
          h('label', { class: 'slider' }, h('span', {}, 'Tamaño del rival'),
            h('input', { type: 'range', min: 0.25, max: 0.75, step: 0.05, value: clampRatio(st.ratio), onInput: (e) => { st.ratio = +e.target.value; saveSplit(st); apply(); } })),
          h('label', { class: 'slider' }, h('span', {}, 'Margen de seguridad'),
            h('input', { type: 'range', min: 0, max: 40, step: 2, value: st.safe, onInput: (e) => { st.safe = +e.target.value; saveSplit(st); apply(); } })),
          toggle('Intercambiar lados', st.swap, (v) => { st.swap = v; changed(); }),
        ] : null,
        toggle('Girar el vídeo del rival (si se ve al revés)', st.flip, (v) => { st.flip = v; changed(); }),
        h('div', { class: 'field-label' }, 'Calidad del vídeo'),
        seg({ normal: 'Normal', low: 'Baja (ahorra datos)' }, st.quality, (v) => { st.quality = v; changed(); }),
        h('p', { class: 'muted small' }, 'El vídeo va directo entre vuestros móviles, sin sonido. En calidad normal gasta unos 150–300 MB por hora; con datos móviles, mejor «Baja».'),
        st.mode === 'split' ? h('p', { class: 'muted small' }, 'Tus zonas se ajustan dentro de tu mitad: usa «Ajustar áreas de la mesa» para colocarlas a tu gusto.') : null,
        h('button', { class: 'act primary', onClick: () => close() }, 'Hecho'),
      );
    };
    render();
    close = sheet(body);
  }

  // ------------------------------------------------------------ enganches
  const offMedia = media.onChange(() => { layoutOverlay(); renderOverview(); });
  const onResize = () => apply();
  window.addEventListener('resize', onResize);
  if (video.srcObject) media.setLocalStream(video.srcObject);
  syncMedia();
  apply();
  setTimeout(askShare, 1200);

  return {
    openPanel,
    openOverview,
    isSplit,
    /** Botones para la barra de arriba. */
    topButtons() {
      const n = session.state.players.length;
      return [
        shareChoice === 'yes' && video.srcObject ? h('button', { class: 'rune-btn rec-btn', title: 'Estás enseñando tu cámara (toca para cambiarlo)', onClick: openPanel }, '🔴') : null,
        n >= 3 ? h('button', { class: 'rune-btn', title: 'Vista general: todas las cámaras', onClick: openOverview }, '▦') : null,
      ];
    },
    refresh() { layoutOverlay(); renderOverview(); },
    setStream(s) { media.setLocalStream(s); syncMedia(); reportQuad(); o.rerender(); },
    relayout: () => apply(),
    destroy() {
      clearInterval(quadTimer);
      offMedia();
      window.removeEventListener('resize', onResize);
      closeOverview();
      ask?.remove();
      media.close();
    },
  };
}
