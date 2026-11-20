// La mesa: cámara a pantalla completa, tablero holográfico encima y el círculo
// de invocación, donde la cámara reconoce sola las cartas que pones.

import { h, clear, append, sheet, toast, burst, floatText } from './dom.js';
import { cardFace, cardInfo } from './cardview.js';
import { icon } from './icons.js';
import { openPicker } from './picker.js';
import { startCamera, stopCamera, cameraSupported } from '../camera.js';
import { CardWatcher } from '../vision.js';
import { targetsFor, describeEffect } from '../engine/effects.js';
import { buzz, keepAwake } from '../native.js';
import {
  STEPS, STEP_INFO, activePlayer, player, opponents, pendingDefenders, findPerm,
  power, toughness, displayName, canAttack, manaSources, planPayment,
} from '../engine/game.js';

const SETTINGS_KEY = 'mtgvr-settings-2';
const DEFAULTS = { tilt: 18, zoom: 1, camera: true };
function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}
function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* */ }
}

const PHASE_RUNES = [
  { label: 'I', steps: ['untap', 'upkeep', 'draw'] },
  { label: 'II', steps: ['main1'] },
  { label: '⚔', steps: ['attack', 'block', 'damage'] },
  { label: 'III', steps: ['main2'] },
  { label: '☾', steps: ['end'] },
];

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

