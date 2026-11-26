// Punto de entrada: portada, menú, preparación de partidas y salas online.

import './styles.css';
import { h, clear, toast } from './ui/dom.js';
import { icon } from './ui/icons.js';
import { mountTable, RUNE_RING, needsCalibration } from './ui/table.js';
import { startTutorial } from './ui/tutorial.js';
import { RULES, KEYWORDS } from './ui/learn.js';
import { Session } from './session.js';
import { createGame } from './engine/game.js';
import { BOT_DECKS, buildBotDeck, localCard, CARD_DATA } from './engine/cards.js';
import { displayName } from './engine/game.js';
import { cardFace, cardInfo } from './ui/cardview.js';
import { sheet } from './ui/dom.js';
import { hostRoom, joinRoom } from './net.js';
import { goNative } from './native.js';
import { preloadVision } from './vision.js';
import { loadCardDb, cardDbCount, cardDbReady, searchNames, cardByName } from './carddb.js';
import { manaColor } from './ui/dom.js';
import { startMusic, musicOn, setMusic, setMusicTrack } from './ui/music.js';
import { openLibrary, onLibrarySave } from './ui/library.js';
import { accountsEnabled, initAccount, currentUser, onAccountChange, pushLibrary, rankedStart, rankedReport, rankedMatch, queueJoin, queueTake, queueLeave, refreshProfile } from './account.js';
import { openAccount, syncLibrary } from './ui/account.js';
import { RANKED_ENABLED } from './config.js';

const app = document.getElementById('app');
// Dorso oficial de las cartas (incluido en la app): ruta absoluta para que funcione desde cualquier hoja de estilos.
document.documentElement.style.setProperty('--mtg-back', `url("${new URL('card-back.jpg', document.baseURI).href}"), linear-gradient(135deg, #3a2414, #1e120a)`);
const COLORS = Object.keys(BOT_DECKS);
const BOT_NAMES = { G: 'Kaia la Druida', R: 'Teo el Trasgo', W: 'Brum el Paladín', B: 'Nyx la Sombra', U: 'Ilse la Maga' };

const NAME_KEY = 'mtgvr-name';
const getName = () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } };
const setName = (n) => { try { localStorage.setItem(NAME_KEY, n); } catch { /* */ } };
const myName = () => currentUser()?.username || getName() || 'Planeswalker';

function botPlayer(i, color, mode, level = 'normal') {
  return {
    id: 'bot' + i,
    name: BOT_NAMES[color],
    isBot: true,
    level,
    deckLabel: BOT_DECKS[color].label,
    deck: buildBotDeck(color, mode === 'commander' ? 99 : 60),
    commander: mode === 'commander' ? localCard(BOT_DECKS[color].commander) : null,
  };
}
const shuffled = (arr) => [...arr].sort(() => Math.random() - 0.5);

// ------------------------------------------------------------ marcos
function bgLayer() {
  return h('div', { class: 'arcane-bg' }, h('div', { class: 'rune-ring', html: RUNE_RING }), h('div', { class: 'rune-ring inner', html: RUNE_RING }));
}
function screenEl(cls, ...kids) {
  return h('div', { class: 'screen ' + cls }, bgLayer(), ...kids);
}
function subScreen(title, onBack, ...kids) {
  return screenEl('sub',
    h('div', { class: 'sub-head' }, h('button', { class: 'rune-btn', onClick: onBack }, icon('back')), h('h2', {}, title)),
    h('div', { class: 'content' }, ...kids));
}
/** Logotipo: «Magic» dorado + emblema «AR» (realidad aumentada) con esquinas de escáner. */
function logo(small = false) {
  return h('div', { class: 'logo' + (small ? ' small' : '') },
    h('span', { class: 'logo-title' }, 'Magic'),
    h('span', { class: 'logo-ar', title: 'Realidad aumentada' },
      h('i', { class: 'k tl' }), h('i', { class: 'k tr' }), h('i', { class: 'k bl' }), h('i', { class: 'k br' }),
      h('b', {}, 'AR'), h('i', { class: 'scan' })));
}
function tarot(iconName, title, sub, tint, onClick) {
  return h('button', { class: 'tarot', style: { '--tint': tint }, onClick },
    h('div', { class: 'medal' }, icon(iconName)),
    h('div', { class: 'ornament' }),
    h('h3', {}, title),
    h('p', {}, sub));
}
const SIGIL = `<svg viewBox="0 0 100 100" fill="none" stroke="#f7dc8f" stroke-width="2">
  <circle cx="50" cy="50" r="46" stroke-width="1.2"/><circle cx="50" cy="50" r="38" stroke-dasharray="3 5"/>
  <path d="M50 10 L59 41 L90 50 L59 59 L50 90 L41 59 L10 50 L41 41 Z" fill="#f7dc8f22"/>
  <circle cx="50" cy="50" r="7" fill="#f7dc8f"/></svg>`;

// ---------------------------------------------------------- portada
// La base de datos de todas las cartas se carga en segundo plano desde el inicio.
let dbStatus = 'Abriendo el gran grimorio…';
const dbListeners = new Set();
let dbProgress = 0;
const setDb = (t, p = dbProgress) => { dbStatus = t; dbProgress = p; dbListeners.forEach((f) => f(t)); };
loadCardDb((p) => setDb(`Abriendo el gran grimorio… ${Math.round(p * 100)}%`, p))
  .then(() => setDb(`${cardDbCount().toLocaleString('es-ES')} cartas de Magic listas para reconocer`, 1))
  .catch(() => setDb('Sin base de datos local: se buscarán las cartas por internet', 1));
