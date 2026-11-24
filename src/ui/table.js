// La mesa: cámara a pantalla completa, tablero holográfico encima y el círculo
// de invocación, donde la cámara reconoce sola las cartas que pones.

import { h, clear, append, sheet, toast, burst, floatText } from './dom.js';
import { cardFace, cardInfo } from './cardview.js';
import { icon } from './icons.js';
import { openPicker } from './picker.js';
import { openCalibrator, applyLayout, LAYOUT_DEFAULTS } from './calibrate.js';
import { startCamera, stopCamera, cameraSupported, cameraErrorText, grabFrame, setCameraZoom } from '../camera.js';
import { CardWatcher } from '../vision.js';
import { targetsFor, describeEffect } from '../engine/effects.js';
import { buzz, keepAwake } from '../native.js';
import { sfx, soundOn, setSound, magicSound } from './sfx.js';
import { castMagic } from './magic.js';
import { hologram } from './hologram.js';
import { tokenImage } from './tokens.js';
import { apply as applyAction } from '../engine/game.js';
import { normalize as normalizeCard } from '../engine/cards.js';
import { warCry, strike, impactFlash, damageNumber } from './combatfx.js';
import { musicOn, setMusic, musicVolume, setMusicVolume, startMusic, duckMusic } from './music.js';
import { openEditionPicker, autoMatchEdition, withPreferredEdition } from './editions.js';
import {
  STEPS, PHASES, STEP_INFO, activePlayer, player, opponents, pendingDefenders, findPerm,
  power, toughness, displayName, canAttack, manaSources, manaAvailable, planPayment,
  stackTop, waitingOn, combatReadyPending,
} from '../engine/game.js';

const SETTINGS_KEY = 'mtgvr-settings-2';
const DEFAULTS = { tilt: 0, zoom: 1, camera: true, layout: null, camZoom: 1 };
function loadSettings() {
  let st;
  try { st = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { st = { ...DEFAULTS }; }
  // v3: vista cenital (sin inclinación) y casillas de mazo/cementerio/exilio movibles.
  if ((st.v || 0) < 3) {
    st.tilt = 0;
    if (st.layout) st.layout = { ...st.layout, br: Math.min(st.layout.br ?? 58, 58), zx: 65.5, zy: 70, zh: 56 };
    st.v = 3;
  }
  return st;
}
/** ¿Falta ajustar la mesa? (la primera vez que se juega en este dispositivo) */
export function needsCalibration() {
  return !loadSettings().layout;
}
function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* */ }
}

const RUNE_LABELS = ['I', 'II', '⚔', 'III', '☾'];
const PHASE_RUNES = PHASES.map((p, i) => ({ label: RUNE_LABELS[i], steps: p.steps, name: p.name }));

export const RUNE_RING = `<svg viewBox="0 0 200 200" fill="none" stroke="#f7dc8f" stroke-width="0.8">
  <circle cx="100" cy="100" r="96"/><circle cx="100" cy="100" r="88" stroke-dasharray="2 4"/>
  <circle cx="100" cy="100" r="70"/>
  <path d="M100 4 L183 148 L17 148 Z" opacity=".55"/><path d="M100 196 L17 52 L183 52 Z" opacity=".55"/>
  <g font-family="serif" font-size="9" fill="#f7dc8f" stroke="none" text-anchor="middle">
    ${'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ'.split('').map((r, i) => {
      const a = (i / 24) * Math.PI * 2;
      return `<text x="${100 + Math.sin(a) * 79}" y="${103 - Math.cos(a) * 79}">${r}</text>`;
    }).join('')}
  </g></svg>`;

