// Lector de habilidades: divide el texto oficial de una carta en habilidades
// (palabras clave, disparadas, activadas, estáticas y texto de hechizo) y
// traduce cada una a algo que el motor sabe aplicar. Lo que no entiende queda
// marcado (ok: false) para que la mesa explique qué hacer a mano, y para la
// auditoría de cobertura (scripts/audit-cards.mjs).

import { parseTargetPhrase, targetEs, parseAttach } from './effects.js';

const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twice: 2, X: 'X', x: 'X' };
export const num = (s) => (s == null ? 1 : /^\d+$/.test(s) ? parseInt(s, 10) : NUM[s] ?? NUM[s.toLowerCase()] ?? 1);
const NUMW = '(a|an|one|two|three|four|five|six|seven|eight|nine|ten|x|X|\\d+)';
const COLOR_WORD = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G', colorless: 'C' };
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ------------------------------------------------------------ palabras clave

/** Palabras clave que el motor aplica (combate, objetivos, daño…). */
export const KW_ENGINE = new Set(['flying', 'reach', 'first strike', 'double strike', 'deathtouch', 'trample', 'lifelink', 'haste', 'vigilance',
  'menace', 'defender', 'hexproof', 'shroud', 'indestructible', 'flash', 'infect', 'wither', 'prowess', 'toxic', 'ward', 'fear', 'intimidate',
  'shadow', 'horsemanship', 'skulk', 'exalted', 'changeling', 'devoid', 'landwalk', 'protection', 'enchant', 'equip', 'flanking', 'bushido',
  'cycling', 'typecycling', 'landcycling', 'basic landcycling', 'flashback', 'kicker', 'treasure', 'food', 'clue', 'mill', 'scry', 'surveil',
  'investigate', 'convoke', 'improvise', 'delve', 'affinity', 'cascade', 'storm', 'partner', 'partner with', 'choose a background', 'crew',
  'job select', 'living weapon', 'for mirrodin!', 'rebound', 'escape', 'unearth', 'evoke', 'madness', 'foretell', 'plot', 'warp', 'echo',
  'cumulative upkeep', 'vanishing', 'fading', 'persist', 'undying', 'afflict', 'battle cry', 'dethrone', 'melee', 'rampage', 'provoke',
  'split second', 'suspend', 'morph', 'megamorph', 'disguise', 'manifest', 'manifest dread', 'cloak', 'bestow', 'mutate', 'ninjutsu',
  'entwine', 'splice', 'buyback', 'retrace', 'jump-start', 'aftermath', 'overload', 'spectacle', 'surge', 'emerge', 'dash', 'blitz',
  'prototype', 'squad', 'offspring', 'gift', 'exhaust', 'saddle', 'station', 'reconfigure', 'ascend', 'daybound', 'nightbound', 'transform',
  'riot', 'training', 'mentor', 'decayed', 'exploit', 'renown', 'monstrosity', 'adapt', 'amass', 'proliferate', 'explore', 'connive', 'goad',
  'incubate', 'discover', 'earthbend', 'more than meets the eye', 'casualty', 'bargain', 'craft', 'backup', 'enlist', 'read ahead',
  'companion', 'channel', 'forecast', 'transmute', 'hideaway', 'fabricate', 'modular', 'graft', 'sunburst', 'bloodthirst', 'outlast',
  'scavenge', 'embalm', 'eternalize', 'encore', 'boast', 'umbra armor', 'totem armor', 'cipher', 'haunt', 'replicate', 'champion',
  'evolve', 'extort', 'tribute', 'dredge', 'frenzy', 'bands with other', 'banding', 'phasing', 'epic', 'fuse', 'awaken', 'myriad',
  'annihilator', 'soulbond', 'miracle', 'devour', 'unleash', 'hexproof from', 'compleated', 'visit', 'prize', 'specialize', 'max speed',
  'start your engines!', 'impending', 'disturb', 'cleave', 'harmonize', 'mobilize', 'sneak', 'firebending', 'airbend', 'waterbend']);

const KW_PARAM = /^(protection from .+|hexproof from .+|ward(?:—| )?.+|toxic \d+|equip(?:—| ).+|enchant .+|cycling .+|\w+cycling .+|basic landcycling .+|flashback.+|kicker.+|multikicker.+|crew \d+|afflict \d+|bushido \d+|rampage \d+|cumulative upkeep.+|vanishing \d+|fading \d+|echo.+|suspend.+|morph.+|megamorph.+|disguise.+|bestow.+|mutate.+|ninjutsu.+|entwine.+|splice.+|buyback.+|escape.+|unearth.+|evoke.+|madness.+|foretell.+|plot.+|warp.+|dash.+|blitz.+|prototype.+|squad.+|offspring.+|gift .+|saddle \d+|station.*|reconfigure.+|overload.+|spectacle.+|surge.+|emerge.+|jump-start|retrace|annihilator \d+|modular \d+|graft \d+|fabricate \d+|bloodthirst \d+|outlast.+|scavenge.+|embalm.+|eternalize.+|encore.+|transmute.+|forecast.+|tribute \d+|dredge \d+|frenzy \d+|devour \d+|myriad|soulbond|miracle.+|craft with.+|backup \d+|casualty \d+|disturb.+|cleave.+|harmonize.+|mobilize \d+|sneak.+|impending.+|partner with .+|\w+walk|landwalk|affinity for .+|companion.+|channel.+|visit.+|max speed.*|exhaust.+|boast.+|renown \d+|training|mentor|decayed|riot|exploit|devoid|changeling|storm|cascade|convoke|delve|improvise|split second|persist|undying|undaunted|prowess|exalted|melee|dethrone|battle cry|provoke|flanking|shadow|horsemanship|fear|intimidate|skulk|menace|banding|phasing|epic|fuse|awaken.+|evolve|extort|cipher|haunt|replicate.+|champion .+|aftermath|ascend|daybound|nightbound|read ahead|enlist|bargain|compleated|start your engines!|for mirrodin!|job select|living weapon|umbra armor|totem armor|more than meets the eye.+|specialize.+|prize|hideaway \d+|sunburst)$/i;

/** ¿Es esta parte una palabra clave conocida? Devuelve su nombre normalizado. */
export function keywordOf(part) {
  const p = part.trim().replace(/\.$/, '');
  const low = p.toLowerCase();
  if (KW_ENGINE.has(low)) return low;
  if (KW_PARAM.test(p)) return low.split(/[ —]/)[0].replace(/walk$/, 'walk');
  return null;
}

// ------------------------------------------------------------ división

/** Texto limpio: sin recordatorios, con el nombre propio como CARDNAME. */
export function cleanText(card, text = card.oracle) {
  let t = (text || '').replace(/\([^)]*\)/g, '').replace(/[’]/g, "'").replace(/[ \t]+\n/g, '\n');
  const names = [card.name];
  if (card.name && card.name.includes(',')) names.push(card.name.split(',')[0]);
  for (const n of names) if (n && n.length > 2) t = t.replace(new RegExp('\\b' + escapeRe(n) + '\\b', 'g'), 'CARDNAME');
  t = t.replace(/\b[Tt]his (creature|artifact|enchantment|land|Aura|Equipment|Vehicle|permanent|planeswalker|battle|Saga|Spacecraft|Room|card|token|Class|Case)\b/g, 'CARDNAME');
  return t;
}

