// Partidas online entre móviles con WebRTC (PeerJS). No hace falta servidor
// propio: el anfitrión crea una sala con un código de 5 letras y los demás se
// unen con ese código. El anfitrión tiene el estado "oficial" de la partida.

import Peer from 'peerjs';

const PREFIX = 'mtgvr-sala-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export function randomCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

// Servidor de emparejamiento: por defecto el público de PeerJS. Se puede usar
// uno propio con VITE_PEER_HOST / VITE_PEER_PORT / VITE_PEER_PATH (ver README).
const env = import.meta.env || {};
const PEER_OPTS = env.VITE_PEER_HOST
  ? { host: env.VITE_PEER_HOST, port: +(env.VITE_PEER_PORT || 443), path: env.VITE_PEER_PATH || '/', secure: env.VITE_PEER_SECURE !== 'false' }
  : {};

function openPeer(id) {
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id, PEER_OPTS) : new Peer(PEER_OPTS);
    const t = setTimeout(() => reject(new Error('No se pudo conectar al servidor de emparejamiento.')), 12000);
    peer.on('open', () => { clearTimeout(t); resolve(peer); });
    peer.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}

/** Crea una sala. Devuelve { code, onMessage, send, broadcast, close }. */
export async function hostRoom({ onJoin, onLeave, onMessage }) {
  let peer, code;
  for (let i = 0; i < 4; i++) {
    code = randomCode();
    try {
      peer = await openPeer(PREFIX + code);
      break;
    } catch (e) {
      if (e.type !== 'unavailable-id' || i === 3) throw e;
    }
  }
  const conns = new Map(); // connId -> conn
  peer.on('connection', (conn) => {
    conn.on('open', () => conns.set(conn.connectionId, conn));
    conn.on('data', (msg) => {
      if (msg && msg.type === 'hello') onJoin && onJoin(conn.connectionId, msg);
      else onMessage && onMessage(conn.connectionId, msg);
    });
    const gone = () => {
      if (conns.delete(conn.connectionId)) onLeave && onLeave(conn.connectionId);
    };
    conn.on('close', gone);
    conn.on('error', gone);
  });
  return {
    code,
    send(connId, msg) { conns.get(connId)?.send(msg); },
    broadcast(msg) { for (const c of conns.values()) c.send(msg); },
    close() { peer.destroy(); },
  };
}

/** Se une a una sala existente. */
export async function joinRoom(code, name, { onMessage, onClose }, extra = {}) {
  const peer = await openPeer();
  const conn = peer.connect(PREFIX + code.trim().toUpperCase(), { reliable: true });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('No se encontró la sala. ¿Código correcto?')), 12000);
    conn.on('open', () => { clearTimeout(t); resolve(); });
    peer.on('error', (e) => {
      clearTimeout(t);
      reject(e.type === 'peer-unavailable' ? new Error('No existe ninguna sala con ese código.') : e);
    });
  });
  conn.on('data', (msg) => onMessage && onMessage(msg));
  conn.on('close', () => onClose && onClose());
  conn.send({ type: 'hello', name, ...extra });
  return {
    send(msg) { conn.send(msg); },
    close() { peer.destroy(); },
  };
}
