// Punto de entrada: menú principal, preparación de partidas y salas online.

import './styles.css';
import { h, clear, toast } from './ui/dom.js';
import { mountTable } from './ui/table.js';
import { startTutorial } from './ui/tutorial.js';
import { RULES, KEYWORDS } from './ui/learn.js';
import { Session } from './session.js';
import { createGame } from './engine/game.js';
import { BOT_DECKS, buildBotDeck, localCard } from './engine/cards.js';
import { hostRoom, joinRoom } from './net.js';

const app = document.getElementById('app');
const COLORS = Object.keys(BOT_DECKS);
const BOT_NAMES = ['Bot Kaia', 'Bot Teo', 'Bot Nyx', 'Bot Brum'];

const NAME_KEY = 'mtgvr-name';
const getName = () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } };
const setName = (n) => { try { localStorage.setItem(NAME_KEY, n); } catch { /* */ } };

function botPlayer(i, color, mode) {
  return {
    id: 'bot' + i,
    name: BOT_NAMES[i % BOT_NAMES.length],
    isBot: true,
    deckLabel: BOT_DECKS[color].label,
    deck: buildBotDeck(color, mode === 'commander' ? 99 : 40),
    commander: mode === 'commander' ? localCard(BOT_DECKS[color].commander) : null,
  };
}

const shuffled = (arr) => [...arr].sort(() => Math.random() - 0.5);

// ------------------------------------------------------------------ menú
function menu() {
  const nameInput = h('input', { class: 'name-input', placeholder: 'Tu nombre', value: getName(), maxLength: 16, onInput: (e) => setName(e.target.value.trim()) });
  clear(app).append(h('div', { class: 'screen menu' },
    h('div', { class: 'logo' }, h('div', { class: 'logo-mark' }, '✦'), h('h1', {}, 'MagicVR'), h('p', {}, 'Aprende y juega a Magic con tus cartas físicas y la cámara del móvil')),
    nameInput,
    h('div', { class: 'menu-grid' },
      bigBtn('🎓', 'Tutorial interactivo', 'Aprende paso a paso jugando contra un bot', startTutorialGame),
      bigBtn('⚔️', '1 contra 1', '20 vidas · contra un bot o un amigo', () => modeMenu('1v1')),
      bigBtn('👑', 'Commander', '40 vidas · multijugador con comandantes', () => modeMenu('commander')),
      bigBtn('📖', 'Reglas básicas', 'Chuleta de reglas y palabras clave', rulesScreen),
    ),
    h('p', { class: 'foot muted' }, 'Proyecto de fans no oficial. Imágenes de cartas vía Scryfall.'),
  ));
}

function bigBtn(icon, title, sub, onClick) {
  return h('button', { class: 'big-btn', onClick }, h('span', { class: 'bb-icon' }, icon), h('span', { class: 'bb-text' }, h('b', {}, title), h('small', {}, sub)));
}

function back(fn = menu) {
  return h('button', { class: 'back', onClick: fn }, '← Volver');
}

function myName() {
  return getName() || 'Jugador';
}

function modeMenu(mode) {
  const label = mode === 'commander' ? 'Commander' : '1 contra 1';
  clear(app).append(h('div', { class: 'screen' }, back(),
    h('h2', {}, label),
    h('div', { class: 'menu-grid' },
      bigBtn('🤖', mode === 'commander' ? 'Contra bots' : 'Contra un bot', 'Practica a tu ritmo', () => botSetup(mode)),
      bigBtn('📡', 'Crear sala', 'Tus amigos se unen con un código', () => hostLobby(mode)),
      bigBtn('🔗', 'Unirse a una sala', 'Introduce el código de tu amigo', () => joinScreen()),
    ),
    h('p', { class: 'muted' }, 'Cada uno juega con sus cartas físicas y registra lo que juega con la cámara. La app lleva vidas, fases y combates.'),
  ));
}

// ------------------------------------------------------- contra bots
function botSetup(mode) {
  let bots = mode === 'commander' ? 3 : 1;
  let color = 'random';
  const render = () => {
    clear(app).append(h('div', { class: 'screen' }, back(() => modeMenu(mode)),
      h('h2', {}, mode === 'commander' ? 'Commander contra bots' : '1 contra 1 contra un bot'),
      mode === 'commander' ? h('div', { class: 'field' }, h('label', {}, 'Número de rivales'),
        h('div', { class: 'seg' }, [1, 2, 3].map((n) => h('button', { class: bots === n ? 'on' : '', onClick: () => { bots = n; render(); } }, n)))) : null,
      h('div', { class: 'field' }, h('label', {}, 'Mazo del bot'),
        h('div', { class: 'seg wrap' },
          h('button', { class: color === 'random' ? 'on' : '', onClick: () => { color = 'random'; render(); } }, '🎲 Aleatorio'),
          COLORS.map((c) => h('button', { class: color === c ? 'on' : '', onClick: () => { color = c; render(); } }, BOT_DECKS[c].label)))),
      h('p', { class: 'muted' }, mode === 'commander'
        ? 'Prepara tu mazo de Commander. Al empezar, toca tu zona de mando (👑) para escanear tu comandante.'
        : 'Prepara tu mazo de 60 (o 40) cartas, baraja y roba 7.'),
      h('button', { class: 'btn primary big', onClick: () => startBotGame(mode, bots, color) }, '¡Empezar partida!'),
    ));
  };
  render();
}

function startBotGame(mode, nBots, color) {
  const colors = color === 'random' ? shuffled(COLORS) : Array(nBots).fill(color);
  const players = [{ id: 'me', name: myName() }];
  for (let i = 0; i < nBots; i++) players.push(botPlayer(i, colors[i % colors.length], mode));
  const state = createGame({ mode, players });
  const session = new Session({ role: 'local', state, me: 'me' });
  return mountTable(app, session, { onExit: menu });
}