export function mountTable(root, session, { onExit } = {}) {
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
      summonStatus,
      h('button', { class: 'rune-btn', title: 'Grimorio (buscar a mano)', 'data-action': 'play', onClick: () => playCard() }, icon('grimoire')),
    ),
  );
  const hud = h('footer', { class: 'hud' });
  const fx = h('div', { class: 'fx-layer' });
  const banner = h('div', { class: 'banner' });
  const targetBar = h('div', { class: 'target-bar parchment', hidden: true });
  const screen = h('div', { class: 'table-screen' }, video, h('div', { class: 'cam-shade' }), topbar, board, summon, hud, banner, targetBar, fx);
  clear(root).append(screen);

  // --------------------------------------------------------- cámara + ojo
  const watcher = new CardWatcher(video, {
    getRegion: () => {
      const v = video.getBoundingClientRect();
      const r = summonWrap.getBoundingClientRect();
      return { x: (r.left - v.left) / v.width, y: (r.top - v.top) / v.height, w: r.width / v.width, h: r.height / v.height };
    },
    onState: ({ phase, text }) => {
      summon.dataset.phase = phase;
      summonStatus.textContent = text;
    },
    onCard: (card) => onCardSeen(card),
  });

  const applySettings = () => {
    mat.style.setProperty('--tilt', ui.settings.tilt + 'deg');
    mat.style.setProperty('--zoom', ui.settings.zoom);
    const useCam = ui.settings.camera && cameraSupported();
    screen.classList.toggle('no-cam', !useCam);
    if (useCam) {
      startCamera(video)
        .then(() => { watcher.pause(false); watcher.start(); })
        .catch(() => {
          screen.classList.add('no-cam');
          summon.dataset.phase = 'error';
          summonStatus.textContent = 'Sin cámara: usa el grimorio';
        });
    } else {
      watcher.pause(true);
      video.srcObject = null;
      summon.dataset.phase = 'error';
      summonStatus.textContent = 'Cámara apagada: usa el grimorio';
    }
  };
  applySettings();
  keepAwake();

  function onCardSeen(card) {
    buzz(40);
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
    if (!fast && !(myTurn && main)) return false;
    return card.isLand || !!planPayment(player(s, me()), card.manaCost);
  }

  function playRecognized(card) {
    const wanted = targetsFor(card);
    if (wanted.length && canPlayNow(card)) {
      startTargeting(card, wanted, (targets) => dispatchPlay(card, targets));
      return;
    }
    dispatchPlay(card, []);
  }

  function dispatchPlay(card, targets) {
    const before = S().eventSeq;
    session.dispatch({ t: 'play', card, targets });
    // Aviso con opción de deshacer por si la cámara leyó mal.
    setTimeout(() => {
      const ev = S().events.filter((e) => e.id > before);
      if (!ev.length || ev.some((e) => e.kind === 'illegal')) return;
      const box = h('div', { class: 'summon-toast' },
        h('span', {}, 'Invocado: ', h('b', {}, displayName(card))),
        h('button', { class: 'gem small bronze', onClick: () => { session.dispatch({ t: 'undo' }); watcher.forget(); box.remove(); } }, icon('undo'), 'Deshacer'),
      );
      screen.append(box);
      setTimeout(() => box.classList.add('out'), 4200);
      setTimeout(() => box.remove(), 4700);
      const fx = card.isPermanent ? card.effects?.etb : card.effects?.spell;
      if (!card.isPermanent && !fx?.length) toast('Esta carta no se aplica sola: toca la criatura objetivo (daño, +X/+X, destruir…) o ajusta las vidas.', 'info', 5000);
    }, 60);
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
    const players = want.target === 'creature' ? [] : s.players.filter((p) => !p.eliminated);
    targetBar.hidden = false;
    clear(targetBar).append(
      h('div', { class: 'tb-title' }, displayName(t.card), ': ', describeEffect(want)),
      h('div', { class: 'tb-hint' }, want.target === 'creature' ? 'Toca la criatura objetivo en el tablero.' : want.target === 'player' ? 'Elige el jugador objetivo.' : 'Toca una criatura o elige un jugador.'),
      h('div', { class: 'row-btns' },
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
    const myP = player(s, me());
    const opps = s.players.filter((p) => p.id !== me());
    if (!ui.viewOpp || !opps.find((p) => p.id === ui.viewOpp && !p.eliminated)) {
      ui.viewOpp = (opps.find((p) => !p.eliminated) || opps[0])?.id;
    }
    renderTop(s, opps);
    renderSide(oppRow, s, player(s, ui.viewOpp), 'opp');
    renderSide(meRow, s, myP, 'me');
    const act = activePlayer(s);
    clear(divider).append(
      h('span', { class: act.id === me() ? 'mine' : '' }, act.id === me() ? 'Tu turno' : 'Turno de ' + act.name),
      h('span', {}, STEP_INFO[s.step].name),
    );
    renderHud(s, myP);
    processEvents(s);
    for (const fn of ui.hooks) fn(s);
  }

  function renderTop(s, opps) {
    const stepIdx = STEPS.indexOf(s.step);
    clear(topbar).append(
      h('div', { class: 'foes' },
        opps.map((p) => h('button', {
          class: 'foe' + (p.id === ui.viewOpp ? ' on' : '') + (p.eliminated ? ' out' : ''),
          onClick: () => { ui.viewOpp = p.id; render(S()); },
        },
        h('span', { class: 'portrait' }, icon(p.isBot ? 'golem' : 'person')),
        h('span', {},
          h('div', { class: 'foe-name' }, p.name),
          h('div', { class: 'foe-meta' }, p.isBot ? `${p.hand.length} en mano · ${p.library.length} en mazo` : (activePlayer(s).id === p.id ? 'jugando…' : 'esperando')),
        ),
        activePlayer(s).id === p.id ? h('span', { class: 'turn-dot' }) : null,
        h('span', { class: 'life-gem', 'data-life': p.id }, p.life),
        )),
      ),
      h('div', { class: 'phase-runes', title: 'Fases del turno' },
        PHASE_RUNES.map((r) => {
          const idxs = r.steps.map((x) => STEPS.indexOf(x));
          const on = r.steps.includes(s.step);
          const done = Math.max(...idxs) < stepIdx;
          return h('span', { class: 'rune' + (on ? ' on' : '') + (done ? ' done' : '') }, r.label);
        }),
        h('span', { class: 'phase-name' }, STEP_INFO[s.step].name),
      ),
      h('div', { class: 'top-actions' },
        h('button', { class: 'rune-btn', title: 'Crónica', onClick: openLog }, icon('scroll')),
        h('button', { class: 'rune-btn', title: 'Menú', onClick: openMenu }, icon('gear')),
      ),
    );
  }

  function renderSide(el, s, p, side) {
    clear(el);
    if (!p) return;
    const creatures = p.battlefield.filter((x) => x.card.isCreature || /Planeswalker/.test(x.card.typeLine));
    const support = p.battlefield.filter((x) => !creatures.includes(x));
    const lands = support.filter((x) => x.card.isLand);
    const others = support.filter((x) => !x.card.isLand);

    const zone = (cls, label, content, onClick) => h('button', { class: 'zone ' + cls, 'data-zone': cls, onClick }, h('span', { class: 'zl' }, label), content);
    const topGrave = p.graveyard[p.graveyard.length - 1];
    const zones = h('div', { class: 'zones' },
      zone('library', 'Mazo', h('span', { class: 'n' }, p.isBot ? p.library.length : '∞'), () => toast('Biblioteca: el mazo, boca abajo. Se roba de aquí.')),
      zone('graveyard', 'Cement.', [topGrave ? cardFace(topGrave) : null, h('span', { class: 'n' }, p.graveyard.length)], () => showZone(p, 'graveyard')),
      zone('exile', 'Exilio', h('span', { class: 'n' }, p.exile.length), () => showZone(p, 'exile')),
      s.mode === 'commander' ? zone('command', 'Mando', commandZone(p), () => commandAction(p)) : null,
    );

    const rowC = h('div', { class: 'row creatures', 'data-zone': 'battlefield' }, creatures.map((x) => permEl(s, x, p)));
    const rowL = h('div', { class: 'row lands', 'data-zone': 'lands' }, others.map((x) => permEl(s, x, p)), lands.map((x) => permEl(s, x, p)));
    if (!creatures.length) rowC.append(h('div', { class: 'hint' }, side === 'me' ? 'Tus criaturas' : 'Criaturas rivales'));
    if (!support.length) rowL.append(h('div', { class: 'hint' }, side === 'me' ? 'Tus tierras' : 'Tierras rivales'));
    const battle = h('div', { class: 'battle' }, ...(side === 'opp' ? [rowL, rowC] : [rowC, rowL]));
    el.append(zones, battle);
    el.classList.toggle('eliminated', p.eliminated);
  }

  function commandZone(p) {
    if (!p.commander) return h('span', { class: 'n' }, p.id === me() ? '+' : '—');
    if (!p.commanderInZone) return h('span', { class: 'n' }, '⚔');
    return [cardFace(p.commander), p.commanderTax ? h('span', { class: 'n' }, '+' + p.commanderTax) : null];
  }

  function permEl(s, perm, owner) {
    let el = ui.els.get(perm.uid);
    if (!el) {
      el = h('div', { class: 'perm', 'data-uid': perm.uid }, cardFace(perm.card), h('div', { class: 'badges' }));
      el.addEventListener('click', (e) => { e.stopPropagation(); onPermTap(perm.uid); });
      ui.els.set(perm.uid, el);
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
    const lifePlate = h('div', { class: 'me-plate' },
      h('button', { class: 'pm', onClick: () => session.dispatch({ t: 'life', target: me(), delta: -1 }) }, '−'),
      h('button', { class: 'life-gem', 'data-life': me(), onClick: () => playerSheet(myP) }, myP.life),
      h('button', { class: 'pm', onClick: () => session.dispatch({ t: 'life', target: me(), delta: 1 }) }, '+'),
    );
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
    let help = STEP_INFO[s.step].help;
    let primary = null;
    const next = (label, cls = '') => h('button', { class: 'gem ' + cls, 'data-action': 'next', onClick: () => session.dispatch({ t: 'next' }) }, label);

    if (myP.eliminated) {
      help = 'Has sido eliminado. Puedes seguir mirando la partida.';
    } else if (myTurn) {
      if (s.step === 'attack') {
        const n = Object.keys(s.combat.attackers).length;
        help = n ? `Atacas con ${n}. Toca otra criatura para añadirla o quitarla.` : 'Toca las criaturas que brillan para atacar' + (opponents(s, me()).length > 1 ? ` a ${player(s, ui.viewOpp).name} (elige el rival arriba).` : '.');
        primary = next(n ? `⚔ Atacar (${n})` : 'No atacar', n ? 'ruby pulse' : '');
      } else if (s.step === 'block') {
        help = pending.length ? `${pending.map((id) => player(s, id).name).join(', ')} está decidiendo bloqueos…` : 'Bloqueos decididos.';
        primary = h('button', { class: 'gem', disabled: pending.length > 0, onClick: () => session.dispatch({ t: 'next' }) }, 'Seguir');
      } else {
        if (s.step === 'main1' || s.step === 'main2') help = 'Pon cartas en el círculo para jugarlas. ' + manaHint(myP);
        if (s.step === 'damage' && s.combat.result) help = s.combat.result.join(' ');
        primary = next(s.step === 'end' ? 'Pasar turno' : 'Siguiente fase');
      }
    } else if (s.step === 'block' && pending.includes(me())) {
      help = '¡Te atacan! Toca una criatura tuya enderezada para elegir a quién bloquea. Luego confirma.';
      primary = h('button', { class: 'gem ruby pulse', onClick: () => session.dispatch({ t: 'confirmBlocks' }) }, icon('shield'), 'Bloquear');
    } else {
      help = `Turno de ${act.name}: ${STEP_INFO[s.step].name}. Puedes lanzar instantáneos poniéndolos en el círculo.`;
      if (s.step === 'damage' && s.combat.result) help = s.combat.result.join(' ');
    }
    append(hud, [lifePlate, oracle(help), primary]);
  }

  function manaHint(p) {
    const n = manaSources(p).length;
    return `Tienes ${n} maná disponible.` + (p.landsPlayed ? ' Ya jugaste tierra este turno.' : ' Aún puedes jugar una tierra.');
  }

  // ------------------------------------------------------------ eventos
  function processEvents(s) {
    const fresh = s.events.filter((e) => e.id > ui.lastEvent);
    if (!fresh.length) return;
    ui.lastEvent = fresh[fresh.length - 1].id;
    for (const e of fresh) {
      if (e.kind === 'play' && e.uid) {
        const el = ui.els.get(e.uid);
        if (el) {
          el.classList.remove('enter');
          void el.offsetWidth;
          el.classList.add('enter');
          setTimeout(() => burst(el, e.color, 22), 650);
        }
      } else if (e.kind === 'spell') {
        spellFx(e.card, e.color);
      } else if (e.kind === 'death' && e.uid) {
        const el = ui.els.get(e.uid);
        if (el) {
          ui.els.delete(e.uid);
          const r = el.getBoundingClientRect();
          if (r.width) {
            const ghost = el.cloneNode(true);
            ghost.className = 'perm ghost';
            Object.assign(ghost.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px' });
            ghost.style.setProperty('--card-w', r.width + 'px');
            fx.append(ghost);
            setTimeout(() => ghost.remove(), 950);
          }
        }
      } else if (e.kind === 'life') {
        floatText(document.querySelector(`[data-life="${e.target}"]`), (e.delta > 0 ? '+' : '') + e.delta, e.delta > 0 ? 'gain' : 'loss');
        if (e.delta < 0 && e.target === me()) { screen.classList.add('hurt'); buzz(120); setTimeout(() => screen.classList.remove('hurt'), 500); }
      } else if (e.kind === 'turn') {
        showBanner(e.player === me() ? 'Tu turno' : 'Turno de ' + player(s, e.player).name);
      } else if (e.kind === 'attack') {
        showBanner('¡Al ataque!');
        buzz(60);
      } else if (e.kind === 'illegal' && e.to === me()) {
        illegalSheet(e);
        watcher.forget();
      } else if (e.kind === 'out' || e.kind === 'win') {
        showBanner(e.kind === 'win' ? (e.player === me() ? '¡Victoria!' : 'Derrota') : 'Eliminado');
        toast(e.text, 'warn', 4000);
      } else if ((e.kind === 'manual' || e.kind === 'draw' || e.kind === 'info') && e.to === me()) {
        toast(e.text, 'info', 4500);
      } else if (e.kind === 'pump' || e.kind === 'hit') {
        const el = ui.els.get(e.uid);
        if (el) burst(el, e.kind === 'pump' ? 'G' : 'R', 12);
      }
    }
    for (const [uid, el] of ui.els) if (!findPerm(s, uid)) { el.remove(); ui.els.delete(uid); }
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
      if (perm.card.isCreature) pickTarget({ uid });
      else toast('Ese objetivo no vale: tiene que ser una criatura.', 'warn');
      return;
    }
    if (s.step === 'attack' && activePlayer(s).id === me() && owner.id === me() && perm.card.isCreature) {
      buzz(15);
      session.dispatch({ t: 'attack', uid, target: ui.viewOpp });
      return;
    }
    if (s.step === 'block' && owner.id === me() && perm.card.isCreature && pendingDefenders(s).includes(me())) {
      blockSheet(perm);
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
      h('div', { class: 'actions' },
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
      cards.length ? h('div', { class: 'zone-grid' }, [...cards].reverse().map((c) => cardFace(c, { big: true })))
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
    let close;
    close = sheet(h('div', { class: 'illegal' },
      h('h3', {}, 'Un momento, aprendiz…'),
      h('p', {}, e.text),
      h('div', { class: 'row-btns' },
        h('button', { class: 'act primary', onClick: () => close() }, 'Entendido'),
        e.action ? h('button', { class: 'act', onClick: () => { close(); session.dispatch({ ...e.action, force: true }); } }, 'Hacerlo igualmente') : null,
      ),
    ));
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
      h('p', { class: 'muted' }, 'Inclina el tablero holográfico para que encaje con tu mesa.'),
      slider('Inclinación', 'tilt', 0, 45, 1),
      slider('Tamaño', 'zoom', 0.7, 1.15, 0.05),
      h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: st.camera, onChange: (e) => { st.camera = e.target.checked; saveSettings(st); applySettings(); } }), 'Usar la cámara'),
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