function dbLine() {
  const el = h('div', { class: 'db-status' + (cardDbReady() ? ' ok' : '') }, dbStatus);
  const f = (t) => { el.textContent = t; el.classList.toggle('ok', cardDbReady()); if (!el.isConnected) dbListeners.delete(f); };
  dbListeners.add(f);
  return el;
}

// Dorso de carta decorativo (para la portada).
const CARD_BACK = `<svg viewBox="0 0 63 88" fill="none">
  <defs><linearGradient id="cbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2b1a55"/><stop offset="1" stop-color="#120a2a"/></linearGradient></defs>
  <rect x="1" y="1" width="61" height="86" rx="4" fill="url(#cbg)" stroke="#f2c86b" stroke-width="1.4"/>
  <rect x="5" y="5" width="53" height="78" rx="2.5" stroke="#f2c86b" stroke-opacity=".7" stroke-width=".8"/>
  <circle cx="31.5" cy="44" r="15" stroke="#f2c86b" stroke-opacity=".6" stroke-width=".7"/>
  <circle cx="31.5" cy="44" r="11" stroke="#f2c86b" stroke-opacity=".4" stroke-dasharray="1.5 2" stroke-width=".7"/>
  <path d="M31.5 27 L34.5 41 L48.5 44 L34.5 47 L31.5 61 L28.5 47 L14.5 44 L28.5 41 Z" fill="#f2c86b" fill-opacity=".85"/>
  <circle cx="31.5" cy="44" r="2.6" fill="#fff2c4"/>
  <path d="M9 9 h7 M9 9 v7 M54 9 h-7 M54 9 v7 M9 79 h7 M9 79 v-7 M54 79 h-7 M54 79 v-7" stroke="#f2c86b" stroke-width=".9"/></svg>`;

// Brújula con estrella de cuatro puntas (el emblema de la portada).
const COMPASS = `<svg viewBox="0 0 120 120" fill="none">
  <circle cx="60" cy="60" r="56" stroke="#f2c86b" stroke-opacity=".55" stroke-width="1.2"/>
  <circle cx="60" cy="60" r="46" stroke="#f2c86b" stroke-width="2"/>
  <circle cx="60" cy="60" r="40" stroke="#f2c86b" stroke-opacity=".7" stroke-dasharray="2 4" stroke-width="1.4"/>
  <path d="M60 6 L68 52 L114 60 L68 68 L60 114 L52 68 L6 60 L52 52 Z" fill="url(#cg)" stroke="#fff0b8" stroke-width="1"/>
  <path d="M60 28 L64 56 L92 60 L64 64 L60 92 L56 64 L28 60 L56 56 Z" fill="#fff6d6" fill-opacity=".35"/>
  <defs><radialGradient id="cg"><stop offset="0" stop-color="#fff2c4"/><stop offset=".55" stop-color="#e8b04a"/><stop offset="1" stop-color="#8a5a1c"/></radialGradient>
  <radialGradient id="cc"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#ffe7a0"/><stop offset="1" stop-color="#d99a2b"/></radialGradient></defs>
  <circle cx="60" cy="60" r="9" fill="url(#cc)"/></svg>`;

// Aro de runas grande del fondo (con su arco y sus líneas de constelación).
const RUNE_HALO = `<svg viewBox="0 0 800 800" fill="none" stroke="#e6b65a">
  <circle cx="400" cy="400" r="395" stroke-opacity=".25" stroke-width="1.5"/>
  <circle cx="400" cy="400" r="350" stroke-opacity=".45" stroke-width="2"/>
  <circle cx="400" cy="400" r="300" stroke-opacity=".25" stroke-width="1"/>
  <circle cx="400" cy="400" r="200" stroke-opacity=".2" stroke-width="1"/>
  <path d="M400 0 V800 M0 400 H800 M117 117 L683 683 M683 117 L117 683" stroke-opacity=".12"/>
  <path d="M400 50 L703 575 L97 575 Z M400 750 L97 225 L703 225 Z" stroke-opacity=".14"/>
  <g fill="#e6b65a" fill-opacity=".55" stroke="none" font-family="serif" font-size="30" text-anchor="middle">
    ${['ᚱ', 'ᚨ', 'ᚾ', 'ᚠ', 'ᛁ', 'ᚲ', 'ᛒ', 'ᛗ', 'ᛟ', 'ᛞ', 'ᛉ', 'ᛏ'].map((r, i) => {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      return `<text x="${400 + Math.cos(a) * 325}" y="${410 + Math.sin(a) * 325}" transform="rotate(${(i / 12) * 360} ${400 + Math.cos(a) * 325} ${400 + Math.sin(a) * 325})">${r}</text>`;
    }).join('')}
  </g></svg>`;

