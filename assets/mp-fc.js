/* Maps tile - the flowchart engine (owner, 5 Nov 2026). Pure functions, no page: the same file runs in the browser
   (window.MP.fc) and in node (dev/flowchart-check.mjs, worked examples).
   A flowchart: steps (branches under the centre) in ISO 5807 shapes, each in a lane (swimlane), and arrows ('flow'
   lines) from one step to the next, labelled with the answer when a decision branches.
     model  { steps: [{ id, title, type, lane, place, order }], flows: [{ id, from, to, label, order }], lanes: [names] }
     layout(model)  where every step and arrow is drawn: top to bottom, lanes as columns, right-angled arrows;
                    a step with a place (drag to place) stays where it was put.
     check(model)   what is wrong or worth a look: errors, warnings, information.
     paths(model)   every way from a Start to an End, and the loops.
     mermaid.parse(text) / mermaid.write(model)   a subset of Mermaid in and out. */
(function (root) {
  'use strict';

  // ---------- shapes ----------
  var SHAPES = [
    { id: 'start', name: 'Start', w: 160, h: 48, chars: 20 },
    { id: 'end', name: 'End', w: 160, h: 48, chars: 20 },
    { id: 'process', name: 'Process', w: 190, h: 56, chars: 24 },
    { id: 'decision', name: 'Decision', w: 200, h: 96, chars: 16 },
    { id: 'data', name: 'Input / Output', w: 200, h: 56, chars: 21 },
    { id: 'document', name: 'Document', w: 190, h: 60, chars: 24 },
    { id: 'manual', name: 'Manual step', w: 190, h: 56, chars: 20 },
    { id: 'delay', name: 'Wait', w: 170, h: 52, chars: 20 },
    { id: 'subprocess', name: 'Sub-process', w: 190, h: 56, chars: 20 },
    { id: 'connector', name: 'Connector', w: 52, h: 52, chars: 4 }
  ];
  var BY = {}; SHAPES.forEach(function (s) { BY[s.id] = s; });
  function shape(type) { return BY[type] || BY.process; }
  var LINE = 16, ROWGAP = 64, COLGAP = 44, LANEPAD = 24, HEAD = 44, MARGIN = 30, LOOPGAP = 26, LOOPSTEP = 14;

  // words into lines of at most n characters (a long word is cut)
  function wrap(text, n) {
    var words = String(text || '').replace(/\s+/g, ' ').trim().split(' '), out = [], cur = '';
    words.forEach(function (w) {
      while (w.length > n) { if (cur) { out.push(cur); cur = ''; } out.push(w.slice(0, n - 1) + '-'); w = w.slice(n - 1); }
      if (!cur) cur = w; else if ((cur + ' ' + w).length <= n) cur += ' ' + w; else { out.push(cur); cur = w; }
    });
    if (cur) out.push(cur);
    return out.length ? out : [''];
  }
  function sizeOf(step) {
    var s = shape(step.type), lines = wrap(step.title, s.chars);
    if (lines.length > 6) { lines = lines.slice(0, 6); lines[5] = lines[5].replace(/.?$/, '…'); }
    var h = step.type === 'decision' ? Math.max(s.h, lines.length * LINE + 52) : step.type === 'connector' ? s.h : Math.max(s.h, lines.length * LINE + 24);
    return { w: s.w, h: h, lines: lines };
  }

  // ---------- the graph ----------
  function graph(model) {
    var steps = (model.steps || []).slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    var ids = {}, out = {}, inc = {};
    steps.forEach(function (s) { ids[s.id] = s; out[s.id] = []; inc[s.id] = []; });
    var flows = (model.flows || []).filter(function (f) { return ids[f.from] && ids[f.to] && f.from !== f.to; })
      .sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    flows.forEach(function (f) { out[f.from].push(f); inc[f.to].push(f); });
    return { steps: steps, by: ids, out: out, inc: inc, flows: flows };
  }
  // Depth first from the Starts (then from steps nothing leads to, then the rest): arrows back to a step on the
  // current way are loops ("back"); the others give the order top to bottom.
  function walk(g) {
    var state = {}, order = [], back = {}, seen = [];
    function visit(id) {
      state[id] = 1; seen.push(id);
      g.out[id].forEach(function (f) {
        if (state[f.to] === 1) back[f.id || (f.from + '>' + f.to)] = true;
        else if (!state[f.to]) visit(f.to);
      });
      state[id] = 2; order.push(id);
    }
    g.steps.forEach(function (s) { if (s.type === 'start' && !state[s.id]) visit(s.id); });
    g.steps.forEach(function (s) { if (!g.inc[s.id].length && !state[s.id]) visit(s.id); });
    g.steps.forEach(function (s) { if (!state[s.id]) visit(s.id); });
    return { topo: order.reverse(), back: back, seen: seen };
  }
  function fkey(f) { return f.id || (f.from + '>' + f.to); }

  // ---------- lanes ----------
  function lanesOf(model, g) {
    var list = [], low = {};
    function add(n) { var k = n.toLowerCase(); if (!low[k]) { low[k] = n; list.push(n); } }
    (model.lanes || []).forEach(function (n) { if (n) add(n); });
    var none = false;
    g.steps.forEach(function (s) { if (s.lane) add(s.lane); else none = true; });
    if (!list.length) return { names: [''], key: function () { return ''; }, shown: false };
    if (none) list.push('');
    return { names: list, key: function (s) { return s.lane ? low[s.lane.toLowerCase()] : ''; }, shown: true };
  }

  // ---------- layout ----------
  function layout(model) {
    var g = graph(model), w = walk(g), rank = {}, lanes = lanesOf(model, g), nodes = {};
    // rank: the longest way down from a source, loops left out
    w.topo.forEach(function (id) { if (rank[id] === undefined) rank[id] = 0; g.out[id].forEach(function (f) {
      if (w.back[fkey(f)]) return;
      rank[f.to] = Math.max(rank[f.to] || 0, rank[id] + 1);
    }); });
    // cells: one per lane and rank, steps in the order they were reached
    var pos = {}; w.seen.forEach(function (id, i) { pos[id] = i; });
    var cells = {}, maxRank = 0;
    g.steps.forEach(function (s) {
      var k = lanes.key(s) + '\u0000' + rank[s.id];
      (cells[k] = cells[k] || []).push(s.id);
      maxRank = Math.max(maxRank, rank[s.id]);
    });
    Object.keys(cells).forEach(function (k) { cells[k].sort(function (a, b) { return pos[a] - pos[b]; }); });
    var colW = 0;
    g.steps.forEach(function (s) { var z = sizeOf(s); nodes[s.id] = { id: s.id, type: s.type || 'process', w: z.w, h: z.h, lines: z.lines, lane: lanes.key(s), rank: rank[s.id] }; colW = Math.max(colW, z.w); });
    colW = Math.max(colW, 190) + COLGAP;
    // lane widths: the most steps side by side in any rank of that lane
    var laneBox = [], x = 0;
    lanes.names.forEach(function (name) {
      var most = 1;
      for (var r = 0; r <= maxRank; r++) most = Math.max(most, (cells[name + '\u0000' + r] || []).length);
      var lw = most * colW + (lanes.shown ? LANEPAD : 0);
      laneBox.push({ name: name, x: x, w: lw, most: most }); x += lw;
    });
    // rows: as tall as the tallest step in them
    var rowH = [], rowY = [], y = lanes.shown ? HEAD + 16 : 0;
    for (var r = 0; r <= maxRank; r++) rowH[r] = 0;
    g.steps.forEach(function (s) { rowH[rank[s.id]] = Math.max(rowH[rank[s.id]], nodes[s.id].h); });
    for (r = 0; r <= maxRank; r++) { rowY[r] = y; y += rowH[r] + ROWGAP; }
    laneBox.forEach(function (L) {
      for (var r2 = 0; r2 <= maxRank; r2++) {
        var c = cells[L.name + '\u0000' + r2] || [], off = (L.most - c.length) * colW / 2;
        c.forEach(function (id, i) {
          var n = nodes[id];
          n.x = Math.round(L.x + (lanes.shown ? LANEPAD / 2 : 0) + off + i * colW + (colW - n.w) / 2);
          n.y = Math.round(rowY[r2] + (rowH[r2] - n.h) / 2);
        });
      }
    });
    // a step put somewhere by hand stays there
    g.steps.forEach(function (s) {
      var p = s.place;
      if (p && typeof p.x === 'number' && typeof p.y === 'number') { nodes[s.id].x = Math.round(p.x); nodes[s.id].y = Math.round(p.y); nodes[s.id].placed = true; }
    });
    // the drawing's box
    var minX = 0, minY = 0, maxX = x, maxY = Math.max(y - ROWGAP, lanes.shown ? HEAD + 40 : 40);
    Object.keys(nodes).forEach(function (id) { var n = nodes[id]; minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + n.h); });
    var edges = route(g, nodes, w.back);
    edges.forEach(function (e) { maxX = Math.max(maxX, e.maxX); maxY = Math.max(maxY, e.maxY); minY = Math.min(minY, e.minY); });
    return {
      nodes: nodes, edges: edges, colW: colW,
      lanes: lanes.shown ? laneBox.map(function (L) { return { name: L.name, x: L.x, w: L.w }; }) : [],
      box: { x: minX - MARGIN, y: minY - MARGIN, w: maxX - minX + MARGIN * 2, h: maxY - minY + MARGIN * 2 },
      back: w.back
    };
  }

  // ---------- arrows ----------
  function cx(n) { return n.x + n.w / 2; }
  function cy(n) { return n.y + n.h / 2; }
  // does an axis-aligned segment pass through a step (other than the two it joins)?
  function hits(all, skip, x1, y1, x2, y2) {
    var n = 0, lo = Math.min(x1, x2), hi = Math.max(x1, x2), top = Math.min(y1, y2), bot = Math.max(y1, y2);
    all.forEach(function (r) {
      if (skip.indexOf(r) >= 0) return;
      if (hi > r.x - 6 && lo < r.x + r.w + 6 && bot > r.y - 6 && top < r.y + r.h + 6) n++;
    });
    return n;
  }
  function cost(all, skip, pts) { var c = 0; for (var i = 1; i < pts.length; i++) c += hits(all, skip, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]); return c; }
  function route(g, nodes, back) {
    var edges = [], loops = 0, all = Object.keys(nodes).map(function (id) { return nodes[id]; });
    g.steps.forEach(function (s) {
      var a = nodes[s.id], exits = g.out[s.id];
      // a decision: the exit most nearly straight below leaves at the bottom, the others from the sides
      var bottom = null, best = Infinity;
      exits.forEach(function (f) {
        var b = nodes[f.to], dx = Math.abs(cx(b) - cx(a));
        if (!back[fkey(f)] && b.y >= a.y + a.h - 2 && dx < best) { best = dx; bottom = f; }
      });
      exits.forEach(function (f) {
        var b = nodes[f.to], pts, lx, ly, anchor = 'start', isBack = !!back[fkey(f)], skip = [a, b];
        var below = b.y >= a.y + a.h - 2, above = b.y + b.h <= a.y + 2;
        if (isBack || above) {
          // a loop: out on the right, up beside both (and clear of what lies between), back in on the right
          var gx = Math.max(a.x + a.w, b.x + b.w) + LOOPGAP + (loops++ % 6) * LOOPSTEP;
          var y0 = Math.min(cy(a), cy(b)), y1 = Math.max(cy(a), cy(b));
          all.forEach(function (r) { if (skip.indexOf(r) < 0 && r.y < y1 && r.y + r.h > y0 && r.x < gx && r.x + r.w > gx - LOOPGAP) gx = Math.max(gx, r.x + r.w + LOOPGAP); });
          pts = [[a.x + a.w, cy(a)], [gx, cy(a)], [gx, cy(b)], [b.x + b.w, cy(b)]];
          lx = a.x + a.w + 6; ly = cy(a) - 6;
        } else if (below) {
          var straight = Math.abs(cx(b) - cx(a)) <= 4, right = cx(b) >= cx(a), sx = right ? a.x + a.w : a.x, out = right ? sx + 18 : sx - 18;
          var my = a.y + a.h + Math.min(22, (b.y - a.y - a.h) / 2), ty = b.y - 22;
          var cand = [];
          var side = s.type === 'decision' && f !== bottom && !straight;
          if (straight) cand.push({ p: [[cx(a), a.y + a.h], [cx(a), b.y]], lab: 'down' });
          if (side) {
            cand.push({ p: [[sx, cy(a)], [cx(b), cy(a)], [cx(b), b.y]], lab: 'side' });
            cand.push({ p: [[sx, cy(a)], [out, cy(a)], [out, ty], [cx(b), ty], [cx(b), b.y]], lab: 'side' });
          }
          cand.push({ p: [[cx(a), a.y + a.h], [cx(a), my], [cx(b), my], [cx(b), b.y]], lab: 'down' });
          cand.push({ p: [[cx(a), a.y + a.h], [cx(a), ty], [cx(b), ty], [cx(b), b.y]], lab: 'down' });
          if (!side && !straight) cand.push({ p: [[sx, cy(a)], [out, cy(a)], [out, ty], [cx(b), ty], [cx(b), b.y]], lab: 'side' });
          var pick = cand[0], pc = Infinity;
          cand.forEach(function (c) { var k = cost(all, skip, c.p); if (k < pc) { pc = k; pick = c; } });
          pts = pick.p;
          if (pick.lab === 'side') { lx = sx + (right ? 6 : -6); ly = cy(a) - 6; anchor = right ? 'start' : 'end'; }
          else { lx = cx(a) + 6; ly = a.y + a.h + 14; }
        } else {
          // side by side: from the side that faces it
          var toRight = cx(b) >= cx(a), x1 = toRight ? a.x + a.w : a.x, x2 = toRight ? b.x : b.x + b.w, mx = (x1 + x2) / 2;
          pts = Math.abs(cy(a) - cy(b)) < 2 ? [[x1, cy(a)], [x2, cy(b)]] : [[x1, cy(a)], [mx, cy(a)], [mx, cy(b)], [x2, cy(b)]];
          lx = x1 + (toRight ? 6 : -6); ly = cy(a) - 6; anchor = toRight ? 'start' : 'end';
        }
        var d = 'M' + pts.map(function (p) { return Math.round(p[0]) + ' ' + Math.round(p[1]); }).join('L');
        var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
        edges.push({ id: f.id, from: f.from, to: f.to, label: f.label || '', d: d, pts: pts, lx: Math.round(lx), ly: Math.round(ly), anchor: anchor, back: isBack,
          clear: cost(all, skip, pts) === 0,
          maxX: Math.max.apply(null, xs) + (f.label ? f.label.length * 7 : 0), maxY: Math.max.apply(null, ys), minY: Math.min.apply(null, ys) - 14 });
      });
    });
    return edges;
  }

  // ---------- checks ----------
  function title(g, id) { return '"' + (g.by[id] ? g.by[id].title : '?') + '"'; }
  function names(g, ids) { var t = ids.slice(0, 4).map(function (id) { return title(g, id); }).join(', '); return ids.length > 4 ? t + ' and ' + (ids.length - 4) + ' more' : t; }
  function reach(g, from, dir) {
    var seen = {}, todo = from.slice();
    from.forEach(function (id) { seen[id] = true; });
    while (todo.length) {
      var id = todo.pop();
      (dir === 'down' ? g.out[id].map(function (f) { return f.to; }) : g.inc[id].map(function (f) { return f.from; })).forEach(function (n) { if (!seen[n]) { seen[n] = true; todo.push(n); } });
    }
    return seen;
  }
  function check(model) {
    var g = graph(model), out = [];
    function add(level, text, ids) { out.push({ level: level, text: text, ids: ids || [] }); }
    if (!g.steps.length) { add('info', 'No steps yet. Add a Start, the steps, and an End.'); return out; }
    var starts = g.steps.filter(function (s) { return s.type === 'start'; }).map(function (s) { return s.id; });
    var ends = g.steps.filter(function (s) { return s.type === 'end'; }).map(function (s) { return s.id; });
    if (!starts.length) add('error', 'There is no Start step. Make the first step a Start.');
    if (!ends.length) add('error', 'There is no End step. Make the last step an End.');
    if (starts.length > 1) add('info', starts.length + ' Start steps: ' + names(g, starts) + '. Fine if the process really starts in more than one way.', starts);
    if (starts.length) {
      var down = reach(g, starts, 'down'), lost = g.steps.filter(function (s) { return !down[s.id]; }).map(function (s) { return s.id; });
      if (lost.length) add('warning', 'Not reached from a Start: ' + names(g, lost) + '. Draw an arrow into ' + (lost.length > 1 ? 'them' : 'it') + ', or delete ' + (lost.length > 1 ? 'them' : 'it') + '.', lost);
    }
    if (ends.length) {
      var up = reach(g, ends, 'up'), dead = g.steps.filter(function (s) { return !up[s.id]; }).map(function (s) { return s.id; });
      if (dead.length) add('error', 'Dead end: no way from ' + names(g, dead) + ' to an End.', dead);
    }
    starts.forEach(function (id) { if (g.inc[id].length) add('warning', 'An arrow goes into the Start ' + title(g, id) + '. Loop back to the step after it instead.', [id]); });
    ends.forEach(function (id) { if (g.out[id].length) add('warning', 'The End ' + title(g, id) + ' has an arrow out of it. An End finishes the flow.', [id]); });
    g.steps.forEach(function (s) {
      var ex = g.out[s.id];
      if (s.type === 'decision') {
        if (ex.length < 2) add('error', 'The decision ' + title(g, s.id) + ' needs two or more exits (e.g. Yes and No).', [s.id]);
        var unl = ex.filter(function (f) { return !String(f.label || '').trim(); });
        if (ex.length >= 2 && unl.length) add('error', 'Label every exit of the decision ' + title(g, s.id) + ' with its answer (e.g. Yes / No).', [s.id]);
        var seen = {}, twice = false;
        ex.forEach(function (f) { var k = String(f.label || '').trim().toLowerCase(); if (k && seen[k]) twice = true; seen[k] = true; });
        if (twice) add('error', 'Two exits of the decision ' + title(g, s.id) + ' have the same answer.', [s.id]);
      } else if (s.type !== 'end' && ex.length > 1) {
        add('warning', title(g, s.id) + ' has ' + ex.length + ' exits. Only a Decision should branch: make it a Decision, or keep one exit.', [s.id]);
      }
    });
    var loops = Object.keys(walk(g).back).length;
    if (loops) add('info', (loops === 1 ? 'One loop' : loops + ' loops') + ' (an arrow back to an earlier step). Fine when each loop has a way out.');
    var order = { error: 0, warning: 1, info: 2 };
    return out.sort(function (a, b) { return order[a.level] - order[b.level]; });
  }

  // ---------- every way through ----------
  // From each Start (or the first step), every way to an End, a step with no exit, or back into a loop.
  function paths(model, limit) {
    var g = graph(model), out = [], cut = false, max = limit || 200;
    var starts = g.steps.filter(function (s) { return s.type === 'start'; }).map(function (s) { return s.id; });
    if (!starts.length && g.steps.length) starts = [g.steps.filter(function (s) { return !g.inc[s.id].length; }).concat(g.steps)[0].id];
    function go(id, steps, answers, on) {
      if (out.length >= max) { cut = true; return; }
      steps = steps.concat(id);
      var ex = g.out[id];
      if (!ex.length || (g.by[id].type === 'end')) { out.push({ steps: steps, answers: answers, end: g.by[id].type === 'end' ? 'end' : 'stop' }); return; }
      ex.forEach(function (f) {
        var a = answers.concat(f.label || '');
        if (on[f.to]) { if (out.length < max) out.push({ steps: steps, answers: a, end: 'loop', loopTo: f.to }); else cut = true; return; }
        var o2 = Object.create(on); o2[f.to] = true;
        go(f.to, steps, a, o2);
      });
    }
    starts.forEach(function (s) { var on = {}; on[s] = true; go(s, [], [], on); });
    return { paths: out, cut: cut };
  }

  // ---------- Mermaid (a subset) ----------
  var MSHAPE = { // Mermaid v11 shape names
    delay: 'delay', doc: 'document', document: 'document', docs: 'document', 'lean-r': 'data', 'lean-l': 'data', 'in-out': 'data',
    diam: 'decision', diamond: 'decision', decision: 'decision', question: 'decision', stadium: 'terminal', pill: 'terminal', terminal: 'terminal',
    rect: 'process', rounded: 'process', process: 'process', proc: 'process', event: 'process', subproc: 'subprocess', subprocess: 'subprocess',
    'fr-rect': 'subprocess', framed: 'subprocess', circle: 'connector', circ: 'connector', 'sm-circ': 'connector', 'small-circle': 'connector',
    manual: 'manual', 'manual-input': 'manual', 'trap-t': 'manual', 'trap-b': 'manual', 'sl-rect': 'manual', 'h-cyl': 'data', cyl: 'data',
    database: 'data', db: 'data', start: 'start', stop: 'end', 'f-circ': 'end'
  };
  var OPEN = [ // longest first
    ['(((', ')))', 'terminal'], ['([', '])', 'terminal'], ['[[', ']]', 'subprocess'], ['[(', ')]', 'data'], ['((', '))', 'circle'],
    ['{{', '}}', 'process'], ['[/', '/]', 'data'], ['[/', '\\]', 'manual'], ['[\\', '\\]', 'data'], ['[\\', '/]', 'manual'],
    ['{', '}', 'decision'], ['(', ')', 'process'], ['[', ']', 'process'], ['>', ']', 'document']
  ];
  function unq(t) {
    t = String(t || '').trim();
    if (/^".*"$/.test(t)) t = t.slice(1, -1);
    if (/^`.*`$/.test(t)) t = t.slice(1, -1);
    return t.replace(/<br\s*\/?>/gi, ' ').replace(/#quot;/g, '"').replace(/#amp;/g, '&').replace(/#lt;/g, '<').replace(/#gt;/g, '>')
      .replace(/#(\d+);/g, function (m, n) { return String.fromCharCode(+n); }).replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();
  }
  function parseNode(s, i) {
    var m = /^[A-Za-z0-9_][A-Za-z0-9_]*/.exec(s.slice(i));
    if (!m) return null;
    var id = m[0], j = i + id.length, node = { id: id, text: null, kind: null };
    var rest = s.slice(j);
    var at = /^@\{([^}]*)\}/.exec(rest);
    if (at) {
      var body = at[1], sh = /shape\s*:\s*([A-Za-z-]+)/.exec(body), lb = /label\s*:\s*("(?:[^"\\]|\\.)*"|[^,}]+)/.exec(body);
      node.kind = sh ? (MSHAPE[sh[1].toLowerCase()] || 'process') : null;
      if (lb) node.text = unq(lb[1]);
      return { node: node, end: j + at[0].length };
    }
    for (var k = 0; k < OPEN.length; k++) {
      var o = OPEN[k];
      if (rest.indexOf(o[0]) !== 0) continue;
      var from = o[0].length, close;
      if (rest.charAt(from) === '"') {               // quoted text may hold anything
        var q = rest.indexOf('"', from + 1);
        if (q < 0) continue;
        close = rest.indexOf(o[1], q + 1);
        if (close !== q + 1) continue;
      } else close = rest.indexOf(o[1], from);
      if (close < 0) continue;
      var inner = rest.slice(from, close);
      if (o[0] === '(' && /^\(|\)$/.test(inner)) continue;
      node.text = unq(inner); node.kind = o[2];
      return { node: node, end: j + close + o[1].length };
    }
    return { node: node, end: j };
  }
  // an arrow at s[i]: returns { label, both, end } or null
  function parseEdge(s, i) {
    var r = s.slice(i), m;
    m = /^\s*(<?)(-{2,}>|-{3,}|-\.+->|-\.+-|={2,}>|={3,}|-{2,}[ox]|={2,}[ox])\s*(?:\|([^|]*)\|)?/.exec(r);
    if (m) return { label: m[3] != null ? unq(m[3]) : '', both: !!m[1], end: i + m[0].length };
    m = /^\s*(<?)(--|-\.|==)\s+(.+?)\s+(-{2,}>|\.+->|={2,}>|-{3,}|\.+-|={3,})/.exec(r);
    if (m) return { label: unq(m[3]), both: !!m[1], end: i + m[0].length };
    return null;
  }
  function parseMermaid(text) {
    var nodes = {}, order = [], edges = [], lanes = [], laneStack = [], warn = [], started = false, n = 0;
    function want(nd, lane) {
      if (!nodes[nd.id]) { nodes[nd.id] = { id: nd.id, text: null, kind: null, lane: lane || '' }; order.push(nd.id); }
      var x = nodes[nd.id];
      if (nd.text != null && x.text == null) x.text = nd.text;
      if (nd.kind && !x.kind) x.kind = nd.kind;
      return x;
    }
    String(text || '').replace(/\r/g, '').split('\n').forEach(function (line, no) {
      var t = line.replace(/%%.*$/, '').trim().replace(/;$/, '').trim();
      if (!t) return;
      if (/^(flowchart|graph)\b/i.test(t)) { started = true; return; }
      if (!started) return;
      if (/^(classDef|class|style|linkStyle|click|direction|accTitle|accDescr|---|title)\b/.test(t)) return;
      var sg = /^subgraph\s+(.*)$/.exec(t);
      if (sg) {
        var raw = sg[1].trim(), named = /^[A-Za-z0-9_]+\s*\[(.*)\]$/.exec(raw), name = unq(named ? named[1] : raw);
        name = name.slice(0, 40);
        laneStack.push(name);
        if (name && lanes.indexOf(name) < 0) lanes.push(name);
        return;
      }
      if (/^end$/.test(t)) { laneStack.pop(); return; }
      var lane = laneStack.length ? laneStack[laneStack.length - 1] : '';
      var i = 0, prev = null, ok = true, seenN = [], seenE = [];
      function group() {
        var list = [];
        for (;;) {
          while (t.charAt(i) === ' ') i++;
          var p = parseNode(t, i); if (!p) return list;
          list.push(p.node); seenN.push(p.node); i = p.end;
          while (t.charAt(i) === ' ') i++;
          if (t.charAt(i) === '&') { i++; continue; }
          return list;
        }
      }
      prev = group();
      if (!prev.length) ok = false;
      while (ok && i < t.length) {
        var e = parseEdge(t, i);
        if (!e) { ok = false; break; }
        i = e.end;
        var next = group();
        if (!next.length) { ok = false; break; }
        prev.forEach(function (a) { next.forEach(function (b) {
          seenE.push({ from: a.id, to: b.id, label: e.label });
          if (e.both) seenE.push({ from: b.id, to: a.id, label: e.label });
        }); });
        prev = next;
      }
      // only a line understood from end to end counts (nothing is guessed)
      if (!ok || i < t.length) { warn.push('Line ' + (no + 1) + ' was not understood: ' + t.slice(0, 60)); return; }
      seenN.forEach(function (nd) { want(nd, lane); });
      seenE.forEach(function (x) { edges.push(x); });
      n++;
    });
    if (!started) return { items: [], lanes: [], warnings: ['Paste a Mermaid flowchart: it starts with "flowchart TD" or "graph TD".'] };
    var incoming = {}, outgoing = {};
    edges.forEach(function (e) { incoming[e.to] = true; outgoing[e.from] = true; });
    var items = order.map(function (id) {
      var x = nodes[id], kind = x.kind || 'process', title = (x.text || id).slice(0, 120), type = kind;
      if (kind === 'terminal' || kind === 'circle') {
        if (kind === 'circle' && title.length <= 3) type = 'connector';
        else if (/^(start|begin)/i.test(title)) type = 'start';
        else if (/^(end|stop|finish|done|exit|complete)/i.test(title) || /\b(end|stop)$/i.test(title)) type = 'end';
        else type = !incoming[id] ? 'start' : !outgoing[id] ? 'end' : 'process';
      }
      return { key: id, title: title, type: type, props: x.lane ? { lane: x.lane } : {}, next: [] };
    });
    var byKey = {}, pairs = {};
    items.forEach(function (it) { byKey[it.key] = it; });
    edges.forEach(function (e) {
      if (e.from === e.to) return;
      var k = e.from + '>' + e.to;
      if (pairs[k]) { warn.push('Two arrows from ' + byKey[e.from].title + ' to ' + byKey[e.to].title + ': the first one is kept.'); return; }
      pairs[k] = true;
      var it = byKey[e.from];
      if (it.next.length >= 20) { warn.push(it.title + ' has more than 20 exits: the rest are left out.'); return; }
      it.next.push({ to: e.to, label: e.label.slice(0, 40) });
    });
    return { items: items, lanes: lanes.slice(0, 12), warnings: warn };
  }
  function mq(t) { return '"' + String(t || '').replace(/&/g, '#amp;').replace(/"/g, '#quot;').replace(/</g, '#lt;').replace(/>/g, '#gt;') + '"'; }
  function writeMermaid(model) {
    var g = graph(model), ids = {}, out = ['flowchart TD'], lanes = lanesOf(model, g);
    g.steps.forEach(function (s, i) { ids[s.id] = 'n' + (i + 1); });
    function nodeText(s) {
      var t = mq(s.title), id = ids[s.id];
      switch (s.type) {
        case 'start': case 'end': return id + '([' + t + '])';
        case 'decision': return id + '{' + t + '}';
        case 'data': return id + '[/' + t + '/]';
        case 'manual': return id + '[/' + t + '\\]';
        case 'subprocess': return id + '[[' + t + ']]';
        case 'connector': return id + '((' + t + '))';
        case 'document': return id + '@{ shape: doc, label: ' + t + ' }';
        case 'delay': return id + '@{ shape: delay, label: ' + t + ' }';
        default: return id + '[' + t + ']';
      }
    }
    if (lanes.shown) {
      lanes.names.forEach(function (name, i) {
        var inLane = g.steps.filter(function (s) { return lanes.key(s) === name; });
        if (!inLane.length) return;
        if (!name) { inLane.forEach(function (s) { out.push('  ' + nodeText(s)); }); return; }
        out.push('  subgraph L' + (i + 1) + '[' + mq(name) + ']');
        inLane.forEach(function (s) { out.push('    ' + nodeText(s)); });
        out.push('  end');
      });
    } else g.steps.forEach(function (s) { out.push('  ' + nodeText(s)); });
    g.flows.forEach(function (f) { out.push('  ' + ids[f.from] + ' -->' + (f.label ? '|' + mq(f.label) + '|' : '') + ' ' + ids[f.to]); });
    return out.join('\n') + '\n';
  }

  var api = { SHAPES: SHAPES, shape: shape, wrap: wrap, sizeOf: sizeOf, layout: layout, check: check, paths: paths,
    mermaid: { parse: parseMermaid, write: writeMermaid } };
  if (root.MP) root.MP.fc = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
