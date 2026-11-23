// Textos didácticos: explicaciones de palabras clave y tipos de carta.

export const KEYWORDS = {
  flying: ['Vuela', 'Sólo puede ser bloqueada por criaturas con vuela o alcance.'],
  reach: ['Alcance', 'Puede bloquear criaturas con vuela.'],
  haste: ['Prisa', 'Puede atacar (y girarse) el mismo turno en que entra al campo de batalla.'],
  vigilance: ['Vigilancia', 'Atacar no hace que se gire: puede atacar y luego bloquear en el turno del rival.'],
  trample: ['Arrollar', 'Si es bloqueada, el daño que sobre después de matar a los bloqueadores pasa al jugador.'],
  deathtouch: ['Toque mortal', 'Cualquier cantidad de daño que haga a una criatura es suficiente para destruirla.'],
  lifelink: ['Vínculo vital', 'El daño que hace también te hace ganar esa misma cantidad de vidas.'],
  defender: ['Defensor', 'No puede atacar.'],
  'first strike': ['Dañar primero', 'Hace su daño de combate antes que las criaturas sin esta habilidad: si mata a su rival, éste no llega a golpear.'],
  'double strike': ['Dañar dos veces', 'Hace daño de combate dos veces: en el paso de dañar primero y en el normal.'],
  infect: ['Infectar', 'Hace daño a los jugadores en forma de contadores de veneno (con 10 se pierde) y a las criaturas en forma de contadores -1/-1.'],
  wither: ['Marchitar', 'Hace daño a las criaturas en forma de contadores -1/-1 (no se curan al final del turno).'],
  protection: ['Protección', 'Protección contra un color (o contra todo): no puede ser bloqueada, ni objetivo, ni recibir daño de cosas de ese color.'],
  unblockable: ['No puede ser bloqueada', 'Ninguna criatura puede bloquearla.'],
  flash: ['Destello', 'Puedes lanzarla en cualquier momento, como un instantáneo.'],
  hexproof: ['Antimaleficio', 'Tus rivales no pueden hacerla objetivo de sus hechizos o habilidades.'],
  menace: ['Amenaza', 'Sólo puede ser bloqueada por dos o más criaturas.'],
  indestructible: ['Indestructible', 'El daño y los efectos de "destruir" no la mandan al cementerio.'],
  ward: ['Custodia', 'Si un rival la hace objetivo, tiene que pagar un coste extra o su hechizo se contrarresta.'],
  shroud: ['Velo', 'Nadie puede hacerla objetivo de hechizos o habilidades.'],
};

export function explainType(card) {
  if (card.isLand) return 'TIERRA: no cuesta maná. Puedes jugar una por turno en tu fase principal. Gírala para obtener maná.';
  if (card.isCreature) return 'CRIATURA: un permanente que puede atacar y bloquear. Los números abajo a la derecha son fuerza/resistencia. El turno que entra está "mareada" y no puede atacar.';
  if (card.isInstant) return 'INSTANTÁNEO: puedes lanzarlo en cualquier momento, incluso en el turno del rival o durante un combate. Después va al cementerio.';
  if (card.isSorcery) return 'CONJURO: sólo en tu fase principal. Haces lo que dice y va al cementerio.';
  if (/Planeswalker/.test(card.typeLine)) return 'PLANESWALKER: un aliado poderoso con contadores de lealtad. Puedes usar una habilidad suya por turno.';
  if (/Artifact/.test(card.typeLine)) return 'ARTEFACTO: un permanente (objeto mágico) que se queda en el campo de batalla.';
  if (/Enchantment/.test(card.typeLine)) return 'ENCANTAMIENTO: un permanente con un efecto continuo mientras esté en el campo de batalla.';
  return 'Carta de Magic.';
}

export function keywordList(card) {
  return card.keywords.filter((k) => KEYWORDS[k]).map((k) => KEYWORDS[k]);
}

export const RULES = [
  ['🎯 Objetivo', 'Cada jugador empieza con 20 vidas (40 en Commander). Gana quien deja a sus rivales a 0.'],
  ['🃏 Preparación', 'Baraja tu mazo (biblioteca) y roba 7 cartas. Si no te gusta tu mano puedes hacer mulligan: barajas y robas 7 otra vez, y luego pones 1 carta debajo por cada mulligan.'],
  ['🌲 Tierras y maná', 'Las tierras producen maná al girarlas. Hay 5 colores: blanco (llanura), azul (isla), negro (pantano), rojo (montaña) y verde (bosque). Una tierra por turno.'],
  ['💎 Coste de maná', 'Arriba a la derecha de cada carta. Los números se pagan con maná de cualquier color; los símbolos de color necesitan maná de ese color.'],
  ['🔄 El turno', 'Inicio (enderezar, mantenimiento, robar) → Fase principal 1 → Combate (inicio, atacantes, bloqueadores, daño, final) → Fase principal 2 → Final (paso final y limpieza). En un duelo, quien empieza no roba en su primer turno.'],
  ['⚔️ Combate', 'El jugador activo elige atacantes; el defensor elige bloqueadores. Cada criatura hace daño igual a su fuerza; muere si recibe daño igual o mayor que su resistencia.'],
  ['😵 Mareo de invocación', 'Una criatura no puede atacar ni usar habilidades con {T} el turno que entra, salvo que tenga prisa.'],
  ['⚡ Instantáneos', 'Se pueden lanzar en cualquier momento, también en el turno del rival. Los conjuros y permanentes sólo en tu fase principal.'],
  ['🪦 Zonas', 'Biblioteca (mazo), mano, campo de batalla, cementerio (cartas usadas o destruidas), exilio (cartas fuera del juego) y, en Commander, la zona de mando.'],
  ['👑 Commander', 'Mazos de 100 cartas sin repetir (salvo tierras básicas) liderados por una criatura legendaria: tu comandante. Empiezas con 40 vidas. Lanzar el comandante desde la zona de mando cuesta 2 más cada vez; si muere o se exilia puede volver a la zona de mando. 21 daños de combate de un mismo comandante te eliminan.'],
  ['👥 Multijugador', 'Con 3 o más jugadores, quien empieza sí roba en su primer turno y el primer mulligan es gratis. Puedes atacar a varios rivales a la vez (cada criatura elige a quién).'],
  ['🧙 Planeswalkers', 'Tienen lealtad. Puedes atacarlos en vez de al jugador; el daño que reciben les quita lealtad y con 0 van al cementerio.'],
  ['🥞 La pila', 'Cuando se lanza un hechizo, va a la pila y los rivales pueden responder con instantáneos. Lo último que se lanza se resuelve primero.'],
];