// Círculo de runas en el «suelo» (en perspectiva) bajo la barra de carga.
const FLOOR_RING = `<svg viewBox="0 0 600 600" fill="none" stroke="#c9a3ff">
  <circle cx="300" cy="300" r="290" stroke-opacity=".35" stroke-width="2"/><circle cx="300" cy="300" r="250" stroke-opacity=".25"/>
  <circle cx="300" cy="300" r="170" stroke-opacity=".35" stroke-dasharray="4 8"/><circle cx="300" cy="300" r="90" stroke-opacity=".45"/>
  <path d="M300 10 L330 270 L590 300 L330 330 L300 590 L270 330 L10 300 L270 270 Z" stroke="#f2c86b" stroke-opacity=".45"/>
  <g fill="#c9a3ff" fill-opacity=".45" stroke="none" font-family="serif" font-size="26" text-anchor="middle">
    ${['ᚱ', 'ᚢ', 'ᚦ', 'ᚨ', 'ᚷ', 'ᚹ', 'ᚺ', 'ᚾ', 'ᛃ', 'ᛇ', 'ᛈ', 'ᛊ', 'ᛏ', 'ᛒ', 'ᛖ', 'ᛚ'].map((r, i) => {
      const a = (i / 16) * Math.PI * 2;
      return `<text x="${300 + Math.cos(a) * 270}" y="${308 + Math.sin(a) * 270}">${r}</text>`;
    }).join('')}
  </g></svg>`;

const DIVIDER = `<svg viewBox="0 0 400 20" fill="none" stroke="#e6b65a"><path d="M10 10 H168 M232 10 H390" stroke-width="1.2"/>
  <path d="M200 1 L208 10 L200 19 L192 10 Z" fill="#e6b65a" fill-opacity=".35"/><circle cx="200" cy="10" r="2.5" fill="#fff0b8" stroke="none"/>
  <path d="M176 10 L182 6 L188 10 L182 14 Z M212 10 L218 6 L224 10 L218 14 Z" fill="#e6b65a" stroke="none"/></svg>`;

function splash() {
  const bar = h('i', { class: 'load-fill' });
  const status = h('div', { class: 'load-status' });
  const note = h('div', { class: 'load-note' });
  const paint = () => {
    const ready = cardDbReady() || dbProgress >= 1;
    bar.style.width = (ready ? 100 : Math.max(4, Math.round(dbProgress * 100))) + '%';
    status.textContent = ready ? 'Toca para empezar' : 'Preparando realidad aumentada…';
    status.classList.toggle('ready', ready);
    note.textContent = ready && cardDbReady() ? `${cardDbCount().toLocaleString('es-ES')} cartas listas para reconocer` : dbStatus;
    note.classList.toggle('ok', cardDbReady());
  };
  const f = () => { if (!status.isConnected) { dbListeners.delete(f); return; } paint(); };
  dbListeners.add(f);
  // Cartas de Magic reales en 3D: frente (ilustración oficial) y dorso, girando en el espacio.
  const art = (n) => `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(n)}&format=image&version=normal`;
  const card = (cls, name) => h('div', { class: 'card3d ' + cls },
    h('div', { class: 'c3-inner' },
      h('div', { class: 'c3-face c3-front', style: { backgroundImage: `url("${art(name)}")` } }, h('i', { class: 'c3-sheen' })),
      h('div', { class: 'c3-face c3-back' }, h('i', { class: 'c3-sheen' })),
      h('i', { class: 'c3-edge' })));
  clear(app).append(h('div', { class: 'screen splash2', onClick: enter },
    h('div', { class: 'nebula' }), h('div', { class: 'stars' }), h('div', { class: 'stars s2' }),
    h('div', { class: 'rune-halo', html: RUNE_HALO }),
    h('div', { class: 'floor-ring', html: FLOOR_RING }),
    card('c1', 'Serra Angel'), card('c2', 'Lightning Bolt'), card('c3', 'Shivan Dragon'), card('c4', 'Llanowar Elves'),
    h('div', { class: 'phone-holo' },
      h('div', { class: 'phone' }, h('i', { class: 'pulse' }), h('i', { class: 'pulse p2' })),
      h('div', { class: 'beam' }),
      h('div', { class: 'holo-card', style: { backgroundImage: `url("${art('Counterspell')}")` } }, h('i', { class: 'holo-tint' }), h('i', { class: 'k tl' }), h('i', { class: 'k tr' }), h('i', { class: 'k bl' }), h('i', { class: 'k br' }))),
    h('div', { class: 'splash-center' },
      h('div', { class: 'compass', html: COMPASS }),
      logo(),
      h('div', { class: 'logo-sub' }, 'Realidad aumentada para tus cartas: aprende y juega en tu mesa'),
      h('div', { class: 'divider', html: DIVIDER }),
      status,
      h('div', { class: 'load-bar' }, bar, h('i', { class: 'cap l' }), h('i', { class: 'cap r' })),
      note,
    ),
  ));
  paint();
  async function enter() {
    startMusic();
    await goNative();
    preloadVision();
    menu();
  }
}

