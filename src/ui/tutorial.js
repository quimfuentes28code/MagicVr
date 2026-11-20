// Tutorial guiado sobre una partida real contra un bot de entrenamiento.

import { h } from './dom.js';
import { localCard, BASICS } from '../engine/cards.js';
import { player, activePlayer } from '../engine/game.js';

const mine = (s, id) => player(s, id).battlefield;
const count = (s, id, f) => mine(s, id).filter(f).length;

function steps(me) {
  return [
    {
      title: '¡Bienvenido a la mesa!',
      text: 'En Magic cada jugador empieza con 20 vidas. Ganas si dejas a tu rival a 0. Vamos a jugar una partida de práctica contra un bot paso a paso.',
    },
    {
      title: 'Tu mesa a través del móvil',
      text: 'Apunta la cámara a la mesa donde pones tus cartas físicas. El tapete virtual te muestra dónde va cada cosa: abajo tu lado, arriba el del rival. En ☰ puedes ajustar la inclinación.',
      focus: '.mat',
    },
    {
      title: 'Las zonas',
      text: 'A un lado tienes tu Biblioteca (el mazo boca abajo), el Cementerio (cartas usadas o destruidas) y el Exilio (cartas fuera de la partida). En el centro va el campo de batalla: criaturas delante, tierras detrás.',
      focus: '.half.me .side',
    },
    {
      title: 'Tus vidas',
      text: 'Aquí ves tus vidas. Puedes ajustarlas con − y +, o tocando el número para más opciones.',
      focus: '.my-life',
    },
    {
      title: 'El turno',
      text: 'Cada turno tiene fases: Inicio (enderezar, mantenimiento, robar), Principal 1, Combate, Principal 2 y Final. El 💡 siempre te explica qué puedes hacer ahora.',
      focus: '.phase-track',
    },
    {
      title: 'Roba tu mano inicial',
      text: 'Baraja tu mazo físico y roba 7 cartas. Si no tienes cartas a mano, no pasa nada: usa los botones de ejemplo.',
    },
    {
      title: 'Juega una tierra',
      text: 'Las tierras dan el maná para lanzar hechizos. Pon un Bosque en la mesa y pulsa "＋ Jugar carta" para escanearlo (o usa el atajo "Bosque").',
      focus: '[data-action="play"]',
      example: { label: 'Usar un Bosque de ejemplo', actions: [{ t: 'play', card: BASICS.G, force: true }] },
      until: (s) => count(s, me, (p) => p.card.isLand) >= 1,
    },
    {
      title: '¡Tierra en juego!',
      text: 'Sólo puedes jugar UNA tierra por turno. Para usarla, se gira (se pone de lado): eso produce 1 maná de su color. La app gira tus tierras automáticamente al lanzar algo.',
      focus: '.half.me .row.lands',
    },
    {
      title: 'Lanza una criatura',
      text: 'Con 1 maná verde puedes lanzar una criatura de coste {G}, como los Elfos de Llanowar. Escanea una criatura de coste 1 tuya o usa la de ejemplo.',
      focus: '[data-action="play"]',
      example: { label: 'Usar Elfos de Llanowar', actions: [{ t: 'play', card: localCard('Llanowar Elves'), force: true }] },
      until: (s) => count(s, me, (p) => p.card.isCreature) >= 1,
    },
    {
      title: 'Mareo de invocación 💤',
      text: 'Las criaturas no pueden atacar el turno que entran. Ahora pulsa "Siguiente fase" hasta "Pasar turno" para terminar tu turno.',
      focus: '.hud .btn.primary',
      until: (s) => activePlayer(s).id !== me,
    },
    {
      title: 'Turno del rival',
      text: 'El bot juega su turno: roba, juega una tierra y quizá una criatura. Mira cómo aparecen en su lado de la mesa.',
      until: (s) => activePlayer(s).id === me,
    },
    {
      title: 'Tu segundo turno',
      text: 'Primero se enderezan tus cartas y robas una carta (cógela de tu mazo físico). Avanza hasta la Fase principal 1.',
      focus: '.phase-track',
      until: (s) => activePlayer(s).id === me && s.step === 'main1',
    },
    {
      title: 'Más maná, criaturas más grandes',
      text: 'Juega otra tierra y lanza una criatura de 2 maná, como los Osos pardos ({1}{G}: 1 de cualquier color + 1 verde).',
      focus: '[data-action="play"]',
      example: {
        label: 'Usar Bosque + Osos pardos',
        actions: [{ t: 'play', card: BASICS.G, force: true }, { t: 'play', card: localCard('Grizzly Bears'), force: true }],
      },
      until: (s) => count(s, me, (p) => p.card.isCreature) >= 2,
    },
    {
      title: '¡A combatir! ⚔',
      text: 'Pulsa "Siguiente fase" hasta "Declarar atacantes". Toca la criatura que brilla (la que ya no está mareada) y luego pulsa "Atacar".',
      focus: '.hud .btn.primary',
      until: (s) => s.step === 'damage' || (activePlayer(s).id === me && s.step === 'main2'),
    },
    {
      title: 'Resultado del combate',
      text: 'Si el rival no bloquea, pierde vidas igual a la fuerza de tu criatura. Si bloquea, las criaturas se hacen daño entre sí: muere la que reciba daño igual o mayor a su resistencia.',
      focus: '.help',
    },
    {
      title: 'Instantáneos ⚡',
      text: 'Los instantáneos se lanzan en cualquier momento. Por ejemplo, Crecimiento gigante da +3/+3 a una criatura hasta el final del turno. Tras lanzarlo, toca la criatura y elige "+3/+3".',
      example: { label: 'Lanzar Crecimiento gigante', actions: [{ t: 'play', card: localCard('Giant Growth'), force: true }] },
    },
    {
      title: '¡Ya sabes lo básico!',
      text: 'Sigue la partida contra el bot. Toca cualquier carta para ver qué hace, y el 💡 te guiará en cada fase. ¡Suerte!',
      last: true,
    },
  ];
}

