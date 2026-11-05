#!/usr/bin/env node
// Check of the outline reader and writer (assets/mp-io.js): an outline as the old tool exported it reads into the right
// branches, notes, special notes and typed values, and a map written out reads back the same. Run: node dev/outline-check.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const io = require('../assets/mp-io.js');

let failed = 0;
function check(ok, what) { if (!ok) { failed++; console.log('FAIL  ' + what); } else console.log('ok    ' + what); }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 1. The old Export, word for word in its format (invented content): 2 spaces per level, "  > " notes, "  ! " special notes.
const old = [
  'Example product',
  '  > What the product is and where it is used.',
  '  ! Layout: columns',
  '  Components',
  '    Compressor',
  '      > Raises the refrigerant pressure.',
  '      > Two stages.',
  '      ! Check the starting current',
  '      ! Place: 120, 80',
  '    Evaporator',
  '      ! Icon: coil',
  '      ! Place: Dubai',
  '  Standards',
  '    AHRI 550/590',
  ''
].join('\r\n');
const r = io.parse('﻿' + old);
check(r.items.length === 6, 'six branches');
check(eq(r.items.map((i) => i.depth), [0, 1, 2, 2, 1, 2]), 'depths 0 1 2 2 1 2');
check(r.items[0].notes === 'What the product is and where it is used.' && r.items[0].props.layout === 'columns', 'Layout: columns becomes the layout');
check(r.items[2].notes === 'Raises the refrigerant pressure.\nTwo stages.', 'notes over two lines');
check(eq(r.items[2].special, ['Check the starting current']) && eq(r.items[2].place, { x: 120, y: 80 }), 'Place: 120, 80 becomes the place; other special notes stay');
check(eq(r.items[3].special, ['Icon: coil', 'Place: Dubai']) && r.items[3].place === undefined, 'unknown or unreadable values stay special notes, word for word');
check(r.typed === 2 && r.cut === 0, 'two typed values, nothing cut');

// 2. Bullets, tabs, an uneven indent, a step back out
const loose = '- Pumps\n\t* Primary\n\t* Secondary\n   1. Standby\nValves\n';
const l = io.parse(loose);
check(eq(l.items.map((i) => [i.depth, i.title]), [[0, 'Pumps'], [1, 'Primary'], [1, 'Secondary'], [1, 'Standby'], [0, 'Valves']]), 'bullets, tabs and uneven indents');

// 3. Limits: long names and notes are cut and counted
const long = io.parse('A' + 'x'.repeat(130) + '\n  ! ' + 'y'.repeat(210));
check(long.items[0].title.length === 120 && long.items[0].special[0].length === 200 && long.cut === 2, 'too long: cut to the limits and counted');

// 4. Round trip: written out, read back the same (blank lines in notes kept, a name starting with ! or > escaped)
const tree = {
  r: { title: 'Map', notes: 'First paragraph.\n\nSecond paragraph.', special: ['Terms: casing leakage'], props: { layout: 'columns' }, kids: ['a', 'b'] },
  a: { title: '! Not a special note', notes: '', special: [], props: {}, place: { x: 10, y: -20, w: 60, h: 40 }, kids: ['c'] },
  b: { title: 'B', notes: '', special: [], props: {}, kids: [] },
  c: { title: 'C', notes: 'note', special: ['x'], props: {}, kids: [] }
};
const text = io.write((id) => tree[id], 'r');
const back = io.parse(text);
check(back.items.length === 4, 'round trip: four branches');
check(back.items[0].notes === tree.r.notes && back.items[0].props.layout === 'columns' && eq(back.items[0].special, tree.r.special), 'round trip: notes with a blank line, layout, special notes');
check(back.items[1].title === tree.a.title && eq(back.items[1].place, tree.a.place), 'round trip: escaped name, place with size');
check(eq(back.items.map((i) => i.depth), [0, 1, 2, 1]), 'round trip: depths');

console.log(failed ? `\n${failed} FAILED` : '\nALL OUTLINE CHECKS PASSED');
process.exit(failed ? 1 : 0);
