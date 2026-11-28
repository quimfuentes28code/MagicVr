// Pantalla partida en las partidas online: media pantalla con tu mesa y tu
// cámara, y la otra media con la cámara del rival y SUS zonas dibujadas encima
// de su mesa. También: ventana pequeña flotante y arrastrable, miniaturas de los
// otros rivales (Commander), vista general con todas las cámaras, botones
// rápidos y el panel «Pantalla y cámaras».

import { h, clear, sheet, toast } from './dom.js';
import { icon } from './icons.js';
import { rectToQuad, cssMatrix } from '../homography.js';

const KEY = 'mtgvr-split';
export const SHARE_KEY = 'mtgvr-share-cam';
export const SPLIT_DEFAULTS = { mode: 'split', ratio: 0.5, swap: false, flip: false, quality: 'normal', safe: 8, seeRival: true, thumbs: true, pip: null, tipShown: false };
/** Distribución de tus zonas cuando tu mesa ocupa media pantalla. */
export const SPLIT_LAYOUT = { bl: 0, br: 60, sx: 81, sy: 27, sh: 40, zx: 81, zy: 80, zh: 34 };
export const MODES = { split: 'Pantalla partida', pip: 'Ventana pequeña', solo: 'Sólo mi mesa' };

export function loadSplit() {
  let st;
  try { st = { ...SPLIT_DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { st = { ...SPLIT_DEFAULTS }; }
  if (!MODES[st.mode]) st.mode = 'split';
  if (st.quality !== 'low') st.quality = 'normal';
  st.ratio = clampRatio(st.ratio);
  st.safe = Math.max(0, Math.min(40, Number(st.safe) || 0));
  return st;
}
const saveSplit = (st) => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* */ } };
export function clampRatio(r) {
  const n = Number(r);
  return Number.isFinite(n) && r !== '' && r !== null ? Math.min(0.75, Math.max(0.25, n)) : 0.5;
}

/**
 * A quién pido vídeo y en qué tamaño: el rival que miro, en grande; los demás,
 * en miniatura (si se ven miniaturas); con la vista general abierta, todos.
 */
export function computeWants({ others, viewOpp, mode, seeRival, overview = false, thumbs = true }) {
  const wants = {};
  for (const id of others) {
    if (!seeRival) wants[id] = false;
    else if (overview) wants[id] = true;
    else if (mode === 'solo') wants[id] = false;
    else if (id === viewOpp) wants[id] = true;
    else wants[id] = mode === 'split' && thumbs ? 'thumb' : false;
  }
  return wants;
}

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
  if (!Array.isArray(q) || q.length !== 4 || q.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))) return false;
  const { w, h: hh } = quadSize(q);
  return w > 0.08 && hh > 0.05 && q.every(([u, v]) => u > -0.5 && u < 1.5 && v > -0.5 && v < 1.5);
}

/** Texto del recuadro del rival según cómo esté su cámara. */
export function rivalStatus({ player, seeRival, remote, mode }) {
  if (!player) return '';
  const n = player.name;
  if (player.isBot) return `${n} · golem (sin cámara)`;
  if (!seeRival) return `${n} · cámaras ocultas (👁 para verlas)`;
  if (mode === 'solo') return n;
  if (!remote || !remote.online) return `${n} · conectando…`;
  const inf = remote.info || {};
  if (!inf.sharing) return inf.share ? `${n} · tiene la cámara apagada` : `${n} · no enseña su cámara`;
  if (remote.state === 'failed') return `${n} · no se pudo conectar el vídeo (la partida sigue)`;
  if (!remote.stream) return remote.state === 'slow' ? `${n} · el vídeo tarda en conectar…` : `${n} · conectando la cámara…`;
  return n;
}

/** Vídeo listo para iPhone/Android: sin sonido, en línea y arrancando solo. */
function liveVideo(cls) {
  const v = h('video', { class: cls });
  v.muted = true;
  v.autoplay = true;
  v.playsInline = true;
  v.setAttribute('muted', '');
  v.setAttribute('playsinline', '');
  v.setAttribute('autoplay', '');
  return v;
}
const setStream = (v, s) => {
  if (v.srcObject !== s) v.srcObject = s || null;
  if (s && v.paused) v.play().catch(() => {});
};

