// Punto de entrada: portada, menú, preparación de partidas y salas online.

import './styles.css';
import { h, clear, toast } from './ui/dom.js';
import { icon } from './ui/icons.js';
import { mountTable, RUNE_RING } from './ui/table.js';
import { startTutorial } from './ui/tutorial.js';
import { RULES, KEYWORDS } from './ui/learn.js';
import { Session } from './session.js';
import { createGame } from './engine/game.js';
import { BOT_DECKS, buildBotDeck, localCard } from './engine/cards.js';
import { hostRoom, joinRoom } from './net.js';
import { goNative } from './native.js';
import { preloadVision } from './vision.js';
import { manaColor } from './ui/dom.js';

const app = document.getElementById('app');
const COLORS = Object.keys(BOT_DECKS);
const BOT_NAMES = ['Kaia la Druida', 'Teo el Goblin', 'Nyx la Sombra', 'Brum el Paladín'];

const NAME_KEY = 'mtgvr-name';
const getName = () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } };
const setName = (n) => { try { localStorage.setItem(NAME_KEY, n); } catch { /* */ } };
const myName = () => getName() || 'Planeswalker';

function botPlayer(i, color, mode) {
  return {
    id: 'bot' + i,
    name: BOT_NAMES[COLORS.indexOf(color) % BOT_NAMES.length],
    isBot: true,
    deckLabel: BOT_DECKS[color].label,
    deck: buildBotDeck(color, mode === 'commander' ? 99 : 40),
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
function splash() {
  clear(app).append(screenEl('splash', h('div', { class: 'content', onClick: enter },
    h('div', { class: 'sigil', html: SIGIL }),
    h('div', { class: 'logo-title' }, 'MagicVR'),
    h('div', { class: 'logo-sub' }, 'La mesa arcana · aprende a jugar con tus cartas'),
    h('div', { class: 'tap-start' }, 'TOCA PARA EMPEZAR'),
  )));
  async function enter() {
    await goNative();
    preloadVision();
    menu();
  }
}

// ------------------------------------------------------------- menú
function menu() {
  const nameInput = h('input', { class: 'field-input', placeholder: 'Tu nombre de Planeswalker', value: getName(), maxLength: 18, onInput: (e) => setName(e.target.value.trim()) });
  clear(app).append(screenEl('menu', h('div', { class: 'content' },
    h('div', { class: 'menu-left' },
      h('div', { class: 'logo-title' }, 'MagicVR'),
      h('div', { class: 'logo-sub' }, 'Juega con tus cartas físicas. La cámara hace el resto.'),
      h('div', { class: 'name-plate' }, h('label', {}, 'Planeswalker'), nameInput),
    ),
    h('div', { class: 'menu-right' },
      tarot('hat', 'Aprendiz', 'Tutorial guiado contra un golem', '#2e9a5b', startTutorialGame),
      tarot('swords', 'Duelo', '1 contra 1 · 20 vidas', '#b3262f', () => modeMenu('1v1')),
      tarot('crown', 'Commander', 'Multijugador · 40 vidas', '#7b3fc4', () => modeMenu('commander')),
      tarot('book', 'Grimorio', 'Reglas y palabras clave', '#2a5fb8', rulesScreen),
    ),
  )));
}

function modeMenu(mode) {
  const label = mode === 'commander' ? 'Commander' : 'Duelo';
  clear(app).append(subScreen(label, menu, h('div', { class: 'menu-right' },
    tarot('golem', mode === 'commander' ? 'Contra golems' : 'Contra un golem', 'Practica contra la máquina', '#2e9a5b', () => botSetup(mode)),
    tarot('portal', 'Abrir portal', 'Crea una sala para tus amigos', '#d9ad55', () => hostLobby(mode)),
    tarot('link', 'Cruzar portal', 'Únete con el código de un amigo', '#2a5fb8', joinScreen),
  )));
}

// ------------------------------------------------------- contra bots
function botSetup(mode) {
  let bots = mode === 'commander' ? 3 : 1;
  let color = 'random';
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
        h('p', { class: 'muted' }, mode === 'commander'
          ? 'Prepara tu mazo de Commander. Al empezar, toca tu zona de Mando y pon tu comandante en el círculo.'
          : 'Baraja tu mazo, roba 7 cartas y apunta la cámara a tu mesa.'),
        h('button', { class: 'gem wide', onClick: () => startBotGame(mode, bots, color) }, '¡A la batalla!'),
      )));
  };
  render();
}

