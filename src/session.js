// Una "sesión" envuelve el estado de la partida y sabe de dónde vienen los
// cambios: local (contra bots), anfitrión de una sala, o cliente de una sala.

import { apply } from './engine/game.js';
import { nextBotAction } from './engine/bot.js';

export class Session {
  /**
   * role: 'local' | 'host' | 'client'
   * me: id del jugador de este móvil
   * net: objeto de red (host o cliente) opcional
   */
  constructor({ role, state, me, net = null }) {
    this.role = role;
    this.state = state;
    this.me = me;
    this.net = net;
    this.listeners = new Set();
    this.botTimer = null;
    this.botsPaused = false;
    this.botDelay = 750;
    this.closed = false;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this.state);
  }

  /** Acción del jugador de este móvil. */
  dispatch(action) {
    action = { ...action, by: action.by ?? this.me };
    if (this.role === 'client') {
      this.net.send({ type: 'action', action });
      return;
    }
    this.applyAndShare(action);
  }

  /** Acción recibida por red de otro jugador (sólo anfitrión). */
  remote(playerId, action) {
    if (this.role !== 'host') return;
    this.applyAndShare({ ...action, by: playerId });
  }

  applyAndShare(action) {
    const next = apply(this.state, action);
    if (next === this.state) return;
    this.state = next;
    if (this.role === 'host') this.net.broadcast({ type: 'state', state: next });
    this.emit();
    this.scheduleBots();
  }

  /** Estado recibido del anfitrión (sólo cliente). */
  receive(state) {
    this.state = state;
    this.emit();
  }

  scheduleBots() {
    if (this.role === 'client' || this.botsPaused || this.closed || this.botTimer) return;
    const action = nextBotAction(this.state);
    if (!action) return;
    const quick = action.t === 'next' && ['untap', 'upkeep', 'draw', 'damage', 'end'].includes(this.state.step);
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      if (this.closed || this.botsPaused) return;
      const again = nextBotAction(this.state);
      if (again) this.applyAndShare(again);
    }, quick ? this.botDelay * 0.5 : this.botDelay);
  }

  pauseBots(v) {
    this.botsPaused = v;
    if (!v) this.scheduleBots();
  }

  close() {
    this.closed = true;
    clearTimeout(this.botTimer);
    this.net?.close();
  }
}
