// Qué habilidades aplica de verdad el motor (para la auditoría de cobertura).
// Cada vez que el motor aprende algo nuevo, se añade aquí.
import { parseAbilities } from './abilities.js';

/** Efectos que el motor aplica (kind, y una comprobación opcional de variantes). */
export const FX_SUPPORTED = {
  damage: (e) => ['any', 'creature', 'permanent', 'player', 'opponents', 'all', 'allPlayers', 'self'].includes(e.target),
  destroy: () => true, exile: () => true, bounce: () => true, destroyAll: () => true, exileAll: () => true, bounceAll: () => true,
  bounceSelf: () => true, tuck: () => true,
  pump: () => true, pumpAll: () => true,
  counter: () => true, counterAll: () => true, proliferate: () => true,
  counterspell: () => true,
  drain: () => true, gain: () => true, lose: () => true, loseAll: () => true, gainAll: () => true,
  draw: () => true, drawOther: () => true, discard: () => true,
  token: () => true, artifactToken: () => true, amass: () => true, tokenAttach: () => true,
  regrow: () => true, reanimate: () => true,
  impulse: () => true, extraLand: () => true, tapHost: () => true, tap: () => true, untap: () => true, tapAll: () => true, untapAll: () => true,
  untapSelf: () => true, tapSelf: () => true, freeze: () => true,
  noBlock: () => true, noBlockAll: () => true, unblockable: () => true,
  bite: () => true, fight: () => true, pickMine: () => true,
  mill: () => true, scry: () => true, surveil: () => true, tutor: () => true, instruct: () => true, explore: () => true, connive: () => true,
  edict: () => true, sacSelf: () => true, regen: () => true, addMana: () => true, attachTo: () => true,
  attachToChosen: () => true, selfToHand: () => true, selfRecur: () => true, exileSelf: () => true, energy: () => true, monstrosity: () => true,
  adapt: () => true, chargeCounter: () => true, prevent: () => true, fog: () => true, threaten: () => true, steal: () => true,
  untapLast: () => true, hasteLast: () => true, controllerLife: () => true, controllerLifePower: () => true, delayedDraw: () => true,
  delayedSac: () => true, support: () => true, bolster: () => true, exileGraveCard: () => true, exileGraveyard: () => true, damageEach: () => true,
  mayPay: () => true, copySpell: () => true, flicker: () => true, flickerBack: () => true, reanimateAny: () => true, copyToken: () => true,
  returnLand: () => true, discover: () => true, incubate: () => true, manifest: () => true, earthbend: () => true, regenHost: () => true,
  payOrSac: () => true, addChosen: () => true, win: () => true, basePT: () => true, toLibrary: () => true, freeCast: () => true,
  hostZone: () => true, hostTap: () => true, tapToggle: () => true, selfTuck: () => true,
  extraTurn: () => true, freezeLast: () => true, returnExiled: () => true, switchPT: () => true, canAttackDefender: () => true, putLand: () => true,
};
export const TRIGGERS_SUPPORTED = new Set(['etb', 'dies', 'leaves', 'attacks', 'blocks', 'blocked', 'combatDamagePlayer', 'upkeep', 'anyUpkeep',
  'endstep', 'anyEndstep', 'begincombat', 'main1', 'drawstep', 'otherEtbMine', 'otherEtbMineNontoken', 'creatureEtbMine', 'otherEtbAny',
  'creatureEtbOpp', 'landfall', 'otherDiesMine', 'creatureDiesMine', 'otherDiesAny', 'creatureDiesOpp', 'castNoncreature', 'castInstantSorcery',
  'castCreature', 'castAny', 'oppCast', 'gainLife', 'youAttack', 'creatureAttacksMine', 'creatureCombatDamageMine', 'hostCombatDamagePlayer',
  'hostAttacks', 'hostDies', 'anyCombat', 'artifactEtbMine', 'enchantmentEtbMine', 'castHistoric', 'castFirst', 'castAnyone', 'main2', 'oppUpkeep',
  'oppEndstep', 'cycled', 'castAuraEquip', 'permEtb', 'permDies', 'castFilter', 'youCombatDamage', 'attacksWithOthers']);
