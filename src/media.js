// Cámaras entre jugadores en las partidas online (WebRTC con PeerJS, de móvil a móvil).
//
// Cada jugador cuenta cómo está (¿enseña su cámara?, ¿a quién quiere ver y en
// qué tamaño?, dónde está su mesa en su vídeo…) y el anfitrión reparte el
// «mapa» con lo de todos. Con ese mapa cada móvil abre una videollamada con los
// demás (sin audio: la voz va por Discord) y decide, para cada uno, si le manda
// su cámara (y con qué calidad) o nada. La llamada se abre una sola vez:
// enseñar/ocultar la cámara o cambiar la calidad sólo cambia la pista.

export const QUALITY = {
  normal: { width: 640, bitrate: 600_000, fps: 20 },
  low: { width: 400, bitrate: 220_000, fps: 12 },
  thumb: { width: 240, bitrate: 110_000, fps: 8 },
};

/**
 * wants[pid]: true (verlo en grande), 'thumb' (en miniatura) o false (no verlo).
 * Si no dice nada, se entiende que sí.
 */
export const wantOf = (inf, pid) => {
  const w = inf && inf.wants ? inf.wants[pid] : undefined;
  return w === undefined ? true : w;
};

/** ¿Le mando mi cámara a `to`? Sólo si la enseño y esa persona quiere verla. */
export function shouldSend(map, me, to) {
  const mine = map && map[me];
  const theirs = map && map[to];
  if (!mine || !mine.sharing || !theirs) return false;
  return wantOf(theirs, me) !== false;
}

/** Entre dos jugadores sólo llama uno (el de identificador menor): así no hay llamadas dobles. */
export const shouldCall = (myPeerId, theirPeerId) => !!myPeerId && !!theirPeerId && myPeerId < theirPeerId;

/** Junta lo que cuenta un jugador con lo que ya se sabía de él. */
export const mergeMedia = (map, pid, info) => ({ ...(map || {}), [pid]: { ...((map && map[pid]) || {}), ...info } });

/**
 * Calidad con la que mando mi vídeo a otro: miniatura si él sólo me ve en
 * pequeño; baja si cualquiera de los dos la pide; si no, normal.
 */
export function pairQuality(mine, theirs, want = true) {
  if (want === 'thumb') return 'thumb';
  return mine === 'low' || theirs === 'low' ? 'low' : 'normal';
}

