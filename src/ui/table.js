// La mesa: cámara de fondo + tapete virtual en perspectiva + controles.

import { h, clear, append, sheet, toast, burst, floatText, manaColor } from './dom.js';
import { cardFace, cardInfo } from './cardview.js';
import { openPicker } from './picker.js';
import { startCamera, stopCamera, cameraSupported } from '../camera.js';
import {
  STEPS, STEP_INFO, activePlayer, player, opponents, pendingDefenders, findPerm,
  power, toughness, displayName, canAttack, manaSources,
} from '../engine/game.js';

const SETTINGS_KEY = 'mtgvr-settings';
function loadSettings() {
  try {
    return { tilt: 38, zoom: 1, camera: true, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { tilt: 38, zoom: 1, camera: true };
  }
}
function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* */ }
}

export function mountTable(root, session, { onExit } = {}) {
  const ui = {
    settings: loadSettings(),
    viewOpp: null,
    els: new Map(),
    lastEvent: session.state.eventSeq,
    hooks: new Set(), // funciones (state) llamadas tras cada render (tutorial)
    hudExtra: null,
  };
  const me = () => session.me;
  const S = () => session.state;

  // ------------------------------------------------------------ estructura
  const video = h('video', { class: 'cam', autoplay: true, playsinline: true, muted: true });
  const topbar = h('header', { class: 'topbar' });
  const oppHalf = h('section', { class: 'half opp' });
  const meHalf = h('section', { class: 'half me' });
  const midline = h('div', { class: 'midline' });
  const mat = h('div', { class: 'mat' }, oppHalf, midline, meHalf);
  const stage = h('div', { class: 'stage' }, mat);
  const hud = h('footer', { class: 'hud' });
  const fx = h('div', { class: 'fx-layer' });
  const banner = h('div', { class: 'banner' });
  const screen = h('div', { class: 'table-screen' }, video, h('div', { class: 'cam-shade' }), topbar, stage, hud, banner, fx);
  clear(root).append(screen);

  const applySettings = () => {
    mat.style.setProperty('--tilt', ui.settings.tilt + 'deg');
    mat.style.setProperty('--zoom', ui.settings.zoom);
    screen.classList.toggle('no-cam', !ui.settings.camera);
    if (ui.settings.camera && cameraSupported()) {
      startCamera(video).catch(() => {
        screen.classList.add('no-cam');
        toast('No se pudo abrir la cámara. Se usará un tapete virtual.', 'warn');
      });
    } else {
      video.srcObject = null;
    }
  };
  applySettings();

  let wakeLock = null;
  navigator.wakeLock?.request('screen').then((w) => (wakeLock = w)).catch(() => {});

  // ------------------------------------------------------------- render
  function render(s) {
    const myP = player(s, me());
    const opps = s.players.filter((p) => p.id !== me());
    if (!ui.viewOpp || !opps.find((p) => p.id === ui.viewOpp && !p.eliminated)) {
      ui.viewOpp = (opps.find((p) => !p.eliminated) || opps[0])?.id;
    }
    renderTop(s, opps);
    renderHalf(oppHalf, s, player(s, ui.viewOpp), 'opp');
    renderHalf(meHalf, s, myP, 'me');
    renderMid(s);
    renderHud(s, myP);
    processEvents(s);
    for (const fn of ui.hooks) fn(s);
  }

  function renderTop(s, opps) {
    clear(topbar).append(
      h('button', { class: 'icon-btn', title: 'Menú', onClick: openMenu }, '☰'),
      h('div', { class: 'opp-chips' },
        opps.map((p) => h('button', {
          class: 'chip' + (p.id === ui.viewOpp ? ' on' : '') + (p.eliminated ? ' out' : '') + (activePlayer(s).id === p.id ? ' active' : ''),
          'data-player': p.id,
          onClick: () => { ui.viewOpp = p.id; render(S()); },
        },
        h('span', { class: 'chip-name' }, (p.isBot ? '🤖 ' : '🧑 ') + p.name),
        h('span', { class: 'chip-life', 'data-life': p.id }, '❤ ' + p.life),
        )),
      ),
      h('button', { class: 'icon-btn', title: 'Historial', onClick: openLog }, '📜'),
    );
  }

  function renderMid(s) {
    const act = activePlayer(s);
    const info = STEP_INFO[s.step];
    clear(midline).append(
      h('span', { class: 'turn-tag' + (act.id === me() ? ' mine' : '') }, act.id === me() ? 'Tu turno' : 'Turno de ' + act.name),
      h('span', { class: 'step-tag' }, info.group + ' · ' + info.name),
    );
  }

  function renderHalf(el, s, p, side) {
    clear(el);
    if (!p) return;
    const creatures = p.battlefield.filter((x) => x.card.isCreature || /Planeswalker/.test(x.card.typeLine));
    const support = p.battlefield.filter((x) => !creatures.includes(x));
    const lands = support.filter((x) => x.card.isLand);
    const others = support.filter((x) => !x.card.isLand);

    const zone = (cls, label, content, onClick) =>
      h('div', { class: 'zone ' + cls, 'data-zone': cls, onClick }, h('div', { class: 'zone-label' }, label), content);

    const lib = p.isBot ? p.library.length : null;
    const topGrave = p.graveyard[p.graveyard.length - 1];
    const sideCol = h('div', { class: 'side' },
      zone('library', 'Biblioteca', h('div', { class: 'pile back' }, lib != null ? lib : '🂠'), () => toast('Biblioteca: tu mazo, boca abajo. Robas de aquí.', 'info')),
      zone('graveyard', 'Cementerio', topGrave ? h('div', { class: 'pile' }, cardFace(topGrave), h('span', { class: 'count' }, p.graveyard.length)) : h('div', { class: 'pile empty' }, '0'), () => showZone(p, 'graveyard')),
      zone('exile', 'Exilio', h('div', { class: 'pile empty' }, p.exile.length), () => showZone(p, 'exile')),
      s.mode === 'commander' ? zone('command', 'Mando', commandZone(p), () => commandAction(p)) : null,
    );

    const lifeBadge = h('button', { class: 'life-badge', 'data-life': p.id, onClick: () => playerSheet(p) },
      h('span', {}, p.name), h('b', {}, '❤ ' + p.life), p.poison ? h('span', {}, ' ☠' + p.poison) : null);

    const hand = p.isBot ? h('div', { class: 'bot-hand' }, Array.from({ length: Math.min(p.hand.length, 10) }, () => h('i')), h('span', {}, p.hand.length + ' en mano')) : null;

    const rowC = h('div', { class: 'row creatures', 'data-zone': 'battlefield' }, creatures.map((x) => permEl(s, x, p)));
    const rowL = h('div', { class: 'row lands', 'data-zone': 'lands' }, others.map((x) => permEl(s, x, p)), lands.map((x) => permEl(s, x, p)));
    if (!creatures.length) rowC.append(h('div', { class: 'row-hint' }, side === 'me' ? 'Criaturas' : ''));
    if (!support.length) rowL.append(h('div', { class: 'row-hint' }, side === 'me' ? 'Tierras' : ''));

    const main = h('div', { class: 'battle' }, ...(side === 'opp' ? [rowL, rowC] : [rowC, rowL]));
    el.append(h('div', { class: 'half-head' }, lifeBadge, hand), h('div', { class: 'half-body' }, side === 'opp' ? [main, sideCol] : [sideCol, main]));
    el.classList.toggle('eliminated', p.eliminated);
  }

  function commandZone(p) {
    if (!p.commander) return h('div', { class: 'pile empty' }, p.id === me() ? '＋' : '—');
    if (!p.commanderInZone) return h('div', { class: 'pile empty' }, '⚔');
    return h('div', { class: 'pile' }, cardFace(p.commander), p.commanderTax ? h('span', { class: 'count' }, '+' + p.commanderTax) : null);
  }

  function permEl(s, perm, owner) {
    let el = ui.els.get(perm.uid);
    if (!el) {
      el = h('div', { class: 'perm', 'data-uid': perm.uid }, cardFace(perm.card), h('div', { class: 'badges' }));
      el.addEventListener('click', (e) => { e.stopPropagation(); onPermTap(perm.uid); });
      ui.els.set(perm.uid, el);
    }
    const attacking = s.combat.attackers[perm.uid] != null;
    const blocking = Object.entries(s.combat.blocks).find(([, l]) => l.includes(perm.uid));
    el.classList.toggle('tapped', perm.tapped);
    el.classList.toggle('attacking', attacking);
    el.classList.toggle('blocking', !!blocking);
    el.classList.toggle('sick', perm.card.isCreature && perm.sick && owner.id === activePlayer(s).id);
    el.classList.toggle('can-attack', s.step === 'attack' && owner.id === me() && activePlayer(s).id === me() && canAttack(s, perm));
    el.classList.toggle('commander', perm.isCommander);
    const b = el.querySelector('.badges');
    clear(b);
    if (perm.card.isCreature) {
      const pw = power(perm);
      const tg = toughness(perm);
      const changed = pw !== perm.card.power || tg !== perm.card.toughness;
      b.append(h('span', { class: 'pt' + (changed ? ' mod' : '') }, `${pw}/${tg}`));
    }
    if (perm.damage) b.append(h('span', { class: 'dmg' }, '💥' + perm.damage));
    if (perm.counters) b.append(h('span', { class: 'ctr' }, (perm.counters > 0 ? '+' : '') + perm.counters));
    if (attacking) b.append(h('span', { class: 'tag atk' }, '⚔'));
    if (blocking) b.append(h('span', { class: 'tag blk' }, '🛡'));
    if (perm.card.isCreature && perm.sick && owner.id === activePlayer(s).id && !perm.card.keywords.includes('haste')) b.append(h('span', { class: 'tag zz' }, '💤'));
    return el;
  }

  // ---------------------------------------------------------------- HUD
  function renderHud(s, myP) {
    clear(hud);
    if (s.winner) {
      const won = s.winner === me();
      hud.append(h('div', { class: 'help big' }, won ? '🏆 ¡Has ganado!' : `${player(s, s.winner).name} gana la partida.`),
        h('div', { class: 'hud-row' }, h('button', { class: 'btn primary', onClick: exit }, 'Volver al menú')));
      return;
    }
    const act = activePlayer(s);
    const myTurn = act.id === me();
    const track = h('div', { class: 'phase-track' },
      STEPS.map((st) => h('span', { class: 'ph' + (st === s.step ? ' on' : '') + (STEPS.indexOf(st) < STEPS.indexOf(s.step) ? ' done' : '') }, STEP_INFO[st].name)));

    let help = STEP_INFO[s.step].help;
    let primary = null;
    const pending = pendingDefenders(s);

    if (myP.eliminated) {
      help = 'Has sido eliminado. Puedes seguir mirando la partida.';
    } else if (myTurn) {
      if (s.step === 'attack') {
        const n = Object.keys(s.combat.attackers).length;
        help = n ? `Atacas con ${n}. Toca otra criatura para añadirla o quitarla.` : 'Toca las criaturas que brillan para atacar' + (opponents(s, me()).length > 1 ? ` a ${player(s, ui.viewOpp).name} (cambia el objetivo arriba).` : '.');
        primary = h('button', { class: 'btn primary', onClick: () => session.dispatch({ t: 'next' }) }, n ? `⚔ Atacar con ${n}` : 'No atacar →');
      } else if (s.step === 'block') {
        help = pending.length ? `Esperando a que ${pending.map((id) => player(s, id).name).join(', ')} decida bloqueos…` : 'Bloqueos decididos.';
        primary = h('button', { class: 'btn primary', disabled: pending.length > 0, onClick: () => session.dispatch({ t: 'next' }) }, 'Siguiente →');
      } else {
        if (s.step === 'main1' || s.step === 'main2') help += manaHint(myP);
        if (s.step === 'damage' && s.combat.result) help = s.combat.result.join(' ');
        primary = h('button', { class: 'btn primary', onClick: () => session.dispatch({ t: 'next' }) }, s.step === 'end' ? 'Pasar turno ⏭' : 'Siguiente fase →');
      }
    } else if (s.step === 'block' && pending.includes(me())) {
      help = '¡Te atacan! Toca una de tus criaturas enderezadas para elegir a quién bloquea. Luego confirma.';
      primary = h('button', { class: 'btn primary alert', onClick: () => session.dispatch({ t: 'confirmBlocks' }) }, '🛡 Confirmar bloqueos');
    } else {
      help = `Turno de ${act.name} (${STEP_INFO[s.step].name}). Puedes lanzar instantáneos si quieres.`;
      if (s.step === 'damage' && s.combat.result) help = s.combat.result.join(' ');
    }

    const lifeCtl = h('div', { class: 'my-life' },
      h('button', { onClick: () => session.dispatch({ t: 'life', target: me(), delta: -1 }) }, '−'),
      h('span', { 'data-life': me(), onClick: () => playerSheet(myP) }, '❤ ' + myP.life),
      h('button', { onClick: () => session.dispatch({ t: 'life', target: me(), delta: 1 }) }, '+'),
    );
    const playBtn = h('button', { class: 'btn play', 'data-action': 'play', disabled: myP.eliminated, onClick: () => playCard() }, '＋ Jugar carta');

    append(hud, [track, h('div', { class: 'help' }, h('span', { class: 'help-ico' }, '💡'), help), ui.hudExtra, h('div', { class: 'hud-row' }, lifeCtl, primary, playBtn)]);
  }

  function manaHint(p) {
    const n = manaSources(p).length;
    const land = p.landsPlayed ? ' Ya has jugado tierra este turno.' : ' Aún puedes jugar una tierra.';
    return ` Tienes ${n} fuente${n === 1 ? '' : 's'} de maná enderezada${n === 1 ? '' : 's'}.` + land;
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
          setTimeout(() => burst(el, e.color, 22), 380);
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
            Object.assign(ghost.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
            fx.append(ghost);
            setTimeout(() => ghost.remove(), 900);
          }
        }
      } else if (e.kind === 'life') {
        const target = document.querySelector(`[data-life="${e.target}"]`);
        floatText(target, (e.delta > 0 ? '+' : '') + e.delta, e.delta > 0 ? 'gain' : 'loss');
        if (e.delta < 0 && e.target === me()) screen.classList.add('hurt'), setTimeout(() => screen.classList.remove('hurt'), 450);
      } else if (e.kind === 'turn') {
        showBanner(e.player === me() ? '¡Tu turno!' : 'Turno de ' + player(s, e.player).name);
      } else if (e.kind === 'attack') {
        showBanner('⚔ ¡Ataque!');
      } else if (e.kind === 'illegal' && e.to === me()) {
        illegalSheet(e);
      } else if (e.kind === 'out') {
        toast(e.text, 'warn', 4000);
      } else if (e.kind === 'pump' || e.kind === 'hit') {
        const el = ui.els.get(e.uid);
        if (el) burst(el, e.kind === 'pump' ? 'G' : 'R', 12);
      }
    }
    // Limpia elementos de permanentes que ya no existen.
    for (const [uid, el] of ui.els) if (!findPerm(s, uid)) { el.remove(); ui.els.delete(uid); }
  }

  function showBanner(text) {
    banner.textContent = text;
    banner.classList.remove('show');
    void banner.offsetWidth;
    banner.classList.add('show');
  }

  function spellFx(card, color) {
    const el = h('div', { class: 'spell-fx' }, cardFace(card));
    fx.append(el);
    setTimeout(() => burst(el, color, 30), 700);
    setTimeout(() => el.remove(), 1500);
  }

  // ------------------------------------------------------- interacciones
  function onPermTap(uid) {
    const s = S();
    const f = findPerm(s, uid);
    if (!f) return;
    const { perm, owner } = f;
    const myTurn = activePlayer(s).id === me();
    if (s.step === 'attack' && myTurn && owner.id === me() && perm.card.isCreature) {
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
    const close = sheet(h('div', {},
      h('h3', {}, `¿A quién bloquea ${displayName(perm.card)} (${power(perm)}/${toughness(perm)})?`),
      h('div', { class: 'choice-list' },
        attackers.map((a) => h('button', { class: 'choice', onClick: () => { close(); session.dispatch({ t: 'block', uid: perm.uid, attacker: a.uid }); } },
          cardFace(a.card), h('span', {}, `${displayName(a.card)} — ${power(a)}/${toughness(a)}`))),
        h('button', { class: 'btn ghost', onClick: () => { close(); session.dispatch({ t: 'block', uid: perm.uid, attacker: null }); } }, 'No bloquear'),
      ),
    ));
  }

  function permSheet(perm, owner) {
    const mine = owner.id === me();
    let close;
    const act = (a) => () => { close(); session.dispatch(a); };
    const dmgRow = h('div', { class: 'dmg-row' }, h('span', {}, 'Hacer daño:'),
      [1, 2, 3, 4, 5].map((n) => h('button', { class: 'mini', onClick: act({ t: 'damage', uid: perm.uid, amount: n }) }, n)));
    const buttons = h('div', { class: 'actions' },
      h('button', { class: 'btn', onClick: act({ t: 'tap', uid: perm.uid }) }, perm.tapped ? '↺ Enderezar' : '↻ Girar'),
      perm.card.isCreature ? [
        h('button', { class: 'btn', onClick: act({ t: 'pump', uid: perm.uid, p: 3, t: 3 }) }, '+3/+3 hasta fin de turno'),
        h('button', { class: 'btn', onClick: act({ t: 'counter', uid: perm.uid, delta: 1 }) }, 'Contador +1/+1'),
        h('button', { class: 'btn', onClick: act({ t: 'counter', uid: perm.uid, delta: -1 }) }, 'Contador −1/−1'),
      ] : null,
      h('button', { class: 'btn danger', onClick: act({ t: 'move', uid: perm.uid, to: 'graveyard' }) }, '🪦 Destruir / al cementerio'),
      h('button', { class: 'btn', onClick: act({ t: 'move', uid: perm.uid, to: 'exile' }) }, '🌀 Exiliar'),
      h('button', { class: 'btn', onClick: act({ t: 'move', uid: perm.uid, to: 'hand' }) }, '✋ Devolver a la mano'),
    );
    close = sheet(cardInfo(perm.card, [
      h('p', { class: 'muted' }, mine ? 'Tu permanente.' : `Permanente de ${owner.name}. Usa estos botones cuando un hechizo tuyo le afecte.`),
      perm.card.isCreature ? dmgRow : null,
      buttons,
    ]));
  }

  function playerSheet(p) {
    const s = S();
    let close;
    const d = (a) => () => session.dispatch(a);
    const content = h('div', {},
      h('h3', {}, p.name),
      h('div', { class: 'life-ctl' },
        h('button', { onClick: d({ t: 'life', target: p.id, delta: -5 }) }, '−5'),
        h('button', { onClick: d({ t: 'life', target: p.id, delta: -1 }) }, '−1'),
        h('span', { class: 'life-num' }, '❤'),
        h('button', { onClick: d({ t: 'life', target: p.id, delta: 1 }) }, '+1'),
        h('button', { onClick: d({ t: 'life', target: p.id, delta: 5 }) }, '+5'),
      ),
      h('div', { class: 'life-ctl small' }, h('span', {}, 'Veneno ☠'),
        h('button', { onClick: d({ t: 'poison', target: p.id, delta: -1 }) }, '−'),
        h('button', { onClick: d({ t: 'poison', target: p.id, delta: 1 }) }, '+')),
      s.mode === 'commander'
        ? h('div', {}, h('h4', {}, 'Daño de comandante recibido'),
          s.players.filter((o) => o.id !== p.id).map((o) => h('div', { class: 'life-ctl small' },
            h('span', {}, `${o.name}: ${p.cmdDamage[o.id] || 0}/21`),
            h('button', { onClick: d({ t: 'cmdDamage', target: p.id, from: o.id, delta: -1 }) }, '−'),
            h('button', { onClick: d({ t: 'cmdDamage', target: p.id, from: o.id, delta: 1 }) }, '+'))))
        : null,
      h('p', { class: 'muted' }, 'Ajusta las vidas cuando un hechizo haga daño directo a un jugador o te haga ganar vidas.'),
      h('button', { class: 'btn', onClick: () => close() }, 'Hecho'),
    );
    close = sheet(content);
  }

  function showZone(p, zone) {
    const cards = p[zone];
    const label = zone === 'graveyard' ? 'Cementerio' : 'Exilio';
    sheet(h('div', {},
      h('h3', {}, `${label} de ${p.name} (${cards.length})`),
      cards.length ? h('div', { class: 'zone-grid' }, [...cards].reverse().map((c) => cardFace(c))) : h('p', { class: 'muted' }, zone === 'graveyard' ? 'Aquí van las criaturas que mueren y los hechizos ya usados.' : 'Aquí van las cartas exiliadas: quedan fuera de la partida.'),
    ));
  }

  function commandAction(p) {
    if (p.id !== me()) {
      if (p.commander) sheet(cardInfo(p.commander, h('p', { class: 'muted' }, `Comandante de ${p.name}.`)));
      return;
    }
    if (!p.commander) {
      openPicker((card) => session.dispatch({ t: 'setCommander', card }), {
        title: 'Elige tu comandante', confirmLabel: 'Este es mi comandante', showLands: false,
        filter: (c) => (c.isLegendary && c.isCreature) || /can be your commander/i.test(c.oracle) ? null : 'Tu comandante debe ser una criatura legendaria.',
      });
      return;
    }
    if (!p.commanderInZone) {
      toast('Tu comandante ya está en el campo de batalla.', 'info');
      return;
    }
    let close;
    close = sheet(cardInfo(p.commander, [
      h('p', {}, `Coste: ${p.commander.manaCost}${p.commanderTax ? ` + ${p.commanderTax} de impuesto de comandante` : ''}.`),
      h('button', { class: 'btn primary', onClick: () => { close(); session.dispatch({ t: 'castCommander' }); } }, '👑 Lanzar comandante'),
    ]));
  }

  function illegalSheet(e) {
    let close;
    close = sheet(h('div', { class: 'illegal' },
      h('h3', {}, '✋ Un momento…'),
      h('p', {}, e.text),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onClick: () => close() }, 'Entendido'),
        e.action ? h('button', { class: 'btn ghost', onClick: () => { close(); session.dispatch({ ...e.action, force: true }); } }, 'Hacerlo igualmente') : null,
      ),
    ));
  }

  function playCard() {
    openPicker((card) => {
      session.dispatch({ t: 'play', card });
      if (!card.isPermanent) {
        setTimeout(() => toast('Aplica su efecto: toca la criatura objetivo (daño, +X/+X, destruir…) o ajusta las vidas.', 'info', 5000), 900);
      }
    });
  }

  // ------------------------------------------------------------ menús
  function openMenu() {
    let close;
    const st = ui.settings;
    const slider = (label, key, min, max, step) => h('label', { class: 'slider' }, h('span', {}, label),
      h('input', { type: 'range', min, max, step, value: st[key], onInput: (e) => { st[key] = +e.target.value; saveSettings(st); applySettings(); } }));
    close = sheet(h('div', { class: 'menu-sheet' },
      h('h3', {}, 'Ajustes de la mesa'),
      h('p', { class: 'muted' }, 'Apunta el móvil a tu mesa y ajusta la inclinación para que el tapete virtual encaje con ella.'),
      slider('Inclinación', 'tilt', 0, 60, 1),
      slider('Tamaño', 'zoom', 0.6, 1.3, 0.05),
      h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: st.camera, onChange: (e) => { st.camera = e.target.checked; saveSettings(st); applySettings(); } }), ' Usar la cámara de fondo'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onClick: () => { close(); openLog(); } }, '📜 Historial de la partida'),
        h('button', { class: 'btn danger', onClick: () => { close(); if (confirm('¿Rendirte?')) session.dispatch({ t: 'concede' }); } }, '🏳 Rendirse'),
        h('button', { class: 'btn', onClick: () => { close(); exit(); } }, '🚪 Salir al menú'),
      ),
    ));
  }

  function openLog() {
    const s = S();
    sheet(h('div', { class: 'log' }, h('h3', {}, 'Historial'), h('ol', {}, [...s.log].reverse().slice(0, 80).map((l) => h('li', {}, l)))), { className: 'tall' });
  }

  function exit() {
    unsub();
    wakeLock?.release?.().catch(() => {});
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
    render: () => render(S()),
    onRender(fn) { ui.hooks.add(fn); return () => ui.hooks.delete(fn); },
    setHudExtra(el) { ui.hudExtra = el; render(S()); },
    exit,
  };
}

export { manaColor };