// ------------------------------------------------------------- menú
function menu() {
  setMusicTrack('menu');
  const user = currentUser();
  const nameInput = user
    ? h('div', { class: 'field-input user-name' }, user.username)
    : h('input', { class: 'field-input', placeholder: 'Tu nombre de Planeswalker', value: getName(), maxLength: 18, onInput: (e) => setName(e.target.value.trim()) });
  const accountBtn = accountsEnabled()
    ? h('button', { class: 'gem small' + (user ? '' : ' bronze'), onClick: () => openAccount({ app, subScreen, onBack: menu }) }, icon('person'), user ? 'Mi perfil' : 'Entrar / Crear cuenta')
    : null;
  const tarots = [
    tarot('chest', 'Biblioteca', 'Tus mazos y tu colección', '#d9a441', () => openLibrary({ app, subScreen, onBack: menu })),
    tarot('hat', 'Aprendiz', 'Tutorial guiado contra un golem', '#3fbf6e', startTutorialGame),
    tarot('swords', 'Duelo', '1 contra 1 · 20 vidas', '#e04848', () => modeMenu('1v1')),
    tarot('crown', 'Commander', 'Multijugador · 40 vidas', '#a46bff', () => modeMenu('commander')),
    tarot('book', 'Grimorio', 'Reglas, palabras clave y mazos', '#4a8dff', () => rulesScreen()),
  ];
  tarots.forEach((t, i) => { t.style.setProperty('--i', i - 2); t.style.setProperty('--a', Math.abs(i - 2)); });
  clear(app).append(h('div', { class: 'screen menu menu2' },
    h('div', { class: 'menu-bg' }), h('div', { class: 'menu-motes' }),
    h('div', { class: 'menu-beams' }, tarots.map((_, i) => h('i', { style: { '--i': i - 2 } }))),
    h('div', { class: 'menu-head' },
      logo(),
      h('div', { class: 'logo-sub' }, 'Juega con tus cartas físicas. La cámara hace el resto.'),
      h('div', { class: 'divider', html: DIVIDER })),
    h('div', { class: 'menu-fan' }, tarots),
    h('div', { class: 'menu-corner' },
      h('div', { class: 'name-plate' }, h('label', {}, 'Planeswalker'), h('div', { class: 'np-row' }, icon('person'), nameInput)),
      h('div', { class: 'menu-btns' },
        accountBtn,
        h('button', { class: 'gem small bronze', onClick: calibrateFromMenu }, icon('eye'), 'Ajustar mesa'),
        h('button', { class: 'gem small bronze', onClick: (e) => { setMusic(!musicOn()); e.currentTarget.textContent = musicOn() ? '♫ Música: sí' : '♫ Música: no'; } }, musicOn() ? '♫ Música: sí' : '♫ Música: no'),
      ),
      dbLine(),
    ),
  ));
}

function modeMenu(mode) {
  const label = mode === 'commander' ? 'Commander' : 'Duelo';
  clear(app).append(subScreen(label, menu, h('div', { class: 'menu-right' },
    tarot('golem', mode === 'commander' ? 'Contra golems' : 'Contra un golem', 'Practica contra la máquina', '#2e9a5b', () => botSetup(mode)),
    tarot('portal', 'Abrir portal', 'Crea una sala para tus amigos', '#d9ad55', () => hostLobby(mode)),
    tarot('link', 'Cruzar portal', 'Únete con el código de un amigo', '#2a5fb8', joinScreen),
    mode === '1v1' && accountsEnabled() && RANKED_ENABLED ? tarot('crown', 'Clasificatoria', 'Ranked: gana puntos y sube en la clasificación', '#b3262f', rankedMenu) : null,
  )));
}

// ------------------------------------------------------- rankeds
function rankedMenu() {
  const u = currentUser();
  if (!u) {
    toast('Para jugar clasificatorias tienes que entrar en tu cuenta.', 'info');
    openAccount({ app, subScreen, onBack: rankedMenu });
    return;
  }
  clear(app).append(subScreen('Clasificatoria', () => modeMenu('1v1'),
    h('div', { class: 'ranked-head' }, h('b', {}, u.username), h('span', {}, `${u.rating} puntos · ${u.wins} victorias · ${u.losses} derrotas`),
      h('small', {}, 'Ganar: +25 puntos · Perder: −15 (nunca bajas de 0) · 1 contra 1, 20 vidas, sin golems.')),
    h('div', { class: 'menu-right' },
      tarot('swords', 'Buscar partida', 'Te emparejamos con otro jugador', '#b3262f', rankedSearch),
      tarot('portal', 'Retar a un amigo', 'Crea una sala clasificatoria con código', '#d9ad55', () => rankedHost({ queue: false })),
      tarot('link', 'Aceptar un reto', 'Únete con el código de tu rival', '#2a5fb8', rankedJoinScreen),
    )));
}

async function rankedSearch() {
  const box = h('div', { class: 'panel setup-panel' }, h('div', { class: 'loading' }, 'Buscando rival…'));
  clear(app).append(subScreen('Buscar partida', rankedMenu, box));
  try {
    const code = await queueTake();
    if (code) { rankedJoin(code); return; }
    rankedHost({ queue: true });
  } catch (e) {
    clear(box).append(h('p', { class: 'warn' }, e.message));
  }
}