/** Cuánto hay que reducir la imagen para mandarla con esa calidad. */
export const scaleFor = (trackWidth, quality) => Math.max(1, (trackWidth || 1280) / (QUALITY[quality] || QUALITY.normal).width);

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
  const local = { share: false, wants: {}, quality: 'normal', quad: null, aspect: null };
  const calls = new Map(); // pid -> { call, stream, state, applied }
  const listeners = new Set();
  const emit = () => { for (const fn of listeners) fn(); };

  const localTrack = () => {
    const t = localStream && localStream.getVideoTracks()[0];
    return t && t.readyState === 'live' ? t : null;
  };
  // Pista casi vacía para abrir la llamada aunque todavía no haya cámara.
  function placeholderStream() {
    if (!placeholder) {
      try {
        const c = document.createElement('canvas');
        c.width = 16; c.height = 9;
        c.getContext('2d').fillRect(0, 0, 16, 9);
        placeholder = c.captureStream(1);
      } catch { placeholder = null; }
    }
    // navegadores sin captureStream: se abre la llamada con la cámara (si la hay)
    return placeholder || (local.share && localTrack() ? new MediaStream([localTrack()]) : new MediaStream());
  }
  const info = () => ({
    sharing: local.share && !!localTrack(), // la enseña de verdad
    share: !!local.share, // quiere enseñarla (aunque su cámara esté apagada)
    wants: local.wants, quality: local.quality, quad: local.quad, aspect: local.aspect,
    peerId: peer ? peer.id : null,
  });
  const effective = () => mergeMedia(map, me, info());
  const pidOfPeer = (peerId) => Object.keys(map).find((p) => map[p] && map[p].peerId === peerId);

  function updateSenders() {
    const m = effective();
    const track = localTrack();
    for (const [pid, entry] of calls) {
      const pc = entry.call.peerConnection;
      if (!pc) continue;
      const sender = pc.getSenders().find((s) => !s.track || s.track.kind === 'video');
      if (!sender) continue;
      const want = track && shouldSend(m, me, pid) ? track : null;
      if (sender.track !== want) sender.replaceTrack(want).catch(() => {});
      if (!want) { entry.applied = null; continue; }
      const q = pairQuality(local.quality, m[pid] && m[pid].quality, wantOf(m[pid], me));
      const key = q + ':' + (want.getSettings ? want.getSettings().width : 0);
      if (entry.applied === key) continue;
      entry.applied = key;
      try {
        const p = sender.getParameters();
        if (!p.encodings || !p.encodings.length) p.encodings = [{}];
        p.encodings[0].maxBitrate = QUALITY[q].bitrate;
        p.encodings[0].maxFramerate = QUALITY[q].fps;
        p.encodings[0].scaleResolutionDownBy = scaleFor(want.getSettings ? want.getSettings().width : 0, q);
        sender.setParameters(p).catch(() => { entry.applied = null; });
      } catch { /* navegadores sin setParameters */ }
    }
  }

  function track(pid, call) {
    const entry = { call, stream: null, state: 'connecting', applied: null };
    calls.set(pid, entry);
    call.on('stream', (s) => { entry.stream = s; entry.state = 'ok'; updateSenders(); emit(); });
    const gone = () => {
      if (calls.get(pid) !== entry) return;
      calls.delete(pid);
      emit();
      setTimeout(connect, 2500);
    };
    call.on('close', gone);
    call.on('error', gone);
    // estado de la conexión (para avisar si el vídeo no consigue conectar)
    const watch = () => {
      const pc = call.peerConnection;
      if (!pc) { setTimeout(watch, 200); return; }
      pc.addEventListener('iceconnectionstatechange', () => {
        const st = pc.iceConnectionState;
        if (st === 'failed') { entry.state = 'failed'; emit(); setTimeout(() => { if (calls.get(pid) === entry) { calls.delete(pid); call.close(); connect(); } }, 8000); }
        else if (st === 'connected' || st === 'completed') { if (entry.state !== 'ok' && entry.stream) entry.state = 'ok'; emit(); }
      });
      setTimeout(() => { if (calls.get(pid) === entry && !entry.stream && entry.state === 'connecting') { entry.state = 'slow'; emit(); } }, 15000);
    };
    watch();
    setTimeout(updateSenders, 0);
  }

  function connect() {
    if (closed || !peer || peer.destroyed) return;
    for (const [pid, inf] of Object.entries(map)) {
      if (pid === me || !inf || !inf.peerId) continue;
      const cur = calls.get(pid);
      // tras una reconexión cambia su identificador: la llamada vieja ya no sirve
      if (cur && cur.call.peer !== inf.peerId) { calls.delete(pid); cur.call.close(); }
      if (calls.has(pid) || !shouldCall(peer.id, inf.peerId)) continue;
      try { track(pid, peer.call(inf.peerId, placeholderStream(), { metadata: { pid: me } })); } catch { /* */ }
    }
    updateSenders();
  }

  function publish() {
    if (closed || !peer) return;
    if (role === 'host') { map = mergeMedia(map, me, info()); send(map); connect(); emit(); }
    else { send(info()); updateSenders(); emit(); }
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
        if (!pid || closed || p !== peer) { call.close(); return; }
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
    /** Cambia lo mío ({ share, wants, quality, quad, aspect }); sólo avisa si algo cambia. */
    set(patch) {
      let changed = false;
      for (const [k, v] of Object.entries(patch)) {
        if (JSON.stringify(local[k]) !== JSON.stringify(v)) { local[k] = v; changed = true; }
      }
      if (changed) publish();
    },
    get local() { return local; },
    get sharing() { return local.share && !!localTrack(); },
    /** Lo que sabemos de otro jugador: su vídeo (si llega) y su información. */
    remote(pid) {
      const inf = map[pid] || null;
      const c = calls.get(pid);
      return {
        info: inf,
        stream: c ? c.stream : null,
        state: c ? c.state : 'none',
        sharing: !!(inf && shouldSend(effective(), pid, me)),
        online: !!(inf && inf.peerId),
      };
    },
    players() { return Object.keys(map); },
    /** Para pruebas: las conexiones de vídeo abiertas. */
    debugCalls() { return [...calls].map(([pid, e]) => ({ pid, pc: e.call.peerConnection, state: e.state, stream: e.stream })); },
    get map() { return map; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    close() {
      closed = true;
      for (const { call } of calls.values()) call.close();
      calls.clear();
      listeners.clear();
    },
  };
}
