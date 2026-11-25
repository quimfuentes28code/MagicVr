#!/usr/bin/env node
// Auditoría de TODAS las cartas: qué habilidades aplica sola la app y cuáles no.
// Uso: node scripts/audit-cards.mjs [--top 60] [--json salida.json] [--grep texto]
// Divide el texto oficial de cada carta en habilidades y comprueba, una por una,
// si el motor la entiende (palabra clave, efecto al entrar/morir/lanzar, estática,
// activada, disparada...). Lista las plantillas sin cubrir más frecuentes.
import fs from 'fs';
import { recordToCard } from '../src/carddb.js';
import { classifyAbility } from '../src/engine/coverage.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const TOP = +opt('--top', 60);
const GREP = opt('--grep', null);
const db = JSON.parse(fs.readFileSync(new URL('../public/carddb.json', import.meta.url)));
const SKIP_TYPES = /\b(Token|Emblem|Scheme|Plane|Phenomenon|Vanguard|Conspiracy|Dungeon|Attraction|Contraption)\b/;

let cards = 0, full = 0, abilities = 0, handled = 0;
const missing = new Map();
const byKind = {};
const perCard = [];
for (const r of db.cards) {
  if (SKIP_TYPES.test(r.t || '') || /^A-/.test(r.n)) continue;
  // sólo cartas de papel normales: fuera las de Alchemy (digitales) y las de broma (Un-sets)
  if (/^y/.test(r.s || '') || /^(unh|ugl|ust|und|unf|unk|uplist|pust|punk|cmb\d|mb2|ulst|sunf|tunf|hho|ptg)$/.test(r.s || '') || (r.k || []).some((k) => /^(Conjure|Seek|Perpetually|Draft from a spellbook|Specialize|Boon)$/.test(k))) continue;
  const c = recordToCard(r);
  if (!c) continue;
  const res = classifyAbility.card(c);
  cards++;
  let ok = true;
  for (const a of res) {
    abilities++;
    byKind[a.kind] = byKind[a.kind] || [0, 0];
    byKind[a.kind][0]++;
    if (a.ok) { handled++; byKind[a.kind][1]++; continue; }
    ok = false;
    const key = a.template;
    const m = missing.get(key) || { n: 0, ex: [] };
    m.n++;
    if (m.ex.length < 3) m.ex.push(c.name);
    missing.set(key, m);
  }
  if (ok) full++;
  perCard.push([c.name, ok]);
}
const pct = (a, b) => (100 * a / Math.max(1, b)).toFixed(1) + '%';
console.log(`Cartas: ${cards}  ·  100% automáticas: ${full} (${pct(full, cards)})`);
console.log(`Habilidades: ${abilities}  ·  cubiertas: ${handled} (${pct(handled, abilities)})`);
console.log('Por tipo de habilidad:');
for (const [k, [n, h]] of Object.entries(byKind).sort((a, b) => b[1][0] - a[1][0])) console.log(`  ${k.padEnd(12)} ${String(h).padStart(6)}/${String(n).padEnd(6)} ${pct(h, n)}`);
console.log(`\nPlantillas sin cubrir más frecuentes:`);
const list = [...missing.entries()].filter(([k]) => !GREP || k.toLowerCase().includes(GREP.toLowerCase())).sort((a, b) => b[1].n - a[1].n);
for (const [k, m] of list.slice(0, TOP)) console.log(String(m.n).padStart(5), ' ', k.slice(0, 150), '  ←', m.ex.join(', '));
const out = opt('--json', null);
if (out) fs.writeFileSync(out, JSON.stringify({ cards, full, abilities, handled, missing: list.map(([k, m]) => ({ template: k, ...m })) }, null, 1));