/** Sala clasificatoria (anfitrión). queue: además se apunta a la cola de «Buscar partida». */
async function rankedHost({ queue }) {
  const me = currentUser();
  let net = null;
  let guest = null;
  let started = false;
  let session = null;
  let keep = null;
  const box = h('div', { class: 'panel setup-panel' });
  const leave = () => { clearInterval(keep); if (queue) queueLeave().catch(() => {}); net?.close(); rankedMenu(); };
  clear(app).append(subScreen(queue ? 'Buscar partida' : 'Retar a un amigo', leave, box));
  const render = (extra) => {
    clear(box).append(
      queue ? h('div', { class: 'loading' }, 'Esperando a que otro jugador busque partida…')
        : [h('div', { class: 'field-label' }, 'Código del reto'), net ? h('div', { class: 'room-code' }, net.code) : h('div', { class: 'loading' }, 'Abriendo la sala…'),
          net ? h('button', { class: 'gem small bronze', onClick: () => share(net.code) }, 'Compartir código') : null,
          h('p', { class: 'muted' }, 'Tu amigo tiene que entrar en su cuenta y pulsar «Aceptar un reto» con este código.')],
      extra || null);
  };
  render();
  const start = async () => {
    started = true;
    clearInterval(keep);
    if (queue) queueLeave().catch(() => {});
    let matchId;
    try { matchId = await rankedStart(guest.userId); } catch (e) {
      net.send(guest.connId, { type: 'rankedError', message: e.message });
      render(h('p', { class: 'warn' }, e.message));
      return;
    }
    const players = [{ id: 'host', name: me.username }, { id: guest.pid, name: guest.name }];
    const state = createGame({ mode: '1v1', players });
    const users = { host: me.id, [guest.pid]: guest.userId };
    session = new Session({ role: 'host', state, me: 'host', net });
    net.send(guest.connId, { type: 'start', state, you: guest.pid, ranked: { matchId, users } });
    mountTable(app, session, { onExit: menu });
    watchRanked(session, matchId, users);
  };
  try {
    net = await hostRoom({
      onJoin(connId, msg) {
        if (started) {
          if (guest && msg.userId === guest.userId && session) {
            guest.connId = connId;
            net.send(connId, { type: 'start', state: session.state, you: guest.pid, rejoin: true, ranked: session.ranked });
            toast(`${guest.name} ha vuelto a la partida.`, 'info');
          } else net.send(connId, { type: 'full' });
          return;
        }
        if (!msg.userId) { net.send(connId, { type: 'rankedError', message: 'Para jugar clasificatorias tienes que entrar en tu cuenta.' }); return; }
        if (msg.userId === me.id) { net.send(connId, { type: 'rankedError', message: 'No puedes jugar contra ti mismo.' }); return; }
        guest = { connId, userId: msg.userId, name: (msg.name || 'Rival').slice(0, 18), pid: 'p' + connId.slice(-6) };
        start();
      },
      onLeave() { if (started) toast('Tu rival se ha desconectado. Si vuelve, la partida sigue.', 'warn'); },
      onMessage(connId, msg) { if (msg.type === 'action' && session && guest) session.remote(guest.pid, msg.action); },
    });
    if (queue) {
      await queueJoin(net.code);
      keep = setInterval(() => queueJoin(net.code).catch(() => {}), 60000);
    }
    render();
  } catch (e) {
    clear(box).append(h('p', { class: 'warn' }, 'No se pudo abrir la sala: ' + (e.message || e.type)));
  }
}

function rankedJoinScreen() {
  const input = h('input', { class: 'field-input code-input', placeholder: '·····', maxLength: 5, autocapitalize: 'characters', onInput: (e) => { e.target.value = e.target.value.toUpperCase(); } });
  clear(app).append(subScreen('Aceptar un reto', rankedMenu, h('div', { class: 'panel setup-panel' },
    h('div', { class: 'field-label' }, 'Código del reto'), input, h('button', { class: 'gem wide', onClick: () => input.value.length === 5 && rankedJoin(input.value) }, 'Entrar'))));
  input.focus();
}

/** Entrar en una sala clasificatoria (invitado), con reconexión automática. */
async function rankedJoin(code) {
  const me = currentUser();
  const status = h('p', { class: 'muted' }, 'Entrando en la sala…');
  clear(app).append(subScreen('Clasificatoria', rankedMenu, h('div', { class: 'panel setup-panel' }, status)));
  let session = null;
  let tries = 0;
  const go = async () => {
    let net;
    try {
      net = await joinRoom(code, me.username, {
        onMessage(msg) {
          if (msg.type === 'rankedError') status.textContent = msg.message;
          else if (msg.type === 'full') status.textContent = 'Esa sala ya está llena.';
          else if (msg.type === 'start') {
            tries = 0;
            if (session && msg.rejoin) { session.net = net; session.receive(msg.state); toast('¡Reconectado!', 'info'); return; }
            session = new Session({ role: 'client', state: msg.state, me: msg.you, net });
            mountTable(app, session, { onExit: menu });
            if (msg.ranked) watchRanked(session, msg.ranked.matchId, msg.ranked.users);
          } else if (msg.type === 'state' && session) session.receive(msg.state);
        },
        onClose() { if (session && tries < 8) { tries++; toast(`Conexión perdida. Reconectando… (${tries})`, 'warn', 2500); setTimeout(go, 2500); } },
      }, { userId: me.id });
      if (!session) status.textContent = 'Dentro. Empezando la partida…';
    } catch (e) {
      if (session && tries < 8) { tries++; setTimeout(go, 2500); } else status.textContent = e.message || 'No se pudo conectar.';
    }
  };
  go();
}

