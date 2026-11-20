// Tutorial guiado sobre una partida real contra un bot de entrenamiento.

import { h } from './dom.js';
import { localCard, BASICS } from '../engine/cards.js';
import { player, activePlayer } from '../engine/game.js';

const mine = (s, id) => player(s, id).battlefield;
const count = (s, id, f) => mine(s, id).filter(f).length;

function steps(me) {
  return [
    {
      title: 'Bienvenido, aprendiz',
      text: 'En Magic cada jugador empieza con 20 vidas. Ganas si dejas a tu rival a 0. Vamos a jugar una partida de práctica contra un golem, paso a paso.',
    },
    {
      title: 'La mesa a través de la cámara',
      text: 'Sujeta el móvil en horizontal apuntando a tu mesa. Sobre la imagen verás el tablero holográfico: abajo tu lado, arriba el del rival. En ⚙ puedes ajustar su inclinación.',
      focus: '.board',
    },
    {
      title: 'Las zonas',
      text: 'A un lado tienes tu Biblioteca (el mazo boca abajo), el Cementerio (cartas usadas o destruidas) y el Exilio (cartas fuera de la partida). En el centro va el campo de batalla: criaturas delante, tierras detrás.',
      focus: '.side-row.me .zones',
    },
    {
      title: 'Tus vidas',
      text: 'Aquí ves tus vidas. Puedes ajustarlas con − y +, o tocando el número para más opciones.',
      focus: '.me-plate',
    },
    {
      title: 'El turno',
      text: 'Cada turno tiene fases: Inicio (enderezar, mantenimiento, robar), Principal 1, Combate, Principal 2 y Final. Abajo, el pergamino con el ojo te explica siempre qué puedes hacer ahora.',
      focus: '.phase-runes',
    },
    {
      title: 'Roba tu mano inicial',
      text: 'Baraja tu mazo físico y roba 7 cartas. Si no tienes cartas a mano, no pasa nada: usa los botones de ejemplo.',
    },
    {
      title: 'Juega una tierra',
      text: 'Las tierras dan el maná para lanzar hechizos. Coloca un Bosque dentro del círculo de invocación de la derecha: la cámara lo leerá sola y aparecerá en tu lado del tablero.',
      focus: '.summon-wrap',
      example: { label: 'Usar un Bosque de ejemplo', actions: [{ t: 'play', card: BASICS.G, force: true }] },
      until: (s) => count(s, me, (p) => p.card.isLand) >= 1,
    },
    {
      title: '¡Tierra en juego!',
      text: 'Sólo puedes jugar UNA tierra por turno. Para usarla, se gira (se pone de lado): eso produce 1 maná de su color. La app gira tus tierras automáticamente al lanzar algo.',
      focus: '.side-row.me .row.lands',
    },
    {
      title: 'Lanza una criatura',
      text: 'Con 1 maná verde puedes lanzar una criatura de coste {G}, como los Elfos de Llanowar. Pon una criatura de coste 1 en el círculo o usa la de ejemplo.',
      focus: '.summon-wrap',
      example: { label: 'Usar Elfos de Llanowar', actions: [{ t: 'play', card: localCard('Llanowar Elves'), force: true }] },
      until: (s) => count(s, me, (p) => p.card.isCreature) >= 1,
    },
    {
      title: 'Mareo de invocación',
      text: 'Las criaturas no pueden atacar el turno que entran. Verás «zZ» sobre ella. Ahora pulsa «Siguiente fase» hasta «Pasar turno» para terminar tu turno.',
      focus: '.hud .gem',
      until: (s) => activePlayer(s).id !== me,
    },
    {
      title: 'Turno del rival',
      text: 'El golem juega su turno: roba, juega una tierra y quizá una criatura. Mira cómo aparecen en su lado de la mesa.',
      until: (s) => activePlayer(s).id === me,
    },
    {
      title: 'Tu segundo turno',
      text: 'Primero se enderezan tus cartas y robas una carta (cógela de tu mazo físico). Avanza hasta la Fase principal 1.',
      focus: '.phase-runes',
      until: (s) => activePlayer(s).id === me && s.step === 'main1',
    },
    {
      title: 'Más maná, criaturas más grandes',
      text: 'Pon otra tierra en el círculo y luego una criatura de 2 maná, como los Osos pardos ({1}{G}: 1 de cualquier color + 1 verde).',
      focus: '.summon-wrap',
      example: {
        label: 'Usar Bosque + Osos pardos',
        actions: [{ t: 'play', card: BASICS.G, force: true }, { t: 'play', card: localCard('Grizzly Bears'), force: true }],
      },
      until: (s) => count(s, me, (p) => p.card.isCreature) >= 2,
    },
    {
      title: '¡Al combate!',
      text: 'Pulsa «Siguiente fase» hasta llegar al combate (runa ⚔). Toca la criatura que brilla en dorado y luego pulsa «Atacar».',
      focus: '.hud .gem',
      until: (s) => s.step === 'damage' || (activePlayer(s).id === me && s.step === 'main2'),
    },
    {
      title: 'Resultado del combate',
      text: 'Si el rival no bloquea, pierde vidas igual a la fuerza de tu criatura. Si bloquea, las criaturas se hacen daño entre sí: muere la que reciba daño igual o mayor a su resistencia.',
      focus: '.oracle',
    },
    {
      title: 'Instantáneos',
      text: 'Los instantáneos se lanzan en cualquier momento. Por ejemplo, Crecimiento gigante da +3/+3 a una criatura hasta el final del turno. Tras lanzarlo, toca la criatura y elige "+3/+3".',
      example: { label: 'Lanzar Crecimiento gigante', actions: [{ t: 'play', card: localCard('Giant Growth'), force: true }] },
    },
    {
      title: '¡Ya sabes lo básico!',
      text: 'Sigue la partida contra el golem. Toca cualquier carta del tablero para ver qué hace; el pergamino te guiará en cada fase. ¡Suerte, Planeswalker!',
      last: true,
    },
  ];
}

export function startTutorial(table) {
  const me = table.session.me;
  const list = steps(me);
  let i = 0;
  const box = h('div', { class: 'coach parchment' });
  table.screen.append(box);

  const draw = () => {
    const st = list[i];
    const s = table.session.state;
    const waiting = st.until && !st.until(s);
    box.replaceChildren(
      h('div', { class: 'coach-head' }, h('span', {}, `Lección ${i + 1} de ${list.length}`), h('button', { class: 'coach-x', onClick: finish }, 'Saltar tutorial')),
      h('h3', { onClick: () => box.classList.toggle('min') }, st.title + (box.classList.contains('min') ? ' ▾' : '')),
      h('p', {}, st.text),
      h('div', { class: 'row-btns' },
        st.example && (waiting || !st.until)
          ? h('button', { class: 'act', onClick: () => st.example.actions.forEach((a) => table.session.dispatch(a)) }, st.example.label)
          : null,
        waiting ? h('span', { class: 'coach-wait' }, 'Esperando a que lo hagas…') : h('button', { class: 'act primary', onClick: st.last ? finish : nextStep }, st.last ? '¡A jugar!' : 'Siguiente →'),
      ),
    );
    document.querySelectorAll('.tut-focus').forEach((el) => el.classList.remove('tut-focus'));
    if (st.focus) document.querySelectorAll(st.focus).forEach((el) => el.classList.add('tut-focus'));
  };

  const nextStep = () => {
    box.classList.remove('min');
    i = Math.min(list.length - 1, i + 1);
    // Si ya hizo lo que pide este paso, pasamos directamente al siguiente.
    while (list[i].until && list[i].until(table.session.state) && i < list.length - 1) i++;
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