function startBotGame(mode, nBots, color) {
  const colors = color === 'random' ? shuffled(COLORS) : Array(nBots).fill(color);
  const players = [{ id: 'me', name: myName() }];
  for (let i = 0; i < nBots; i++) players.push(botPlayer(i, colors[i % colors.length], mode));
  const state = createGame({ mode, players });
  return mountTable(app, new Session({ role: 'local', state, me: 'me' }), { onExit: menu });
}

function startTutorialGame() {
  const state = createGame({ mode: '1v1', players: [{ id: 'me', name: myName() }, { ...botPlayer(0, 'W', '1v1'), name: 'Golem de entrenamiento' }] });
  const session = new Session({ role: 'local', state, me: 'me' });
  session.botDelay = 1100;
  startTutorial(mountTable(app, session, { onExit: menu }));
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
          const c = COLORS[seats.length % 4];
          seats.push({ id: 'bot' + seats.length, name: BOT_NAMES[COLORS.indexOf(c)], kind: 'bot', color: c });
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
        if (started || seats.length >= max) { net.send(connId, { type: 'full' }); return; }
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
  const input = h('input', { class: 'field-input code-input', placeholder: '·····', maxLength: 5, autocapitalize: 'characters', onInput: (e) => (e.target.value = e.target.value.toUpperCase()) });
  const status = h('p', { class: 'muted' }, 'Pide el código de 5 letras a quien abrió el portal.');
  const go = async () => {
    if (input.value.length !== 5) { status.textContent = 'El código tiene 5 letras.'; return; }
    status.textContent = 'Cruzando el portal…';
    let session = null;
    let net;
    try {
      net = await joinRoom(input.value, myName(), {
        onMessage(msg) {
          if (msg.type === 'lobby') status.textContent = `Dentro. Jugadores: ${msg.seats.map((s) => s.name).join(', ')}. Esperando al anfitrión…`;
          else if (msg.type === 'full') status.textContent = 'El portal está lleno o la partida ya empezó.';
          else if (msg.type === 'start') {
            session = new Session({ role: 'client', state: msg.state, me: msg.you, net });
            mountTable(app, session, { onExit: menu });
          } else if (msg.type === 'state' && session) session.receive(msg.state);
        },
        onClose() { toast('Se ha perdido la conexión con el anfitrión.', 'warn', 5000); },
      });
      status.textContent = 'Dentro. Esperando a que el anfitrión empiece…';
    } catch (e) {
      status.textContent = e.message || 'No se pudo conectar.';
    }
  };
  clear(app).append(subScreen('Cruzar portal', () => modeMenu('1v1'),
    h('div', { class: 'panel setup-panel' }, h('div', { class: 'field-label' }, 'Código del portal'), input, h('button', { class: 'gem wide', onClick: go }, 'Cruzar'), status)));
  input.focus();
}

function share(code) {
  const text = `¡Únete a mi partida de MagicVR! Código del portal: ${code}\n${location.href}`;
  if (navigator.share) navigator.share({ text }).catch(() => {});
  else navigator.clipboard?.writeText(text).then(() => toast('Código copiado'));
}

// -------------------------------------------------------------- reglas
function rulesScreen() {
  clear(app).append(subScreen('Grimorio de reglas', menu,
    h('div', { class: 'rules-book parchment' },
      RULES.map(([t, d]) => [h('h3', {}, t.replace(/^\S+\s/, '')), h('p', {}, d)]),
      h('h3', {}, 'Palabras clave'),
      h('dl', {}, Object.values(KEYWORDS).map(([n, d]) => [h('dt', {}, n), h('dd', {}, d)])),
    )));
}

splash();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