/** Al terminar la partida, cada jugador envía el resultado; el servidor aplica los puntos. */
function watchRanked(session, matchId, users) {
  session.ranked = { matchId, users };
  let sent = false;
  session.subscribe(async (s) => {
    if (sent || !s.winner) return;
    sent = true;
    const winner = users[s.winner];
    const meId = currentUser()?.id;
    try {
      let r = await rankedReport(matchId, winner);
      for (let i = 0; i < 10 && r && r.status === 'playing'; i++) {
        await new Promise((res) => setTimeout(res, 3000));
        r = await rankedMatch(matchId);
      }
      const u = await refreshProfile();
      if (!r || r.status === 'playing') toast('Resultado enviado. Los puntos se aplicarán cuando tu rival lo confirme (o en 10 minutos).', 'info', 7000);
      else if (r.status === 'disputed') toast('Los dos jugadores habéis dado resultados distintos: esta partida no cuenta.', 'warn', 7000);
      else if (r.winner === meId) toast(`¡Victoria clasificatoria! +${r.points_win} puntos (ahora tienes ${u?.rating}).`, 'info', 7000);
      else toast(`Derrota clasificatoria: −${r.points_loss} puntos (ahora tienes ${u?.rating}).`, 'warn', 7000);
    } catch (e) {
      toast('No se pudo enviar el resultado: ' + e.message, 'warn', 7000);
    }
  });
}

// ------------------------------------------------------- contra bots
function botSetup(mode) {
  let bots = mode === 'commander' ? 3 : 1;
  let color = 'random';
  let level = 'normal';
  const LEVELS = { easy: ['Aprendiz', 'No responde ni usa trucos de combate.'], normal: ['Mago', 'Responde en la pila y usa trucos de combate.'], hard: ['Archimago', 'Igual que Mago y además contrarresta tus hechizos importantes.'] };
  const render = () => {
    clear(app).append(subScreen(mode === 'commander' ? 'Commander contra golems' : 'Duelo contra un golem', () => modeMenu(mode),
      h('div', { class: 'panel setup-panel' },
        mode === 'commander' ? [h('div', { class: 'field-label' }, 'Rivales'),
          h('div', { class: 'seg' }, [1, 2, 3].map((n) => h('button', { class: 'sigil-opt' + (bots === n ? ' on' : ''), onClick: () => { bots = n; render(); } }, `${n} golem${n > 1 ? 's' : ''}`)))] : null,
        h('div', { class: 'field-label' }, 'Mazo del rival'),
        h('div', { class: 'seg' },
          h('button', { class: 'sigil-opt' + (color === 'random' ? ' on' : ''), onClick: () => { color = 'random'; render(); } }, '✦ Al azar'),
          COLORS.map((c) => h('button', { class: 'sigil-opt' + (color === c ? ' on' : ''), onClick: () => { color = c; render(); } },
            h('span', { class: 'pip', style: { background: manaColor(c), fontSize: '18px' } }), BOT_DECKS[c].label))),
        color !== 'random' ? h('p', { class: 'muted' }, BOT_DECKS[color].blurb) : null,
        h('p', { class: 'muted' }, mode === 'commander'
          ? 'Prepara tu mazo de Commander. Al empezar, toca tu zona de Mando y pon tu comandante en el círculo.'
          : 'Baraja tu mazo, roba 7 cartas y apunta la cámara a tu mesa.'),
        h('div', { class: 'field-label' }, 'Dificultad'),
        h('div', { class: 'seg' }, Object.entries(LEVELS).map(([k, [label]]) => h('button', { class: 'sigil-opt' + (level === k ? ' on' : ''), onClick: () => { level = k; render(); } }, label))),
        h('p', { class: 'muted' }, LEVELS[level][1]),
        h('button', { class: 'gem wide', onClick: () => startBotGame(mode, bots, color, level) }, '¡A la batalla!'),
      )));
  };
  render();
}

function startBotGame(mode, nBots, color, level = 'normal') {
  const colors = color === 'random' ? shuffled(COLORS) : Array(nBots).fill(color);
  const players = [{ id: 'me', name: myName() }];
  for (let i = 0; i < nBots; i++) players.push(botPlayer(i, colors[i % colors.length], mode, level));
  const state = createGame({ mode, players });
  return mountTable(app, new Session({ role: 'local', state, me: 'me' }), { onExit: menu });
}

function startTutorialGame() {
  // En el tutorial empiezas tú y el golem no usa trucos.
  const state = createGame({ mode: '1v1', first: 0, players: [{ id: 'me', name: myName() }, { ...botPlayer(0, 'W', '1v1', 'easy'), name: 'Golem de entrenamiento' }] });
  const session = new Session({ role: 'local', state, me: 'me' });
  session.botDelay = 1100;
  // Si es la primera vez, el tutorial empieza después de ajustar la mesa.
  const first = needsCalibration();
  const table = mountTable(app, session, { onExit: menu, intro: false, onCalibrated: () => first && startTutorial(table) });
  if (!first) startTutorial(table);
}

/** «Ajustar mesa» desde el menú: la mesa con la cámara, sin partida en marcha. */
function calibrateFromMenu() {
  const state = createGame({ mode: '1v1', players: [{ id: 'me', name: myName() }, botPlayer(0, 'G', '1v1')] });
  const session = new Session({ role: 'local', state, me: 'me' });
  session.pauseBots(true);
  const table = mountTable(app, session, { calibrate: true, intro: false, onExit: menu, onCalibrated: () => table.exit() });
}

