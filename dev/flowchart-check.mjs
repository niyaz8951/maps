#!/usr/bin/env node
// Worked examples for the flowchart engine (assets/mp-fc.js): layout, arrows, checks, paths and Mermaid in and out.
// Invented, generic content. Run: node dev/flowchart-check.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fc = require('../assets/mp-fc.js');

let failed = 0;
function check(ok, what) { if (!ok) { failed++; console.log('FAIL  ' + what); } else console.log('ok    ' + what); }
const levels = (r) => r.map((x) => x.level[0]).join('');
const has = (r, level, words) => r.some((x) => x.level === level && x.text.indexOf(words) >= 0);

// An approval flow with two lanes, a decision, and a loop back for rework.
const S = (id, title, type, lane, order) => ({ id, title, type, lane, order });
const approval = {
  lanes: ['Sales', 'Application'],
  steps: [
    S('s', 'Request received', 'start', 'Sales', 0),
    S('c', 'Check the request', 'process', 'Application', 1),
    S('d', 'Standard product?', 'decision', 'Application', 2),
    S('o', 'Prepare the offer', 'process', 'Sales', 3),
    S('r', 'Ask the factory', 'process', 'Application', 4),
    S('e', 'Offer sent', 'end', 'Sales', 5)
  ],
  flows: [
    { id: 'f1', from: 's', to: 'c', label: '', order: 0 },
    { id: 'f2', from: 'c', to: 'd', label: '', order: 1 },
    { id: 'f3', from: 'd', to: 'o', label: 'Yes', order: 2 },
    { id: 'f4', from: 'd', to: 'r', label: 'No', order: 3 },
    { id: 'f5', from: 'r', to: 'c', label: 'Answer back', order: 4 },
    { id: 'f6', from: 'o', to: 'e', label: '', order: 5 }
  ]
};

// 1. Layout: ranks top to bottom, lanes as columns, the loop goes round on the right
const L = fc.layout(approval), N = L.nodes;
check(N.s.y < N.c.y && N.c.y < N.d.y && N.d.y < N.o.y && N.o.y < N.e.y, 'steps go down in order');
check(N.o.y === N.r.y, 'both answers of the decision on the same row');
check(L.lanes.length === 2 && L.lanes[0].name === 'Sales' && L.lanes[1].name === 'Application', 'two lanes in the order given');
const inLane = (n, lane) => { const b = L.lanes.find((x) => x.name === lane); return n.x >= b.x && n.x + n.w <= b.x + b.w; };
check(inLane(N.s, 'Sales') && inLane(N.o, 'Sales') && inLane(N.c, 'Application') && inLane(N.r, 'Application'), 'each step inside its lane');
const back = L.edges.find((e) => e.id === 'f5');
check(back && back.back === true, 'the rework arrow is a loop');
check(back.pts[1][0] > Math.max(N.r.x + N.r.w, N.c.x + N.c.w), 'the loop runs to the right of both steps');
const yes = L.edges.find((e) => e.id === 'f3'), no = L.edges.find((e) => e.id === 'f4');
const atBottom = (e) => e.pts[0][1] === N.d.y + N.d.h, atSide = (e) => e.pts[0][1] === N.d.y + N.d.h / 2;
check(atBottom(no) && atSide(yes), 'decision: the exit straight below leaves at the bottom, the other from the side');
check(L.edges.every((e) => /^M-?\d+ -?\d+(L-?\d+ -?\d+)+$/.test(e.d)), 'every arrow is a plain path');
check(L.box.w > 0 && L.box.h > 0 && L.box.x <= 0 && L.box.y <= 0, 'drawing box holds everything');

// 2. Drag to place: a placed step stays where it was put, the others keep their places
const placed = JSON.parse(JSON.stringify(approval)); placed.steps[4].place = { x: 900, y: 40 };
const L2 = fc.layout(placed);
check(L2.nodes.r.x === 900 && L2.nodes.r.y === 40 && L2.nodes.r.placed, 'placed step stays at its place');
check(L2.nodes.s.x === N.s.x && L2.nodes.s.y === N.s.y, 'the others are where auto layout puts them');
check(L2.box.x + L2.box.w >= 900 + N.r.w, 'drawing grows to hold it');