/** Divide en habilidades (líneas), quitando las «palabras de habilidad» (Landfall —, Raid —…). */
export function splitAbilities(card, text) {
  const t = cleanText(card, text);
  const out = [];
  for (let line of t.split('\n')) {
    line = line.trim();
    if (!line || line === '//') continue;
    let word = null;
    if (/^Exhaust — /.test(line)) { out.push({ text: line.replace(/^Exhaust — /, ''), word: 'Exhaust' }); continue; }
    const aw = line.match(/^([A-Z][\w'!,\- ]{1,40}?) — (.+)$/);
    if (aw && !/^(Equip|Ward|Kicker|Flashback|Cycling|Crew|Escape|Echo|Buyback|Madness|Morph|Suspend|Cumulative upkeep|Disguise|Plot|Warp|Foretell|Bestow|Unearth|Evoke|Ninjutsu|Reconfigure|Saddle|Station|Megamorph|Mutate|Entwine|Splice|Dash|Blitz|Overload|Spectacle|Surge|Emerge|Prototype|Squad|Offspring|Exhaust|Boast|Outlast|Scavenge|Embalm|Eternalize|Encore|Transmute|Forecast|Channel|Craft|Disturb|Cleave|Harmonize|Sneak|Impending|Miracle|Companion|Visit|Replicate|Awaken|Specialize|Multikicker|Retrace|Max speed)$/i.test(aw[1].split(' ').pop())) {
      word = aw[1];
      line = aw[2];
    }
    out.push({ text: line, word });
  }
  return out;
}

// ------------------------------------------------------------ efectos

const KWS = '(flying|first strike|double strike|deathtouch|trample|lifelink|haste|vigilance|menace|reach|hexproof|indestructible|defender|shroud|infect|wither|fear|intimidate|skulk|prowess)';
const kwList = (s) => (s || '').toLowerCase().split(/,\s*(?:and\s+)?|\s+and\s+/).map((x) => x.trim()).filter(Boolean);

function permT(ph) {
  const filter = parseTargetPhrase(ph);
  if (!filter) return null;
  const onlyCreature = filter.types.length === 1 && filter.types[0] === 'creature';
  return { target: onlyCreature ? 'creature' : 'permanent', filter };
}

/** Un objetivo de daño: «any target», «target creature», «target player or planeswalker», «each opponent»… */
function damageTarget(ph) {
  ph = ph.trim();
  if (/^any (other )?target$/i.test(ph)) return { target: 'any' };
  if (/^(target player|target opponent)( or planeswalker)?$/i.test(ph)) return { target: 'player' };
  if (/^each opponent$/i.test(ph)) return { target: 'opponents' };
  if (/^each player$/i.test(ph)) return { target: 'allPlayers' };
  if (/^you$/i.test(ph)) return { target: 'self' };
  if (/^(?:target )?(?:creature or player|player or creature)$/i.test(ph)) return { target: 'any' };
  if (/^each (creature|creature and each player|creature and planeswalker|other creature|creature you don't control|creature your opponents control|creature without flying|creature with flying|attacking creature|blocking creature|opponent and each creature (?:your opponents control|they control))$/i.test(ph)) {
    const m = ph.toLowerCase();
    return { target: 'all', players: /player|opponent and/.test(m), opp: /don't control|opponents control|opponent and|they control/.test(m), oppPlayers: /opponent and/.test(m),
      flying: /without flying/.test(m) ? false : /with flying/.test(m) ? true : null, other: /other/.test(m), combat: /attacking|blocking/.test(m) ? m.match(/attacking|blocking/)[0] : null };
  }
  const m = ph.match(/^(?:up to one )?(?:another )?target (.+)$/i);
  if (m) return permT(m[1]);
  return null;
}

const TOKEN_KINDS = { treasure: 'Treasure', food: 'Food', clue: 'Clue', blood: 'Blood', map: 'Map', gold: 'Gold', powerstone: 'Powerstone', junk: 'Junk', shard: 'Shard', lander: 'Lander' };

/**
 * Plantillas de efectos (una cláusula entera). Cada una devuelve un efecto o
 * una lista de efectos. El orden importa: las más concretas primero.
 */
const T = [
  // --- daño
  [/^CARDNAME deals (\d+|X) damage to (.+?)(?: and (\d+) damage to (.+))?$/i, (m) => {
    const t = damageTarget(m[2]);
    if (!t) return null;
    const out = [{ kind: 'damage', amount: num(m[1]), ...t }];
    if (m[3]) { const t2 = damageTarget(m[4]); if (!t2) return null; out.push({ kind: 'damage', amount: +m[3], ...t2 }); }
    return out;
  }],
  [/^CARDNAME deals (\d+) damage divided as you choose among (?:one, two, or three|any number of) targets$/i, (m) => ({ kind: 'damage', amount: +m[1], target: 'any' })],
  [/^(target creature you control|CARDNAME|target creature) deals damage equal to its power to (target creature(?: or planeswalker)?(?: you don't control| an opponent controls)?|any target|target player|each opponent|up to one target creature(?: or planeswalker)?(?: you don't control)?)$/i, (m) => {
    const t = damageTarget(m[2].replace(/^up to one /, '')) || { target: 'creature' };
    const self = /^CARDNAME$/i.test(m[1]);
    return self ? { kind: 'bite', self: true, ...t } : [{ kind: 'pickMine', target: 'creature', filter: { types: ['creature'], non: [], you: /you control/i.test(m[1]) } }, { kind: 'bite', ...t }];
  }],
  [/^(target creature you control|CARDNAME) fights (?:up to one )?(?:another )?target (creature(?: or planeswalker)?(?: you don't control| an opponent controls)?)$/i, (m) => {
    const t = permT(m[2]);
    const self = /^CARDNAME$/i.test(m[1]);
    return self ? { kind: 'fight', self: true, ...t } : [{ kind: 'pickMine', target: 'creature', filter: { types: ['creature'], non: [], you: true } }, { kind: 'fight', ...t }];
  }],
  // --- destruir / exiliar / devolver
  [/^destroy (?:up to one )?(?:another )?target (.+?)(?:\. it can't be regenerated)?$/i, (m) => { const p = permT(m[1]); return p && !/card/.test(m[1]) ? { kind: 'destroy', ...p } : null; }],
  [/^destroy (?:up to )?(two|three) target (.+)$/i, (m) => { const p = permT(m[2]); return p ? Array.from({ length: num(m[1]) }, () => ({ kind: 'destroy', ...p })) : null; }],
  [/^destroy all (.+?)(?:\. they can't be regenerated)?$/i, (m) => { const f = parseTargetPhrase(m[1]); return f ? { kind: 'destroyAll', filter: f } : null; }],
  [/^destroy each (.+)$/i, (m) => { const f = parseTargetPhrase(m[1]); return f ? { kind: 'destroyAll', filter: f } : null; }],
  [/^exile (?:up to one )?(?:another )?target (.+?)( until CARDNAME leaves the battlefield)?$/i, (m) => { if (/card|spell|graveyard|player/.test(m[1])) return null; const p = permT(m[1]); return p ? { kind: 'exile', ...p, untilLeaves: !!m[2] } : null; }],
  [/^return the exiled card(?:s)? to the battlefield under (?:its|their) owners?'s? control$/i, () => ({ kind: 'returnExiled' })],
  [/^return the exiled card(?:s)? to (?:its|their) owners?'s? hands?$/i, () => ({ kind: 'returnExiled', toHand: true })],
  [/^exile all (.+)$/i, (m) => { if (/card|graveyard/.test(m[1])) return null; const f = parseTargetPhrase(m[1]); return f ? { kind: 'exileAll', filter: f } : null; }],
  [/^return (?:up to one )?(?:another )?target (.+?) to (?:its|their) owner's hand$/i, (m) => { if (/card|spell/.test(m[1])) return null; const p = permT(m[1]); return p ? { kind: 'bounce', ...p } : null; }],
  [/^return all (.+?) to their owners' hands$/i, (m) => { const f = parseTargetPhrase(m[1]); return f ? { kind: 'bounceAll', filter: f } : null; }],
  [/^return CARDNAME to its owner's hand$/i, () => ({ kind: 'bounceSelf' })],
  [/^put target (.+?) on (top|the bottom) of its owner's library$/i, (m) => { const p = permT(m[1]); return p ? { kind: 'tuck', ...p } : null; }],
  // --- recuperar del cementerio
  [/^return (?:up to one )?target (creature|artifact|enchantment|instant or sorcery|instant|sorcery|permanent|land|creature or planeswalker|historic|legendary)? ?card (?:with mana value \d or less )?from your graveyard to your hand$/i, (m) => ({ kind: 'regrow', type: (m[1] || 'card').toLowerCase() })],
  [/^return (?:up to one )?target (creature|artifact|enchantment|permanent|land|creature or planeswalker)? ?card (?:with mana value \d or less )?from your graveyard to the battlefield(?: tapped)?$/i, (m) => ({ kind: 'reanimate', type: (m[1] || 'permanent').toLowerCase() })],
  [/^return CARDNAME from your graveyard to (your hand|the battlefield)(?: tapped)?$/i, (m) => ({ kind: 'selfRecur', to: /hand/.test(m[1]) ? 'hand' : 'battlefield' })],
  // --- girar / enderezar
  [/^(tap|untap) (?:up to one )?(?:another )?target (.+)$/i, (m) => { const p = permT(m[2]); return p ? { kind: m[1].toLowerCase(), ...p } : null; }],
  [/^(tap|untap) (?:up to )?(two|three) target (.+)$/i, (m) => { const p = permT(m[3]); return p ? Array.from({ length: num(m[2]) }, () => ({ kind: m[1].toLowerCase(), ...p })) : null; }],
  [/^tap (?:enchanted|equipped) creature$/i, () => ({ kind: 'tapHost' })],
  [/^(tap|untap) all (.+)$/i, (m) => { const f = parseTargetPhrase(m[2]); return f ? { kind: m[1].toLowerCase() + 'All', filter: f } : null; }],
  [/^untap CARDNAME$/i, () => ({ kind: 'untapSelf' })],
  [/^tap CARDNAME$/i, () => ({ kind: 'tapSelf' })],
  [/^(target creature|that creature|it) doesn't untap during its controller's next untap step$/i, () => ({ kind: 'freeze' })],
  // --- +X/+X y habilidades
  [new RegExp(`^(up to one target creature|target creature(?: you control| an opponent controls| you don't control)?|another target creature you control|CARDNAME|equipped creature|enchanted creature) gets? ([+-]\\d+|[+-]X)/([+-]\\d+|[+-]X)(?: and gains (.+?))? until end of turn$`, 'i'), (m) => {
    const who = m[1].toLowerCase();
    const e = { kind: 'pump', p: m[2].includes('X') ? 'X' : +m[2], t: m[3].includes('X') ? 'X' : +m[3], kw: kwList(m[4]) };
    if (who === 'cardname') return { ...e, self: true };
    if (/equipped|enchanted/.test(who)) return { ...e, host: true };
    return { ...e, target: 'creature', filter: parseTargetPhrase(who.replace(/^(up to one |another )?target /, '')) };
  }],
  [new RegExp(`^(up to one target creature|target creature(?: you control)?|CARDNAME|equipped creature) gains (.+?) until end of turn$`, 'i'), (m) => {
    const kws = kwList(m[2]);
    if (!kws.every((k) => new RegExp('^' + KWS + '$').test(k) || /^protection from/.test(k))) return null;
    const who = m[1].toLowerCase();
    return { kind: 'pump', p: 0, t: 0, kw: kws, ...(who === 'cardname' ? { self: true } : /equipped/.test(who) ? { host: true } : { target: 'creature' }) };
  }],
  [/^(?:other )?creatures you control get ([+-]\d+)\/([+-]\d+)(?: and gain (.+?))? until end of turn$/i, (m) => ({ kind: 'pumpAll', p: +m[1], t: +m[2], kw: kwList(m[3]), who: 'mine' })],
  [/^creatures you control gain (.+?) until end of turn$/i, (m) => ({ kind: 'pumpAll', p: 0, t: 0, kw: kwList(m[1]), who: 'mine' })],
  [/^creatures your opponents control get ([+-]\d+)\/([+-]\d+) until end of turn$/i, (m) => ({ kind: 'pumpAll', p: +m[1], t: +m[2], kw: [], who: 'opp' })],
  [/^all creatures get ([+-]\d+)\/([+-]\d+) until end of turn$/i, (m) => ({ kind: 'pumpAll', p: +m[1], t: +m[2], kw: [], who: 'all' })],
  [/^(target creature|that creature) can't block this turn$/i, () => ({ kind: 'noBlock', target: 'creature' })],
  [/^(target creature|that creature) can't (?:attack or block|block or attack) this turn$/i, () => ({ kind: 'noBlock', noAttack: true, target: 'creature' })],
  [/^creatures your opponents control can't block this turn$/i, () => ({ kind: 'noBlockAll' })],
  [/^(target creature|CARDNAME) can't be blocked this turn$/i, (m) => ({ kind: 'unblockable', ...(/CARDNAME/i.test(m[1]) ? { self: true } : { target: 'creature' }) })],
  // --- contadores
  [new RegExp(`^put ${NUMW} \\+1/\\+1 counters? on (up to one target creature|target creature(?: you control)?|another target creature you control|CARDNAME|each creature you control|each other creature you control|it|that creature|equipped creature|enchanted creature)$`, 'i'), (m) => {
    const who = m[2].toLowerCase();
    const n = num(m[1]);
    if (who === 'cardname' || who === 'it' || who === 'that creature') return { kind: 'counter', amount: n, self: true };
    if (/each/.test(who)) return { kind: 'counterAll', amount: n, other: /other/.test(who) };
    if (/equipped|enchanted/.test(who)) return { kind: 'counter', amount: n, host: true };
    return { kind: 'counter', amount: n, target: 'creature' };
  }],
  [new RegExp(`^put ${NUMW} -1/-1 counters? on (target creature(?: you don't control| an opponent controls)?|CARDNAME|each creature(?: you don't control| your opponents control)?|each other creature)$`, 'i'), (m) => {
    const who = m[2].toLowerCase();
    const n = num(m[1]);
    if (who === 'cardname') return { kind: 'counter', amount: -n, self: true };
    if (/each/.test(who)) return { kind: 'counterAll', amount: -n, opp: /don't control|opponents/.test(who), other: /other/.test(who), all: true };
    return { kind: 'counter', amount: -n, target: 'creature' };
  }],
  [/^proliferate$/i, () => ({ kind: 'proliferate' })],
  // --- robar / descartar
  [new RegExp(`^(?:you )?draw ${NUMW} cards?$`, 'i'), (m) => ({ kind: 'draw', amount: num(m[1]) })],
  [/^draw a card for each (.+)$/i, (m) => ({ kind: 'instruct', text: `Roba una carta por cada ${m[1]}.`, draw: true })],
  [new RegExp(`^(target player|target opponent|each player|each opponent) draws ${NUMW} cards?$`, 'i'), (m) => ({ kind: 'drawOther', who: m[1].toLowerCase(), amount: num(m[2]) })],
  [new RegExp(`^(?:you )?discard ${NUMW} cards?$`, 'i'), (m) => ({ kind: 'discard', amount: num(m[1]), who: 'you' })],
  [/^discard your hand$/i, () => ({ kind: 'discard', amount: 'all', who: 'you' })],
  [new RegExp(`^(target player|target opponent|each opponent|each player) discards ${NUMW} cards?(?: at random)?$`, 'i'), (m) => ({ kind: 'discard', amount: num(m[2]), who: m[1].toLowerCase() })],
  [/^draw (a card|two cards|three cards), then discard (a card|two cards)$/i, (m) => [{ kind: 'draw', amount: num(m[1].split(' ')[0]) }, { kind: 'discard', amount: num(m[2].split(' ')[0]), who: 'you' }]],
  [/^(?:you may )?discard a card\. if you do, draw a card$/i, () => ({ kind: 'instruct', text: 'Puedes descartar una carta; si lo haces, roba una.' })],
  // --- vidas
  [new RegExp(`^(?:you )?gain ${NUMW} life$`, 'i'), (m) => ({ kind: 'gain', amount: num(m[1]) })],
  [new RegExp(`^(?:you )?lose ${NUMW} life$`, 'i'), (m) => ({ kind: 'lose', amount: num(m[1]) })],
  [new RegExp(`^(each opponent|target opponent|target player|each player|that player|defending player) loses ${NUMW} life$`, 'i'), (m) => ({ kind: /each player/i.test(m[1]) ? 'loseAll' : 'drain', amount: num(m[2]), who: m[1].toLowerCase() })],
  [new RegExp(`^(each opponent|target opponent|target player) loses ${NUMW} life and you gain ${NUMW} life$`, 'i'), (m) => [{ kind: 'drain', amount: num(m[2]), who: m[1].toLowerCase() }, { kind: 'gain', amount: num(m[3]) }]],
  [new RegExp(`^(target player|target opponent) gains ${NUMW} life$`, 'i'), (m) => ({ kind: 'gain', amount: num(m[2]) })],
  [new RegExp(`^each player gains ${NUMW} life$`, 'i'), (m) => ({ kind: 'gainAll', amount: num(m[1]) })],
  [/^you gain life equal to (.+)$/i, (m) => ({ kind: 'instruct', text: `Ganas vidas igual a ${m[1]} (súmalas con el botón + de tu vida).` })],
  // --- fichas
  [new RegExp(`^[Cc]reate ${NUMW} (tapped )?(\\d+|X)/(\\d+|X) ((?:white|blue|black|red|green|colorless)(?:,? (?:and )?(?:white|blue|black|red|green))*) ([A-Z][\\w' -]*?) (?:artifact |enchantment )?creature tokens?(?: with (.+?))?(?: that's tapped and attacking| tapped and attacking)?$`, ''), (m) => ({
    kind: 'token', amount: num(m[1]), tapped: !!m[2], power: m[3] === 'X' ? 'X' : +m[3], toughness: m[4] === 'X' ? 'X' : +m[4],
    colors: m[5].split(/,? (?:and )?/).map((w) => COLOR_WORD[w]).filter((c) => c && c !== 'C'), subtype: m[6].trim(),
    keywords: kwList(m[7]).filter((k) => !k.includes('"')),
  })],
  [new RegExp(`^create ${NUMW} (tapped )?(Treasure|Food|Clue|Blood|Map|Gold|Powerstone|Junk|Shard|Lander) tokens?$`, 'i'), (m) => ({ kind: 'artifactToken', amount: num(m[1]), tapped: !!m[2], subtype: TOKEN_KINDS[m[3].toLowerCase()] })],
  [/^investigate( twice)?$/i, (m) => ({ kind: 'artifactToken', amount: m[1] ? 2 : 1, subtype: 'Clue' })],
  [/^amass (\w+) (\d+)$/i, (m) => ({ kind: 'amass', amount: +m[2], subtype: m[1] })],
  // --- maná
  [/^add ((?:\{[WUBRGC]\})+)$/i, (m) => ({ kind: 'addMana', mana: [...m[1].matchAll(/\{(\w)\}/g)].map((x) => [x[1]]) })],
  [/^add (one|two|three) mana of any (?:one )?color$/i, (m) => ({ kind: 'addMana', mana: Array.from({ length: num(m[1]) }, () => ['W', 'U', 'B', 'R', 'G']) })],
  [/^add (\{\w\}) or (\{\w\})$/i, (m) => ({ kind: 'addMana', mana: [[m[1][1], m[2][1]]] })],
  [/^add (\{\w\}), (\{\w\}), or (\{\w\})$/i, (m) => ({ kind: 'addMana', mana: [[m[1][1], m[2][1], m[3][1]]] })],
  // --- pila
  [/^counter target (?:creature |noncreature |instant or sorcery |instant |sorcery |artifact or enchantment |activated or triggered ability |activated ability |)?(spell|ability)(?: with mana value \d or less)?$/i, (m) => (m[1] === 'spell' ? { kind: 'counterspell', target: 'spell' } : { kind: 'instruct', text: 'Contrarresta la habilidad objetivo (se ignora su efecto).' })],
  [/^counter target (?:\w+ )?spell unless its controller pays (\{[^}]+\}|X)$/i, (m) => ({ kind: 'counterspell', target: 'spell', unless: m[1] })],
  // --- biblioteca y cementerio (cartas físicas: instrucciones claras; los bots lo hacen solos)
  [new RegExp(`^scry ${NUMW}$`, 'i'), (m) => ({ kind: 'scry', amount: num(m[1]) })],
  [new RegExp(`^surveil ${NUMW}$`, 'i'), (m) => ({ kind: 'surveil', amount: num(m[1]) })],
  [new RegExp(`^(?:you )?mill ${NUMW} cards?$`, 'i'), (m) => ({ kind: 'mill', amount: num(m[1]), who: 'you' })],
  [new RegExp(`^(target player|target opponent|each opponent|each player) mills ${NUMW} cards?$`, 'i'), (m) => ({ kind: 'mill', amount: num(m[2]), who: m[1].toLowerCase() })],
  [/^search your library for (?:up to (one|two|three) )?(?:a |an )?(basic land|basic (?:Plains|Island|Swamp|Mountain|Forest)|land|Forest|Plains|Island|Swamp|Mountain|[\w ,]+?) cards?(?:, reveal (?:it|them|that card))?(?:, (?:and )?put (?:it|them|that card|one of them) (?:onto the battlefield( tapped)?|into your hand))?(?:,? and put the other into your hand)?(?:, then shuffle| then shuffle)?$/i,
    (m) => ({ kind: 'tutor', what: m[2], amount: num(m[1] || 'one'), toBattlefield: /battlefield/.test(m[0]), tapped: !!m[3] })],
  [/^search your library for .+$/i, (m) => ({ kind: 'instruct', text: 'Busca en tu biblioteca lo que indica la carta, ponlo donde diga y baraja.', raw: m[0] })],
  [/^(?:then )?shuffle(?: your library)?$/i, () => ({ kind: 'instruct', text: 'Baraja tu biblioteca.', silent: true })],
  [/^(?:then )?shuffle and put (?:that card|the revealed card|it) on top(?: of your library)?$/i, () => ({ kind: 'instruct', text: 'Baraja y pon esa carta encima de tu biblioteca.', silent: true })],
  [/^exile CARDNAME, then return it to the battlefield transformed under (?:your|its owner's) control$/i, () => ({ kind: 'instruct', text: 'Exilia esta carta y vuelve a ponerla en el campo de batalla transformada (por su otra cara).' })],
  [/^exile target card from a graveyard$/i, () => ({ kind: 'exileGraveCard' })],
  [/^exile (?:up to (?:one|two|three) )?target cards? from (?:a single|target player's|an opponent's) graveyard$/i, () => ({ kind: 'exileGraveCard' })],
  [/^exile target player's graveyard$/i, () => ({ kind: 'exileGraveyard' })],
  [/^exile each opponent's graveyard$/i, () => ({ kind: 'exileGraveyard', all: true })],
  [/^fabricate (\d+)$/i, (m) => ({ kind: 'counter', amount: +m[1], self: true })],
  [/^CARDNAME deals (\d+) damage to each opponent and each creature (?:your opponents control|they control)$/i, (m) => [{ kind: 'damage', amount: +m[1], target: 'opponents' }, { kind: 'damageEach', amount: +m[1], opp: true }]],
  [/^look at the top (\w+) cards? of your library.*$/i, (m) => ({ kind: 'instruct', text: `Mira las ${num(m[1])} primeras cartas de tu biblioteca y sigue lo que dice la carta.`, raw: m[0] })],
  [/^reveal the top (\w+) cards? of your library.*$/i, (m) => ({ kind: 'instruct', text: `Muestra las ${num(m[1])} primeras cartas de tu biblioteca y sigue lo que dice la carta.`, raw: m[0] })],
  [/^exile the top (card|two cards|three cards|\w+ cards) of your library\.?\s*(?:until (?:the )?end of (your next turn|turn), you may (play|cast) (?:that card|it|them|those cards)|you may (play|cast) (?:that card|it|them|those cards) (this turn|until the end of your next turn))$/i,
    (m) => ({ kind: 'impulse', amount: m[1] === 'card' ? 1 : num(m[1].split(' ')[0]), until: /next/.test(m[2] || m[5] || '') ? 'next' : 'turn', play: (m[3] || m[4] || 'play').toLowerCase() })],
  [/^explore$/i, () => ({ kind: 'explore' })],
  [/^connive$/i, () => ({ kind: 'connive' })],
  // --- sacrificios
  [/^(each opponent|target opponent|target player|each player) sacrifices (?:a|an|one) (creature|artifact|enchantment|land|permanent|nonland permanent|creature or planeswalker|creature they control|creature of their choice|attacking creature)(?: of their choice)?$/i, (m) => ({ kind: 'edict', who: m[1].toLowerCase(), filter: parseTargetPhrase(m[2].replace(/ (they control|of their choice)/, '')) })],
  [/^sacrifice CARDNAME$/i, () => ({ kind: 'sacSelf' })],
  [/^(?:you may )?sacrifice (?:a|an|another) (creature|artifact|land|permanent|enchantment|Food|Treasure|Clue)$/i, (m) => ({ kind: 'instruct', text: `Sacrifica ${m[1] === 'creature' ? 'una criatura' : 'un permanente'} (tócalo y pulsa «Destruir»).` })],
  // --- otros
  [/^goad target creature(?: an opponent controls)?$/i, () => ({ kind: 'instruct', text: 'La criatura objetivo queda provocada: ataca cada combate y a un jugador distinto de ti si puede.' })],
  [/^you become the monarch$/i, () => ({ kind: 'instruct', text: 'Te conviertes en el monarca: al final de tu turno robas una carta; si un rival te hace daño de combate, pasa a ser el monarca.' })],
  [/^venture into the dungeon$/i, () => ({ kind: 'instruct', text: 'Avanza en el dungeon (lleva la cuenta a mano).' })],
  [/^regenerate (CARDNAME|target creature)$/i, () => ({ kind: 'regen' })],
  [/^CARDNAME phases out$/i, () => ({ kind: 'instruct', text: 'Esta carta sale de fase hasta tu próximo turno (trátala como si no estuviera).' })],
  [/^you may play an additional land this turn$/i, () => ({ kind: 'extraLand', amount: 1 })],
  [/^(?:it|CARDNAME) gains haste until end of turn$/i, () => ({ kind: 'pump', p: 0, t: 0, kw: ['haste'], self: true })],
  [/^transform CARDNAME$/i, () => ({ kind: 'instruct', text: 'Transforma esta carta (dale la vuelta).' })],
  [/^CARDNAME explores$/i, () => ({ kind: 'explore' })],
  [/^CARDNAME connives$/i, () => ({ kind: 'connive' })],
  [/^attach (?:it|CARDNAME) to target creature you control$/i, () => ({ kind: 'attachTo', target: 'creature', filter: { types: ['creature'], non: [], you: true } })],
  [/^attach CARDNAME to it$/i, () => ({ kind: 'attachToChosen' })],
  [/^return (?:it|CARDNAME) to (?:its owner's|your) hand$/i, () => ({ kind: 'selfToHand' })],
  [/^return (?:it|CARDNAME) to the battlefield(?: tapped)?(?: under (?:its owner's|your) control)?$/i, () => ({ kind: 'selfRecur', to: 'battlefield' })],
  [/^exile CARDNAME$/i, () => ({ kind: 'exileSelf' })],
  [/^(?:you get|get) ((?:\{E\})+)$/i, (m) => ({ kind: 'energy', amount: (m[1].match(/\{E\}/g) || []).length })],
  [/^monstrosity (\d+|X)$/i, (m) => ({ kind: 'monstrosity', amount: num(m[1]) })],
  [/^adapt (\d+)$/i, (m) => ({ kind: 'adapt', amount: +m[1] })],
  [/^put a (?:charge|time|storage|ki|spore|quest|loyalty|lore|oil|age|fade|level|study|verse|wish|\w+) counter on CARDNAME$/i, () => ({ kind: 'chargeCounter', amount: 1 })],
  [/^prevent the next (\d+) damage that would be dealt to (any target|target creature|target creature or player|target player|you|CARDNAME) this turn$/i, (m) => ({ kind: 'prevent', amount: +m[1], ...(/CARDNAME/i.test(m[2]) ? { self: true } : /^you$/i.test(m[2]) ? { you: true } : damageTarget(m[2].replace('target creature or player', 'any target')) || { target: 'any' }) })],
  [/^prevent all combat damage that would be dealt this turn$/i, () => ({ kind: 'fog' })],
  [/^prevent all damage that would be dealt to (?:target creature|CARDNAME) this turn$/i, (m) => ({ kind: 'prevent', amount: 999, ...(/CARDNAME/.test(m[0]) ? { self: true } : { target: 'creature' }) })],
  [/^gain control of target (.+?) until end of turn$/i, (m) => { const p = permT(m[1]); return p ? { kind: 'threaten', ...p } : null; }],
  [/^gain control of target (.+)$/i, (m) => { const p = permT(m[1]); return p && !/card|spell/.test(m[1]) ? { kind: 'steal', ...p } : null; }],
  [/^untap (?:that creature|it)$/i, () => ({ kind: 'untapLast' })],
  [/^(?:that creature|it) gains haste until end of turn$/i, () => ({ kind: 'hasteLast' })],
  [/^its controller (loses|gains) (\d+) life$/i, (m) => ({ kind: 'controllerLife', amount: (m[1] === 'loses' ? -1 : 1) * +m[2] })],
  [/^its controller gains life equal to its power$/i, () => ({ kind: 'controllerLifePower' })],
  [/^its controller (?:may )?(?:search|searches) (?:their|his or her) library for a basic land card.*$/i, () => ({ kind: 'instruct', text: 'Su controlador puede buscar una tierra básica y ponerla en el campo de batalla girada.' })],
  [new RegExp(`^return up to ${NUMW} target (creature|instant and/or sorcery|artifact|enchantment|permanent|land)? ?cards? from your graveyard to your hand$`, 'i'), (m) => Array.from({ length: num(m[1]) }, () => ({ kind: 'regrow', type: (m[2] || 'card').replace(' and/or ', ' or ').toLowerCase() }))],
  [new RegExp(`^draw ${NUMW} cards? at the beginning of the next turn's upkeep$`, 'i'), (m) => ({ kind: 'delayedDraw', amount: num(m[1]) })],
  [/^(?:that player|defending player|target player|target opponent|each opponent) discards (a|one|two) cards?$/i, (m) => ({ kind: 'discard', amount: num(m[1]), who: 'that player' })],
  [/^sacrifice CARDNAME at the beginning of the next end step$/i, () => ({ kind: 'delayedSac' })],
  [/^at the beginning of the next end step, sacrifice (?:it|CARDNAME|that creature|them|those tokens)$/i, () => ({ kind: 'delayedSac' })],
  [/^exile (?:it|that creature|them) at the beginning of the next end step$/i, () => ({ kind: 'delayedSac', exile: true })],
  [/^(?:you )?take the initiative$/i, () => ({ kind: 'instruct', text: 'Tomas la iniciativa: avanza en la Mazmorra Subterránea (llévalo a mano).' })],
  [/^the ring tempts you$/i, () => ({ kind: 'instruct', text: 'El Anillo te tienta: elige a tu Portador del Anillo (llévalo a mano).' })],
  [/^support (\d+)$/i, (m) => ({ kind: 'support', amount: +m[1] })],
  [/^bolster (\d+)$/i, (m) => ({ kind: 'bolster', amount: +m[1] })],
  [/^populate$/i, () => ({ kind: 'instruct', text: 'Poblar: crea una copia de una ficha de criatura que controles (créala a mano con el mismo efecto).' })],
  [/^learn$/i, () => ({ kind: 'instruct', text: 'Aprende: puedes coger una carta de Lección de fuera del juego, o descartar una carta para robar otra.' })],
  [/^(?:untap|tap) (two|three|up to two|up to three) target (lands|creatures|permanents)$/i, (m) => Array.from({ length: num(m[1].replace('up to ', '')) }, () => ({ kind: /^untap/i.test(m[0]) ? 'untap' : 'tap', ...permT(m[2].replace(/s$/, '')) }))],
  [/^each player draws (a|one|two|three) cards?$/i, (m) => ({ kind: 'drawOther', who: 'each player', amount: num(m[1]) })],
  [new RegExp(`^target player draws ${NUMW} cards? and loses ${NUMW} life$`, 'i'), (m) => [{ kind: 'draw', amount: num(m[1]) }, { kind: 'lose', amount: num(m[2]) }]],
  [new RegExp(`^(?:you )?draw ${NUMW} cards? and (?:you )?lose ${NUMW} life$`, 'i'), (m) => [{ kind: 'draw', amount: num(m[1]) }, { kind: 'lose', amount: num(m[2]) }]],
  [/^(?:target opponent|target player) reveals their hand\. you choose a (nonland|noncreature, nonland|creature|instant or sorcery)? ?card from it\. that player discards that card$/i, () => ({ kind: 'discard', amount: 1, who: 'target opponent', choose: true })],
  [/^take an extra turn after this one$/i, () => ({ kind: 'extraTurn' })],
  [new RegExp(`^up to ${NUMW} target creatures can't block this turn$`, 'i'), (m) => Array.from({ length: num(m[1]) }, () => ({ kind: 'noBlock', target: 'creature' }))],
  [new RegExp(`^return up to ${NUMW} target (creatures|nonland permanents|permanents) to their owners' hands$`, 'i'), (m) => Array.from({ length: num(m[1]) }, () => ({ kind: 'bounce', ...permT(m[2].replace(/s$/, '')) }))],
  [new RegExp(`^put a \\+1/\\+1 counter on each of up to ${NUMW} target creatures$`, 'i'), (m) => Array.from({ length: num(m[1]) }, () => ({ kind: 'counter', amount: 1, target: 'creature' }))],
  [/^(?:those creatures|they) don't untap during their controller's next untap step$/i, () => ({ kind: 'freezeLast' })],
  [/^if (?:that creature|it|a creature dealt damage this way) would die this turn, exile it instead$/i, () => []],
  [/^(?:then )?put (?:one|two|a card|one of them|two of them|the rest|them|those cards|that card|the other|the others|any number of them).*$/i, () => []],
  [/^(?:you may )?reveal (?:it|that card|a [\w ]+ card from among them).*$/i, () => []],
  [/^(?:that player|they) shuffles?$/i, () => []],
  [/^roll a d20$/i, () => ({ kind: 'instruct', text: 'Tira un dado de 20 caras y aplica el resultado de la tabla.' })],
  [/^flip a coin$/i, () => ({ kind: 'instruct', text: 'Lanza una moneda y aplica el resultado.' })],
  [/^CARDNAME deals damage equal to (?:the number of|its power|your devotion|twice).+$/i, (m) => ({ kind: 'instruct', text: 'Calcula el daño (' + m[0].replace(/^CARDNAME deals damage equal to /i, '') + ') y aplícalo con los botones de daño o de vida.' })],
  [/^switch CARDNAME's power and toughness until end of turn$/i, () => ({ kind: 'switchPT' })],
  [/^CARDNAME can attack this turn as though it didn't have defender$/i, () => ({ kind: 'canAttackDefender' })],
  [/^(?:you may )?put a land card from your hand onto the battlefield(?: tapped)?$/i, (m) => ({ kind: 'putLand', tapped: /tapped/i.test(m[0]) })],
  [/^copy target (?:instant or sorcery |instant |sorcery )?spell(?: you control)?$/i, () => ({ kind: 'copySpell', target: 'spell' })],
  [/^copy (?:it|that spell)(?: (?:twice|for each .+))?$/i, () => ({ kind: 'instruct', text: 'Copia ese hechizo (vuelve a aplicar su efecto; puedes elegir nuevos objetivos).' })],
  [/^you may choose new targets for the cop(?:y|ies)$/i, () => []],
  [/^(?:target opponent|target player|each opponent) reveals (?:their|his or her) hand$/i, () => []],
  [/^you choose (?:a|an|up to one|one) (?:nonland|noncreature, nonland|creature|instant or sorcery|nonartifact, nonland|artifact or creature|land|nonlegendary)? ?card from (?:it|that player's hand)$/i, () => []],
  [/^(?:that player|they) discards? (?:that card|those cards)$/i, () => ({ kind: 'discard', amount: 1, who: 'target opponent', choose: true })],
  [/^if you search your library this way, shuffle$/i, () => []],
  [/^until end of turn, you don't lose this mana as steps and phases end$/i, () => []],
  [/^(?:it|they|those creatures|those tokens|that creature|the token|the tokens) gains? haste(?: until end of turn)?$/i, () => ({ kind: 'hasteLast' })],
  [/^sacrifice (?:it|that creature|them|those tokens|the token) at the beginning of the next end step$/i, () => ({ kind: 'delayedSac' })],
  [/^exile (?:it|that creature|them|those tokens|the token) at the beginning of the next end step$/i, () => ({ kind: 'delayedSac', exile: true })],
  [/^(?:look at|reveal) the top card of your library$/i, () => ({ kind: 'instruct', text: 'Mira la primera carta de tu biblioteca y sigue lo que dice la carta.' })],
  [/^exile the top (\w+) cards? of your library$/i, (m) => ({ kind: 'instruct', text: `Exilia las ${m[1] === 'card' ? 1 : num(m[1])} primeras cartas de tu biblioteca.` })],
  [/^add (\w+) mana in any combination of colors$/i, (m) => ({ kind: 'addMana', mana: Array.from({ length: num(m[1]) }, () => ['W', 'U', 'B', 'R', 'G']) })],
  [/^add (one|two|three) mana of the chosen color$/i, (m) => ({ kind: 'addChosen', amount: num(m[1]) })],
  [/^you win the game$/i, () => ({ kind: 'win' })],
  [/^(?:target player|each player|that player|you) (?:shuffles their hand and graveyard into their library, then )?draws seven cards$/i, () => ({ kind: 'drawOther', who: 'each player', amount: 7 })],
  [/^return (?:that card|it|the exiled card|that creature) to the battlefield under (?:its owner's|your) control(?: at the beginning of the next end step)?$/i, (m) => ({ kind: 'flickerBack', delayed: /next end step/i.test(m[0]) })],
  [/^exile (?:another )?target (creature|artifact|permanent|nonland permanent|creature or artifact|creature you control|artifact or creature you control), then return (?:that card|it) to the battlefield under (?:its owner's|your) control$/i, (m) => ({ kind: 'flicker', ...permT(m[1]) })],
  [/^put target creature card from a graveyard onto the battlefield under your control$/i, () => ({ kind: 'reanimateAny' })],
  [/^exile (?:up to one )?target (?:creature )?card from a graveyard$/i, () => ({ kind: 'exileGraveCard' })],
  [/^create a token that's a copy of (CARDNAME|target creature you control|it|that creature)$/i, (m) => ({ kind: 'copyToken', ...(/target/.test(m[1]) ? { target: 'creature', filter: { types: ['creature'], non: [], you: true } } : { self: true }) })],
  [/^CARDNAME deals (\d+) damage to (?:that player|defending player|that creature's controller)$/i, (m) => ({ kind: 'damage', amount: +m[1], target: 'that' })],
  [/^return (?:a|one) land you control to its owner's hand$/i, () => ({ kind: 'returnLand' })],
  [/^discover (\d+)$/i, (m) => ({ kind: 'discover', amount: +m[1] })],
  [/^incubate (\d+|X)$/i, (m) => ({ kind: 'incubate', amount: num(m[1]) })],
  [/^manifest dread$/i, () => ({ kind: 'manifest', dread: true })],
  [/^manifest the top card of your library$/i, () => ({ kind: 'manifest' })],
  [/^earthbend (\d+|X)$/i, (m) => ({ kind: 'earthbend', amount: num(m[1]), target: 'permanent', filter: { types: ['land'], non: [], you: true } })],
  [/^target attacking creature gets ([+-]\d+)\/([+-]\d+) until end of turn$/i, (m) => ({ kind: 'pump', p: +m[1], t: +m[2], kw: [], target: 'creature', filter: { types: ['creature'], non: [], combat: true } })],
  [/^target creature with power (\d+) or less can't be blocked this turn$/i, (m) => ({ kind: 'unblockable', target: 'creature', filter: { types: ['creature'], non: [], powMax: +m[1] } })],
  [/^regenerate (?:enchanted|equipped) creature$/i, () => ({ kind: 'regenHost' })],
  [/^sacrifice CARDNAME unless you pay ((?:\{[^}]+\})+)$/i, (m) => ({ kind: 'payOrSac', cost: m[1] })],
];

/** Partes que no hace falta aplicar (texto de ayuda o ya implícito). */
const NOOP = [/^(?:then )?shuffle$/i, /^it can't be regenerated$/i, /^they can't be regenerated$/i, /^activate only as a sorcery$/i, /^activate only once each turn$/i, /^activate only during your turn$/i, /^this ability triggers only once each turn$/i];

/** Divide un texto de efecto en cláusulas («X. Then Y», «X, then Y», «X and Y»). */
function clauses(text) {
  const t0 = text.replace(/\s+/g, ' ').trim()
    .replace(/(of your library)\. (?=(?:Until (?:the )?end of|You may (?:play|cast) (?:that card|it|them|those cards)))/g, '$1 ')
    .replace(/\. (If you do|If you don't), /g, '. $1, ');
  const sentences = t0.replace(/\.$/, '').split(/\.\s+(?=[A-Z])/);
  const out = [];
  for (let s of sentences) {
    s = s.replace(/\.$/, '').trim();
    for (const part of s.split(/,? then (?=[a-z])/i)) out.push(part.trim());
  }
  return out;
}

function matchClause(c) {
  let s = c.trim().replace(/^(?:you may |then |also |if you do, )/i, '').replace(/^(?:you may )/i, '');
  // «si se pagó el estímulo, …»
  const kk = s.match(/^if (?:this spell|CARDNAME|it) was kicked, (.+)$/i);
  if (kk) { const r = matchClause(kk[1]); return r ? r.map((e) => ({ ...e, kicked: true })) : null; }
  // «it/that creature …» se refiere a la propia carta en disparadas y activadas
  s = s.replace(/^(?:it|that creature) (deals|gets|gains|explores|connives|fights|can't be blocked)\b/i, 'CARDNAME $1');
  if (NOOP.some((r) => r.test(s))) return [];
  for (const [re, fn] of T) {
    const m = s.match(re);
    if (m) {
      const r = fn(m);
      if (r) return Array.isArray(r) ? r : [r];
    }
  }
  // «X and Y» (dos efectos unidos)
  const and = s.match(/^(.+?) and (you gain \d+ life|you lose \d+ life|draw a card|you draw a card|scry \d+|create .+|put .+|it gains .+|gain \d+ life|surveil \d+|investigate)$/i);
  if (and) {
    const a = matchClause(and[1]);
    const b = matchClause(and[2]);
    if (a && b) return [...a, ...b];
  }
  return null;
}

/** Traduce un texto de efecto. ok: se entendió entero; fx: efectos; missing: cláusulas no entendidas. */
export function parseEffectText(text) {
  const fx = [];
  const missing = [];
  let paid = false;
  for (let c of clauses(text)) {
    if (!c) continue;
    // «Puedes pagar {2}. Si lo haces, …»
    const mp = c.match(/^(?:you may )?pay ((?:\{[^}]+\})+|(\d+) life)(?:\. if you do,|\.?$| and)?\s*(.*)$/i);
    if (mp && /^you may pay/i.test(c.trim())) {
      fx.push({ kind: 'mayPay', cost: mp[2] ? '' : mp[1], life: mp[2] ? +mp[2] : 0 });
      paid = true;
      c = mp[3] || '';
      if (!c) continue;
    }
    const ifDo = c.match(/^if you do, (.+)$/i);
    if (ifDo && paid) c = ifDo[1];
    else if (/^if you don't, /i.test(c) && paid) { const r = matchClause(c.replace(/^if you don't, /i, '')); if (r) { fx.push(...r.map((e) => ({ ...e, ifNotPaid: true }))); continue; } }
    const r = matchClause(c);
    if (r) fx.push(...(paid && ifDo ? r.map((e) => ({ ...e, ifPaid: true })) : r));
    else missing.push(c);
  }
  return { fx, ok: missing.length === 0 && (fx.length > 0 || clauses(text).every((c) => NOOP.some((r) => r.test(c)))), missing };
}

// ------------------------------------------------------------ disparadas

/** Condición de una habilidad disparada → evento del motor. */
export function parseTrigger(cond) {
  const c = cond.trim();
  const R = (re, ev) => { const m = c.match(re); return m ? { ev, m } : null; };
  return R(/^(?:When|Whenever) CARDNAME enters(?: the battlefield)?(?: or attacks| or dies)?$/i, 'etb')
    || R(/^(?:When|Whenever) CARDNAME enters or attacks$/i, 'etb')
    || R(/^(?:When|Whenever) CARDNAME dies$/i, 'dies')
    || R(/^(?:When|Whenever) CARDNAME is put into a graveyard from the battlefield$/i, 'dies')
    || R(/^(?:When|Whenever) CARDNAME leaves the battlefield$/i, 'leaves')
    || R(/^Whenever CARDNAME attacks(?: or blocks)?$/i, 'attacks')
    || R(/^Whenever CARDNAME blocks(?: or becomes blocked)?$/i, 'blocks')
    || R(/^Whenever CARDNAME becomes blocked$/i, 'blocked')
    || R(/^Whenever CARDNAME deals combat damage to a player(?: or planeswalker| or battle)?$/i, 'combatDamagePlayer')
    || R(/^Whenever CARDNAME deals combat damage to an opponent$/i, 'combatDamagePlayer')
    || R(/^Whenever CARDNAME deals damage to a player$/i, 'combatDamagePlayer')
    || R(/^Whenever CARDNAME deals combat damage$/i, 'combatDamage')
    || R(/^At the beginning of your upkeep$/i, 'upkeep')
    || R(/^At the beginning of each upkeep$/i, 'anyUpkeep')
    || R(/^At the beginning of your end step$/i, 'endstep')
    || R(/^At the beginning of each end step$/i, 'anyEndstep')
    || R(/^At the beginning of the end step$/i, 'anyEndstep')
    || R(/^At the beginning of each combat$/i, 'anyCombat')
    || R(/^Whenever CARDNAME or another creature you control enters$/i, 'creatureEtbMine')
    || R(/^Whenever CARDNAME or another creature you control dies$/i, 'creatureDiesMine')
    || R(/^Whenever another creature you control attacks$/i, 'creatureAttacksMine')
    || R(/^Whenever you cast a noncreature spell, if/i, null)
    || R(/^Whenever an artifact you control enters$/i, 'artifactEtbMine')
    || R(/^Whenever an enchantment you control enters$/i, 'enchantmentEtbMine')
    || R(/^Whenever a nontoken creature you control dies$/i, 'creatureDiesMine')
    || R(/^Whenever a creature you control with power (\d+) or greater enters$/i, 'creatureEtbMine')
    || R(/^Whenever CARDNAME attacks or blocks$/i, 'attacks')
    || R(/^Whenever you cast a historic spell$/i, 'castHistoric')
    || R(/^Whenever you cast a Spirit or Arcane spell$/i, 'castSpiritArcane')
    || R(/^Whenever you cast an Aura, Equipment, or Vehicle spell$/i, 'castAuraEquip')
    || R(/^Whenever you cast your first spell each turn$/i, 'castFirst')
    || R(/^Whenever a player casts a spell$/i, 'castAnyone')
    || R(/^Whenever CARDNAME becomes the target of a spell or ability an opponent controls$/i, 'targeted')
    || R(/^At the beginning of your second main phase$/i, 'main2')
    || R(/^At the beginning of each opponent's upkeep$/i, 'oppUpkeep')
    || R(/^At the beginning of each opponent's end step$/i, 'oppEndstep')
    || R(/^Whenever you cycle CARDNAME$/i, 'cycled')
    || R(/^When you cycle CARDNAME$/i, 'cycled')
    || R(/^At the beginning of combat on your turn$/i, 'begincombat')
    || R(/^At the beginning of your precombat main phase$/i, 'main1')
    || R(/^At the beginning of your draw step$/i, 'drawstep')
    || R(/^Whenever another creature you control enters$/i, 'otherEtbMine')
    || R(/^Whenever another nontoken creature you control enters$/i, 'otherEtbMineNontoken')
    || R(/^Whenever a creature you control enters$/i, 'creatureEtbMine')
    || R(/^Whenever another creature enters(?: the battlefield)?$/i, 'otherEtbAny')
    || R(/^Whenever a creature enters(?: the battlefield)?$/i, 'otherEtbAny')
    || R(/^Whenever a creature enters(?: the battlefield)? under an opponent's control$/i, 'creatureEtbOpp')
    || R(/^Whenever a creature an opponent controls enters$/i, 'creatureEtbOpp')
    || R(/^Whenever a land you control enters$/i, 'landfall')
    || R(/^Whenever a land enters(?: the battlefield)? under your control$/i, 'landfall')
    || R(/^Whenever another creature you control dies$/i, 'otherDiesMine')
    || R(/^Whenever a creature you control dies$/i, 'creatureDiesMine')
    || R(/^Whenever another creature dies$/i, 'otherDiesAny')
    || R(/^Whenever a creature dies$/i, 'otherDiesAny')
    || R(/^Whenever a creature an opponent controls dies$/i, 'creatureDiesOpp')
    || R(/^Whenever you cast a noncreature spell$/i, 'castNoncreature')
    || R(/^Whenever you cast an instant or sorcery spell$/i, 'castInstantSorcery')
    || R(/^Whenever you cast a creature spell$/i, 'castCreature')
    || R(/^Whenever you cast a spell$/i, 'castAny')
    || R(/^Whenever you cast your second spell each turn$/i, 'castSecond')
    || R(/^Whenever an opponent casts a spell$/i, 'oppCast')
    || R(/^Whenever you gain life$/i, 'gainLife')
    || R(/^Whenever you attack$/i, 'youAttack')
    || R(/^Whenever a creature you control attacks$/i, 'creatureAttacksMine')
    || R(/^Whenever one or more creatures you control attack$/i, 'youAttack')
    || R(/^Whenever CARDNAME becomes tapped$/i, 'tapped')
    || R(/^Whenever you draw a card$/i, 'drawCard')
    || R(/^Whenever an opponent draws a card$/i, 'oppDraw')
    || R(/^Whenever a creature you control deals combat damage to a player$/i, 'creatureCombatDamageMine')
    || R(/^Whenever equipped creature deals combat damage to a player$/i, 'hostCombatDamagePlayer')
    || R(/^Whenever enchanted creature deals combat damage to a player$/i, 'hostCombatDamagePlayer')
    || R(/^Whenever equipped creature attacks$/i, 'hostAttacks')
    || R(/^Whenever equipped creature dies$/i, 'hostDies')
    || R(/^When enchanted creature dies$/i, 'hostDies')
    || R(/^Whenever you sacrifice (?:a|another) permanent$/i, 'sacrifice')
    || R(/^Whenever you cycle or discard (?:a|another) card$/i, 'discard')
    || R(/^Whenever you cast or copy an instant or sorcery spell$/i, 'castInstantSorcery')
    || R(/^Whenever one or more creatures you control deal combat damage to a player$/i, 'youCombatDamage')
    || R(/^Whenever CARDNAME and at least (two|one) other creatures? attacks?$/i, 'attacksWithOthers')
    || genericTrigger(c)
    || null;
}

/** Condiciones genéricas: «Siempre que [CARDNAME u] otra X (que controlas) entre / muera», «Siempre que lances un hechizo X». */
function genericTrigger(c) {
  let m;
  if ((m = c.match(/^(?:When|Whenever) (CARDNAME or )?(another )?(?:one or more )?(.+?) (?:you control )?(?:enters|enter)(?: the battlefield)?( under your control)?$/i))) {
    const mine = /you control/i.test(c) || !!m[4];
    const ph = m[3].replace(/ you control$/i, '');
    if (/\b(card|spell|player)\b/i.test(ph)) return null;
    const f = parseTargetPhrase(ph);
    if (f) return { ev: 'permEtb', filt: { ...f, selfOk: !!m[1], other: !!m[2], mine, opp: /opponent controls/i.test(c) } };
  }
  if ((m = c.match(/^(?:When|Whenever) (CARDNAME or )?(another )?(?:one or more )?(?:other )?(.+?) (?:you control )?(?:dies|die|is put into a graveyard from the battlefield|are put into a graveyard from the battlefield)$/i))) {
    const ph = m[3].replace(/ (?:you control|an opponent controls|your opponents control)$/i, '');
    if (/\bcard\b/i.test(ph)) return null;
    const f = parseTargetPhrase(ph);
    if (f) return { ev: 'permDies', filt: { ...f, selfOk: !!m[1], other: !!m[2], mine: /you control/i.test(c), opp: /opponent/i.test(c) } };
  }
  if ((m = c.match(/^Whenever you cast (?:a|an) (.+?) spell(?: with mana value (\d+) or (greater|less))?$/i))) {
    const words = m[1];
    if (/that targets|from anywhere|during|your first|your second/i.test(words)) return null;
    return { ev: 'castFilter', cast: { words, mv: m[2] ? +m[2] : null, mvDir: m[3] || null } };
  }
  if ((m = c.match(/^Whenever you cast a spell with mana value (\d+) or (greater|less)$/i))) return { ev: 'castFilter', cast: { words: 'any', mv: +m[1], mvDir: m[2] } };
  return null;
}

/** ¿Cumple el hechizo la descripción («creature», «noncreature», «multicolored», «Spirit or Arcane»…)? */
export function castMatches(cast, card) {
  if (cast.mv != null && (cast.mvDir === 'less' ? card.cmc > cast.mv : card.cmc < cast.mv)) return false;
  const w = cast.words.toLowerCase();
  if (w === 'any') return true;
  return w.split(/,? or |, /).some((part) => part.split(' ').every((t) => {
    switch (t) {
      case 'noncreature': return !card.isCreature;
      case 'nonartifact': return !/Artifact/.test(card.typeLine);
      case 'multicolored': return (card.colors || []).length > 1;
      case 'monocolored': return (card.colors || []).length === 1;
      case 'colorless': return !(card.colors || []).length;
      case 'white': case 'blue': case 'black': case 'red': case 'green': return (card.colors || []).includes({ white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' }[t]);
      case 'historic': return /Legendary|Artifact|Saga/.test(card.typeLine);
      case 'kicked': return !!card.kicked;
      case '': return true;
      default: return new RegExp('\\b' + t + '\\b', 'i').test(card.typeLine || '');
    }
  }));
}

// ------------------------------------------------------------ activadas

/** Coste de una habilidad activada: { mana, tap, untap, sacSelf, life, discard, loyalty, other }. */
export function parseCost(cost) {
  const out = { mana: '', tap: false, untap: false, sacSelf: false, life: 0, discard: 0, loyalty: null, removeCounters: 0, exileSelf: false, other: [] };
  const lm = cost.trim().match(/^([+−-]?)(\d+|X)$/);
  if (lm) { out.loyalty = lm[2] === 'X' ? 'X' : (lm[1] === '−' || lm[1] === '-' ? -1 : 1) * +lm[2]; if (lm[1] === '' && lm[2] === '0') out.loyalty = 0; return out; }
  for (let part of cost.split(/,\s*/)) {
    part = part.trim();
    if (/^(\{[^}]+\})+$/.test(part)) {
      const syms = [...part.matchAll(/\{([^}]+)\}/g)].map((x) => x[1]);
      for (const sy of syms) {
        if (sy === 'T') out.tap = true;
        else if (sy === 'Q') out.untap = true;
        else if (sy === 'E') out.energy = (out.energy || 0) + 1;
        else out.mana += '{' + sy + '}';
      }
    } else if (/^Sacrifice CARDNAME$/i.test(part)) out.sacSelf = true;
    else if (/^Exile CARDNAME(?: from your graveyard)?$/i.test(part)) out.exileSelf = true;
    else if (/^Pay (\d+) life$/i.test(part)) out.life = +part.match(/\d+/)[0];
    else if (/^Discard (a|one|two) cards?$/i.test(part)) out.discard = num(part.split(' ')[1]);
    else if (/^Remove (a|one|two|three|\w+) (?:\+1\/\+1 |charge |loyalty |time |\w+ )?counters? from CARDNAME$/i.test(part)) out.removeCounters = num(part.split(' ')[1]);
    else out.other.push(part);
  }
  return out;
}

// ------------------------------------------------------------ estáticas

/** Estáticas que el motor aplica: { kind, ... } o null. */
export function parseStatic(text, card) {
  const s = text.replace(/\.$/, '');
  let m;
  if ((m = s.match(/^(Other )?((?:[A-Z][a-z]+ )*?)[Cc]reatures you control get ([+-]\d+)\/([+-]\d+)(?: and have (.+))?$/))) {
    return { kind: 'anthem', who: 'mine', other: !!m[1], sub: m[2].trim() || null, p: +m[3], t: +m[4], kw: kwList(m[5]) };
  }
  if ((m = s.match(/^(Other )?(white|blue|black|red|green|artifact|nontoken|tapped|attacking|legendary|multicolored|colorless|token) creatures you control get ([+-]\d+)\/([+-]\d+)(?: and have (.+))?$/i))) {
    return { kind: 'anthem', who: 'mine', other: !!m[1], adj: m[2].toLowerCase(), p: +m[3], t: +m[4], kw: kwList(m[5]) };
  }
  if ((m = s.match(/^(Other )?(?:[Cc]reatures you control with flying|[Cc]reatures you control with (\w+)) get ([+-]\d+)\/([+-]\d+)$/))) return { kind: 'anthem', who: 'mine', other: !!m[1], withKw: m[2] || 'flying', p: +m[3], t: +m[4], kw: [] };
  if ((m = s.match(/^(Other )?([A-Z][a-z]+(?:s|es|ves)) you control get ([+-]\d+)\/([+-]\d+)(?: and have (.+))?$/))) {
    const sing = m[2].replace(/ves$/, 'f').replace(/ies$/, 'y').replace(/(ss|sh|ch|x)es$/, '$1').replace(/s$/, '');
    return { kind: 'anthem', who: 'mine', other: !!m[1], sub: sing === 'Elve' ? 'Elf' : sing, p: +m[3], t: +m[4], kw: kwList(m[5]) };
  }
  if ((m = s.match(/^(Other )?((?:[A-Z][a-z]+ )*?)[Cc]reatures you control have (.+)$/)) && kwList(m[3]).every((k) => new RegExp('^' + KWS + '$').test(k))) {
    return { kind: 'anthem', who: 'mine', other: !!m[1], sub: m[2].trim() || null, p: 0, t: 0, kw: kwList(m[3]) };
  }
  if ((m = s.match(/^(Other )?((?:[A-Z][a-z]+ )*?)creatures (?:get|you control get) ([+-]\d+)\/([+-]\d+)$/))) return { kind: 'anthem', who: 'all', other: !!m[1], sub: m[2].trim() || null, p: +m[3], t: +m[4], kw: [] };
  if ((m = s.match(/^Creatures your opponents control get ([+-]\d+)\/([+-]\d+)$/))) return { kind: 'anthem', who: 'opp', p: +m[1], t: +m[2], kw: [] };
  if ((m = s.match(/^(?:As long as it's your turn, CARDNAME|During your turn, CARDNAME) (?:gets ([+-]\d+)\/([+-]\d+)|has (.+))(?: and has (.+))?$/))) return { kind: 'selfBuff', myTurn: true, p: +(m[1] || 0), t: +(m[2] || 0), kw: kwList(m[3] || m[4]) };
  if ((m = s.match(/^CARDNAME gets ([+-]\d+)\/([+-]\d+) as long as it's your turn$/))) return { kind: 'selfBuff', myTurn: true, p: +m[1], t: +m[2], kw: [] };
  if (/^CARDNAME can't block$/.test(s)) return { kind: 'noBlockSelf' };
  if (/^CARDNAME can't attack$/.test(s)) return { kind: 'noAttackSelf' };
  if (/^CARDNAME can't attack or block$/.test(s)) return { kind: 'noAttackSelf', noBlock: true };
  if (/^CARDNAME can't be blocked$/.test(s)) return { kind: 'unblockableSelf' };
  if (/^CARDNAME can't be blocked by more than one creature$/.test(s)) return { kind: 'info' };
  if (/^CARDNAME can block (?:an additional creature|any number of creatures)(?: each combat)?$/.test(s)) return { kind: 'info' };
  if (/^CARDNAME can't be blocked except by (?:two|three) or more creatures$/.test(s)) return { kind: 'menaceLike' };
  if (/^CARDNAME can't be blocked by creatures with power (\d) or less$/.test(s)) return { kind: 'info' };
  if (/^CARDNAME attacks each (?:combat|turn) if able$/.test(s)) return { kind: 'info', text: 'Ataca cada combate si puede.' };
  if (/^CARDNAME blocks each combat if able$/.test(s)) return { kind: 'info', text: 'Bloquea cada combate si puede.' };
  if (/^CARDNAME doesn't untap during your untap step$/.test(s)) return { kind: 'noUntapSelf' };
  if (/^CARDNAME enters tapped$/.test(s)) return { kind: 'entersTapped' };
  if ((m = s.match(/^CARDNAME enters tapped unless you control (?:a|an) (\w+) or (?:a|an) (\w+)$/))) return { kind: 'entersTapped', unlessTypes: [m[1], m[2]] };
  if ((m = s.match(/^CARDNAME enters tapped unless you control two or fewer other lands$/))) return { kind: 'entersTapped', unlessFewLands: 2 };
  if ((m = s.match(/^CARDNAME enters tapped unless you control two or more other lands$/))) return { kind: 'entersTapped', unlessManyLands: 2 };
  if (/^As CARDNAME enters, you may pay 2 life\. If you don't, it enters tapped$/.test(s)) return { kind: 'entersTapped', shock: true };
  if (/^CARDNAME enters with (\w+) \+1\/\+1 counters? on it$/.test(s)) return { kind: 'entersCounters', amount: num(s.match(/with (\w+)/)[1]) };
  if (/^You may play an additional land on each of your turns$/.test(s)) return { kind: 'extraLand' };
  if (/^(?:Equipped|Enchanted) creature /.test(s) || /^During your turn, (?:equipped|enchanted) creature /.test(s)) {
    const att = parseAttach({ typeLine: 'Artifact — Equipment', oracle: s.replace(/^During your turn, /, 'During your turn, ') });
    return att && att.mods.length ? { kind: 'attach' } : null;
  }
  if (/^Enchant (creature|permanent|land|artifact|creature you control|creature or vehicle|planeswalker|player|opponent|artifact or creature|nonland permanent)/.test(s)) return { kind: 'info' };
  if (/^This spell costs \{\d+\} less to cast if it targets/.test(s)) return { kind: 'info' };
  if (/^This spell can't be countered$/i.test(s) || /^CARDNAME can't be countered$/.test(s)) return { kind: 'info' };
  if (/^(?:CARDNAME|You) (?:has|have) hexproof$/.test(s)) return { kind: 'info' };
  if (/^Spells you cast cost \{(\d)\} less to cast$/.test(s)) return { kind: 'info', text: 'Tus hechizos cuestan menos (resta a mano).' };
  if (/^Activate only as a sorcery$/.test(s)) return { kind: 'info' };
  if (/^You may choose not to untap CARDNAME during your untap step$/.test(s)) return { kind: 'info' };
  if (/^You may look at the top card of your library any time$/.test(s)) return { kind: 'info' };
  if (/^CARDNAME can be your commander$/.test(s)) return { kind: 'info' };
  if (/^You have no maximum hand size$/.test(s)) return { kind: 'info' };
  if (/^Doctor's companion$/.test(s)) return { kind: 'info' };
  if (/^If CARDNAME is in your opening hand, you may begin the game with it on the battlefield$/.test(s)) return { kind: 'info', text: 'Si está en tu mano inicial, puedes empezar con ella en juego (regístrala con el grimorio).' };
  if (/^Play with the top card of your library revealed$/.test(s)) return { kind: 'info' };
  if (/^CARDNAME must be blocked if able$/.test(s)) return { kind: 'info' };
  if (/^CARDNAME can block only creatures with flying$/.test(s)) return { kind: 'blockOnlyFlyers' };
  if ((m = s.match(/^CARDNAME can't attack unless defending player controls an? (Island|Swamp|Forest|Mountain|Plains)$/))) return { kind: 'attackOnlyIf', land: m[1] };
  if ((m = s.match(/^CARDNAME can't be blocked by creatures with power (\d+) or greater$/))) return { kind: 'evadePower', min: +m[1] };
  if (/^Creatures with power less than CARDNAME's power can't block it$/.test(s)) return { kind: 'evadeSmaller' };
  if ((m = s.match(/^CARDNAME enters with (two|three|one|a) -1\/-1 counters? on it$/))) return { kind: 'entersCounters', amount: -num(m[1]) };
  if ((m = s.match(/^If CARDNAME was kicked, it enters with (\w+) \+1\/\+1 counters? on it$/))) return { kind: 'entersCounters', amount: num(m[1]), kicked: true };
  if ((m = s.match(/^Afterlife (\d+)$/))) return { kind: 'afterlife', amount: +m[1] };
  if ((m = s.match(/^(?:CARDNAME enters tapped\. )?As CARDNAME enters, choose (a|an) (color|creature type|opponent|basic land type|card type)$/))) return { kind: 'chooseOnEnter', what: m[2], tapped: /enters tapped/.test(s) };
  if ((m = s.match(/^(?:Other )?[Cc]reatures you control of the chosen type get ([+-]\d+)\/([+-]\d+)(?: and have (.+))?$/))) return { kind: 'anthem', who: 'mine', chosenType: true, other: /^Other/.test(s), p: +m[1], t: +m[2], kw: kwList(m[3]) };
  if ((m = s.match(/^(?:Other )?[Cc]reatures of the chosen type (?:you control )?get ([+-]\d+)\/([+-]\d+)$/))) return { kind: 'anthem', who: 'mine', chosenType: true, other: /^Other/.test(s), p: +m[1], t: +m[2], kw: [] };
  // fuerza/resistencia que dependen de algo que se puede contar
  if ((m = s.match(/^CARDNAME's (power and toughness are each|power is|toughness is) equal to (?:the number of )?(.+)$/))) {
    const what = countWhat(m[2]);
    if (what) return { kind: 'varPT', which: /and toughness/.test(m[1]) ? 'both' : /power/.test(m[1]) ? 'p' : 't', what, k: /twice/.test(m[2]) ? 2 : 1 };
  }
  if ((m = s.match(/^CARDNAME gets \+(\d+)\/\+(\d+) for each (.+)$/))) {
    const what = countWhat(m[3]);
    if (what) return { kind: 'forEach', p: +m[1], t: +m[2], what };
  }
  if ((m = s.match(/^(Instant and sorcery|Noncreature|Creature|Artifact|Enchantment|Aura|Equipment|Dragon|Elf|Goblin|Zombie|Spirit|Wizard|[A-Z][a-z]+) spells you cast cost \{(\d+)\} less to cast$/))) return { kind: 'costReducer', what: m[1].toLowerCase(), n: +m[2] };
  if (/^Spells you cast cost \{(\d)\} less to cast$/.test(s)) return { kind: 'costReducer', what: 'any', n: +s.match(/\{(\d)\}/)[1] };
  if ((m = s.match(/^This spell costs \{(\d+)\} less to cast for each (.+)$/))) { const what = countWhat(m[2]); if (what) return { kind: 'selfReduce', n: +m[1], what }; }
  if (/^Players can't gain life$/.test(s)) return { kind: 'noLifeGain', who: 'all' };
  if (/^Your opponents can't gain life$/.test(s)) return { kind: 'noLifeGain', who: 'opp' };
  if ((m = s.match(/^If you would gain life, you gain that much life plus (\d+) instead$/))) return { kind: 'lifeBonus', plus: +m[1] };
  if (/^If you would gain life, you gain twice that much life instead$/.test(s)) return { kind: 'lifeBonus', twice: true };
  if (/^Skip your draw step$/.test(s)) return { kind: 'skipDraw' };
  if ((m = s.match(/^When you control no (Islands|Swamps|Forests|Mountains|Plains|artifacts|other creatures), sacrifice CARDNAME$/))) return { kind: 'sacUnless', what: m[1] };
  if (/^Whenever CARDNAME deals damage, you gain that much life$/.test(s)) return { kind: 'lifelinkLike' };
  if ((m = s.match(/^CARDNAME can't be blocked by (artifact creatures|creatures with flying|Walls|black creatures|white creatures|red creatures|green creatures|blue creatures|more than one creature)$/))) return { kind: 'evadeType', what: m[1] };
  if (/^All creatures able to block CARDNAME do so$/.test(s)) return { kind: 'info', text: 'Todas las criaturas que puedan bloquearla deben hacerlo.' };
  if (/^A deck can have any number of cards named CARDNAME$/.test(s)) return { kind: 'info' };
  if (/^Partner—/.test(s)) return { kind: 'info' };
  if ((m = s.match(/^CARDNAME enters with (a|one|two|three|four|five|X) (?:charge|oil|shield|time|loyalty|lore|\w+) counters? on it$/))) return { kind: 'info', text: 'Entra con contadores.' };
  if ((m = s.match(/^CARDNAME enters tapped unless a player has (\d+) or less life$/))) return { kind: 'entersTapped', unlessLowLife: +m[1] };
  if ((m = s.match(/^CARDNAME enters tapped unless you control two or more basic lands$/))) return { kind: 'entersTapped', unlessBasics: 2 };
  if ((m = s.match(/^CARDNAME enters tapped unless you have two or more opponents$/))) return { kind: 'entersTapped', unlessOpps: 2 };
  if ((m = s.match(/^CARDNAME enters tapped unless you control a planeswalker$/))) return { kind: 'entersTapped', unlessPW: true };
  if ((m = s.match(/^CARDNAME enters tapped unless your opponents control eight or more lands$/))) return { kind: 'entersTapped', unlessOppLands: 8 };
  if (/^You control enchanted (?:creature|permanent|artifact|land)$/.test(s)) return { kind: 'controlHost' };
  if ((m = s.match(/^As an additional cost to cast this spell, sacrifice (?:a|an) (creature|artifact|land|permanent|artifact or creature|creature or artifact|nonland permanent)$/))) return { kind: 'addSac', filter: parseTargetPhrase(m[1]) };
  if ((m = s.match(/^As an additional cost to cast this spell, discard (a|one|two) cards?$/))) return { kind: 'addDiscard', amount: num(m[1]) };
  if (/^As an additional cost to cast this spell, pay (\d+) life$/.test(s)) return { kind: 'addLife', amount: +s.match(/pay (\d+)/)[1] };
  if (/^(?:Myriad|Banding|Split second|Daybound|Nightbound|Changeling|Devoid|Rampage \d+|Soulbond|Partner|Assist|Teamwork \d+|Ravenous|Conspire)$/i.test(s)) return { kind: 'info' };
  if ((m = s.match(/^(Persist|Undying)$/i))) return { kind: m[1].toLowerCase() };
  if ((m = s.match(/^(Bushido|Flanking|Modular|Bloodthirst|Renown|Vanishing|Fading|Firebending|Backup|Evolve|Mentor|Extort|Storm|Rebound|Fabricate|Exhaust)(?: (\d+))?$/i))) return { kind: 'kw', kw: m[1].toLowerCase(), n: +(m[2] || 1) };
  if ((m = s.match(/^Cumulative upkeep ((?:\{[^}]+\})+)$/i))) return { kind: 'cumulative', cost: m[1] };
  if ((m = s.match(/^Echo ((?:\{[^}]+\})+)$/i))) return { kind: 'echo', cost: m[1] };
  if ((m = s.match(/^Level up ((?:\{[^}]+\})+)$/i))) return { kind: 'levelUp', cost: m[1] };
  if (/^LEVEL \d+(?:-\d+|\+)$/.test(s) || /^\d+\/\d+$/.test(s)) return { kind: 'levelInfo' };
  if ((m = s.match(/^Soulshift (\d+)$/))) return { kind: 'info', text: 'Al morir, puedes devolver a tu mano una carta de Espíritu de tu cementerio con valor de maná ' + m[1] + ' o menos.' };
  if (/^\{T\}: Add /.test(s)) return null; // las activadas de maná se tratan aparte
  return null;
}

// ------------------------------------------------------------ carta entera

/**
 * Habilidades de una carta: [{ kind, text, ok, ... }]
 * kind: keyword | trigger | activated | static | spell | mana
 */
export function parseAbilities(card) {
  const out = [];
  const isSpell = card.isInstant || card.isSorcery;
  const parts = splitAbilities(card);
  for (const { text, word } of parts) {
    // 1) línea de palabras clave
    const kwParts = text.split(/[,;]\s*(?![^{]*\})/).map((x) => x.trim()).filter(Boolean);
    if (kwParts.length && kwParts.every((p) => keywordOf(p))) {
      for (const p of kwParts) out.push({ kind: 'keyword', text: p, kw: keywordOf(p), ok: true });
      continue;
    }
    // 2) modal («Choose one —»)
    if (/^Choose (one|two|one or both|one or more|any number)(?: —|\b.*—)/i.test(text)) {
      out.push({ kind: 'modal', text, ok: /^Choose (one|two|one or both|one or more|three)\b/i.test(text) && !/same mode more than once|Spree/i.test(text), choose: text });
      continue;
    }
    if (/^•/.test(text)) {
      const r = parseEffectText(text.replace(/^•\s*/, ''));
      out.push({ kind: 'mode', text, ok: r.ok, fx: r.fx, missing: r.missing });
      continue;
    }
    // 3) disparada
    const tm = text.match(/^((?:When|Whenever|At) [^,]+?), (.+)$/);
    if (tm && !isSpell) {
      const tr = parseTrigger(tm[1]);
      let body = tm[2];
      if (/^choose (one|two|one or both|one or more)(?: —|\b.*—)/i.test(body)) {
        out.push({ kind: 'trigger', text, ev: tr && tr.ev, modal: body, fx: [], ok: !!tr && tr.ev === 'etb', missing: [], condText: tm[1] });
        continue;
      }
      const kc = body.match(/^if (?:it|CARDNAME) was kicked, (.+)$/i);
      if (kc) {
        const r = parseEffectText(kc[1]);
        out.push({ kind: 'trigger', text, ev: tr && tr.ev, fx: r.fx.map((e) => ({ ...e, kicked: true })), ok: !!tr && r.ok, missing: r.missing, condText: tm[1] });
        continue;
      }
      let cond = null;
      const ifm = body.match(/^if (.+?), (.+)$/i);
      if (ifm) { cond = ifm[1]; body = ifm[2]; }
      if (/^Whenever (CARDNAME|enchanted creature|equipped creature) deals damage$/i.test(tm[1]) && /^you gain that much life$/i.test(body)) {
        out.push({ kind: 'static', text, st: /CARDNAME/.test(tm[1]) ? { kind: 'lifelinkLike' } : { kind: 'attach' }, ok: true });
        continue;
      }
      const r = parseEffectText(body);
      out.push({ kind: 'trigger', text, ev: tr && tr.ev, filt: tr && tr.filt, cast: tr && tr.cast, cond, fx: r.fx, ok: !!tr && r.ok && !cond, missing: r.missing, condText: tm[1] });
      continue;
    }
    // 4) activada (coste: efecto)
    const am = text.match(/^([^:"]{1,80}?): (.+)$/);
    if (am && (/[{]|^[+−-]?\d+$|Sacrifice|Pay|Discard|Remove|Exile|Tap|Return/.test(am[1]))) {
      const cost = parseCost(am[1]);
      let body = am[2];
      const sorcery = /Activate only as a sorcery/i.test(body);
      const once = /Activate only once each turn/i.test(body);
      body = body.replace(/\s*Activate only (?:as a sorcery|once each turn|during your turn|during your upkeep|during combat|before blockers are declared|if [^.]+)\.?/gi, '').trim();
      const r = parseEffectText(body);
      const isMana = r.fx.length > 0 && r.fx.every((e) => e.kind === 'addMana');
      out.push({ kind: isMana ? 'mana' : 'activated', text, cost, fx: r.fx, sorcery: sorcery || cost.loyalty != null, once: once || cost.loyalty != null, exhaust: word === 'Exhaust',
        ok: r.ok && cost.other.length === 0, missing: r.missing });
      continue;
    }
    // 5) hechizo
    if (isSpell) {
      const st = parseStatic(text, card);
      if (st) { out.push({ kind: 'static', text, st, ok: true }); continue; }
      const r = parseEffectText(text);
      out.push({ kind: 'spell', text, fx: r.fx, ok: r.ok, missing: r.missing });
      continue;
    }
    // 6) estática
    const st = parseStatic(text, card);
    out.push({ kind: 'static', text, st, ok: !!st });
  }
  for (const a of out) if (!a.ok) a.template = templateOf(a);
  return out;
}

/** Plantilla genérica de una habilidad no cubierta (para agrupar en la auditoría). */
export function templateOf(a) {
  const base = a.kind === 'trigger' && a.ev && a.missing?.length ? '[' + a.ev + '] ' + a.missing.join(' / ')
    : a.kind === 'activated' && a.missing?.length ? '[act] ' + a.missing.join(' / ')
      : a.kind === 'spell' && a.missing?.length ? a.missing.join(' / ')
        : a.text;
  return base.replace(/\{[0-9X]+\}/g, '{N}').replace(/\b\d+\b/g, 'N').replace(/\{[WUBRG]\}/g, '{C}')
    .replace(/\b(a|an|one|two|three|four|five|six)\b(?= (?:target|\+1|-1|cards?|life|damage|creature|\d))/gi, 'N');
}

export { targetEs };

// ------------------------------------------------------------ caché

const CACHE = new Map();
/** Habilidades de una carta (con caché por nombre + texto; no se guarda en el estado). */
export function abilitiesOf(card) {
  if (!card) return [];
  const key = (card.name || '') + '\u0001' + (card.oracle || '') + '\u0001' + (card.typeLine || '');
  let a = CACHE.get(key);
  if (!a) {
    a = parseAbilities(card);
    if (CACHE.size > 5000) CACHE.clear();
    CACHE.set(key, a);
  }
  return a;
}
export const staticsOf = (card) => abilitiesOf(card).filter((a) => a.kind === 'static' && a.st).map((a) => a.st);
export const triggersOf = (card, ev) => abilitiesOf(card).filter((a) => a.kind === 'trigger' && a.ev === ev && a.fx.length && !a.cond);
export const activatedOf = (card) => abilitiesOf(card).filter((a) => (a.kind === 'activated' || a.kind === 'mana') && a.fx.length);
export const keywordsOf = (card) => abilitiesOf(card).filter((a) => a.kind === 'keyword').map((a) => a.text.toLowerCase());

/** Costes alternativos y adicionales de una carta (estímulo, ciclo, evocar, retrospectiva, transfigurar…). */
export function altCosts(card) {
  const out = {};
  const t = cleanText(card).replace(/—/g, '—');
  const get = (re) => { const m = t.match(re); return m ? m[1].trim() : null; };
  out.kicker = get(/(?:^|\n|, )Kicker ((?:\{[^}]+\})+)/i);
  out.cycling = get(/(?:^|\n|, )Cycling ((?:\{[^}]+\})+)/i);
  const tc = t.match(/(?:^|\n|, )((?:Basic l|L)andcycling|[A-Z][a-z]+cycling) ((?:\{[^}]+\})+)/);
  if (tc) out.typecycling = { what: tc[1].replace(/cycling$/i, ''), cost: tc[2] };
  out.evoke = get(/(?:^|\n|, )Evoke ((?:\{[^}]+\})+)/i);
  out.flashback = get(/(?:^|\n|, )Flashback ((?:\{[^}]+\})+)/i);
  out.morph = get(/(?:^|\n|, )Morph ((?:\{[^}]+\})+)/i);
  out.megamorph = get(/(?:^|\n|, )Megamorph ((?:\{[^}]+\})+)/i);
  out.disguise = get(/(?:^|\n|, )Disguise ((?:\{[^}]+\})+)/i);
  out.dash = get(/(?:^|\n|, )Dash ((?:\{[^}]+\})+)/i);
  out.escape = get(/(?:^|\n|, )Escape—((?:\{[^}]+\})+)/i);
  out.unearth = get(/(?:^|\n|, )Unearth ((?:\{[^}]+\})+)/i);
  out.buyback = get(/(?:^|\n|, )Buyback ((?:\{[^}]+\})+)/i);
  out.entwine = get(/(?:^|\n|, )Entwine ((?:\{[^}]+\})+)/i);
  const w = t.match(/(?:^|\n|, )Ward(?: |—)(?:((?:\{[^}]+\})+)|Pay (\d+) life)/i);
  if (w) out.ward = w[1] ? { mana: w[1] } : { life: +w[2] };
  out.convoke = /(?:^|\n|, )Convoke\b/i.test(t);
  out.delve = /(?:^|\n|, )Delve\b/i.test(t);
  out.improvise = /(?:^|\n|, )Improvise\b/i.test(t);
  const af = t.match(/(?:^|\n|, )Affinity for (\w+)/i);
  if (af) out.affinity = af[1].replace(/s$/, '');
  for (const k of Object.keys(out)) if (out[k] == null || out[k] === false) delete out[k];
  return out;
}


/** Niveles («Level up»): [{ min, max, p, t, kw: [] }] a partir del texto. */
export function levelsOf(card) {
  const lines = (card.oracle || '').split('\n').map((x) => x.trim());
  const out = [];
  let cur = null;
  for (const l of lines) {
    const m = l.match(/^LEVEL (\d+)(?:-(\d+)|\+)$/);
    if (m) { cur = { min: +m[1], max: m[2] ? +m[2] : 99, p: null, t: null, kw: [] }; out.push(cur); continue; }
    if (!cur) continue;
    const pt = l.match(/^(\d+)\/(\d+)$/);
    if (pt) { cur.p = +pt[1]; cur.t = +pt[2]; continue; }
    for (const k of l.split(/,\s*/)) { const kw = keywordOf(k); if (kw) cur.kw.push(kw); }
  }
  return out;
}


/** Qué se cuenta en «igual al número de …» / «por cada …». */
export function countWhat(t) {
  const x = t.toLowerCase().replace(/\.$/, '').replace(/^twice /, '');
  if (/^lands you control$/.test(x)) return 'myLands';
  if (/^(?:other )?creatures you control$/.test(x)) return /other/.test(x) ? 'myOtherCreatures' : 'myCreatures';
  if (/^artifacts? you control$/.test(x)) return 'myArtifacts';
  if (/^enchantments? you control$/.test(x)) return 'myEnchantments';
  if (/^cards in your hand$/.test(x)) return 'myHand';
  if (/^(?:creature )?cards? in your graveyard$/.test(x)) return /creature/.test(x) ? 'myGraveCreatures' : 'myGrave';
  if (/^creatures? cards? in your graveyard$/.test(x)) return 'myGraveCreatures';
  if (/^(?:basic )?(plains|islands?|swamps?|mountains?|forests?) you control$/.test(x)) return 'myLandType:' + x.match(/(plains|island|swamp|mountain|forest)/)[1];
  if (/^creatures? on the battlefield$/.test(x)) return 'allCreatures';
  if (/^creature card in your graveyard$/.test(x)) return 'myGraveCreatures';
  if (/^artifact you control$/.test(x)) return 'myArtifacts';
  if (/^land you control$/.test(x)) return 'myLands';
  if (/^other creature you control$/.test(x)) return 'myOtherCreatures';
  if (/^creature you control$/.test(x)) return 'myCreatures';
  if (/^enchantment you control$/.test(x)) return 'myEnchantments';
  if (/^card in your hand$/.test(x)) return 'myHand';
  if (/^opponent you have$/.test(x)) return 'opponents';
  return null;
}