// ------------------------------------------------------------- online
async function hostLobby(mode) {
  const max = mode === 'commander' ? 4 : 2;
  const seats = [{ id: 'host', name: myName(), kind: 'host' }];
  let net = null;
  let started = false;
  let session = null;
  const connToPlayer = new Map();
  const box = h('div', { class: 'panel setup-panel' });
  clear(app).append(subScreen('Portal de ' + (mode === 'commander' ? 'Commander' : 'Duelo'), () => { net?.close(); modeMenu(mode); }, box));

  const render = () => {
    if (started) return;
    clear(box).append(
      h('div', { class: 'field-label' }, 'Código del portal'),
      net ? h('div', { class: 'room-code' }, net.code) : h('div', { class: 'loading' }, 'Abriendo el portal…'),
      net ? h('button', { class: 'gem small bronze', onClick: () => share(net.code) }, 'Compartir código') : null,
      h('div', { class: 'field-label' }, `Planeswalkers (${seats.length}/${max})`),
      h('ul', { class: 'seats' }, seats.map((p, i) => h('li', {},
        icon(p.kind === 'bot' ? 'golem' : 'person'), p.name + (p.kind === 'host' ? ' (tú)' : ''),
        p.kind === 'bot' ? h('button', { class: 'x', onClick: () => { seats.splice(i, 1); render(); } }, icon('close')) : null))),
      h('div', { class: 'row-btns' },
        seats.length < max ? h('button', { class: 'gem bronze', onClick: () => {
          const c = COLORS[(seats.length - 1) % COLORS.length];
          seats.push({ id: 'bot' + seats.length, name: BOT_NAMES[c], kind: 'bot', color: c });
          render();
        } }, icon('golem'), 'Añadir golem') : null,
        h('button', { class: 'gem', disabled: seats.length < 2, onClick: start }, 'Empezar'),
      ),
    );
  };

  const start = () => {
    started = true;
    const players = seats.map((p, i) => (p.kind === 'bot' ? botPlayer(i, p.color, mode) : { id: p.id, name: p.name }));
    const state = createGame({ mode, players });
    session = new Session({ role: 'host', state, me: 'host', net });
    for (const [connId, pid] of connToPlayer) net.send(connId, { type: 'start', state, you: pid });
    mountTable(app, session, { onExit: menu });
  };

  render();
  try {
    net = await hostRoom({
      onJoin(connId, msg) {
        if (started) {
          // ¿vuelve alguien que se había desconectado? (pantalla bloqueada, cambio de red…)
          const online = new Set(connToPlayer.values());
          const gone = seats.filter((p) => p.kind === 'remote' && !online.has(p.id));
          const back = gone.find((p) => p.name.toLowerCase() === String(msg.name || '').slice(0, 18).toLowerCase()) || (gone.length === 1 ? gone[0] : null);
          if (!back || !session) { net.send(connId, { type: 'full' }); return; }
          connToPlayer.set(connId, back.id);
          net.send(connId, { type: 'start', state: session.state, you: back.id, rejoin: true });
          toast(`${back.name} ha vuelto a la partida.`, 'info');
          return;
        }
        if (seats.length >= max) { net.send(connId, { type: 'full' }); return; }
        const id = 'p' + connId.slice(-6);
        seats.push({ id, name: (msg.name || 'Amigo').slice(0, 18), kind: 'remote' });
        connToPlayer.set(connId, id);
        net.broadcast({ type: 'lobby', seats, mode });
        render();
      },
      onLeave(connId) {
        const id = connToPlayer.get(connId);
        connToPlayer.delete(connId);
        if (!started) {
          const i = seats.findIndex((s) => s.id === id);
          if (i >= 0) seats.splice(i, 1);
          render();
        } else toast('Un jugador se ha desconectado.', 'warn');
      },
      onMessage(connId, msg) {
        const pid = connToPlayer.get(connId);
        if (msg.type === 'action' && session && pid) session.remote(pid, msg.action);
      },
    });
    render();
  } catch (e) {
    clear(box).append(h('p', { class: 'warn' }, 'No se pudo abrir el portal: ' + (e.message || e.type)));
  }
}