export const STATICS_SUPPORTED = new Set(['attach', 'extraLand', 'info', 'anthem', 'selfBuff', 'noBlockSelf', 'noAttackSelf', 'unblockableSelf',
  'menaceLike', 'noUntapSelf', 'entersTapped', 'entersCounters', 'blockOnlyFlyers', 'attackOnlyIf', 'evadePower', 'evadeSmaller', 'afterlife',
  'controlHost', 'addSac', 'addDiscard', 'addLife', 'persist', 'undying', 'kw', 'cumulative', 'echo', 'levelUp', 'levelInfo', 'varPT', 'forEach',
  'costReducer', 'selfReduce', 'noLifeGain', 'lifeBonus', 'skipDraw', 'sacUnless', 'lifelinkLike', 'evadeType', 'chooseOnEnter', 'strive']);
export const KEYWORDS_SUPPORTED = new Set(['flying', 'reach', 'first strike', 'double strike', 'deathtouch', 'trample', 'lifelink', 'haste',
  'vigilance', 'menace', 'defender', 'hexproof', 'shroud', 'indestructible', 'flash', 'infect', 'wither', 'protection', 'enchant', 'equip',
  'job select', 'living weapon', 'for mirrodin!', 'partner', 'partner with', 'choose a background', 'prowess', 'exalted', 'toxic', 'fear',
  'intimidate', 'shadow', 'horsemanship', 'skulk', 'changeling', 'devoid', 'crew', 'landwalk', 'swampwalk', 'islandwalk', 'forestwalk',
  'mountainwalk', 'plainswalk', 'kicker', 'cycling', 'typecycling', 'landcycling', 'basic', 'evoke', 'flashback', 'morph', 'megamorph',
  'disguise', 'dash', 'unearth', 'buyback', 'ward', 'convoke', 'delve', 'improvise', 'affinity', 'escape', 'persist', 'undying', 'bushido',
  'flanking', 'modular', 'bloodthirst', 'renown', 'vanishing', 'fading', 'firebending', 'backup', 'evolve', 'mentor', 'extort', 'storm',
  'rebound', 'cumulative', 'echo', 'myriad', 'banding', 'split second', 'daybound', 'nightbound', 'entwine', 'fabricate', 'exhaust']);

const fxOk = (fx) => fx.length > 0 && fx.every((e) => FX_SUPPORTED[e.kind] && FX_SUPPORTED[e.kind](e));

function judge(a) {
  if (!a.ok) return false;
  switch (a.kind) {
    case 'keyword': return KEYWORDS_SUPPORTED.has(a.kw);
    case 'trigger': return TRIGGERS_SUPPORTED.has(a.ev) && (a.modal ? true : fxOk(a.fx));
    case 'activated': return ACTIVATED_SUPPORTED && fxOk(a.fx);
    case 'mana': return true;
    case 'modal': return true;
    case 'spell': case 'mode': return fxOk(a.fx);
    case 'static': return STATICS_SUPPORTED.has(a.st?.kind);
    default: return false;
  }
}
export let ACTIVATED_SUPPORTED = true;
export const setActivatedSupported = (v) => { ACTIVATED_SUPPORTED = v; };

export const classifyAbility = {
  card(c) {
    return parseAbilities(c).map((a) => {
      const ok = judge(a);
      return { kind: a.kind, ok, template: ok ? null : (a.template || (a.kind === 'keyword' ? 'keyword: ' + a.kw : a.kind === 'trigger' && !a.ev ? '[trigger?] ' + a.condText : a.kind + ': ' + a.text)) };
    });
  },
};

/**
 * Partes de la carta que el motor NO aplica solo (para avisar al jugador).
 * Devuelve el texto de esas habilidades, en español si la carta lo tiene.
 */
export function manualParts(card) {
  const abil = parseAbilities(card);
  const res = abil.map((a) => judge(a));
  if (res.every(Boolean)) return [];
  const en = (card.oracle || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const es = (card.printedText || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const out = [];
  abil.forEach((a, i) => {
    if (res[i] || a.kind === 'mode') return;
    // busca la línea original de esta habilidad para mostrar su traducción
    const key = a.text.replace(/CARDNAME/g, '').slice(0, 18).toLowerCase();
    let li = en.findIndex((l) => l.toLowerCase().replace(card.name.toLowerCase(), '').includes(key.trim().slice(0, 12)));
    const txt = li >= 0 && es.length === en.length ? es[li] : li >= 0 ? en[li] : a.text.replace(/CARDNAME/g, card.printedName || card.name);
    if (!out.includes(txt)) out.push(txt);
  });
  return out;
}