// 3. No lanes: one column, no headers; text wraps
const plain = { steps: [S('a', 'Start', 'start', '', 0), S('b', 'A step with a fairly long name that has to wrap over lines', 'process', '', 1), S('z', 'End', 'end', '', 2)],
  flows: [{ id: 'x1', from: 'a', to: 'b' }, { id: 'x2', from: 'b', to: 'z' }] };
const L3 = fc.layout(plain);
check(L3.lanes.length === 0, 'no lanes: no lane headers');
check(L3.nodes.b.lines.length >= 2 && L3.nodes.b.lines.every((l) => l.length <= 24), 'long name wraps at 24 characters');
check(L3.nodes.b.h > 56, 'wrapped step is taller');
check(L3.edges.length === 2 && L3.edges[0].pts.length === 2, 'straight arrow when one step is under the other');
check(fc.wrap('Supercalifragilisticexpialidocious word', 10).every((l) => l.length <= 10), 'a word longer than a line is cut');

// 3b. Arrows go round steps: no arrow of the approval flow crosses a step; a side exit with a step in its way goes round it
check(L.edges.every((e) => e.clear), 'approval flow: no arrow crosses a step');
const blocked = {
  steps: [S('s', 'Start', 'start', '', 0), S('d', 'Pump running?', 'decision', '', 1), S('c', 'Check the strainer', 'process', '', 2), S('r', 'Read the trip code', 'data', '', 3), S('e', 'Done', 'end', '', 4),
    S('x', 'In the way', 'process', '', 5)],
  flows: [{ id: 'k1', from: 's', to: 'd' }, { id: 'k2', from: 'd', to: 'c', label: 'Yes', order: 1 }, { id: 'k3', from: 'd', to: 'r', label: 'No', order: 2 },
    { id: 'k4', from: 'c', to: 'e' }, { id: 'k5', from: 'r', to: 'e' }]
};
const LB = fc.layout(blocked);
const side = LB.edges.find((e) => e.from === 'd' && e.pts[0][1] === LB.nodes.d.y + LB.nodes.d.h / 2);
check(!!side, 'the decision has a side exit');
const leftSide = side.pts[0][0] === LB.nodes.d.x;
// put a step right where that side exit leaves the decision
blocked.steps[5].place = { x: leftSide ? LB.nodes.d.x - 20 - 190 : LB.nodes.d.x + LB.nodes.d.w + 20, y: LB.nodes.d.y };
const LB2 = fc.layout(blocked), again = LB2.edges.find((e) => e.id === side.id);
check(LB2.edges.every((e) => e.clear), 'a step put in the way of an exit: every arrow goes round it');
check(again.d !== side.d, 'that arrow took another route');

// 4. Checks on the good flow: only the loop as information
const c1 = fc.check(approval);
check(levels(c1) === 'i' && has(c1, 'info', 'One loop'), 'good flow: no error, no warning, one loop noted');

// 5. Checks on a broken flow
const broken = {
  steps: [S('a', 'Begin', 'process', '', 0), S('d', 'Valve open?', 'decision', '', 1), S('p', 'Open the valve', 'process', '', 2),
    S('q', 'Log it', 'process', '', 3), S('x', 'Orphan', 'process', '', 4), S('w', 'Wait', 'process', '', 5)],
  flows: [{ id: 'b1', from: 'a', to: 'd' }, { id: 'b2', from: 'd', to: 'p', label: 'No' }, { id: 'b3', from: 'p', to: 'q' }, { id: 'b4', from: 'p', to: 'w' }]
};
const c2 = fc.check(broken);
check(has(c2, 'error', 'no Start'), 'no Start: error');
check(has(c2, 'error', 'no End'), 'no End: error');
check(has(c2, 'error', 'needs two or more exits'), 'decision with one exit: error');
check(has(c2, 'warning', 'has 2 exits'), 'a Process that branches: warning');
check(c2[0].level === 'error' && c2[c2.length - 1].level !== 'error', 'errors first');
const b2 = JSON.parse(JSON.stringify(broken));
b2.steps[0].type = 'start'; b2.steps[3].type = 'end';
b2.flows.push({ id: 'b5', from: 'd', to: 'q', label: 'no' });
const c3 = fc.check(b2);
check(has(c3, 'error', 'same answer'), 'two exits with the same answer: error');
check(has(c3, 'warning', 'Not reached') && c3.find((x) => x.text.indexOf('Not reached') >= 0).ids.indexOf('x') >= 0, 'orphan step: not reached');
check(has(c3, 'error', 'Dead end') && c3.find((x) => x.text.indexOf('Dead end') >= 0).ids.indexOf('w') >= 0, 'step with no way on: dead end');
b2.flows.push({ id: 'b6', from: 'd', to: 'w' });
check(has(fc.check(b2), 'error', 'Label every exit'), 'an unlabelled exit of a decision: error');
check(has(fc.check({ steps: [], flows: [] }), 'info', 'No steps'), 'empty flowchart: a hint');