/** «Red» vacía para la vista previa (Ajustar mesa sin rival conectado). */
export const PREVIEW_MEDIA = {
  sharing: false,
  set() {}, setLocalStream() {}, close() {},
  remote() { return null; },
  onChange() { return () => {}; },
};

/**
 * o: { screen, mid, video, oppRow, oppAvatar, mat, divider, media, session, ui, myQuad, rerender, onLayout }
 */
export function mountSplit(o) {
  const { screen, mid, video, oppRow, oppAvatar, mat, divider, media, session, ui } = o;
  const st = loadSplit();
  const preview = !!o.preview; // vista previa: sin rival, para dejarla ajustada antes de jugar
  const savedMode = st.mode;
  if (preview) st.mode = 'split';
  const persist = () => saveSplit(preview ? { ...st, mode: savedMode } : st);
  let shareChoice = null;
  try { shareChoice = localStorage.getItem(SHARE_KEY); } catch { /* */ }

  const rvideo = liveVideo('rcam');
  const overlay = h('div', { class: 'rival-overlay' });
  const label = h('div', { class: 'rival-label' });
  const thumbs = h('div', { class: 'rival-thumbs' });
  const handle = h('div', { class: 'split-handle', title: 'Arrastra para cambiar el tamaño' }, h('span', {}));
  const btnEye = h('button', { class: 'pane-btn', title: 'Ver / ocultar las cámaras de los rivales', onClick: (e) => { e.stopPropagation(); st.seeRival = !st.seeRival; changed(); toast(st.seeRival ? 'Ves las cámaras de los rivales.' : 'Cámaras de los rivales ocultas (no gastan datos).', 'info', 2200); } });
  const btnSwap = h('button', { class: 'pane-btn', title: 'Intercambiar lados', onClick: (e) => { e.stopPropagation(); st.swap = !st.swap; changed(); } }, '⇄');
  const btnCfg = h('button', { class: 'pane-btn', title: 'Pantalla y cámaras', onClick: (e) => { e.stopPropagation(); openPanel(); } }, '⚙');
  const tools = h('div', { class: 'pane-tools' }, btnEye, btnSwap, btnCfg);
  const pane = h('div', { class: 'rival-pane' }, rvideo, overlay, thumbs, label, tools);
  const slot = h('div', { class: 'rival-slot' });
  const shade = screen.querySelector('.cam-shade');
  screen.append(slot, pane, handle);
  let overview = null;
  let ask = null;
  let lastViewOpp = null;

  const isSplit = () => st.mode === 'split';
  const portrait = () => screen.clientWidth < screen.clientHeight;
  const rivalPlayer = () => session.state.players.find((p) => p.id === ui.viewOpp);
  const others = () => session.state.players.filter((p) => p.id !== session.me && !p.isBot).map((p) => p.id);

  // ------------------------------------------------------------ preferencias → red
  const syncMedia = () => {
    media.set({
      share: shareChoice === 'yes',
      wants: computeWants({ others: others(), viewOpp: ui.viewOpp, mode: st.mode, seeRival: st.seeRival, overview: !!overview, thumbs: st.thumbs }),
      quality: st.quality,
    });
  };
  function changed() { persist(); syncMedia(); apply(); o.rerender(); }

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
      if (oppAvatar.parentNode !== pane) pane.insertBefore(oppAvatar, label);
    } else {
      screen.style.gridTemplateColumns = screen.style.gridTemplateRows = screen.style.gridTemplateAreas = '';
      mid.style.margin = '';
      if (oppRow.parentNode !== mat) mat.insertBefore(oppRow, divider);
      if (oppAvatar.parentNode !== mid) mid.append(oppAvatar);
    }
    btnSwap.hidden = !isSplit();
    btnEye.textContent = st.seeRival ? '👁' : '🙈';
    btnEye.classList.toggle('off', !st.seeRival);
    if (isSplit() && !st.tipShown) {
      st.tipShown = true;
      persist();
      setTimeout(() => toast('Pantalla partida: tus zonas van en tu mitad. Colócalas a tu gusto en ⚙ → «Ajustar áreas de la mesa».', 'info', 6000), 2500);
    }
    place();
    requestAnimationFrame(place);
  }

  const setBox = (el, b) => {
    for (const k of ['left', 'top', 'width', 'height']) el.style[k] = b && b[k] != null ? b[k] + 'px' : '';
  };

  function place() {
    if (!screen.isConnected) return;
    if (isSplit()) {
      if (portrait()) {
        const b = st.swap ? { left: 0, top: 0, width: screen.clientWidth, height: mid.offsetTop + mid.offsetHeight + (st.safe || 0) } : { left: 0, top: mid.offsetTop - (st.safe || 0), width: screen.clientWidth, height: screen.clientHeight - mid.offsetTop + (st.safe || 0) };
        setBox(video, b); setBox(shade, b);
      } else {
        const b = { left: mid.offsetLeft, top: 0, width: mid.offsetWidth, height: screen.clientHeight };
        setBox(video, b); setBox(shade, b);
      }
      setBox(pane, { left: slot.offsetLeft, top: slot.offsetTop, width: slot.offsetWidth, height: slot.offsetHeight });
      // línea del centro, en la frontera entre las dos mitades
      const T = 28;
      if (portrait()) {
        const y = st.swap ? slot.offsetTop : slot.offsetTop + slot.offsetHeight;
        setBox(handle, { left: 0, top: y - T / 2, width: screen.clientWidth, height: T });
      } else {
        const x = st.swap ? slot.offsetLeft + slot.offsetWidth : slot.offsetLeft;
        setBox(handle, { left: x - T / 2, top: slot.offsetTop, width: T, height: slot.offsetHeight });
      }
    } else if (st.mode === 'pip') {
      setBox(video, null); setBox(shade, null);
      const w = Math.min(screen.clientWidth * 0.24, 230);
      const hh = w * 0.75;
      const pos = st.pip || { x: 0.36, y: 0.11 };
      setBox(pane, { left: Math.max(0, Math.min(screen.clientWidth - w, pos.x * screen.clientWidth)), top: Math.max(0, Math.min(screen.clientHeight - hh, pos.y * screen.clientHeight)), width: w, height: hh });
    } else {
      setBox(video, null); setBox(shade, null); setBox(pane, null);
    }
    if (!isSplit()) setBox(handle, null);
    layoutOverlay();
    renderThumbs();
    o.onLayout && o.onLayout();
  }

  // Vídeo, texto y zonas del rival
  function layoutOverlay() {
    const rid = ui.viewOpp;
    const p = rivalPlayer();
    const rp = rid && p && !p.isBot ? media.remote(rid) : null;
    const show = !!(rp && st.seeRival && st.mode !== 'solo' && rp.sharing && rp.stream);
    setStream(rvideo, show ? rp.stream : null);
    pane.classList.toggle('has-video', show);
    rvideo.classList.toggle('flip', !!st.flip);
    label.textContent = preview ? 'Vista previa · aquí se verá la cámara de tu rival' : rivalStatus({ player: p, seeRival: st.seeRival, remote: rp, mode: st.mode });
    pane.classList.toggle('preview', preview);
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
      overlay.style.inset = isSplit() ? `${(st.safe || 0) + 40}px ${st.safe || 0}px ${(st.safe || 0) + 22}px` : '';
    }
  }
  rvideo.addEventListener('loadedmetadata', () => layoutOverlay());
  rvideo.addEventListener('resize', () => layoutOverlay());

  // Miniaturas de los otros rivales (Commander): tocar una la pone en grande
  const thumbVideos = new Map();
  function renderThumbs() {
    const s = session.state;
    const list = isSplit() && st.thumbs ? s.players.filter((p) => p.id !== session.me && p.id !== ui.viewOpp && !p.eliminated) : [];
    thumbs.hidden = !list.length;
    const act = s.players[s.active];
    const wanted = list.map((p) => {
      const rp = p.isBot ? null : media.remote(p.id);
      const live = !!(rp && st.seeRival && rp.sharing && rp.stream);
      let tile = thumbs.querySelector(`[data-pid="${p.id}"]`);
      if (!tile) {
        tile = h('button', { class: 'rthumb', 'data-pid': p.id, onClick: (e) => { e.stopPropagation(); ui.viewOpp = p.id; syncMedia(); o.rerender(); } });
      }
      let v = thumbVideos.get(p.id);
      if (live) {
        if (!v) { v = liveVideo(''); thumbVideos.set(p.id, v); }
        setStream(v, rp.stream);
      }
      const cap = h('span', { class: 'rthumb-cap' }, p.name, ' · ', h('b', {}, p.life));
      const body = live ? v : h('span', { class: 'rthumb-off' }, icon(p.isBot ? 'golem' : 'person'));
      if (tile.firstChild !== body) { clear(tile).append(body, cap); } else tile.replaceChild(cap, tile.lastChild);
      tile.classList.toggle('turn', !!act && act.id === p.id);
      return tile;
    });
    for (const el of [...thumbs.children]) if (!wanted.includes(el)) el.remove();
    wanted.forEach((el, i) => { if (thumbs.children[i] !== el) thumbs.insertBefore(el, thumbs.children[i] || null); });
    for (const v of thumbs.querySelectorAll('video')) if (v.paused) v.play().catch(() => {});
  }

  // Arrastrar la línea del centro
  handle.addEventListener('pointerdown', (e) => {
    if (!isSplit()) return;
    e.preventDefault();
    e.stopPropagation();
    handle.setPointerCapture(e.pointerId);
    const sr = screen.getBoundingClientRect();
    const move = (ev) => {
      const f = portrait() ? (ev.clientY - sr.top) / sr.height : (ev.clientX - sr.left) / sr.width;
      const rivalFirst = portrait() ? !st.swap : st.swap; // ¿el rival está a la izquierda/arriba?
      st.ratio = clampRatio(rivalFirst ? f : 1 - f);
      apply();
    };
    const up = () => { handle.removeEventListener('pointermove', move); persist(); };
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
    const up = () => { pane.removeEventListener('pointermove', move); persist(); };
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
    media.set({ quad: key ? JSON.parse(key) : null, aspect: video.videoWidth ? Math.round((video.videoWidth / video.videoHeight) * 1000) / 1000 : null });
  }
  const quadTimer = preview ? null : setInterval(reportQuad, 2000);

  // ------------------------------------------------------------ preguntar si enseña la cámara
  function setShare(v) {
    shareChoice = v;
    try { localStorage.setItem(SHARE_KEY, v); } catch { /* */ }
    ask?.remove(); ask = null;
    syncMedia();
    o.rerender();
  }
  function askShare() {
    if (shareChoice || ask || !screen.isConnected) return;
    const choose = (v) => {
      setShare(v);
      toast(v === 'yes' ? 'Tus rivales verán tu cámara (🔴 arriba mientras la enseñas). Puedes cambiarlo en ⚙ → Pantalla y cámaras.' : 'Tu cámara no se enseña. Puedes cambiarlo en ⚙ → Pantalla y cámaras.', 'info', 4500);
    };
    ask = h('div', { class: 'share-ask parchment' },
      h('b', {}, '📷 ¿Enseñar tu cámara a tus rivales?'),
      h('span', { class: 'muted' }, 'Verán tu mesa y tus cartas de verdad. Sólo la imagen, sin sonido. Se recuerda para las próximas partidas.'),
      h('div', { class: 'row-btns' },
        h('button', { class: 'act primary', onClick: () => choose('yes') }, 'Sí, enseñarla'),
        h('button', { class: 'act', onClick: () => choose('no') }, 'No')));
    screen.append(ask);
  }

  // ------------------------------------------------------------ vista general
  const ovVideos = new Map(); // un <video> por jugador, reutilizado para que no parpadee
  const tileVideo = (pid, stream) => {
    let v = ovVideos.get(pid);
    if (!v) { v = liveVideo(''); ovVideos.set(pid, v); }
    setStream(v, stream);
    return v;
  };
  function openOverview() {
    closeOverview();
    overview = h('div', { class: 'cam-overview' });
    screen.append(overview);
    syncMedia(); // con la vista general abierta se piden todas las cámaras
    renderOverview();
  }
  function closeOverview() {
    if (!overview) return;
    overview.remove(); overview = null; ovVideos.clear();
    syncMedia();
  }
  function renderOverview() {
    if (!overview) return;
    const s = session.state;
    const act = s.players[s.active];
    const tiles = s.players.map((p) => {
      const mine = p.id === session.me;
      const rp = mine || p.isBot ? null : media.remote(p.id);
      let body;
      if (mine && video.srcObject && media.sharing) body = tileVideo(p.id, video.srcObject);
      else if (rp && st.seeRival && rp.sharing && rp.stream) body = tileVideo(p.id, rp.stream);
      else {
        let why = 'Sin cámara';
        if (p.isBot) why = 'Golem';
        else if (mine) why = shareChoice === 'yes' ? 'Tu cámara está apagada' : 'No enseñas tu cámara';
        else if (!st.seeRival) why = 'Cámaras ocultas';
        else if (rp && rp.info && !rp.info.sharing) why = rp.info.share ? 'Cámara apagada' : 'No enseña su cámara';
        else if (rp && rp.state === 'failed') why = 'No se pudo conectar el vídeo';
        else why = 'Conectando…';
        body = h('div', { class: 'ov-off' }, icon(p.isBot ? 'golem' : 'person'), h('span', {}, why));
      }
      return h('button', {
        class: 'ov-tile' + (act && act.id === p.id ? ' turn' : '') + (p.eliminated ? ' out' : '') + (p.id === ui.viewOpp ? ' on' : ''),
        onClick: () => { if (!mine) ui.viewOpp = p.id; closeOverview(); o.rerender(); },
      }, body, h('div', { class: 'ov-cap' }, h('b', {}, mine ? p.name + ' (tú)' : p.name), act && act.id === p.id ? h('span', { class: 'turn-dot' }) : null, h('span', { class: 'life-gem' }, p.life)));
    });
    clear(overview).append(
      h('div', { class: 'ov-head' }, h('span', {}, 'Vista general'), h('span', { class: 'ov-hint' }, 'Toca a un rival para verlo en grande'), h('button', { class: 'rune-btn', title: 'Cerrar', onClick: closeOverview }, icon('close'))),
      h('div', { class: 'ov-grid n' + tiles.length }, tiles));
    for (const v of overview.querySelectorAll('video')) if (v.paused) v.play().catch(() => {});
  }

  // ------------------------------------------------------------ panel de ajustes
  function openPanel() {
    let close;
    const body = h('div', { class: 'split-panel' });
    const render = () => {
      const seg = (opts, cur, set) => h('div', { class: 'seg' }, Object.entries(opts).map(([k, l]) => h('button', { class: 'sigil-opt' + (cur === k ? ' on' : ''), onClick: () => { set(k); render(); } }, l)));
      const toggle = (label, val, set) => h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: !!val, onChange: (e) => { set(e.target.checked); render(); } }), label);
      const camOff = shareChoice === 'yes' && !media.sharing;
      clear(body).append(
        h('h3', {}, 'Pantalla y cámaras'),
        toggle('📷 Enseñar mi cámara a los rivales', shareChoice === 'yes', (v) => setShare(v ? 'yes' : 'no')),
        camOff ? h('p', { class: 'muted small warn-text' }, 'Tu cámara está apagada o sin permiso: actívala en «Usar la cámara» (Ajustes de la mesa) para que se vea.') : null,
        toggle('👁️ Ver las cámaras de los rivales', st.seeRival, (v) => { st.seeRival = v; changed(); }),
        h('div', { class: 'field-label' }, 'Diseño'),
        seg(MODES, st.mode, (v) => { st.mode = v; changed(); }),
        st.mode === 'split' ? [
          h('label', { class: 'slider' }, h('span', {}, 'Tamaño del rival'),
            h('input', { type: 'range', min: 0.25, max: 0.75, step: 0.05, value: clampRatio(st.ratio), onInput: (e) => { st.ratio = +e.target.value; persist(); apply(); } })),
          h('label', { class: 'slider' }, h('span', {}, 'Margen de seguridad'),
            h('input', { type: 'range', min: 0, max: 40, step: 2, value: st.safe, onInput: (e) => { st.safe = +e.target.value; persist(); apply(); } })),
          toggle('Intercambiar lados (rival a la izquierda)', st.swap, (v) => { st.swap = v; changed(); }),
          session.state.players.length > 2 ? toggle('Miniaturas de los otros rivales', st.thumbs, (v) => { st.thumbs = v; changed(); }) : null,
        ] : null,
        st.mode === 'pip' ? h('p', { class: 'muted small' }, 'Arrastra la ventana pequeña a donde no te moleste.') : null,
        toggle('Girar el vídeo del rival (si se ve al revés)', st.flip, (v) => { st.flip = v; changed(); }),
        h('div', { class: 'field-label' }, 'Calidad del vídeo'),
        seg({ normal: 'Normal', low: 'Baja (ahorra datos)' }, st.quality, (v) => { st.quality = v; changed(); }),
        h('p', { class: 'muted small' }, 'El vídeo va directo entre vuestros móviles, sin sonido. En calidad normal gasta unos 150–300 MB por hora; con datos móviles, mejor «Baja». Ocultar las cámaras o «Sólo mi mesa» no gasta datos de vídeo.'),
        st.mode === 'split' ? h('p', { class: 'muted small' }, 'Tus zonas se colocan dentro de tu mitad y se guardan aparte de las de pantalla completa: usa «Ajustar áreas de la mesa» para ponerlas a tu gusto.') : null,
        session.state.players.length > 2 ? h('button', { class: 'act', onClick: () => { close(); openOverview(); } }, '▦ Vista general (todas las cámaras)') : null,
        h('button', { class: 'act primary', onClick: () => close() }, 'Hecho'),
      );
    };
    render();
    close = sheet(body);
  }

  // ------------------------------------------------------------ enganches
  const offMedia = media.onChange(() => { layoutOverlay(); renderThumbs(); renderOverview(); });
  const onResize = () => apply();
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  if (video.srcObject) media.setLocalStream(video.srcObject);
  syncMedia();
  apply();
  if (!preview) setTimeout(askShare, 1200);
  if (preview) tools.hidden = true;

  /** Quita la pantalla partida y deja la mesa como estaba (vista previa). */
  function teardown() {
    st.mode = 'solo';
    apply();
    for (const el of [pane, slot, handle]) el.remove();
    screen.classList.remove('split', 'split-pip', 'split-swap');
    setBox(video, null); setBox(shade, null);
  }

  return {
    openPanel,
    openOverview,
    isSplit,
    /** Botones para la barra de arriba. */
    topButtons() {
      if (preview) return [];
      const n = session.state.players.length;
      return [
        media.sharing ? h('button', { class: 'rune-btn rec-btn', title: 'Estás enseñando tu cámara (toca para cambiarlo)', onClick: openPanel }, h('span', { class: 'rec-dot' })) : null,
        n >= 3 ? h('button', { class: 'rune-btn', title: 'Vista general: todas las cámaras', onClick: openOverview }, '▦') : null,
      ];
    },
    /** En cada redibujado de la mesa. */
    refresh() {
      if (ui.viewOpp !== lastViewOpp) { lastViewOpp = ui.viewOpp; syncMedia(); }
      layoutOverlay();
      renderThumbs();
      renderOverview();
    },
    setStream(s) { media.setLocalStream(s); syncMedia(); lastQuad = ''; reportQuad(); o.rerender(); },
    relayout: () => apply(),
    preview,
    get opts() { return { mode: st.mode, ratio: st.ratio, safe: st.safe, swap: st.swap }; },
    /** Cambia el diseño o los tamaños desde fuera (p. ej. desde «Ajustar mesa»). */
    setOpts(patch) { Object.assign(st, patch); persist(); syncMedia(); apply(); },
    destroy() {
      if (preview) teardown();
      clearInterval(quadTimer);
      offMedia();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      closeOverview();
      ask?.remove();
      media.close();
    },
  };
}