function startTutorialGame() {
  const state = createGame({ mode: '1v1', players: [{ id: 'me', name: myName() }, { ...botPlayer(0, 'W', '1v1'), name: 'Bot de entrenamiento' }] });
  const session = new Session({ role: 'local', state, me: 'me' });
  session.botDelay = 1100;
  const table = mountTable(app, session, { onExit: menu });
  startTutorial(table);
}

// ------------------------------------------------------------- online
async function hostLobby(mode) {
  const seats = [{ id: 'host', name: myName(), kind: 'host' }];
  let net = null;
  let started = false;
  let session = null;
  const connToPlayer = new Map();

  const box = h('div', { class: 'screen' });
  clear(app).append(box);

  const render = () => {
    if (started) return;
    clear(box).append(
      back(() => { net?.close(); modeMenu(mode); }),
      h('h2', {}, 'Sala de ' + (mode === 'commander' ? 'Commander' : '1 contra 1')),
      net ? h('div', { class: 'room-code' }, h('small', {}, 'Código de la sala'), h('b', {}, net.code),
        h('button', { class: 'btn ghost', onClick: () => share(net.code) }, 'Compartir')) : h('div', { class: 'loading' }, 'Creando sala…'),
      h('h3', {}, `Jugadores (${seats.length}/${mode === 'commander' ? 4 : 2})`),
      h('ul', { class: 'seats' }, seats.map((p, i) => h('li', {},
        (p.kind === 'bot' ? '🤖 ' : '🧑 ') + p.name + (p.kind === 'host' ? ' (tú)' : ''),
        p.kind === 'bot' ? h('button', { class: 'mini', onClick: () => { seats.splice(i, 1); render(); } }, '✕') : null))),
      seats.length < (mode === 'commander' ? 4 : 2)
        ? h('button', { class: 'btn ghost', onClick: () => { seats.push({ id: 'bot' + seats.length, name: BOT_NAMES[seats.length % 4], kind: 'bot', color: COLORS[seats.length % 4] }); render(); } }, '＋ Añadir bot')
        : null,
      h('button', { class: 'btn primary big', disabled: seats.length < 2, onClick: start }, 'Empezar partida'),
      h('p', { class: 'muted' }, 'Tus amigos deben abrir la app, ir a "Unirse a una sala" y escribir el código.'),
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
        const max = mode === 'commander' ? 4 : 2;
        if (started || seats.length >= max) { net.send(connId, { type: 'full' }); return; }
        const id = 'p' + connId.slice(-6);
        seats.push({ id, name: (msg.name || 'Amigo').slice(0, 16), kind: 'remote' });
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
        } else {
          toast('Un jugador se ha desconectado.', 'warn');
        }
      },
      onMessage(connId, msg) {
        const pid = connToPlayer.get(connId);
        if (msg.type === 'action' && session && pid) session.remote(pid, msg.action);
      },
    });
    render();
  } catch (e) {
    clear(box).append(back(() => modeMenu(mode)), h('p', { class: 'warn' }, 'No se pudo crear la sala: ' + (e.message || e.type)));
  }
}

function joinScreen() {
  const input = h('input', { class: 'code-input', placeholder: 'CÓDIGO', maxLength: 5, autocapitalize: 'characters', onInput: (e) => (e.target.value = e.target.value.toUpperCase()) });
  const status = h('p', { class: 'muted' });
  const go = async () => {
    if (input.value.length !== 5) { status.textContent = 'El código tiene 5 letras.'; return; }
    status.textContent = 'Conectando…';
    let session = null;
    let net;
    try {
      net = await joinRoom(input.value, myName(), {
        onMessage(msg) {
          if (msg.type === 'lobby') {
            status.textContent = `Conectado. Jugadores: ${msg.seats.map((s) => s.name).join(', ')}. Esperando a que el anfitrión empiece…`;
          } else if (msg.type === 'full') {
            status.textContent = 'La sala está llena o la partida ya empezó.';
          } else if (msg.type === 'start') {
            session = new Session({ role: 'client', state: msg.state, me: msg.you, net });
            mountTable(app, session, { onExit: menu });
          } else if (msg.type === 'state' && session) {
            session.receive(msg.state);
          }
        },
        onClose() { toast('Se ha perdido la conexión con el anfitrión.', 'warn', 5000); },
      });
      status.textContent = 'Conectado. Esperando a que el anfitrión empiece…';
    } catch (e) {
      status.textContent = e.message || 'No se pudo conectar.';
    }
  };
  clear(app).append(h('div', { class: 'screen' }, back(),
    h('h2', {}, 'Unirse a una sala'),
    input,
    h('button', { class: 'btn primary big', onClick: go }, 'Unirse'),
    status,
  ));
  input.focus();
}

function share(code) {
  const text = `¡Únete a mi partida de MagicVR! Código: ${code}\n${location.href}`;
  if (navigator.share) navigator.share({ text }).catch(() => {});
  else navigator.clipboard?.writeText(text).then(() => toast('Copiado al portapapeles'));
}

// -------------------------------------------------------------- reglas
function rulesScreen() {
  clear(app).append(h('div', { class: 'screen rules' }, back(),
    h('h2', {}, 'Reglas básicas'),
    RULES.map(([t, d]) => h('details', {}, h('summary', {}, t), h('p', {}, d))),
    h('h2', {}, 'Palabras clave'),
    h('dl', {}, Object.values(KEYWORDS).map(([n, d]) => [h('dt', {}, n), h('dd', {}, d)])),
  ));
}

menu();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