// 6. Paths: every way from Start to End; a loop ends the way it closes
const p = fc.paths(approval);
check(p.paths.length === 2 && !p.cut, 'two ways through the approval flow');
const toEnd = p.paths.find((x) => x.end === 'end'), loop = p.paths.find((x) => x.end === 'loop');
check(toEnd && toEnd.steps.join('') === 'scdoe' && toEnd.answers[2] === 'Yes', 'Yes way: Start, check, decision, offer, End');
check(loop && loop.loopTo === 'c' && loop.steps.join('') === 'scdr', 'No way: back to the check (loop)');
const wide = { steps: [S('s', 'Start', 'start', '', 0)], flows: [] };
let prev = 's';
for (let i = 0; i < 9; i++) { const d = 'd' + i, j = 'j' + i; wide.steps.push(S(d, 'Q' + i, 'decision', '', 2 * i + 1), S(j, 'J' + i, 'process', '', 2 * i + 2)); wide.flows.push({ from: prev, to: d }, { from: d, to: j, label: 'Yes' }, { from: d, to: j + 'b', label: 'No' }); wide.steps.push(S(j + 'b', 'K' + i, 'process', '', 100 + i)); wide.flows.push({ from: j + 'b', to: j }); prev = j; }
const pw = fc.paths(wide, 200);
check(pw.paths.length === 200 && pw.cut, '2^9 ways: the list stops at 200 and says so');

// 7. Mermaid in
const mm = [
  'flowchart TD',
  '  %% a comment',
  '  subgraph S1[Sales]',
  '    A([Start]) --> B[Check the request]',
  '  end',
  '  subgraph Application',
  '    C{"Standard, or special?"}',
  '    D[/Datasheet/]',
  '  end',
  '  B --> C',
  '  C -->|Standard| E[[Price list]]',
  '  C -- Special --> F@{ shape: delay, label: "Wait for the factory" }',
  '  F --> D --> G(((Done)))',
  '  E & D --> H>Offer letter]',
  '  H --> G',
  '  classDef red fill:#f00',
  '  this is not mermaid'
].join('\n');
const m = fc.mermaid.parse(mm);
const it = (k) => m.items.find((x) => x.key === k);
check(m.items.length === 8, 'eight steps read');
check(it('A').type === 'start' && it('G').type === 'end', 'Start and End from their words');
check(it('C').type === 'decision' && it('C').title === 'Standard, or special?', 'decision with quoted text');
check(it('D').type === 'data' && it('E').type === 'subprocess' && it('F').type === 'delay' && it('H').type === 'document', 'shapes: data, sub-process, wait, document');
check(it('A').props.lane === 'Sales' && it('C').props.lane === 'Application' && !it('H').props.lane, 'lanes from subgraphs');
check(m.lanes.join('|') === 'Sales|Application', 'lane order');
check(it('C').next.map((x) => x.to + ':' + x.label).join(',') === 'E:Standard,F:Special', 'labelled exits, both forms');
check(it('F').next[0].to === 'D' && it('D').next.map((x) => x.to).join(',') === 'G,H', 'a chain and "&"');
check(m.warnings.length === 1 && m.warnings[0].indexOf('not understood') >= 0, 'a line that is not Mermaid is reported, not guessed');
check(fc.mermaid.parse('hello').items.length === 0 && fc.mermaid.parse('hello').warnings.length === 1, 'plain text is not taken for a flowchart');
const inf = fc.mermaid.parse('graph LR\n  P(Pump on) --> Q(Flow ok)\n  Q --> R(Alarm)');
check(inf.items.map((x) => x.type).join(',') === 'process,process,process', 'round boxes are Process steps');
const term = fc.mermaid.parse('flowchart TD\n  a([Receive]) --> b([Archive])');
check(term.items[0].type === 'start' && term.items[1].type === 'end', 'a terminal with nothing before it starts, with nothing after it ends');