function joinScreen() {
  const input = h('input', { class: 'field-input code-input', placeholder: '·····', maxLength: 5, autocapitalize: 'characters', onInput: (e) => { e.target.value = e.target.value.toUpperCase(); try { localStorage.setItem('mtgvr-last-room', e.target.value); } catch { /* */ } } });
  try { const last = localStorage.getItem('mtgvr-last-room'); if (last) input.value = last; } catch { /* */ }
  const status = h('p', { class: 'muted' }, 'Pide el código de 5 letras a quien abrió el portal.');
  let session = null;
  let tries = 0;
  // Si se corta la conexión, vuelve a entrar solo en la misma sala (con el mismo nombre).
  const reconnect = async () => {
    if (tries >= 8) { toast('No se pudo recuperar la conexión. Vuelve a entrar con el código del portal.', 'warn', 8000); return; }
    tries++;
    toast(`Conexión perdida. Reconectando… (${tries})`, 'warn', 2500);
    await new Promise((r) => setTimeout(r, 2500));
    go(true);
  };
  const go = async (silent = false) => {
    if (input.value.length !== 5) { status.textContent = 'El código tiene 5 letras.'; return; }
    if (!silent) status.textContent = 'Cruzando el portal…';
    let net;
    try {
      net = await joinRoom(input.value, myName(), {
        onMessage(msg) {
          if (msg.type === 'lobby') status.textContent = `Dentro. Jugadores: ${msg.seats.map((s) => s.name).join(', ')}. Esperando al anfitrión…`;
          else if (msg.type === 'full') status.textContent = 'El portal está lleno o la partida ya empezó.';
          else if (msg.type === 'start') {
            tries = 0;
            if (session && msg.rejoin) { session.net = net; session.receive(msg.state); toast('¡Reconectado!', 'info'); return; }
            session = new Session({ role: 'client', state: msg.state, me: msg.you, net });
            mountTable(app, session, { onExit: menu, intro: !msg.rejoin });
          } else if (msg.type === 'state' && session) session.receive(msg.state);
        },
        onClose() { reconnect(); },
      });
      if (!session) status.textContent = 'Dentro. Esperando a que el anfitrión empiece…';
    } catch (e) {
      if (session) reconnect();
      else status.textContent = e.message || 'No se pudo conectar.';
    }
  };
  clear(app).append(subScreen('Cruzar portal', () => modeMenu('1v1'),
    h('div', { class: 'panel setup-panel' }, h('div', { class: 'field-label' }, 'Código del portal'), input, h('button', { class: 'gem wide', onClick: () => go() }, 'Cruzar'), status)));
  input.focus();
}

function share(code) {
  const text = `¡Únete a mi partida de Magic AR! Código del portal: ${code}\n${location.href}`;
  if (navigator.share) navigator.share({ text }).catch(() => {});
  else navigator.clipboard?.writeText(text).then(() => toast('Código copiado'));
}

// -------------------------------------------------------------- reglas
function rulesScreen(tab = 'rules') {
  const tabs = h('div', { class: 'book-tabs' },
    h('button', { class: 'sigil-opt' + (tab === 'rules' ? ' on' : ''), onClick: () => rulesScreen('rules') }, 'Reglas'),
    h('button', { class: 'sigil-opt' + (tab === 'all' ? ' on' : ''), onClick: () => rulesScreen('all') }, icon('cards'), 'Todas las cartas'),
    COLORS.map((c) => h('button', { class: 'sigil-opt' + (tab === c ? ' on' : ''), onClick: () => rulesScreen(c) },
      h('span', { class: 'pip', style: { background: manaColor(c), fontSize: '16px' } }), BOT_DECKS[c].label)));
  let body;
  if (tab === 'rules') {
    body = h('div', { class: 'rules-book parchment' },
      RULES.map(([t, d]) => [h('h3', {}, t.replace(/^\S+\s/, '')), h('p', {}, d)]),
      h('h3', {}, 'Palabras clave'),
      h('dl', {}, Object.values(KEYWORDS).map(([n, d]) => [h('dt', {}, n), h('dd', {}, d)])));
  } else if (tab === 'all') {
    const list = h('div', { class: 'deck-grid' });
    const info = h('p', { class: 'muted' }, cardDbReady()
      ? `Busca cualquiera de las ${cardDbCount().toLocaleString('es-ES')} cartas de Magic, en español o en inglés.`
      : 'El gran grimorio aún se está abriendo…');
    let timer;
    const input = h('input', { class: 'field-input', type: 'search', placeholder: 'Nombre de la carta…', onInput: () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const names = searchNames(input.value, 24);
        clear(list).append(...names.map((n) => {
          const card = cardByName(n);
          return card ? h('button', { class: 'deck-card', onClick: () => sheet(cardInfo(card)) }, cardFace(card, { big: true })) : null;
        }).filter(Boolean));
      }, 200);
    } });
    body = h('div', { class: 'deck-view parchment' }, info, input, h('div', { style: { height: '10px' } }), list);
    setTimeout(() => input.focus(), 100);
  } else {
    const deck = BOT_DECKS[tab];
    body = h('div', { class: 'deck-view parchment' },
      h('p', {}, h('b', {}, deck.label + ': '), deck.blurb, ' Comandante: ', displayName(CARD_DATA[deck.commander]), '. Es el mazo con el que juega el golem.'),
      h('div', { class: 'deck-grid' }, deck.list.map(([name, n]) => {
        const card = CARD_DATA[name];
        return h('button', { class: 'deck-card', onClick: () => sheet(cardInfo(card)) }, cardFace(card, { big: true }), h('span', { class: 'qty' }, '×' + n));
      })));
  }
  clear(app).append(subScreen('Grimorio', menu, h('div', { class: 'book' }, tabs, body)));
}

splash();

// Cuentas: recuperar la sesión y guardar la biblioteca en el perfil al cambiarla.
if (accountsEnabled()) {
  initAccount().then((u) => { if (u) syncLibrary({ quiet: true }); });
  let t = null;
  onLibrarySave((lib) => {
    if (!currentUser()) return;
    clearTimeout(t);
    t = setTimeout(() => pushLibrary(lib).catch(() => toast('No se pudo guardar la biblioteca en tu perfil (¿sin conexión?). Se guardará cuando vuelvas a entrar.', 'warn')), 1500);
  });
  onAccountChange(() => { if (document.querySelector('.screen.menu')) menu(); });
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