export function mountTable(root, session, { onExit, calibrate = false, onCalibrated, intro: showIntro = true } = {}) {
  const ui = {
    settings: loadSettings(),
    viewOpp: null,
    els: new Map(),
    lastEvent: session.state.eventSeq,
    hooks: new Set(),
    awaitingCommander: false,
    targeting: null, // { card, wanted, picked, done }
  };
  const me = () => session.me;
  const S = () => session.state;

  // ------------------------------------------------------------ estructura
  const video = h('video', { class: 'cam', autoplay: true, playsinline: true, muted: true });
  const topbar = h('header', { class: 'topbar' });
  const oppRow = h('div', { class: 'side-row opp' });
  const divider = h('div', { class: 'divider' });
  const meRow = h('div', { class: 'side-row me' });
  const mat = h('div', { class: 'mat' }, oppRow, divider, meRow);
  const board = h('section', { class: 'board' }, mat);

  const summonStatus = h('div', { class: 'summon-status' }, 'Preparando la cámara…');
  const summonWrap = h('div', { class: 'summon-wrap' },
    h('div', { class: 'summon-ring', html: RUNE_RING }),
    h('div', { class: 'summon-ring r2', html: RUNE_RING }),
    h('div', { class: 'summon-frame' }, h('div', { class: 'band' }), h('div', { class: 'summon-title' }, 'Nombre aquí')),
  );
  const summon = h('aside', { class: 'summon', 'data-phase': 'loading' },
    summonWrap,
    h('div', { class: 'summon-tools' },
      h('button', { class: 'rune-btn zoom-btn', title: 'Alejar la cámara', onClick: (e) => { e.stopPropagation(); zoomBy(-0.25); } }, '−'),
      summonStatus,
      h('button', { class: 'rune-btn zoom-btn', title: 'Acercar la cámara (que tu carta llene el círculo)', onClick: (e) => { e.stopPropagation(); zoomBy(0.25); } }, '+'),
      h('button', { class: 'rune-btn', title: 'Grimorio (buscar a mano)', 'data-action': 'play', onClick: () => playCard() }, icon('grimoire')),
    ),
  );
  const hud = h('footer', { class: 'hud' });
  const fx = h('div', { class: 'fx-layer' });
  const banner = h('div', { class: 'banner' });
  const targetBar = h('div', { class: 'target-bar parchment', hidden: true });
  const stackPanel = h('div', { class: 'stack-panel', hidden: true });
  const arrows = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  arrows.setAttribute('class', 'arrows');
  // Zona central: tablero y círculo se colocan donde el jugador los ajustó.
  // Tus casillas de mazo, cementerio y exilio: se colocan donde las ajustes,
  // del tamaño de tus cartas de verdad.
  const myZones = h('div', { class: 'zones-free' });
  const oppAvatar = h('div', { class: 'avatar opp' });
  const mid = h('div', { class: 'table-mid' }, board, myZones, summon, oppAvatar);
  const screen = h('div', { class: 'table-screen' }, video, h('div', { class: 'cam-shade' }), topbar, mid, hud, stackPanel, banner, targetBar, arrows, fx);
  const layout = () => ({ ...LAYOUT_DEFAULTS, tilt: ui.settings.tilt, ...(ui.settings.layout || {}) });
  applyLayout(mid, layout());
  clear(root).append(screen);
  startMusic();
  try {
    if (localStorage.getItem('mtgvr-debug')) {
      window.__mtg = {
        session,
        spell: (e) => spellVisual(S(), { id: 0, ...e }, new Set()),
        normalize: normalizeCard,
        act: (a) => { session.state = applyAction(session.state, a); session.emit(); return session.state; },
      };
    }
  } catch { /* */ }

  // --------------------------------------------------------- cámara + ojo
  const regionOfSummon = () => {
    const v = video.getBoundingClientRect();
    const r = summonWrap.getBoundingClientRect();
    return { x: (r.left - v.left) / v.width, y: (r.top - v.top) / v.height, w: r.width / v.width, h: r.height / v.height };
  };
  const watcher = new CardWatcher(video, {
    getRegion: regionOfSummon,
    onState: ({ phase, text }) => {
      summon.dataset.phase = phase;
      summonStatus.textContent = text;
    },
    onCard: (card) => onCardSeen(card),
    onOutline: (o) => drawOutline(o),
  });

  // Contorno de la carta que está viendo el círculo (ámbar: leyendo; verde: reconocida).
  const outline = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  outline.setAttribute('class', 'card-outline');
  const outlinePoly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  outline.append(outlinePoly);
  screen.append(outline);
  function drawOutline(o) {
    if (!o) { outline.classList.remove('show'); return; }
    const v = video.getBoundingClientRect();
    const sr = screen.getBoundingClientRect();
    outlinePoly.setAttribute('points', o.pts.map((p) => `${v.left - sr.left + p.x * v.width},${v.top - sr.top + p.y * v.height}`).join(' '));
    outline.dataset.state = o.state;
    outline.classList.add('show');
  }

  const applySettings = () => {
    mat.style.setProperty('--tilt', ui.settings.tilt + 'deg');
    mat.style.setProperty('--zoom', ui.settings.zoom);
    const useCam = ui.settings.camera && cameraSupported();
    screen.classList.toggle('no-cam', !useCam);
    if (useCam) {
      startCamera(video)
        .then(() => {
          // El lector sólo trabaja si no hay una ventana inicial ni un ajuste de mesa abiertos.
          watcher.pause(!!ui.holdVision || screen.classList.contains('calibrating'));
          watcher.start();
          applyZoom();
        })
        .catch((e) => {
          screen.classList.add('no-cam');
          summon.dataset.phase = 'error';
          summonStatus.textContent = 'Sin cámara';
          cameraHelp(e);
        });
    } else {
      watcher.pause(true);
      video.srcObject = null;
      summon.dataset.phase = 'error';
      summonStatus.textContent = 'Cámara apagada: usa el grimorio';
    }
  };
  // ------------------------------------------------------- zoom de cámara
  const zoomLabel = h('span', { class: 'zoom-label' });
  function summonOrigin() {
    const v = video.getBoundingClientRect();
    const r = summon.getBoundingClientRect();
    if (!v.width) return { x: 50, y: 50 };
    // origen en coordenadas del vídeo SIN escalar (el centro del círculo en pantalla)
    const sr = screen.getBoundingClientRect();
    return { x: ((r.left + r.width / 2 - sr.left) / sr.width) * 100, y: ((r.top + r.height / 2 - sr.top) / sr.height) * 100 };
  }
  async function applyZoom() {
    const z = ui.settings.camZoom || 1;
    const mode = await setCameraZoom(video, z, summonOrigin());
    zoomLabel.textContent = `×${z.toFixed(2).replace(/\.?0+$/, '')}${mode === 'css' && z > 1 ? ' (digital)' : ''}`;
  }
  function zoomBy(d) {
    ui.settings.camZoom = Math.min(4, Math.max(1, (ui.settings.camZoom || 1) + d));
    saveSettings(ui.settings);
    applyZoom();
    toast(`Zoom de la cámara ×${ui.settings.camZoom}. Ajusta hasta que tu carta llene el círculo.`, 'info', 1800);
  }

  /** Explica por qué falla la cámara y ofrece reintentar (un toque del usuario ayuda a algunos navegadores). */
  function cameraHelp(e) {
    let close;
    close = sheet(h('div', {},
      h('h3', {}, 'La cámara no se ha podido abrir'),
      h('p', {}, cameraErrorText(e)),
      h('p', { class: 'muted' }, 'En Brave: además del permiso, desactiva los «Escudos» de Brave para esta web (icono del león) y recarga. Mientras tanto puedes jugar usando el grimorio para buscar las cartas.'),
      h('div', { class: 'row-btns' },
        h('button', { class: 'act primary', onClick: () => { close(); applySettings(); } }, 'Reintentar'),
        h('button', { class: 'act', onClick: () => close() }, 'Jugar sin cámara'),
      ),
    ));
  }

  /** Abre «Ajustar mesa» sobre la partida. */
  function calibrateTable(firstTime = false) {
    watcher.pause(true);
    session.pauseBots(true);
    const zoomSlider = h('label', { class: 'slider' }, h('span', {}, 'Zoom cámara ', zoomLabel),
      h('input', { type: 'range', min: 1, max: 4, step: 0.25, value: ui.settings.camZoom || 1, onInput: (e) => { ui.settings.camZoom = +e.target.value; saveSettings(ui.settings); applyZoom(); } }));
    openCalibrator({ screen, mid, board, summon, mat, zones: myZones }, layout(), {
      firstTime,
      extra: zoomSlider,
      onChange: () => applyZoom(),
      onDone: (L) => {
        ui.settings.layout = { bl: L.bl, br: L.br, sx: L.sx, sy: L.sy, sh: L.sh, zx: L.zx, zy: L.zy, zh: L.zh };
        ui.settings.tilt = L.tilt;
        saveSettings(ui.settings);
        watcher.pause(!!ui.holdVision);
        if (!screen.querySelector('.intro')) session.pauseBots(false);
        onCalibrated && onCalibrated();
      },
    });
  }

  applySettings();
  keepAwake();
  // La primera vez (o si se pide), ajustar la mesa antes de empezar.
  if (calibrate || !ui.settings.layout) setTimeout(() => calibrateTable(!calibrate), 300);

  function onCardSeen(card) {
    buzz(40);
    // Foto en color de la carta para averiguar su edición exacta.
    try { ui.lastPhoto = { name: card.name, canvas: grabFrame(video, regionOfSummon(), { color: true }) }; } catch { ui.lastPhoto = null; }
    summonGhost(card);
    if (ui.awaitingCommander) {
      ui.awaitingCommander = false;
      if (!(card.isLegendary && card.isCreature) && !/can be your commander/i.test(card.oracle)) {
        toast(`${displayName(card)} no es una criatura legendaria: no puede ser tu comandante.`, 'warn');
        watcher.forget();
        return;
      }
      session.dispatch({ t: 'setCommander', card });
      return;
    }
    playRecognized(card);
  }

  /** ¿Se puede jugar ya (turno, fase y maná)? Si no, el motor explicará por qué. */
  function canPlayNow(card) {
    const s = S();
    const myTurn = activePlayer(s).id === me();
    const main = s.step === 'main1' || s.step === 'main2';
    const fast = card.isInstant || card.keywords.includes('flash');
    if (!fast && !(myTurn && main && !s.stack.length)) return false;
    return card.isLand || !!planPayment(player(s, me()), card.manaCost);
  }

  /** Cartas de dos caras/mitades (aventura, doble cara modal, partidas): eliges cuál jugar. */
  const CHOOSE_LAYOUTS = ['adventure', 'modal_dfc', 'split'];
  function chooseFace(card, then) {
    const faces = card.faces || [];
    const onAdv = player(S(), me()).exile.find((c) => c.onAdventure && c.id === card.id);
    const opts = [];
    if (card.layout === 'adventure') {
      const [cre, adv] = faces;
      if (onAdv) opts.push({ label: `${displayName(card)} desde el exilio`, sub: 'Criatura que volvió de su aventura', card: { ...cre, ...pick(card), fromAdventure: true }, primary: true });
      opts.push({ label: displayName(card), sub: `Criatura · ${cre.manaCost || 'sin coste'}`, card: { ...cre, ...pick(card) } });
      opts.push({ label: adv.name, sub: `Aventura (${/Instant/.test(adv.typeLine) ? 'instantáneo' : 'conjuro'}) · ${adv.manaCost}: ${adv.oracle.replace(/\([^)]*\)/g, '').trim()}`, card: { ...adv, image: card.image, adventureOf: { ...cre, ...pick(card) } } });
    } else {
      faces.forEach((f, i) => opts.push({ label: f.name, sub: `${card.layout === 'split' ? (i ? 'Mitad derecha' : 'Mitad izquierda') : (i ? 'Cara trasera' : 'Cara delantera')} · ${f.manaCost || 'sin coste'} · ${f.typeLine}`, card: { ...f, image: i && f.image ? f.image : card.image } }));
    }
    let close;
    close = sheet(h('div', {},
      h('h3', {}, `¿Cómo juegas ${displayName(card)}?`),
      h('p', { class: 'muted' }, card.layout === 'adventure'
        ? 'Es una carta con aventura: puedes lanzar la criatura, o lanzar primero la aventura (el hechizo); entonces la carta queda exiliada y más tarde puedes lanzar la criatura desde el exilio.'
        : 'Esta carta tiene dos partes: elige cuál juegas.'),
      h('div', { class: 'face-choices' }, opts.map((o) => h('button', { class: 'act face-choice' + (o.primary ? ' primary' : ''), onClick: () => { close(); then(o.card); } },
        h('b', {}, o.label), h('span', {}, o.sub)))),
    ));
  }
  // lo que la cara elegida conserva de la carta reconocida (edición, nombre en español…)
  const pick = (card) => ({ image: card.image, edition: card.edition, printedName: card.printedName, printedText: card.printedText, printedType: card.printedType, id: card.id });

  function playRecognized(card) {
    if (card.faces && card.faces.length > 1 && CHOOSE_LAYOUTS.includes(card.layout) && !card.faceIndex && card.faceIndex !== 0) {
      chooseFace(card, (face) => playRecognized(face));
      return;
    }
    const wanted = targetsFor(card);
    if (wanted.length && canPlayNow(card)) {
      startTargeting(card, wanted, (targets) => dispatchPlay(card, targets));
      return;
    }
    dispatchPlay(card, []);
  }

  function dispatchPlay(card, targets) {
    const before = S().eventSeq;
    if (!card.edition) card = withPreferredEdition(card);
    session.dispatch({ t: 'play', card, targets });
    findEdition(card);
    // Aviso con opción de deshacer por si la cámara leyó mal.
    setTimeout(() => {
      const ev = S().events.filter((e) => e.id > before);
      if (!ev.length || ev.some((e) => e.kind === 'illegal')) return;
      const box = h('div', { class: 'summon-toast' },
        h('span', {}, 'Invocado: ', h('b', {}, displayName(card))),
        h('button', { class: 'gem small bronze', onClick: () => { session.dispatch({ t: 'undo' }); box.remove(); toast('Deshecho. Saca la carta del círculo y vuelve a ponerla (o usa el grimorio).'); } }, icon('undo'), 'Deshacer'),
      );
      screen.append(box);
      setTimeout(() => box.classList.add('out'), 4200);
      setTimeout(() => box.remove(), 4700);
      const fx = card.isPermanent ? card.effects?.etb : card.effects?.spell;
      if (!card.isPermanent && !fx?.length) toast('Esta carta no se aplica sola: toca la criatura objetivo (daño, +X/+X, destruir…) o ajusta las vidas.', 'info', 5000);
    }, 60);
  }

  /** En segundo plano: compara la foto con las ilustraciones y pone tu edición. */
  function findEdition(card) {
    const photo = ui.lastPhoto && ui.lastPhoto.name === card.name ? ui.lastPhoto.canvas : null;
    ui.lastPhoto = null;
    if (!photo || !card.isPermanent || card.edition) return;
    const myPerm = () => { const mine = player(S(), me()).battlefield.filter((p) => p.card.name === card.name); return mine[mine.length - 1]; };
    autoMatchEdition(photo, card).then((ed) => {
      if (!ed) return;
      if (ed.unsure) {
        // No está segura: ofrece elegirla a mano.
        const perm = myPerm();
        if (!perm) return;
        editionPrompt(`¿Es tu edición de ${displayName(card)}?`, () => openEditionPicker(perm.card, (e2) => { const p2 = myPerm(); if (p2) session.dispatch({ t: 'setImage', uid: p2.uid, image: e2.image }); }));
        return;
      }
      const perm = myPerm();
      if (perm) session.dispatch({ t: 'setImage', uid: perm.uid, image: ed.image });
      editionPrompt(`Edición detectada: ${ed.setName}`, () => openEditionPicker(card, (e2) => { const p2 = myPerm(); if (p2) session.dispatch({ t: 'setImage', uid: p2.uid, image: e2.image }); }));
    }).catch(() => {});
  }

  /** Aviso con botón para elegir la edición a mano. */
  function editionPrompt(text, onChange) {
    const box = h('div', { class: 'summon-toast edition-toast' }, h('span', {}, text),
      h('button', { class: 'gem small bronze', onClick: () => { box.remove(); onChange(); } }, 'Elegir otra'));
    screen.append(box);
    setTimeout(() => box.classList.add('out'), 6000);
    setTimeout(() => box.remove(), 6500);
  }

  // ------------------------------------------------------- objetivos
  function startTargeting(card, wanted, done) {
    ui.targeting = { card, wanted, picked: [], done };
    watcher.pause(true);
    drawTargetBar();
    render(S());
  }

  function currentWant() {
    const t = ui.targeting;
    return t && t.wanted[t.picked.length];
  }

  function pickTarget(ref) {
    const t = ui.targeting;
    if (!t) return;
    buzz(20);
    t.picked.push(ref);
    if (t.picked.length >= t.wanted.length) finishTargeting(t.picked);
    else { drawTargetBar(); render(S()); }
  }

  function finishTargeting(targets) {
    const t = ui.targeting;
    ui.targeting = null;
    targetBar.hidden = true;
    watcher.pause(false);
    render(S());
    if (t) t.done(targets);
  }

  function drawTargetBar() {
    const t = ui.targeting;
    const want = currentWant();
    const s = S();
    const players = want.target === 'creature' || want.target === 'spell' ? [] : s.players.filter((p) => !p.eliminated);
    const spells = want.target === 'spell' ? s.stack : [];
    targetBar.hidden = false;
    clear(targetBar).append(
      h('div', { class: 'tb-title' }, displayName(t.card), ': ', describeEffect(want)),
      h('div', { class: 'tb-hint' }, want.target === 'spell' ? (spells.length ? 'Elige el hechizo de la pila.' : 'No hay ningún hechizo en la pila.') : want.target === 'creature' ? 'Toca la criatura objetivo en el tablero.' : want.target === 'player' ? 'Elige el jugador objetivo.' : 'Toca una criatura o elige un jugador.'),
      h('div', { class: 'row-btns' },
        spells.map((it) => h('button', { class: 'act primary', onClick: () => pickTarget({ stack: it.id }) }, displayName(it.card))),
        players.map((p) => h('button', { class: 'act' + (p.id === me() ? '' : ' primary'), onClick: () => pickTarget({ player: p.id }) }, p.id === me() ? 'A mí' : p.name)),
        h('button', { class: 'act', onClick: () => finishTargeting(t.picked) }, 'Sin objetivo (a mano)'),
      ),
    );
  }

  function summonGhost(card) {
    const g = h('div', { class: 'summon-ghost' }, cardFace(card, { big: true }));
    summonWrap.append(g);
    burst(summonWrap, card.colors[0] || card.produces?.[0] || 'C', 26);
    setTimeout(() => g.remove(), 1150);
  }

  // ------------------------------------------------------------- render
  function render(s) {
    // Posición de cada carta antes de redibujar (para animar las que mueren o se van).
    ui.rects ||= new Map();
    for (const [uid, el] of ui.els) if (el.isConnected) { const r = el.getBoundingClientRect(); if (r.width) ui.rects.set(uid, r); }
    const myP = player(s, me());
    const opps = s.players.filter((p) => p.id !== me());
    if (!ui.viewOpp || !opps.find((p) => p.id === ui.viewOpp && !p.eliminated)) {
      ui.viewOpp = (opps.find((p) => !p.eliminated) || opps[0])?.id;
    }
    renderTop(s, opps);
    renderAvatar(oppAvatar, s, player(s, ui.viewOpp), false);
    renderSide(oppRow, s, player(s, ui.viewOpp), 'opp');
    renderSide(meRow, s, myP, 'me');
    const act = activePlayer(s);
    clear(divider).append(
      h('span', { class: act.id === me() ? 'mine' : '' }, act.id === me() ? 'Tu turno' : 'Turno de ' + act.name),
      h('span', {}, STEP_INFO[s.step].name),
    );
    renderHud(s, myP);
    renderStack(s);
    processEvents(s);
    requestAnimationFrame(() => drawArrows(S()));
    if (s.winner && !ui.endShown) { ui.endShown = true; setTimeout(() => endScreen(S()), 1600); }
    for (const fn of ui.hooks) fn(s);
  }

  // ------------------------------------------------------------- la pila
  function renderStack(s) {
    clearTimeout(ui.passTimer);
    if (!s.stack.length) { stackPanel.hidden = true; ui.waitingFor = null; return; }
    stackPanel.hidden = false;
    const top = stackTop(s);
    const myResponse = top.waiting[0] === me();
    const items = s.stack.map((it, i) => {
      const owner = player(s, it.by);
      const el = h('button', { class: 'stack-item' + (i === s.stack.length - 1 ? ' top' : ''), 'data-stack': it.id, onClick: () => sheet(cardInfo(it.card, h('p', { class: 'muted' }, `Lanzado por ${owner.name}.`))) },
        cardFace(it.card), h('span', { class: 'who' }, owner.id === me() ? 'Tú' : owner.name));
      return el;
    });
    const caster = player(s, top.by);
    let status;
    if (myResponse) {
      // Ventana de respuesta: como en los juegos digitales, se pasa sola si no haces nada.
      const secs = 10; // tiempo para decidir si respondes
      if (ui.waitingFor !== top.id) { ui.waitingFor = top.id; ui.passAt = Date.now() + secs * 1000; ui.hold = false; sfx('warn'); }
      const left = Math.max(0, Math.ceil((ui.passAt - Date.now()) / 1000));
      status = h('div', { class: 'stack-ask' },
        h('div', {}, h('b', {}, caster.name), ' lanza ', h('b', {}, displayName(top.card)), describeTargets(s, top), '. ¿Respondes? Pon un instantáneo en el círculo.'),
        h('div', { class: 'row-btns' },
          h('button', { class: 'act primary', onClick: () => session.dispatch({ t: 'pass' }) }, ui.hold ? 'No respondo' : `No respondo (${left})`),
          !ui.hold ? h('button', { class: 'act', onClick: () => { ui.hold = true; render(S()); } }, 'Esperar') : null,
        ));
      if (!ui.hold) {
        ui.passTimer = setTimeout(() => {
          if (Date.now() >= ui.passAt) { if (stackTop(S())?.waiting[0] === me()) session.dispatch({ t: 'pass' }); } else render(S());
        }, 500);
      }
    } else {
      const who = top.waiting[0] ? player(s, top.waiting[0]).name : '';
      status = h('div', { class: 'stack-ask' }, who ? `Esperando a que ${who} responda…` : 'Resolviendo…');
    }
    clear(stackPanel).append(h('div', { class: 'stack-title' }, 'La pila', h('small', {}, ' (se resuelve de arriba abajo)')), h('div', { class: 'stack-items' }, items), status);
  }

  function describeTargets(s, it) {
    const names = (it.targets || []).map((t) => {
      if (t.player) return t.player === me() ? 'ti' : player(s, t.player)?.name;
      if (t.stack) { const x = s.stack.find((y) => y.id === t.stack); return x ? displayName(x.card) : 'un hechizo'; }
      const f = findPerm(s, t.uid);
      return f ? displayName(f.perm.card) : '';
    }).filter(Boolean);
    return names.length ? ` sobre ${names.join(' y ')}` : '';
  }

  // ------------------------------------------------------------ flechas
  function drawArrows(s) {
    const sr = screen.getBoundingClientRect();
    const center = (el) => {
      if (!el || !el.isConnected) return null;
      const r = el.getBoundingClientRect();
      if (!r.width) return null;
      return [r.left + r.width / 2 - sr.left, r.top + r.height / 2 - sr.top];
    };
    const playerEl = (id) => (typeof id === 'string' && id.startsWith('pw:') ? ui.els.get(+id.slice(3))
      : id === me() ? hud.querySelector('[data-life]') : topbar.querySelector(`[data-player="${id}"]`));
    const lines = [];
    for (const it of s.stack) {
      const from = center(stackPanel.querySelector(`[data-stack="${it.id}"]`));
      for (const t of it.targets || []) {
        const to = t.player ? center(playerEl(t.player)) : t.stack ? center(stackPanel.querySelector(`[data-stack="${t.stack}"]`)) : center(ui.els.get(t.uid));
        lines.push([from, to, 'tgt']);
      }
    }
    arrows.setAttribute('viewBox', `0 0 ${sr.width} ${sr.height}`);
    arrows.innerHTML = `<defs>${['atk', 'blk', 'tgt'].map((k) => `<marker id="ah-${k}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="ah ${k}"/></marker>`).join('')}</defs>`
      + lines.filter(([a, b]) => a && b).map(([a, b, k]) => {
        const mx = (a[0] + b[0]) / 2;
        const my = Math.min(a[1], b[1]) - 30;
        return `<path class="arrow ${k}" d="M${a[0]},${a[1]} Q${mx},${my} ${b[0]},${b[1]}" marker-end="url(#ah-${k})"/>`;
      }).join('');
  }

  // ------------------------------------------------- fin de la partida
  function endScreen(s) {
    const won = s.winner === me();
    sfx(won ? 'win' : 'lose');
    const plays = s.log.filter((l) => l.startsWith(player(s, me()).name + ' lanza') || l.startsWith(player(s, me()).name + ' juega')).length;
    const box = h('div', { class: 'end-screen' + (won ? ' won' : ' lost') },
      h('div', { class: 'end-card parchment' },
        h('div', { class: 'end-title' }, won ? '¡Victoria!' : 'Derrota'),
        h('p', {}, won ? 'Has derrotado a tus rivales.' : `${player(s, s.winner).name} gana la partida.`),
        h('div', { class: 'end-stats' },
          h('div', {}, h('b', {}, s.turn), h('span', {}, 'turnos')),
          h('div', {}, h('b', {}, player(s, me()).life), h('span', {}, 'vidas finales')),
          h('div', {}, h('b', {}, plays), h('span', {}, 'cartas jugadas')),
        ),
        h('div', { class: 'row-btns' },
          h('button', { class: 'act', onClick: () => { box.remove(); openLog(); } }, 'Ver crónica'),
          h('button', { class: 'act primary', onClick: exit }, 'Volver al menú'),
        ),
      ));
    screen.append(box);
  }

  // ------------------------------------------------- inicio de partida
  function intro(s) {
    session.pauseBots(true); // los bots esperan a que mires la tirada
    ui.holdVision = true; // y la cámara no lee cartas hasta que empieces
    watcher.pause(true);
    const ev = s.events.find((e) => e.kind === 'start');
    const first = player(s, ev?.player || activePlayer(s).id);
    sfx('dice');
    const box = h('div', { class: 'intro' },
      h('div', { class: 'intro-card parchment' },
        h('h3', {}, 'Quién empieza'),
        ev?.rolls ? h('p', { class: 'intro-sub' }, 'Cada jugador tira un dado de 20 caras: quien saca el número más alto empieza.') : null,
        ev?.rolls ? h('div', { class: 'dice-row' }, s.players.map((p, i) => h('div', { class: 'die' + (p.id === first.id ? ' win' : '') }, h('b', {}, ev.rolls[i]), h('span', {}, p.id === me() ? 'Tú' : p.name)))) : null,
        h('p', { class: 'intro-first' }, first.id === me()
          ? (s.players.length > 2 ? '¡Empiezas tú! (en multijugador, quien empieza también roba en su primer turno)' : '¡Empiezas tú! (en un duelo, quien empieza no roba carta en su primer turno)')
          : `Empieza ${first.name}.`),
        h('div', { class: 'intro-steps' },
          h('b', {}, 'Con tus cartas de verdad:'),
          h('ol', {},
            h('li', {}, 'Coge tu mazo físico y barájalo.'),
            h('li', {}, 'Roba 7 cartas: esa es tu mano. Tenla en la mano, sin enseñarla (la app no ve tu mano, sólo las cartas que pones en el círculo para jugarlas).'),
            h('li', {}, '¿No te gusta la mano (muy pocas o demasiadas tierras)? Haz ', h('b', {}, 'mulligan'), ': vuelve a barajar todo y roba 7; luego pon 1 carta debajo del mazo por cada mulligan que hayas hecho.',
              s.players.length > 2 ? ' En multijugador (Commander) el primer mulligan es gratis: no pones ninguna carta debajo.' : ''),
          ),
        ),
        h('div', { class: 'row-btns' },
          h('button', { class: 'act', onClick: () => { ui.mulligans = (ui.mulligans || 0) + 1; const bottom = ui.mulligans - (S().players.length > 2 ? 1 : 0); session.dispatch({ t: 'hand', target: me(), set: 7 - Math.max(0, bottom) }); toast(bottom > 0 ? `Mulligan ${ui.mulligans}: baraja tu mazo, roba 7 cartas y pon ${bottom} carta${bottom > 1 ? 's' : ''} de tu mano debajo del mazo.` : 'Mulligan gratis: baraja tu mazo y roba 7 cartas (no pones ninguna debajo).', 'info', 7000); } }, 'Hago mulligan'),
          h('button', { class: 'act primary', onClick: () => { box.remove(); ui.holdVision = false; if (!screen.classList.contains('calibrating')) { session.pauseBots(false); watcher.pause(false); } } }, 'Me quedo la mano'),
        ),
      ));
    screen.append(box);
  }

  // ---------------------------------------------------------- emotes
  const EMOTES = ['¡Hola!', '¡Buena jugada!', 'Gracias', 'Uy…', 'Pensando…', '¡Buena partida!'];
  function openEmotes() {
    let close;
    close = sheet(h('div', {}, h('h3', {}, 'Mensajes rápidos'),
      h('div', { class: 'actions' }, EMOTES.map((t) => h('button', { class: 'act', onClick: () => { close(); session.dispatch({ t: 'emote', text: t }); } }, t)))));
  }
  function showEmote(e) {
    const anchor = e.by === me() ? hud.querySelector('.me-plate') : topbar.querySelector(`[data-player="${e.by}"]`);
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const sr = screen.getBoundingClientRect();
    const b = h('div', { class: 'emote-bubble parchment', style: { left: r.left - sr.left + r.width / 2 + 'px', top: (e.by === me() ? r.top - sr.top - 40 : r.bottom - sr.top + 6) + 'px' } }, e.text);
    screen.append(b);
    sfx('emote');
    setTimeout(() => b.remove(), 3200);
  }

  /** Retrato al estilo de las mesas digitales: cara, vidas en un escudo y la mano en abanico. */
  function portraitOf(s, p) {
    const cmd = p.commander;
    if (cmd && cmd.image) return h('span', { class: 'av-face', style: { backgroundImage: `url(${cmd.image.replace('/normal/', '/art_crop/')})` } });
    return h('span', { class: 'av-face icon-face' }, icon(p.isBot ? 'golem' : 'person'));
  }
  function handFan(n, onClick) {
    const k = Math.min(n, 8);
    return h('button', { class: 'av-hand', title: `${n} cartas en la mano`, onClick },
      Array.from({ length: k }, (_, i) => h('i', { style: { '--i': i - (k - 1) / 2 } })),
      h('b', {}, n));
  }
  function renderAvatar(el, s, p, mine) {
    if (!p) { clear(el); return; }
    const myTurn = activePlayer(s).id === p.id;
    const hand = p.isBot ? p.hand.length : (p.handCount || 0);
    el.classList.toggle('turn', myTurn);
    el.classList.toggle('out', !!p.eliminated);
    clear(el).append(
      h('button', { class: 'av-portrait', onClick: () => playerSheet(p) }, h('span', { class: 'av-ring' }), portraitOf(s, p)),
      h('div', { class: 'av-life' },
        mine ? h('button', { class: 'pm', onClick: () => session.dispatch({ t: 'life', target: p.id, delta: -1 }) }, '−') : null,
        h('button', { class: 'av-shield', 'data-life': p.id, onClick: () => playerSheet(p) }, p.life),
        mine ? h('button', { class: 'pm', onClick: () => session.dispatch({ t: 'life', target: p.id, delta: 1 }) }, '+') : null),
      h('div', { class: 'av-name' }, p.name, p.poison ? h('span', { class: 'av-poison' }, ` ☠${p.poison}`) : null),
      handFan(hand, () => handSheet(p)),
    );
  }
  function handSheet(p) {
    if (p.isBot) { toast(`${p.name} tiene ${p.hand.length} cartas en la mano y ${p.library.length} en el mazo.`, 'info'); return; }
    let close;
    const d = (a) => () => { session.dispatch(a); close(); handSheet(player(S(), p.id)); };
    close = sheet(h('div', {},
      h('h3', {}, 'Cartas en tu mano'),
      h('p', { class: 'muted' }, 'La app lleva la cuenta sola (roba, juegas, vuelven a la mano…). Si no coincide con tu mano real, corrígela aquí.'),
      h('div', { class: 'life-ctl' },
        h('button', { class: 'act', onClick: d({ t: 'hand', target: p.id, delta: -1 }) }, '−1'),
        h('span', { class: 'life-big' }, p.handCount || 0),
        h('button', { class: 'act', onClick: d({ t: 'hand', target: p.id, delta: 1 }) }, '+1')),
      h('button', { class: 'act primary', onClick: () => close() }, 'Hecho')));
  }

  function renderTop(s, opps) {
    const stepIdx = STEPS.indexOf(s.step);
    clear(topbar).append(
      h('div', { class: 'foes' },
        opps.length < 2 ? null : opps.map((p) => h('button', {
          class: 'foe' + (p.id === ui.viewOpp ? ' on' : '') + (p.eliminated ? ' out' : ''),
          'data-player': p.id,
          onClick: () => { ui.viewOpp = p.id; render(S()); },
        },
        h('span', { class: 'portrait' }, icon(p.isBot ? 'golem' : 'person')),
        h('span', {},
          h('div', { class: 'foe-name' }, p.name),
          h('div', { class: 'foe-meta' }, p.isBot ? `${p.hand.length} en mano · ${p.library.length} en mazo` : (activePlayer(s).id === p.id ? 'jugando…' : 'esperando')),
        ),
        activePlayer(s).id === p.id ? h('span', { class: 'turn-dot' }) : null,
        h('span', { class: 'life-gem', 'data-life': p.id === ui.viewOpp ? null : p.id }, p.life),
        )),
      ),
      h('div', { class: 'phase-runes', title: 'Fases del turno' },
        PHASE_RUNES.map((r) => {
          const idxs = r.steps.map((x) => STEPS.indexOf(x));
          const on = r.steps.includes(s.step);
          const done = Math.max(...idxs) < stepIdx;
          return h('span', { class: 'rune' + (on ? ' on' : '') + (done ? ' done' : ''), title: r.name }, r.label);
        }),
        h('span', { class: 'phase-name' }, STEP_INFO[s.step].name),
      ),
      h('div', { class: 'top-actions' },
        session.role !== 'local' ? h('button', { class: 'rune-btn', title: 'Mensajes rápidos', onClick: openEmotes }, '💬') : null,
        h('button', { class: 'rune-btn', title: 'Crónica', onClick: openLog }, icon('scroll')),
        h('button', { class: 'rune-btn', title: 'Menú', onClick: openMenu }, icon('gear')),
      ),
    );
  }

  /**
   * Coloca los hijos de `container` en el orden deseado SIN sacar del DOM los
   * que ya están en su sitio: así sus animaciones no se reinician cada vez
   * que el rival hace algo.
   */
  function reconcile(container, wanted) {
    wanted.forEach((node, i) => {
      if (container.children[i] !== node) container.insertBefore(node, container.children[i] || null);
    });
    while (container.children.length > wanted.length) container.lastElementChild.remove();
  }

  function renderSide(el, s, p, side) {
    if (!p) { clear(el); el.__parts = null; return; }
    // Estructura fija por lado (sólo se reconstruye si cambia el jugador mostrado).
    let parts = el.__parts;
    if (!parts || parts.pid !== p.id) {
      clear(el);
      parts = {
        pid: p.id,
        zones: h('div', { class: 'zones' }),
        rowC: h('div', { class: 'row creatures', 'data-zone': 'battlefield' }),
        rowL: h('div', { class: 'row lands', 'data-zone': 'lands' }),
        hintC: h('div', { class: 'hint' }, side === 'me' ? 'Tus criaturas' : 'Criaturas rivales'),
        hintL: h('div', { class: 'hint' }, side === 'me' ? 'Tus tierras' : 'Tierras rivales'),
      };
      parts.battle = h('div', { class: 'battle' }, ...(side === 'opp' ? [parts.rowL, parts.rowC] : [parts.rowC, parts.rowL]));
      // Tus casillas van aparte (movibles); las del rival, enfrente (a tu izquierda).
      if (side === 'me') { el.append(parts.battle); myZones.replaceChildren(parts.zones); }
      else el.append(parts.zones, parts.battle);
      el.__parts = parts;
    }
    const creatures = p.battlefield.filter((x) => x.card.isCreature || /Planeswalker/.test(x.card.typeLine));
    const support = p.battlefield.filter((x) => !creatures.includes(x));
    const lands = support.filter((x) => x.card.isLand);
    const others = support.filter((x) => !x.card.isLand);

    const zone = (cls, label, content, count, onClick) => h('button', { class: 'zone ' + cls, 'data-zone': cls, onClick },
      content, h('span', { class: 'zl' }, label), count != null ? h('span', { class: 'n' }, count) : null);
    const topGrave = p.graveyard[p.graveyard.length - 1];
    const topExile = p.exile[p.exile.length - 1];
    parts.zones.className = 'zones' + (s.mode === 'commander' ? ' four' : '');
    clear(parts.zones).append(
      zone('library', 'Mazo', h('div', { class: 'card-back' }), p.isBot ? p.library.length : null, () => toast('Biblioteca: el mazo, boca abajo. Se roba de aquí.')),
      zone('graveyard', 'Cementerio', topGrave ? cardFace(topGrave) : null, p.graveyard.length, () => showZone(p, 'graveyard')),
      zone('exile', 'Exilio', topExile ? cardFace(topExile) : null, p.exile.length || null, () => showZone(p, 'exile')),
      s.mode === 'commander' ? zone('command', 'Mando', commandZone(p), null, () => commandAction(p)) : null,
    );

    const cEls = creatures.map((x) => permEl(s, x, p));
    const lEls = [...others, ...lands].map((x) => permEl(s, x, p));
    reconcile(parts.rowC, cEls.length ? cEls : [parts.hintC]);
    reconcile(parts.rowL, lEls.length ? lEls : [parts.hintL]);
    parts.rowC.style.setProperty('--n', Math.max(1, creatures.length));
    parts.rowL.style.setProperty('--n', Math.max(1, support.length));
    el.classList.toggle('eliminated', p.eliminated);
  }

  function commandZone(p) {
    if (!p.commander) return h('span', { class: 'big' }, p.id === me() ? '+' : '—');
    if (!p.commanderInZone) return h('span', { class: 'big' }, '⚔');
    return [cardFace(p.commander), p.commanderTax ? h('span', { class: 'tax' }, '+' + p.commanderTax) : null];
  }

  function permEl(s, perm, owner) {
    let el = ui.els.get(perm.uid);
    if (!el) {
      el = h('div', { class: 'perm', 'data-uid': perm.uid }, cardFace(perm.card), h('div', { class: 'badges' }));
      // La animación de entrada se reproduce una sola vez: al acabar se quita,
      // para que no se repita cuando el tablero recoloca las cartas.
      el.addEventListener('animationend', (ev) => { if (ev.animationName === 'summonIn') el.classList.remove('enter'); });
      el.addEventListener('click', (e) => { e.stopPropagation(); onPermTap(perm.uid); });
      ui.els.set(perm.uid, el);
      el.__img = perm.card.image;
    }
    // si cambia la imagen (edición elegida, imagen de la ficha…), se repinta la cara
    if (el.__img !== perm.card.image) {
      el.__img = perm.card.image;
      const old = el.querySelector('.card');
      if (old) old.replaceWith(cardFace(perm.card));
    }
    const attacking = s.combat.attackers[perm.uid] != null;
    const blocking = Object.values(s.combat.blocks).some((l) => l.includes(perm.uid));
    const isActive = owner.id === activePlayer(s).id;
    el.classList.toggle('tapped', perm.tapped);
    el.classList.toggle('attacking', attacking);
    el.classList.toggle('blocking', blocking);
    el.classList.toggle('sick', perm.card.isCreature && perm.sick && isActive);
    el.classList.toggle('can-attack', s.step === 'attack' && owner.id === me() && isActive && canAttack(s, perm) && !attacking);
    el.classList.toggle('commander', perm.isCommander);
    el.classList.toggle('targetable', !!currentWant() && perm.card.isCreature);
    const b = el.querySelector('.badges');
    clear(b);
    if (perm.card.isCreature) {
      const pw = power(perm);
      const tg = toughness(perm);
      b.append(h('span', { class: 'pt' + (pw !== perm.card.power || tg !== perm.card.toughness ? ' mod' : '') }, `${pw}/${tg}`));
    }
    if (perm.damage) b.append(h('span', { class: 'dmg' }, '−' + perm.damage));
    if (perm.counters) b.append(h('span', { class: 'ctr' }, (perm.counters > 0 ? '+' : '') + perm.counters));
    if (perm.card.isCreature && perm.sick && isActive && !perm.card.keywords.includes('haste')) b.append(h('span', {}, 'zZ'));
    return el;
  }

  // ---------------------------------------------------------------- HUD
  function renderHud(s, myP) {
    clear(hud);
    const lifePlate = h('div', { class: 'avatar me' });
    renderAvatar(lifePlate, s, myP, true);
    const oracle = (text) => h('div', { class: 'oracle parchment' }, icon('eye'), h('div', { class: 'txt' }, text));

    if (s.winner) {
      const won = s.winner === me();
      append(hud, [lifePlate, oracle(won ? '¡Victoria! Has derrotado a tus rivales.' : `${player(s, s.winner).name} gana la partida.`),
        h('button', { class: 'gem', onClick: exit }, 'Volver al menú')]);
      return;
    }
    const act = activePlayer(s);
    const myTurn = act.id === me();
    const pending = pendingDefenders(s);
    const readyPend = combatReadyPending(s);
    let help = STEP_INFO[s.step].help;
    let primary = null;
    let secondary = null;
    const next = (label, cls = '') => h('button', { class: 'gem ' + cls, 'data-action': 'next', onClick: () => { sfx('click'); session.dispatch({ t: 'next' }); } }, label);
    const lastCombat = s.lastCombat && s.lastCombat.turn === s.turn ? s.lastCombat.result.join(' ') : null;

    if (myP.eliminated) {
      help = 'Has sido eliminado. Puedes seguir mirando la partida.';
    } else if (s.stack.length) {
      help = stackTop(s).waiting[0] === me() ? 'Hay un hechizo en la pila esperando tu respuesta (arriba).' : 'Hay hechizos en la pila. Se resuelven de arriba abajo.';
    } else if (myTurn) {
      if (s.step === 'main1') {
        help = 'Fase principal 1: pon cartas en el círculo para jugarlas. ' + manaHint(myP);
        const canAtk = myP.battlefield.some((p) => canAttack(s, p));
        primary = next(canAtk ? '⚔ Ir al combate' : 'Ir a la fase 2');
      } else if (s.step === 'attack') {
        const n = Object.keys(s.combat.attackers).length;
        help = n ? `Atacas con ${n}. Toca otra criatura para añadirla o quitarla.` : 'Toca las criaturas que brillan para atacar' + (opponents(s, me()).length > 1 ? ` a ${player(s, ui.viewOpp).name} (elige el rival arriba).` : '.');
        primary = next(n ? `⚔ Atacar (${n})` : 'No atacar', n ? 'ruby pulse' : '');
        if (myP.battlefield.filter((p) => canAttack(s, p)).length > 1) secondary = h('button', { class: 'gem small bronze', onClick: () => session.dispatch({ t: 'attackAll', target: ui.viewOpp }) }, 'Todos al ataque');
      } else if (s.step === 'block') {
        if (pending.length) help = `${pending.map((id) => player(s, id).name).join(', ')} está decidiendo bloqueos…`;
        else if (readyPend.length) help = `${readyPend.map((id) => player(s, id).name).join(', ')} puede usar trucos de combate…`;
        else help = 'Bloqueos decididos. Puedes lanzar un instantáneo (truco de combate) antes del daño.';
        primary = h('button', { class: 'gem', disabled: pending.length > 0 || readyPend.length > 0, onClick: () => session.dispatch({ t: 'next' }) }, 'Al daño');
      } else if (s.step === 'main2') {
        help = (lastCombat ? lastCombat + ' ' : '') + 'Fase principal 2. ' + manaHint(myP);
        primary = next('Pasar turno');
      } else {
        primary = next('Seguir');
      }
    } else if (s.step === 'block' && pending.includes(me())) {
      help = '¡Te atacan! Toca una criatura tuya enderezada para elegir a quién bloquea (puedes poner varias sobre un mismo atacante). Luego confirma.';
      primary = h('button', { class: 'gem ruby pulse', onClick: () => session.dispatch({ t: 'confirmBlocks' }) }, icon('shield'), 'Bloquear');
    } else if (readyPend.includes(me())) {
      help = 'Bloqueos hechos. ¿Usas algún truco de combate? Pon un instantáneo en el círculo, o sigue al daño.';
      primary = h('button', { class: 'gem', onClick: () => session.dispatch({ t: 'ready' }) }, 'Al daño');
    } else {
      help = `Turno de ${act.name}: ${STEP_INFO[s.step].name}. Puedes lanzar instantáneos poniéndolos en el círculo.`;
      if (lastCombat) help = lastCombat;
    }
    append(hud, [lifePlate, manaOrbs(myP), oracle(help), secondary, primary]);
  }

  function manaOrbs(p) {
    const m = manaAvailable(p);
    const orbs = ['W', 'U', 'B', 'R', 'G', 'C'].filter((c) => m[c]).map((c) => h('span', { class: 'orb orb-' + c }, m[c]));
    if (m.any) orbs.push(h('span', { class: 'orb orb-any' }, m.any));
    return h('div', { class: 'mana-orbs', title: 'Maná disponible: tierras sin girar + maná en tu reserva' },
      orbs.length ? orbs : h('span', { class: 'orb orb-none' }, '0'),
      m.pool ? h('span', { class: 'pool-tag' }, `${m.pool} en reserva`) : null);
  }

  function manaHint(p) {
    const m = manaAvailable(p);
    return `Tienes ${m.total} maná disponible${m.pool ? ` (${m.pool} ya en tu reserva)` : ''}: la app gira tus tierras al pagar, o tócalas para girarlas tú.` + (p.landsPlayed ? ' Ya jugaste tierra este turno.' : ' Aún puedes jugar una tierra.');
  }

  // ------------------------------------------------------------ eventos
  function processEvents(s) {
    const fresh = s.events.filter((e) => e.id > ui.lastEvent);
    if (!fresh.length) return;
    ui.lastEvent = fresh[fresh.length - 1].id;
    const cast = new Set();
    // Combate: primero las embestidas; las vidas y muertes se ven al impactar.
    const combatEv = fresh.find((e) => e.kind === 'combat' && e.hits);
    const lateBy = combatEv ? playCombat(s, combatEv) : 0;
    for (const e of fresh) {
      if (lateBy && e.kind === 'life' && e.uid) { setTimeout(() => lifeFx(e, false), lateBy); continue; }
      if (lateBy && e.kind === 'death' && e.uid) {
        const el = ui.els.get(e.uid);
        ui.els.delete(e.uid);
        if (el) deathGhost(el, ui.rects?.get(e.uid) || el.getBoundingClientRect(), lateBy);
        setTimeout(() => sfx('death'), lateBy);
        continue;
      }
      if (e.spell && spellVisual(s, e, cast)) continue;
      if (e.kind === 'play' && e.uid) {
        sfx(findPerm(s, e.uid)?.perm.card.isLand ? 'land' : 'play');
        const el = ui.els.get(e.uid);
        if (el) {
          el.classList.remove('enter');
          void el.offsetWidth;
          el.classList.add('enter');
          clearTimeout(el.__enterT);
          el.__enterT = setTimeout(() => el.classList.remove('enter'), 1100);
          setTimeout(() => burst(el, e.color, 22), 650);
          // las fichas reciben su imagen oficial
          const tk = findPerm(s, e.uid)?.perm.card;
          if (tk && tk.isToken && !tk.image) {
            tokenImage(tk).then((url) => { if (url && findPerm(S(), e.uid)) session.dispatch({ t: 'setImage', uid: e.uid, image: url }); });
          }
          // el personaje de la carta sale en 2,5D (criaturas y planeswalkers)
          const pc = findPerm(s, e.uid)?.perm.card;
          if (pc && (pc.isCreature || pc.isPlaneswalker) && !pc.isToken) {
            const big = pc.isLegendary || pc.rarity === 'mythic' || pc.rarity === 'm' || pc.cmc >= 6;
            setTimeout(() => hologram(fx, ui.els.get(e.uid), pc, { big }), 350);
          }
        }
      } else if (e.kind === 'cast') {
        sfx('cast');
        if (!e.card.isPermanent || e.by !== me()) spellFx(e.card, e.color);
      } else if (e.kind === 'resolve') {
        sfx('resolve');
      } else if (e.kind === 'fizzle') {
        sfx('warn');
        toast(e.text, 'warn', 4000);
      } else if (e.kind === 'start') {
        // (la tirada se muestra al montar la mesa)
      } else if (e.kind === 'mana') {
        const el = ui.els.get(e.uid);
        if (el) floatText(el, '+1 maná', 'gain');
      } else if (e.kind === 'emote') {
        showEmote(e);
      } else if (e.kind === 'death' && e.uid) {
        sfx('death');
        const el = ui.els.get(e.uid);
        if (el) {
          ui.els.delete(e.uid);
          deathGhost(el, ui.rects?.get(e.uid) || el.getBoundingClientRect());
        }
      } else if (e.kind === 'life') {
        lifeFx(e, !!e.uid);
      } else if (e.kind === 'turn') {
        sfx('turn');
        showBanner(e.player === me() ? 'Tu turno' : 'Turno de ' + player(s, e.player).name);
      } else if (e.kind === 'attack') {
        showBanner('¡Al ataque!');
        sfx('warcry');
        buzz(60);
        (e.uids || []).forEach((u, i) => setTimeout(() => warCry(ui.els.get(u), colorOf(s, u)), i * 90));
      } else if (e.kind === 'combat') {
        // (las embestidas se lanzan en playCombat)
        if (!e.hits) { sfx('explosion'); for (const u of e.uids || []) explode(ui.els.get(u), false, colorOf(s, u)); }
      } else if (e.kind === 'illegal' && e.to === me()) {
        illegalSheet(e);
      } else if (e.kind === 'out' || e.kind === 'win') {
        showBanner(e.kind === 'win' ? (e.player === me() ? '¡Victoria!' : 'Derrota') : 'Eliminado');
        toast(e.text, 'warn', 4000);
      } else if ((e.kind === 'manual' || e.kind === 'draw' || e.kind === 'info') && e.to === me()) {
        toast(e.text, 'info', 4500);
      } else if (e.kind === 'pump' || e.kind === 'hit') {
        sfx(e.kind === 'hit' ? 'hit' : 'resolve');
        const el = ui.els.get(e.uid);
        if (el) burst(el, e.kind === 'pump' ? 'G' : 'R', 12);
      }
    }
    for (const [uid, el] of ui.els) if (!findPerm(s, uid)) { el.remove(); ui.els.delete(uid); }
  }

  function lifeFx(e, boom) {
    const gem = document.querySelector(`[data-life="${e.target}"]`);
    floatText(gem, (e.delta > 0 ? '+' : '') + e.delta, e.delta > 0 ? 'gain' : 'loss');
    if (boom && e.delta < 0) explode(gem, true, 'R');
    sfx(e.delta > 0 ? 'gain' : 'loss');
    if (e.delta < 0 && e.target === me()) { screen.classList.add('hurt'); buzz(120); setTimeout(() => screen.classList.remove('hurt'), 500); }
  }

  /** Rect actual (o el último conocido) de una carta del campo. */
  function rectOf(uid) {
    const el = ui.els.get(uid);
    if (el && el.isConnected) { const r = el.getBoundingClientRect(); if (r.width) return r; }
    return ui.rects?.get(uid) || null;
  }

  /**
   * Embestidas del combate: cada criatura que golpea carga contra su objetivo
   * (bloqueador o jugador). Devuelve los ms hasta el último impacto.
   */
  function playCombat(s, ev) {
    const order = [];
    for (const hit of ev.hits) if (!order.includes(hit.src) && (ev.uids || []).includes(hit.src)) order.push(hit.src);
    let last = 0;
    let first = true;
    duckMusic(1800);
    for (const hit of ev.hits) {
      const srcEl = ui.els.get(hit.src);
      const cardEl = srcEl ? srcEl.querySelector('.card') : null;
      const from = rectOf(hit.src);
      // los bloqueadores contraatacan a la vez que su atacante
      const att = (ev.uids || []).includes(hit.src) ? hit.src : hit.to;
      const slot = Math.max(0, order.indexOf(att));
      const delay = slot * 260 + ((ev.uids || []).includes(hit.src) ? 0 : 90);
      const playerTarget = hit.player != null;
      const toEl = playerTarget ? document.querySelector(`[data-life="${hit.player}"]`) : null;
      const to = playerTarget ? (toEl && toEl.getBoundingClientRect()) : rectOf(hit.to);
      const color = (findPerm(s, hit.src)?.perm.card.colors[0]) || (srcEl && srcEl.dataset.color) || 'R';
      const isFirst = first;
      first = false;
      const at = strike(fx, cardEl, from, to, color, () => {
        impactFlash(fx, playerTarget && toEl ? toEl.getBoundingClientRect() : to, color, playerTarget);
        if (!playerTarget) damageNumber(fx, to, hit.amt);
        if (isFirst) { sfx('explosion'); buzz(150); } else sfx('hit');
        screen.classList.remove('quake');
        void screen.offsetWidth;
        screen.classList.add('quake');
        setTimeout(() => screen.classList.remove('quake'), 450);
        const tEl = playerTarget ? toEl : ui.els.get(hit.to);
        if (tEl && tEl.isConnected) { tEl.classList.remove('shake'); void tEl.offsetWidth; tEl.classList.add('shake'); setTimeout(() => tEl.classList.remove('shake'), 600); }
      }, { delay });
      last = Math.max(last, at);
    }
    return last + 30;
  }

  function colorOf(s, uid) {
    const f = findPerm(s, uid);
    return (f && f.perm.card.colors[0]) || 'R';
  }

  function deathGhost(el, r, wait = 0) {
    if (!r || !r.width) return;
    const ghost = el.cloneNode(true);
    const tapped = el.classList.contains('tapped');
    ghost.className = 'perm ghost' + (tapped ? ' tapped' : '') + (wait ? ' hold' : '');
    // la carta girada ocupa su ancho en horizontal: el rect es el de la carta girada
    const w = tapped ? r.height : r.width;
    Object.assign(ghost.style, { left: r.left + (r.width - w) / 2 + 'px', top: r.top + (r.height - (tapped ? r.width : r.height)) / 2 + 'px', width: w + 'px', margin: 0 });
    ghost.style.setProperty('--card-w', w + 'px');
    fx.append(ghost);
    if (wait) setTimeout(() => ghost.classList.remove('hold'), wait);
    setTimeout(() => ghost.remove(), wait + 950);
  }

  /**
   * Efecto de un hechizo: su magia (según el color) vuela hasta el objetivo y,
   * al impactar, se ve el resultado. Devuelve true si se ha encargado del evento.
   */
  function spellVisual(s, e, cast) {
    const kinds = ['hit', 'pump', 'life', 'death'];
    if (!kinds.includes(e.kind)) return false;
    const colors = e.spell.colors;
    const main = colors[0];
    let target = null;
    if (e.kind === 'life') target = document.querySelector(`[data-life="${e.target}"]`);
    else target = ui.els.get(e.uid);
    if (!target) return false;
    const from = (e.spell.src != null && ui.els.get(e.spell.src))
      || (e.spell.by === me() ? summon : topbar.querySelector(`[data-player="${e.spell.by}"]`));
    const key = e.kind + ':' + (e.uid ?? e.target);
    if (!cast.has('snd')) { magicSound(main, 'cast'); duckMusic(1100); cast.add('snd'); }
    cast.add(key);
    let ghostRect = null;
    if (e.kind === 'death') {
      ui.els.delete(e.uid);
      ghostRect = target.getBoundingClientRect();
    }
    castMagic(fx, colors, from, target, () => {
      magicSound(main, 'impact');
      if (e.kind === 'life') {
        const lifeEl = document.querySelector(`[data-life="${e.target}"]`);
        floatText(lifeEl, (e.delta > 0 ? '+' : '') + e.delta, e.delta > 0 ? 'gain' : 'loss');
        if (e.delta < 0 && e.target === me()) { screen.classList.add('hurt'); buzz(120); setTimeout(() => screen.classList.remove('hurt'), 500); }
        if (lifeEl) { lifeEl.classList.remove('shake'); void lifeEl.offsetWidth; lifeEl.classList.add('shake'); setTimeout(() => lifeEl.classList.remove('shake'), 600); }
      } else if (e.kind === 'death') {
        sfx('death');
        deathGhost(target, ghostRect);
      } else {
        const el = ui.els.get(e.uid);
        if (el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); setTimeout(() => el.classList.remove('shake'), 600); }
      }
    });
    return true;
  }

  /** Explosión de impacto (destello, onda expansiva y chispas). */
  function explode(target, big = false, color = 'R') {
    if (!target || !target.isConnected) return;
    const r = target.getBoundingClientRect();
    const sr = screen.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * (big ? 1.6 : 1.3);
    const boom = h('div', { class: 'boom', style: { left: r.left - sr.left + r.width / 2 + 'px', top: r.top - sr.top + r.height / 2 + 'px', width: size + 'px', height: size + 'px' } },
      h('i', { class: 'flash' }), h('i', { class: 'ring' }));
    fx.append(boom);
    burst(target, color, big ? 30 : 20);
    setTimeout(() => burst(target, 'C', 12), 80);
    target.classList.remove('shake');
    void target.offsetWidth;
    target.classList.add('shake');
    setTimeout(() => { boom.remove(); target.classList.remove('shake'); }, 900);
  }

  function showBanner(text) {
    banner.textContent = text;
    banner.classList.remove('show');
    void banner.offsetWidth;
    banner.classList.add('show');
  }

  function spellFx(card, color) {
    const el = h('div', { class: 'spell-fx' }, cardFace(card, { big: true }));
    fx.append(el);
    setTimeout(() => burst(el, color, 30), 700);
    setTimeout(() => el.remove(), 1600);
  }

  // ------------------------------------------------------- interacciones
  function onPermTap(uid) {
    const s = S();
    const f = findPerm(s, uid);
    if (!f) return;
    const { perm, owner } = f;
    const want = currentWant();
    if (want) {
      if (want.target === 'spell') toast('Este hechizo tiene que apuntar a un hechizo de la pila.', 'warn');
      else if (perm.card.isCreature) pickTarget({ uid });
      else toast('Ese objetivo no vale: tiene que ser una criatura.', 'warn');
      return;
    }
    if (s.step === 'attack' && activePlayer(s).id === me() && owner.id === me() && perm.card.isCreature) {
      buzz(15);
      const pws = (player(s, ui.viewOpp)?.battlefield || []).filter((x) => /Planeswalker/.test(x.card.typeLine));
      if (pws.length && s.combat.attackers[uid] == null && canAttack(s, perm)) {
        // ¿Al jugador o a uno de sus planeswalkers? (regla 506.1)
        let close;
        close = sheet(h('div', {}, h('h3', {}, `¿A quién ataca ${displayName(perm.card)}?`),
          h('div', { class: 'choice-list' },
            h('button', { class: 'choice', onClick: () => { close(); session.dispatch({ t: 'attack', uid, target: ui.viewOpp }); } }, icon('person'), h('span', {}, player(s, ui.viewOpp).name + ' (jugador)')),
            pws.map((pw) => h('button', { class: 'choice', onClick: () => { close(); session.dispatch({ t: 'attack', uid, target: 'pw:' + pw.uid }); } },
              cardFace(pw.card), h('span', {}, `${displayName(pw.card)} — lealtad ${pw.loyalty}`))))));
        return;
      }
      session.dispatch({ t: 'attack', uid, target: ui.viewOpp });
      return;
    }
    if (s.step === 'block' && owner.id === me() && perm.card.isCreature && pendingDefenders(s).includes(me())) {
      blockSheet(perm);
      return;
    }
    // Un toque en una tierra tuya la gira (su maná va a tu reserva) o la endereza.
    if (owner.id === me() && perm.card.isLand) {
      buzz(15);
      sfx('click');
      session.dispatch({ t: 'tap', uid });
      return;
    }
    permSheet(perm, owner);
  }

  function blockSheet(perm) {
    const s = S();
    const attackers = Object.entries(s.combat.attackers).filter(([, t]) => t === me()).map(([u]) => findPerm(s, +u)?.perm).filter(Boolean);
    let close;
    close = sheet(h('div', {},
      h('h3', {}, `¿A quién bloquea ${displayName(perm.card)} (${power(perm)}/${toughness(perm)})?`),
      h('div', { class: 'choice-list' },
        attackers.map((a) => h('button', { class: 'choice', onClick: () => { close(); session.dispatch({ t: 'block', uid: perm.uid, attacker: a.uid }); } },
          cardFace(a.card), h('span', {}, `${displayName(a.card)} — ${power(a)}/${toughness(a)}`))),
        h('button', { class: 'act', onClick: () => { close(); session.dispatch({ t: 'block', uid: perm.uid, attacker: null }); } }, 'No bloquear'),
      ),
    ));
  }

  function permSheet(perm, owner) {
    const mine = owner.id === me();
    let close;
    const act = (a) => () => { close(); session.dispatch(a); };
    const btn = (label, a, cls = '') => h('button', { class: 'act ' + cls, onClick: act(a) }, label);
    close = sheet(cardInfo(perm.card, [
      h('p', { class: 'muted' }, mine ? 'Tu permanente.' : `Permanente de ${owner.name}. Usa estos botones cuando un hechizo tuyo le afecte.`),
      perm.card.isCreature ? h('div', { class: 'dmg-row' }, 'Hacer daño:', [1, 2, 3, 4, 5].map((n) => btn(n, { t: 'damage', uid: perm.uid, amount: n }))) : null,
      perm.loyalty != null ? h('div', { class: 'dmg-row' }, `Lealtad ${perm.loyalty}:`, [-3, -2, -1, 1, 2].map((n) => btn((n > 0 ? '+' : '') + n, { t: 'loyalty', uid: perm.uid, delta: n }))) : null,
      h('div', { class: 'actions' },
        mine && !perm.card.isToken ? h('button', { class: 'act', onClick: () => { close(); openEditionPicker(perm.card, (ed) => session.dispatch({ t: 'setImage', uid: perm.uid, image: ed.image })); } }, 'Cambiar edición') : null,
        btn(perm.tapped ? 'Enderezar' : 'Girar', { t: 'tap', uid: perm.uid }),
        perm.card.isCreature ? [
          btn('+3/+3 hasta fin de turno', { t: 'pump', uid: perm.uid, p: 3, t: 3 }),
          btn('Contador +1/+1', { t: 'counter', uid: perm.uid, delta: 1 }),
          btn('Contador −1/−1', { t: 'counter', uid: perm.uid, delta: -1 }),
        ] : null,
        btn('Destruir', { t: 'move', uid: perm.uid, to: 'graveyard' }, 'danger'),
        btn('Exiliar', { t: 'move', uid: perm.uid, to: 'exile' }),
        btn('Devolver a la mano', { t: 'move', uid: perm.uid, to: 'hand' }),
      ),
    ]));
  }

  function playerSheet(p) {
    const s = S();
    let close;
    const d = (a) => () => session.dispatch(a);
    const b = (label, a) => h('button', { class: 'act', onClick: d(a) }, label);
    close = sheet(h('div', {},
      h('h3', {}, 'Vidas de ' + p.name),
      h('div', { class: 'life-ctl' },
        b('−5', { t: 'life', target: p.id, delta: -5 }), b('−1', { t: 'life', target: p.id, delta: -1 }),
        h('span', { class: 'life-big' }, '♥'),
        b('+1', { t: 'life', target: p.id, delta: 1 }), b('+5', { t: 'life', target: p.id, delta: 5 }),
      ),
      h('div', { class: 'life-ctl small' }, h('span', {}, 'Contadores de veneno'), b('−', { t: 'poison', target: p.id, delta: -1 }), b('+', { t: 'poison', target: p.id, delta: 1 })),
      s.mode === 'commander' ? h('div', {}, h('h4', {}, 'Daño de comandante recibido'),
        s.players.filter((o) => o.id !== p.id).map((o) => h('div', { class: 'life-ctl small' },
          h('span', {}, `${o.name}: ${p.cmdDamage[o.id] || 0}/21`),
          b('−', { t: 'cmdDamage', target: p.id, from: o.id, delta: -1 }), b('+', { t: 'cmdDamage', target: p.id, from: o.id, delta: 1 })))) : null,
      h('p', { class: 'muted' }, 'Ajusta las vidas cuando un hechizo haga daño directo a un jugador o te haga ganar vidas.'),
      h('button', { class: 'act primary', onClick: () => close() }, 'Hecho'),
    ));
  }

  function showZone(p, zone) {
    const cards = p[zone];
    sheet(h('div', {},
      h('h3', {}, `${zone === 'graveyard' ? 'Cementerio' : 'Exilio'} de ${p.name} (${cards.length})`),
      cards.length ? h('p', { class: 'muted' }, 'Toca una carta para leer su descripción.') : null,
      cards.length ? h('div', { class: 'zone-grid' }, [...cards].reverse().map((c) => h('button', { class: 'zone-card', onClick: () => sheet(cardInfo(c)) }, cardFace(c, { big: true }))))
        : h('p', { class: 'muted' }, zone === 'graveyard' ? 'Aquí van las criaturas que mueren y los hechizos ya usados.' : 'Aquí van las cartas exiliadas: quedan fuera de la partida.'),
    ));
  }

  function commandAction(p) {
    if (p.id !== me()) {
      if (p.commander) sheet(cardInfo(p.commander, h('p', { class: 'muted' }, `Comandante de ${p.name}.`)));
      return;
    }
    if (!p.commander) {
      let close;
      close = sheet(h('div', {},
        h('h3', {}, 'Elige tu comandante'),
        h('p', {}, 'Pon tu comandante en el círculo de invocación y la cámara lo reconocerá.'),
        h('div', { class: 'row-btns' },
          h('button', { class: 'act primary', onClick: () => { close(); ui.awaitingCommander = true; watcher.forget(); toast('Pon tu comandante en el círculo…'); } }, 'Usar la cámara'),
          h('button', { class: 'act', onClick: () => { close(); openPicker((card) => session.dispatch({ t: 'setCommander', card }), {
            title: 'Elige tu comandante', confirmLabel: 'Este es mi comandante', showLands: false,
            filter: (c) => ((c.isLegendary && c.isCreature) || /can be your commander/i.test(c.oracle) ? null : 'Tu comandante debe ser una criatura legendaria.'),
          }); } }, 'Buscar en el grimorio'),
        ),
      ));
      return;
    }
    if (!p.commanderInZone) { toast('Tu comandante ya está en el campo de batalla.'); return; }
    let close;
    close = sheet(cardInfo(p.commander, [
      h('p', {}, `Coste: ${p.commander.manaCost}${p.commanderTax ? ` + ${p.commanderTax} de impuesto de comandante` : ''}.`),
      h('button', { class: 'act primary', onClick: () => { close(); session.dispatch({ t: 'castCommander' }); } }, 'Lanzar comandante'),
    ]));
  }

  function illegalSheet(e) {
    if (ui.illegalOpen) return; // nunca más de un aviso a la vez
    ui.illegalOpen = true;
    let close;
    close = sheet(h('div', { class: 'illegal' },
      h('h3', {}, 'Un momento, aprendiz…'),
      h('p', {}, e.text),
      h('div', { class: 'row-btns' },
        h('button', { class: 'act primary', onClick: () => close() }, 'Entendido'),
      ),
    ), { onClose: () => { ui.illegalOpen = false; } });
  }

  function playCard() {
    openPicker((card) => playRecognized(card));
  }

  // ------------------------------------------------------------ menús
  function openMenu() {
    let close;
    const st = ui.settings;
    const slider = (label, key, min, max, step) => h('label', { class: 'slider' }, h('span', {}, label),
      h('input', { type: 'range', min, max, step, value: st[key], onInput: (e) => { st[key] = +e.target.value; saveSettings(st); mat.style.setProperty('--tilt', st.tilt + 'deg'); mat.style.setProperty('--zoom', st.zoom); } }));
    close = sheet(h('div', {},
      h('h3', {}, 'Ajustes de la mesa'),
      h('button', { class: 'act primary', onClick: () => { close(); calibrateTable(); } }, 'Ajustar áreas de la mesa (con la cámara)'),
      slider('Inclinación', 'tilt', 0, 45, 1),
      slider('Tamaño', 'zoom', 0.7, 1.15, 0.05),
      h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: st.camera, onChange: (e) => { st.camera = e.target.checked; saveSettings(st); applySettings(); } }), 'Usar la cámara'),
      h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: soundOn(), onChange: (e) => setSound(e.target.checked) }), 'Efectos de sonido'),
      h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: musicOn(), onChange: (e) => setMusic(e.target.checked) }), 'Música de fondo'),
      h('label', { class: 'slider' }, h('span', {}, 'Volumen música'), h('input', { type: 'range', min: 0.05, max: 1, step: 0.05, value: musicVolume(), onInput: (e) => setMusicVolume(+e.target.value) })),
      h('div', { class: 'actions' },
        h('button', { class: 'act', onClick: () => { close(); openLog(); } }, 'Crónica de la partida'),
        h('button', { class: 'act', onClick: () => { close(); playCard(); } }, 'Grimorio'),
        h('button', { class: 'act danger', onClick: () => { close(); if (confirm('¿Rendirte?')) session.dispatch({ t: 'concede' }); } }, 'Rendirse'),
        h('button', { class: 'act', onClick: () => { close(); exit(); } }, 'Salir al menú'),
      ),
    ));
  }

  function openLog() {
    sheet(h('div', { class: 'log' }, h('h3', {}, 'Crónica de la partida'), h('ol', {}, [...S().log].reverse().slice(0, 80).map((l) => h('li', {}, l)))));
  }

  function exit() {
    unsub();
    watcher.stop();
    stopCamera();
    session.close();
    onExit && onExit();
  }

  const unsub = session.subscribe(render);
  render(S());
  // Al empezar la partida: quién empieza (tirada de dado) y ayuda para el mulligan.
  if (showIntro && S().turn === 1 && !S().log.some((l) => l.startsWith('Turno 2'))) {
    ui.holdVision = true;
    watcher.pause(true);
    setTimeout(() => intro(S()), 500);
  }
  session.scheduleBots();

  return {
    screen,
    session,
    watcher,
    render: () => render(S()),
    onRender(fn) { ui.hooks.add(fn); return () => ui.hooks.delete(fn); },
    exit,
  };
}