// 8. Mermaid out, and back in: the same steps, shapes, lanes and arrows
const out = fc.mermaid.write(approval);
check(/^flowchart TD\n/.test(out) && out.indexOf('subgraph L1["Sales"]') > 0, 'written with lanes as subgraphs');
check(out.indexOf('-->|"Yes"|') > 0, 'answers on the arrows');
const back2 = fc.mermaid.parse(out);
check(back2.items.length === 6 && back2.items.map((x) => x.type).sort().join(',') === approval.steps.map((x) => x.type).sort().join(','), 'round trip: same shapes');
check(back2.items.reduce((a, x) => a + x.next.length, 0) === 6, 'round trip: same arrows');
const t1 = back2.items.find((x) => x.title === 'Standard product?');
check(t1 && t1.next.map((x) => x.label).join(',') === 'Yes,No', 'round trip: same answers');
check(back2.items.find((x) => x.title === 'Ask the factory').props.lane === 'Application', 'round trip: same lanes');
const odd = { steps: [S('a', 'Say "hi" & <go>', 'document', '', 0), S('b', 'Wait 5 min', 'delay', '', 1)], flows: [{ from: 'a', to: 'b', label: 'then' }] };
const o2 = fc.mermaid.parse(fc.mermaid.write(odd));
check(o2.items[0].title === 'Say "hi" & <go>' && o2.items[0].type === 'document' && o2.items[1].type === 'delay', 'quotes, & and < > survive; document and wait kept');

// 9. The plain outline (Export / Import) of a flowchart: Shape, Lane and Next lines, read back the same
const io = require('../assets/mp-io.js');
const nodes = { root: { title: 'Approval', notes: '', special: [], props: { lanes: ['Sales', 'Application'] }, kids: approval.steps.map((x) => x.id) } };
approval.steps.forEach((x) => { nodes[x.id] = { title: x.title, notes: '', special: [], type: x.type, props: { lane: x.lane }, kids: [] }; });
const NAMES = Object.fromEntries(fc.SHAPES.map((x) => [x.id, x.name]));
const txt = io.write((id) => nodes[id], 'root', { name: (t) => NAMES[t], exits: (id) => approval.flows.filter((f) => f.from === id).map((f) => ({ label: f.label, to_title: nodes[f.to].title })) });
check(txt.indexOf('  ! Lanes: Sales, Application') > 0 && txt.indexOf('    ! Shape: Decision') > 0 && txt.indexOf('    ! Next: Yes -> Prepare the offer') > 0, 'outline: lanes, shapes and answers written');
const rd = io.parse(txt, 'flowchart');
check(rd.centre && rd.centre.title === 'Approval' && rd.centre.lanes.join('|') === 'Sales|Application', 'outline: the centre is read as the map, with its lanes');
check(rd.items.length === 6 && rd.items.every((x) => x.depth === 0) && rd.items.map((x) => x.type).join(',') === approval.steps.map((x) => x.type).join(','), 'outline: six flat steps, same shapes');
check(rd.items.reduce((a, x) => a + x.next.length, 0) === 6 && rd.items[2].next.map((x) => x.label).join(',') === 'Yes,No', 'outline: same arrows and answers');
check(rd.items[4].props.lane === 'Application' && !rd.unknown.length, 'outline: same lanes, every Next found');
const kn = io.parse('Pump\n  ! Shape: Decision\n  ! Next: Yes -> Pump');
check(kn.items[0].special.length === 2 && !kn.items[0].type, 'outline: in a knowledge map these stay special notes');

