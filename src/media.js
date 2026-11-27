// Cámaras entre jugadores en las partidas online (WebRTC con PeerJS, de móvil a móvil).
//
// Cada jugador cuenta cómo está (¿enseña su cámara?, ¿a quién quiere ver?, dónde
// está su mesa en su vídeo…) y el anfitrión reparte el «mapa» con lo de todos.
// Con ese mapa cada móvil abre una videollamada con los demás (sin audio: la voz
// va por Discord) y decide, para cada uno, si le manda su cámara o nada.
// La llamada se abre una sola vez; enseñar/ocultar la cámara sólo cambia la pista.

export const QUALITY = {
  normal: { width: 640, bitrate: 600_000, fps: 20 },
  low: { width: 400, bitrate: 220_000, fps: 12 },
};

/** ¿Le mando mi cámara a `to`? Sólo si la enseño y esa persona no la ha ocultado. */
export function shouldSend(map, me, to) {
  const mine = map && map[me];
  const theirs = map && map[to];
  if (!mine || !mine.sharing || !theirs) return false;
  return !(theirs.wants && theirs.wants[me] === false);
}

/** Entre dos jugadores sólo llama uno (el de identificador menor): así no hay llamadas dobles. */
export const shouldCall = (myPeerId, theirPeerId) => !!myPeerId && !!theirPeerId && myPeerId < theirPeerId;

/** Junta lo que cuenta un jugador con lo que ya se sabía de él. */
export const mergeMedia = (map, pid, info) => ({ ...(map || {}), [pid]: { ...((map && map[pid]) || {}), ...info } });

/** Calidad que se usa entre dos jugadores: si cualquiera de los dos pide «baja», baja. */
export const pairQuality = (a, b) => (a === 'low' || b === 'low' ? 'low' : 'normal');

/** Cuánto hay que reducir la imagen para mandarla con esa calidad. */
export const scaleFor = (trackWidth, quality) => Math.max(1, (trackWidth || 1280) / QUALITY[quality === 'low' ? 'low' : 'normal'].width);

/**
 * role: 'host' | 'client'. send(msg): el anfitrión manda el mapa a todos; el
 * cliente manda lo suyo al anfitrión.
 */
export function createMedia({ me, role, send }) {
  let peer = null;
  let map = {};
  let localStream = null;
  let placeholder = null;
  let closed = false;
  const local = { sharing: false, wants: {}, quality: 'normal', quad: null, aspect: null };
  const calls = new Map(); // pid -> { call, stream }
  const listeners = new Set();
  const emit = () => { for (const fn of listeners) fn(); };

  const localTrack = () => {
    const t = localStream && localStream.getVideoTracks()[0];
    return t && t.readyState === 'live' ? t : null;
  };
  // Pista vacía para abrir la llamada aunque todavía no haya cámara.
  function placeholderStream() {
    if (!placeholder) {
      const c = document.createElement('canvas');
      c.width = 16; c.height = 9;
      c.getContext('2d').fillRect(0, 0, 16, 9);
      placeholder = c.captureStream(1);
    }
    return placeholder;
  }
  const effective = () => mergeMedia(map, me, info());
  const info = () => ({ sharing: local.sharing && !!localTrack(), wants: local.wants, quality: local.quality, quad: local.quad, aspect: local.aspect, peerId: peer ? peer.id : null });
  const pidOfPeer = (peerId) => Object.keys(map).find((p) => map[p] && map[p].peerId === peerId);

  function updateSenders() {
    const m = effective();
    const track = localTrack();
    for (const [pid, { call }] of calls) {
      const pc = call.peerConnection;
      if (!pc) continue;
      const sender = pc.getSenders().find((s) => !s.track || s.track.kind === 'video');
      if (!sender) continue;
      const want = track && shouldSend(m, me, pid) ? track : null;
      if (sender.track !== want) sender.replaceTrack(want).catch(() => {});
      if (want) {
        const q = pairQuality(local.quality, m[pid] && m[pid].quality);
        try {
          const p = sender.getParameters();
          if (!p.encodings || !p.encodings.length) p.encodings = [{}];
          p.encodings[0].maxBitrate = QUALITY[q].bitrate;
          p.encodings[0].maxFramerate = QUALITY[q].fps;
          p.encodings[0].scaleResolutionDownBy = scaleFor(want.getSettings ? want.getSettings().width : 0, q);
          sender.setParameters(p).catch(() => {});
        } catch { /* navegadores sin setParameters */ }
      }
    }
  }

  function track(pid, call) {
    const entry = { call, stream: null };
    calls.set(pid, entry);
    call.on('stream', (s) => { entry.stream = s; updateSenders(); emit(); });
    const gone = () => {
      if (calls.get(pid) !== entry) return;
      calls.delete(pid);
      emit();
      setTimeout(connect, 2500);
    };
    call.on('close', gone);
    call.on('error', gone);
    setTimeout(updateSenders, 0);
  }

  function connect() {
    if (closed || !peer || peer.destroyed || peer.disconnected && !peer.open) return;
    for (const [pid, inf] of Object.entries(map)) {
      if (pid === me || !inf || !inf.peerId || calls.has(pid)) continue;
      if (!shouldCall(peer.id, inf.peerId)) continue;
      try { track(pid, peer.call(inf.peerId, placeholderStream(), { metadata: { pid: me } })); } catch { /* */ }
    }
    updateSenders();
  }

  function publish() {
    if (closed || !peer) return;
    if (role === 'host') { map = mergeMedia(map, me, info()); send(map); connect(); emit(); }
    else send(info());
    updateSenders();
  }

  return {
    me,
    /** Engancha el «peer» de la conexión de la partida (otra vez si se reconecta). */
    attach(p) {
      if (!p || p === peer) return;
      for (const { call } of calls.values()) call.close();
      calls.clear();
      peer = p;
      p.on('call', (call) => {
        const pid = (call.metadata && call.metadata.pid) || pidOfPeer(call.peer);
        if (!pid || closed) { call.close(); return; }
        const old = calls.get(pid);
        if (old) { calls.delete(pid); old.call.close(); }
        call.answer(placeholderStream());
        track(pid, call);
      });
      publish();
    },
    /** Anfitrión: llega lo que cuenta un jugador. */
    report(pid, inf) {
      if (role !== 'host' || closed) return;
      map = mergeMedia(map, pid, inf);
      send(map);
      connect();
      emit();
    },
    /** Anfitrión: vuelve a mandar el mapa (p. ej. a quien se reconecta). */
    resend() { if (role === 'host' && !closed) send(map); },
    /** Cliente: llega el mapa del anfitrión. */
    setMap(m) {
      if (role === 'host' || closed) return;
      map = m || {};
      connect();
      emit();
    },
    setLocalStream(s) { if (localStream === s) return; localStream = s; publish(); },
    set(patch) { Object.assign(local, patch); publish(); },
    get local() { return local; },
    /** Lo que sabemos de otro jugador: su vídeo (si llega) y su información. */
    remote(pid) {
      const inf = map[pid] || null;
      const c = calls.get(pid);
      const iSee = !(local.wants && local.wants[pid] === false);
      return { info: inf, stream: c ? c.stream : null, connected: !!(c && c.stream), sharing: !!(inf && inf.sharing && shouldSend(effective(), pid, me)), online: !!(inf && inf.peerId), iSee };
    },
    players() { return Object.keys(map); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    close() {
      closed = true;
      for (const { call } of calls.values()) call.close();
      calls.clear();
      listeners.clear();
    },
  };
}