export function startTutorial(table) {
  const me = table.session.me;
  const list = steps(me);
  let i = 0;
  const box = h('div', { class: 'coach' });
  table.screen.append(box);

  const draw = () => {
    const st = list[i];
    const s = table.session.state;
    const waiting = st.until && !st.until(s);
    box.replaceChildren(
      h('div', { class: 'coach-head' }, h('span', {}, `Tutorial ${i + 1}/${list.length}`), h('button', { class: 'coach-x', onClick: finish }, 'Saltar ✕')),
      h('h3', { onClick: () => box.classList.toggle('min') }, st.title + (box.classList.contains('min') ? ' ▾' : '')),
      h('p', {}, st.text),
      h('div', { class: 'row' },
        st.example && (waiting || !st.until)
          ? h('button', { class: 'btn ghost', onClick: () => st.example.actions.forEach((a) => table.session.dispatch(a)) }, st.example.label)
          : null,
        waiting ? h('span', { class: 'coach-wait' }, '⏳ Esperando…') : h('button', { class: 'btn primary', onClick: st.last ? finish : nextStep }, st.last ? '¡A jugar!' : 'Siguiente →'),
      ),
    );
    document.querySelectorAll('.tut-focus').forEach((el) => el.classList.remove('tut-focus'));
    if (st.focus) document.querySelectorAll(st.focus).forEach((el) => el.classList.add('tut-focus'));
  };

  const nextStep = () => {
    box.classList.remove('min');
    i = Math.min(list.length - 1, i + 1);
    draw();
  };

  const off = table.onRender((s) => {
    const st = list[i];
    if (st.until && st.until(s)) {
      // Avanza solo cuando se cumple la condición.
      i = Math.min(list.length - 1, i + 1);
    }
    draw();
  });

  function finish() {
    off();
    box.remove();
    document.querySelectorAll('.tut-focus').forEach((el) => el.classList.remove('tut-focus'));
  }

  draw();
}