// 11. A process flow (an escalation ladder, invented names): replies beside their arrows, notes in a box, a Note, a group
const P = (id, title, type, extra, order) => Object.assign({ id, title, type, lane: '', order }, extra || {});
const esc = {
  style: 'process',
  steps: [P('s', 'Requester', 'start', {}, 0),
    P('l1', 'Level 1 - First line', 'process', { showNotes: true, notes: 'ROLES\n- Answer standard questions\n- Log every request\n- Escalate what is not resolved' }, 1),
    P('l2', 'Level 2 - Knowledge base', 'data', {}, 2), P('l3', 'Level 3 - Specialists', 'process', { group: 'Head office' }, 3),
    P('p', 'Level 4 - Product team', 'process', { group: 'Head office' }, 4), P('f', 'Level 4 - Factory', 'process', { group: 'Head office' }, 5),
    P('n', 'Not handled here', 'note', { notes: '- Orders\n- Prices' }, 6)],
  flows: [
    { id: 'q', from: 's', to: 'l1', label: 'Query' }, { id: 'qr', from: 'l1', to: 's', label: 'Reply', reply: true },
    { id: 'a', from: 'l1', to: 'l2', label: 'Not resolved' }, { id: 'ar', from: 'l2', to: 'l1', label: 'Answer', reply: true },
    { id: 'b', from: 'l2', to: 'l3', label: 'No answer found' }, { id: 'br', from: 'l3', to: 'l2', label: 'Answer', reply: true },
    { id: 'c', from: 'l3', to: 'p', label: 'Not resolved' }, { id: 'cr', from: 'p', to: 'l3', label: 'Answer', reply: true },
    { id: 'd', from: 'l3', to: 'f', label: 'Not resolved' }, { id: 'dr', from: 'f', to: 'l3', label: 'Answer', reply: true }]
};
const E = fc.layout(esc), EN = E.nodes, edge = (id) => E.edges.find((e) => e.id === id);
check(EN.s.y < EN.l1.y && EN.l1.y < EN.l2.y && EN.l2.y < EN.l3.y && EN.l3.y < EN.p.y && EN.p.y === EN.f.y, 'replies do not change the order: the levels go down, level 4 side by side');
check(E.edges.length === 10 && E.edges.filter((e) => e.reply).length === 5, 'five arrows and five replies drawn');
const q = edge('a'), qr = edge('ar');
check(q.pts.length === 2 && qr.pts.length === 2 && q.pts[0][0] === qr.pts[0][0] - 14 && qr.pts[0][1] > qr.pts[1][1], 'a reply runs beside its arrow, the other way');
check(q.anchor === 'end' && qr.anchor === 'start' && q.lx < q.pts[0][0] && qr.lx > qr.pts[0][0], 'the arrow\'s words on the left, the reply\'s on the right');
check(E.edges.every((e) => e.clear), 'no arrow or reply crosses a box');
check(EN.l1.card && EN.l1.notes[0].length === 4 && EN.l1.notes[0][1] === '• Answer standard questions' && EN.l1.h > 100, 'notes shown in the box, as bullets');
check(EN.n.card && EN.n.x >= Math.max(...['s', 'l1', 'l2', 'l3', 'p', 'f'].map((k) => EN[k].x + EN[k].w)), 'the Note stands to the right of the chart');
const G = E.groups[0];
check(E.groups.length === 1 && G.name === 'Head office' && G.y1 <= EN.l3.y && G.y2 >= EN.p.y + EN.p.h && G.x < Math.min(EN.l3.x, EN.p.x) && E.box.x < G.x - 60, 'group bracket on the left of its boxes, with room for its name');
check(E.legend && E.legend.y > EN.f.y + EN.f.h, 'a legend under the chart when there are replies');
check(fc.check(esc).every((x) => x.level === 'info'), 'process flow: no End, branching, replies and a Note are all fine');
check(fc.check(Object.assign({}, esc, { style: 'flowchart' })).some((x) => x.text.indexOf('no End') >= 0), 'the same as a flowchart: an End is asked for');
const lone = JSON.parse(JSON.stringify(esc)); lone.steps.push(P('z', 'Forgotten box', 'process', {}, 9));
check(fc.check(lone).some((x) => x.level === 'warning' && x.ids[0] === 'z'), 'process flow: a box joined to nothing gets a warning');
const pe = fc.paths(esc);
check(pe.paths.length === 2 && pe.paths.every((x) => x.end === 'stop' && x.steps.length === 5), 'ways through follow the arrows, not the replies');
const card = fc.sizeOf({ type: 'process', title: 'Long list', showNotes: true, notes: Array.from({ length: 12 }, (_, i) => '- Item ' + (i + 1)).join('\n') });
check(card.notes.length === 2 && card.w === 460, 'many lines of notes: two columns');
check(fc.sizeOf({ type: 'decision', title: 'Q?', showNotes: true, notes: 'x' }).card !== true, 'a Decision keeps its shape (no notes in it)');
const em = fc.mermaid.write(esc), eb = fc.mermaid.parse(em);
check(/n2 -.->\|"Reply"\| n1/.test(em) && /@\{ shape: braces/.test(em), 'Mermaid out: replies dashed, the Note as braces');
check(eb.items.reduce((a, x) => a + x.next.filter((n) => n.reply).length, 0) === 5 && eb.items.find((x) => x.title === 'Not handled here').type === 'note', 'Mermaid round trip: replies and the Note come back');
const io2 = require('../assets/mp-io.js'), en = { root: { title: 'Escalation', notes: '', special: [], props: {}, kids: esc.steps.map((x) => x.id) } };
esc.steps.forEach((x) => { en[x.id] = { title: x.title, notes: x.notes || '', special: [], type: x.type, props: Object.assign({}, x.group ? { group: x.group } : {}, x.showNotes ? { show_notes: true } : {}), kids: [] }; });
const et = io2.write((id) => en[id], 'root', { name: (t) => NAMES[t], exits: (id) => esc.flows.filter((f) => f.from === id).map((f) => ({ label: f.label, to_title: en[f.to].title, reply: f.reply })) });
const er = io2.parse(et, 'flowchart');
check(et.indexOf('! Reply: Answer -> Level 1 - First line') > 0 && et.indexOf('! Group: Head office') > 0 && et.indexOf('! Show notes: yes') > 0, 'outline out: Reply, Group and Show notes lines');
check(er.items.reduce((a, x) => a + x.next.filter((n) => n.reply).length, 0) === 5 && er.items[3].props.group === 'Head office' && er.items[1].props.show_notes === true, 'outline round trip: the same replies, group and notes setting');

// 10. The starters (templates/flowchart-*.json): every one passes the check with no problem and no warning
const fs = require('node:fs');
for (const f of fs.readdirSync(new URL('../templates/', import.meta.url)).filter((x) => /^flowchart-.*\.json$/.test(x))) {
  const t = JSON.parse(fs.readFileSync(new URL('../templates/' + f, import.meta.url), 'utf8'));
  const m2 = { style: t.style || 'flowchart', lanes: t.lanes || [], steps: t.items.map((x, i) => ({ id: x.key, title: x.title, type: x.type, lane: (x.props || {}).lane || '', order: i })),
    flows: t.items.flatMap((x) => (x.next || []).map((n, j) => ({ id: x.key + '>' + n.to, from: x.key, to: n.to, label: n.label || '', order: j, reply: !!n.reply }))) };
  const r = fc.check(m2);
  check(t.kind === 'flowchart' && !r.some((x) => x.level !== 'info'), 'starter ' + f + ': no problem, no warning' + (r.length ? ' (' + r.map((x) => x.text).join(' / ') + ')' : ''));
  check(JSON.stringify(t).indexOf('http') < 0, 'starter ' + f + ': no address in it');
}

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL FLOWCHART CHECKS PASSED');
process.exit(failed ? 1 : 0);
