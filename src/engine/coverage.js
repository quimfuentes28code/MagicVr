// Qué habilidades aplica de verdad el motor (para la auditoría de cobertura).
// Cada vez que el motor aprende algo nuevo, se añade aquí.
import { parseAbilities } from './abilities.js';

/** Efectos que el motor aplica (kind, y una comprobación opcional de variantes). */
export const FX_SUPPORTED = {
  damage: (e) => ['any', 'creature', 'permanent', 'player', 'opponents'].includes(e.target) && e.amount !== 'X',
  destroy: () => true, exile: () => true, bounce: () => true, destroyAll: () => true, exileAll: () => true, bounceAll: () => true,
  bounceSelf: () => true, tuck: () => true,
  pump: (e) => e.p !== 'X' && e.t !== 'X', pumpAll: () => true,
  counter: (e) => e.amount !== 'X', counterAll: () => true, proliferate: () => true,
  counterspell: (e) => !e.unless,
  drain: () => true, gain: (e) => e.amount !== 'X', lose: () => true, loseAll: () => true, gainAll: () => true,
  draw: (e) => e.amount !== 'X', drawOther: () => true, discard: () => true,
  token: (e) => e.power !== 'X', artifactToken: () => true, amass: () => true, tokenAttach: () => true,
  regrow: () => true, reanimate: () => true,
  impulse: () => true, extraLand: () => true, tapHost: () => true, tap: () => true, untap: () => true, tapAll: () => true, untapAll: () => true,
  untapSelf: () => true, tapSelf: () => true, freeze: () => true,
  noBlock: () => true, noBlockAll: () => true, unblockable: () => true,
  bite: () => true, fight: () => true, pickMine: () => true,
  mill: () => true, scry: () => true, surveil: () => true, tutor: () => true, instruct: () => true, explore: () => true, connive: () => true,
  edict: () => true, sacSelf: () => true, regen: () => true, addMana: () => true, attachTo: () => true,
};
export const TRIGGERS_SUPPORTED = new Set(['etb', 'dies', 'leaves', 'attacks', 'blocks', 'blocked', 'combatDamagePlayer', 'upkeep', 'anyUpkeep',
  'endstep', 'anyEndstep', 'begincombat', 'main1', 'drawstep', 'otherEtbMine', 'otherEtbMineNontoken', 'creatureEtbMine', 'otherEtbAny',
  'creatureEtbOpp', 'landfall', 'otherDiesMine', 'creatureDiesMine', 'otherDiesAny', 'creatureDiesOpp', 'castNoncreature', 'castInstantSorcery',
  'castCreature', 'castAny', 'oppCast', 'gainLife', 'youAttack', 'creatureAttacksMine', 'creatureCombatDamageMine', 'hostCombatDamagePlayer',
  'hostAttacks', 'hostDies']);
export const STATICS_SUPPORTED = new Set(['attach', 'extraLand', 'info', 'anthem', 'selfBuff', 'noBlockSelf', 'noAttackSelf', 'unblockableSelf',
  'menaceLike', 'noUntapSelf', 'entersTapped', 'entersCounters']);
export const KEYWORDS_SUPPORTED = new Set(['flying', 'reach', 'first strike', 'double strike', 'deathtouch', 'trample', 'lifelink', 'haste',
  'vigilance', 'menace', 'defender', 'hexproof', 'shroud', 'indestructible', 'flash', 'infect', 'wither', 'protection', 'enchant', 'equip',
  'job select', 'living weapon', 'for mirrodin!', 'partner', 'partner with', 'choose a background', 'prowess', 'exalted', 'toxic', 'fear',
  'intimidate', 'shadow', 'horsemanship', 'skulk', 'changeling', 'devoid', 'crew', 'landwalk', 'swampwalk', 'islandwalk', 'forestwalk',
  'mountainwalk', 'plainswalk']);

const fxOk = (fx) => fx.length > 0 && fx.every((e) => FX_SUPPORTED[e.kind] && FX_SUPPORTED[e.kind](e));

function judge(a) {
  if (!a.ok) return false;
  switch (a.kind) {
    case 'keyword': return KEYWORDS_SUPPORTED.has(a.kw);
    case 'trigger': return TRIGGERS_SUPPORTED.has(a.ev) && fxOk(a.fx);
    case 'activated': return ACTIVATED_SUPPORTED && fxOk(a.fx);
    case 'mana': return true;
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
