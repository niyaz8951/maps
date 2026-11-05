/* Maps tile - the flowchart view (step 3). The steps are the branches under the centre, the arrows 'flow' lines.
   Drawn as SVG on the map's canvas (its zoom, pan, fit and full screen), from MP.fc.layout: lanes as columns, steps in
   ISO 5807 shapes, right-angled arrows with the answer on them.
   Edit: drag a step to place it (saved with the version read, like any change; dropped in another lane it moves to
   that lane); drag the round handle under the chosen step onto another step to draw an arrow, or onto empty space
   for a new step there. Auto layout forgets the places. Check, Walk through and Ways through read the chart.
   Phone: the chart is for reading (pan, zoom, tap); changes in the Outline or the step panel. */
(function () {
  'use strict';
  var MP = window.MP, el = MP.el, $ = MP.$, st = MP.st, N = MP.N;
  var NS = 'http://www.w3.org/2000/svg', GRID = 10;
  var last = null, firstDraw = true, drag = null, issues = { list: [], by: {} }, showChecks = false;
  st.walk = null;            // { at: id, path: [ids], flows: [line ids] }

  function svgEl(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) if (attrs[k] != null && attrs[k] !== false) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  MP.isFlow = function () { return !!MP.M && MP.M.map.kind === 'flowchart'; };
  MP.SHAPE_NAME = {}; MP.fc.SHAPES.forEach(function (s) { MP.SHAPE_NAME[s.id] = s.name; });

  // ---------- the model from the open map ----------
  function model(over) {
    var root = N(MP.M.root), steps = root.kids.map(function (id, i) {
      var n = N(id), p = n.place;
      if (over && over.id === id) p = over.place;
      var pr = n.props || {};
      return { id: id, title: n.title, type: n.type || 'process', lane: pr.lane || '', place: p, order: i,
        notes: n.notes || '', showNotes: !!pr.show_notes, group: pr.group || '' };
    });
    var flows = MP.M.lines.filter(function (l) { return l.kind === 'flow' && N(l.from) && N(l.to); })
      .map(function (l) { return { id: l.id, from: l.from, to: l.to, label: l.label || '', order: l.sort, reply: l.rel === 'reply' }; });
    return { steps: steps, flows: flows, lanes: (root.props && root.props.lanes) || [], style: MP.flowStyle() };
  }
  MP.flowModel = model;
  // the kind of chart: a flowchart (Start to End) or a process flow (escalation ladder ...), kept on the centre
  MP.flowStyle = function () { var r = MP.M && N(MP.M.root); return r && r.props && r.props.style === 'process' ? 'process' : 'flowchart'; };
  // arrows out of and into a step (a Note has none: arrows of a step made a Note are left out)
  function joined(l) { return N(l.from) && N(l.to) && N(l.from).type !== 'note' && N(l.to).type !== 'note'; }
  function exitsOf(id) { return MP.M.lines.filter(function (l) { return l.kind === 'flow' && l.from === id && joined(l); }); }
  function intoOf(id) { return MP.M.lines.filter(function (l) { return l.kind === 'flow' && l.to === id && joined(l); }); }
  MP.exitsOf = exitsOf; MP.intoOf = intoOf;

  // ---------- one shape ----------
  function shapePath(type, x, y, w, h) {
    var r = h / 2;
    switch (type) {
      case 'start': case 'end': return 'M' + (x + r) + ' ' + y + 'H' + (x + w - r) + 'A' + r + ' ' + r + ' 0 0 1 ' + (x + w - r) + ' ' + (y + h) + 'H' + (x + r) + 'A' + r + ' ' + r + ' 0 0 1 ' + (x + r) + ' ' + y + 'Z';
      case 'decision': return 'M' + (x + w / 2) + ' ' + y + 'L' + (x + w) + ' ' + (y + h / 2) + 'L' + (x + w / 2) + ' ' + (y + h) + 'L' + x + ' ' + (y + h / 2) + 'Z';
      case 'data': return 'M' + (x + 16) + ' ' + y + 'H' + (x + w) + 'L' + (x + w - 16) + ' ' + (y + h) + 'H' + x + 'Z';
      case 'manual': return 'M' + x + ' ' + y + 'H' + (x + w) + 'L' + (x + w - 16) + ' ' + (y + h) + 'H' + (x + 16) + 'Z';
      case 'document': return 'M' + x + ' ' + y + 'H' + (x + w) + 'V' + (y + h - 8) + 'C' + (x + w * 0.75) + ' ' + (y + h - 20) + ' ' + (x + w * 0.6) + ' ' + (y + h + 4) + ' ' + (x + w / 2) + ' ' + (y + h - 6) +
        'C' + (x + w * 0.4) + ' ' + (y + h - 16) + ' ' + (x + w * 0.2) + ' ' + (y + h + 6) + ' ' + x + ' ' + (y + h - 6) + 'Z';
      case 'delay': return 'M' + x + ' ' + y + 'H' + (x + w - r) + 'A' + r + ' ' + r + ' 0 0 1 ' + (x + w - r) + ' ' + (y + h) + 'H' + x + 'Z';
      case 'note': return 'M' + x + ' ' + y + 'H' + (x + w - 14) + 'L' + (x + w) + ' ' + (y + 14) + 'V' + (y + h) + 'H' + x + 'Z';
      case 'connector': return 'M' + (x + w / 2) + ' ' + y + 'A' + (w / 2) + ' ' + (h / 2) + ' 0 1 1 ' + (x + w / 2 - 0.01) + ' ' + y + 'Z';
      default: return 'M' + (x + 8) + ' ' + y + 'H' + (x + w - 8) + 'Q' + (x + w) + ' ' + y + ' ' + (x + w) + ' ' + (y + 8) + 'V' + (y + h - 8) + 'Q' + (x + w) + ' ' + (y + h) + ' ' + (x + w - 8) + ' ' + (y + h) +
        'H' + (x + 8) + 'Q' + x + ' ' + (y + h) + ' ' + x + ' ' + (y + h - 8) + 'V' + (y + 8) + 'Q' + x + ' ' + y + ' ' + (x + 8) + ' ' + y + 'Z';
    }
  }
  // INK: fixed colours for a file or a print (an SVG file carries no theme)
  var INK = { line: '#55606B', text: '#1B2430', text2: '#4A5562', fill: '#FFFFFF', soft: '#EEF2F6', lane: '#F6F8FA', laneLine: '#D5DCE3', accent: '#3B4754', note: '#FFF8E6' };
  var FONT = 'Segoe UI, Arial, sans-serif';

  // draw(svg, layout, opts): lanes, arrows, steps. opts.ink: fixed colours; opts.live: marks and handles for the page.
  function draw(svg, L, opts) {
    var ink = opts.ink, defs = svgEl('defs', {}, svg), pre = opts.ink ? 'fcx' : 'fc';
    var mk = svgEl('marker', { id: pre + '-arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse', class: 'fc-mk' }, defs);
    svgEl('path', { d: 'M0 0L10 5L0 10Z', fill: ink ? INK.line : null }, mk);
    var mk2 = svgEl('marker', { id: pre + '-arrow-on', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse', class: 'fc-mk on' }, defs);
    svgEl('path', { d: 'M0 0L10 5L0 10Z' }, mk2);
    var HUES = ['rose', 'teal', 'violet', 'orange', 'green', 'blue', 'slate'];
    // lanes
    var lg = svgEl('g', { class: 'fc-lanes' }, svg);
    L.lanes.forEach(function (ln, i) {
      var g = svgEl('g', { class: 'fc-lane', 'data-accent': ink ? null : HUES[i % HUES.length] }, lg);
      svgEl('rect', { x: ln.x, y: L.box.y, width: ln.w, height: L.box.h, class: 'fc-lane-bg' + (i % 2 ? ' odd' : ''),
        fill: ink ? (i % 2 ? INK.fill : INK.lane) : null, stroke: ink ? INK.laneLine : null }, g);
      svgEl('rect', { x: ln.x + 6, y: L.box.y + 8, width: ln.w - 12, height: 30, rx: 8, class: 'fc-lane-head', fill: ink ? INK.soft : null }, g);
      var t = svgEl('text', { x: ln.x + ln.w / 2, y: L.box.y + 28, class: 'fc-lane-t', 'text-anchor': 'middle', fill: ink ? INK.text : null }, g);
      t.textContent = ln.name || 'No lane';
    });
    // groups: a bracket beside the steps that share one, with its name
    var gg = svgEl('g', { class: 'fc-groups' }, svg);
    (L.groups || []).forEach(function (gr) {
      svgEl('path', { d: 'M' + (gr.x + 10) + ' ' + gr.y1 + 'H' + gr.x + 'V' + gr.y2 + 'H' + (gr.x + 10), class: 'fc-group', fill: 'none', stroke: ink ? INK.text2 : null, 'stroke-width': ink ? '1.6' : null }, gg);
      var t = svgEl('text', { x: gr.x - 8, y: (gr.y1 + gr.y2) / 2 + 4, 'text-anchor': 'end', class: 'fc-group-t', fill: ink ? INK.text2 : null,
        'font-size': ink ? '12' : null, 'font-weight': ink ? '750' : null, 'font-family': ink ? FONT : null }, gg);
      t.textContent = gr.name;
    });
    // arrows
    var walk = opts.live && st.walk ? st.walk : null, onPath = {}, onEdge = {};
    if (walk) { walk.path.forEach(function (id) { onPath[id] = 1; }); walk.flows.forEach(function (id) { onEdge[id] = 1; }); }
    var eg = svgEl('g', { class: 'fc-edges' }, svg), labels = svgEl('g', { class: 'fc-labels' }, svg);
    L.edges.forEach(function (e) {
      var on = !!onEdge[e.id];
      svgEl('path', { d: e.d, class: 'fc-edge' + (e.reply ? ' reply' : '') + (on ? ' on' : ''), 'marker-end': 'url(#' + pre + (on ? '-arrow-on' : '-arrow') + ')',
        fill: 'none', stroke: ink ? INK.line : null, 'stroke-width': ink ? '1.6' : null, 'stroke-dasharray': ink && e.reply ? '6 4' : null }, eg);
      if (e.label) {
        var t = svgEl('text', { x: e.lx, y: e.ly, 'text-anchor': e.anchor, class: 'fc-lab' + (on ? ' on' : ''), 'data-flow': opts.live ? e.id : null,
          fill: ink ? INK.text : null, stroke: ink ? INK.fill : null, 'stroke-width': ink ? '4' : null, 'paint-order': ink ? 'stroke' : null,
          'font-size': ink ? '12' : null, 'font-weight': ink ? '700' : null, 'font-family': ink ? 'Segoe UI, Arial, sans-serif' : null }, labels);
        t.textContent = e.label;
      }
    });
    // steps
    var sg = svgEl('g', { class: 'fc-steps' }, svg);
    Object.keys(L.nodes).forEach(function (id) {
      var b = L.nodes[id], n = N(id) || {}, lvl = opts.live ? issues.by[id] : null;
      var cls = 'fc-step fc-' + b.type;
      if (opts.live) {
        if (n.status === 'to_verify') cls += ' fc-unv';
        if (n.status === 'changed') cls += ' fc-chg';
        if (id === st.sel) cls += ' fc-sel';
        if (lvl) cls += ' fc-' + lvl;
        if (walk) cls += onPath[id] ? (walk.at === id ? ' fc-here' : ' fc-on') : ' fc-off';
        if (st.q) cls += MP.matches(n) ? ' fc-hit' : ' fc-dim';
        if (MP.editing() && !MP.coarse()) cls += ' fc-drag';
        if (drag && drag.kind === 'move' && drag.id === id && drag.moved) cls += ' fc-moving';
      }
      var g = svgEl('g', { class: cls, 'data-node': opts.live ? id : null, tabindex: opts.live ? '0' : null, role: opts.live ? 'button' : null,
        'aria-label': opts.live ? (MP.SHAPE_NAME[b.type] || 'Step') + ': ' + n.title + (n.status === 'verified' ? '' : ', ' + MP.statusWord(n).toLowerCase()) : null }, sg);
      if (opts.live) { var tt = svgEl('title', {}, g); tt.textContent = (MP.SHAPE_NAME[b.type] || 'Step') + (n.props && n.props.lane ? ' · ' + n.props.lane : '') + (n.notes ? '\n' + n.notes.slice(0, 300) : ''); }
      svgEl('path', { d: shapePath(b.type, b.x, b.y, b.w, b.h), class: 'fc-shape',
        fill: ink ? (b.type === 'start' || b.type === 'end' ? INK.soft : b.type === 'note' ? INK.note : INK.fill) : null, stroke: ink ? INK.accent : null, 'stroke-width': ink ? '1.6' : null }, g);
      if (b.type === 'note') svgEl('path', { d: 'M' + (b.x + b.w - 14) + ' ' + b.y + 'V' + (b.y + 14) + 'H' + (b.x + b.w), class: 'fc-shape fc-inner', fill: 'none', stroke: ink ? INK.accent : null, 'stroke-width': ink ? '1.2' : null }, g);
      if (b.type === 'subprocess') {
        svgEl('path', { d: 'M' + (b.x + 10) + ' ' + b.y + 'V' + (b.y + b.h) + 'M' + (b.x + b.w - 10) + ' ' + b.y + 'V' + (b.y + b.h), class: 'fc-shape fc-inner', fill: 'none', stroke: ink ? INK.accent : null, 'stroke-width': ink ? '1.4' : null }, g);
      }
      var lines = b.lines, lh = 16;
      if (b.card) {
        // a card: the name on top (left), a rule, the notes in one or two columns
        var pad = b.type === 'data' || b.type === 'manual' ? 24 : 16, tx = b.x + pad, ty0 = b.y + 22;
        var head = svgEl('text', { x: tx, y: ty0, class: 'fc-t fc-card-t', fill: ink ? INK.text : null, 'font-size': ink ? '13' : null, 'font-weight': ink ? '700' : null, 'font-family': ink ? FONT : null }, g);
        lines.forEach(function (ln, i) { var ts = svgEl('tspan', { x: tx, dy: i ? lh : 0 }, head); ts.textContent = ln; });
        var cols = (b.notes || []).filter(function (c) { return c.length; });
        if (cols.length) {
          var ry = ty0 + (lines.length - 1) * lh + 10;
          svgEl('path', { d: 'M' + tx + ' ' + ry + 'H' + (b.x + b.w - pad), class: 'fc-card-rule', stroke: ink ? INK.laneLine : null, 'stroke-width': ink ? '1' : null }, g);
          var colW = (b.w - pad * 2) / cols.length;
          cols.forEach(function (col, c) {
            var nt = svgEl('text', { x: tx + c * colW, y: ry + 17, class: 'fc-card-n', fill: ink ? INK.text2 : null, 'font-size': ink ? '11.5' : null, 'font-family': ink ? FONT : null }, g);
            col.forEach(function (ln, i) { var ts = svgEl('tspan', { x: tx + c * colW, dy: i ? 15 : 0 }, nt); ts.textContent = ln; });
          });
        }
      } else {
        var ty = b.y + b.h / 2 - (lines.length - 1) * lh / 2 + 4 - (b.type === 'document' ? 4 : 0);
        var text = svgEl('text', { x: b.x + b.w / 2, y: ty, 'text-anchor': 'middle', class: 'fc-t', fill: ink ? INK.text : null,
          'font-size': ink ? '13' : null, 'font-weight': ink ? '600' : null, 'font-family': ink ? FONT : null }, g);
        lines.forEach(function (ln, i) { var ts = svgEl('tspan', { x: b.x + b.w / 2, dy: i ? lh : 0 }, text); ts.textContent = ln; });
      }
      if (opts.live) {
        // small marks: notes, links, to verify, a problem
        var mx = b.x + b.w - 4, marks = [];
        if (n.notes && !b.card) marks.push(['fc-mnote', '≡', 'Has notes']);
        if (n.special && n.special.length) marks.push(['fc-msp', '!', n.special.join('\n')]);
        marks.forEach(function (m, i) {
          var c = svgEl('g', { class: 'fc-mark ' + m[0] }, g);
          svgEl('circle', { cx: mx - i * 17, cy: b.y + 2, r: 7.5 }, c);
          var t2 = svgEl('text', { x: mx - i * 17, y: b.y + 6, 'text-anchor': 'middle' }, c); t2.textContent = m[1];
          var t3 = svgEl('title', {}, c); t3.textContent = m[2];
        });
        if (id === st.sel && MP.editing() && !MP.coarse() && !walk && b.type !== 'end' && b.type !== 'note') {
          var h = svgEl('g', { class: 'fc-handle', 'data-handle': id }, g);
          svgEl('circle', { cx: b.x + b.w / 2, cy: b.y + b.h + 14, r: 9 }, h);
          svgEl('path', { d: 'M' + (b.x + b.w / 2 - 4) + ' ' + (b.y + b.h + 14) + 'h8M' + (b.x + b.w / 2) + ' ' + (b.y + b.h + 10) + 'v8' }, h);
          var t4 = svgEl('title', {}, h); t4.textContent = 'Drag onto a step to draw an arrow, or onto empty space for a new step';
        }
      }
    });
    // the legend, when there are replies
    if (L.legend) {
      var lgd = svgEl('g', { class: 'fc-legend' }, svg), lx = L.legend.x, ly = L.legend.y;
      [['Escalate / next', false], ['Answer / reply', true]].forEach(function (it, i) {
        var x0 = lx + i * 190;
        svgEl('path', { d: 'M' + x0 + ' ' + ly + 'H' + (x0 + 40), class: 'fc-lg-line' + (it[1] ? ' reply' : ''), 'marker-end': 'url(#' + pre + '-arrow)', fill: 'none',
          stroke: ink ? INK.line : null, 'stroke-width': ink ? '1.6' : null, 'stroke-dasharray': ink && it[1] ? '6 4' : null }, lgd);
        var t = svgEl('text', { x: x0 + 50, y: ly + 4, class: 'fc-legend-t', fill: ink ? INK.text2 : null, 'font-size': ink ? '12' : null, 'font-family': ink ? FONT : null }, lgd);
        t.textContent = it[0];
      });
    }
    return svg;
  }

  // ---------- the page ----------
  function render() {
    var stage = $('mp-stage'), canvas = $('mp-canvas');
    var over = drag && drag.kind === 'move' && drag.moved ? { id: drag.id, place: drag.place } : null;
    var M = model(over);
    if (!drag) runChecks(M);
    var L = MP.fc.layout(M); last = L;
    Core.clear(stage);
    var svg = svgEl('svg', { class: 'fc-svg', width: L.box.w, height: L.box.h, viewBox: [L.box.x, L.box.y, L.box.w, L.box.h].join(' '), 'aria-hidden': 'false', role: 'group', 'aria-label': 'Flowchart' });
    draw(svg, L, { live: true });
    if (drag && drag.kind === 'link' && drag.at) {
      var a = L.nodes[drag.from];
      svgEl('path', { class: 'fc-edge fc-ghost', d: 'M' + (a.x + a.w / 2) + ' ' + (a.y + a.h) + 'L' + drag.at.x + ' ' + drag.at.y, 'marker-end': 'url(#fc-arrow-on)' }, svg);
    }
    stage.appendChild(svg);
    if (!M.steps.length) stage.appendChild(el('div', { class: 'fc-empty' }, el('b', { text: 'No steps yet.' }),
      el('span', { text: MP.canEdit() ? ' Turn Edit on and press Add step, or Import a flowchart.' : ' The owner has not drawn it yet.' })));
    stage.style.width = L.box.w + 'px'; stage.style.height = L.box.h + 'px';
    stage.style.transform = 'scale(' + st.zoom + ')';
    var sizer = $('mp-sizer'); sizer.style.width = Math.ceil(L.box.w * st.zoom) + 'px'; sizer.style.height = Math.ceil(L.box.h * st.zoom) + 'px';
    if (firstDraw) {
      // the first look: the whole width when it does not fit (a phone, a wide chart), from the top
      firstDraw = false; canvas.scrollLeft = 0; canvas.scrollTop = 0;
      var fitW = (canvas.clientWidth - 10) / L.box.w;
      if (canvas.clientWidth && fitW < st.zoom) { MP.mapView.setZoom(Math.max(0.4, fitW)); canvas.scrollLeft = 0; canvas.scrollTop = 0; }
    }
    if (MP.view.wantScroll && st.sel && L.nodes[st.sel]) keepInView(L.nodes[st.sel]);
    MP.view.wantScroll = false;
    $('mp-zoom-pct').textContent = Math.round(st.zoom * 100) + '%';
    bar();
  }
  function keepInView(b) {
    var c = $('mp-canvas'), z = st.zoom, x0 = (b.x - last.box.x - 30) * z, x1 = (b.x - last.box.x + b.w + 30) * z, y0 = (b.y - last.box.y - 30) * z, y1 = (b.y - last.box.y + b.h + 50) * z;
    if (x1 > c.scrollLeft + c.clientWidth) c.scrollLeft = x1 - c.clientWidth;
    if (x0 < c.scrollLeft) c.scrollLeft = Math.max(0, x0);
    if (y1 > c.scrollTop + c.clientHeight) c.scrollTop = y1 - c.clientHeight;
    if (y0 < c.scrollTop) c.scrollTop = Math.max(0, y0);
  }

  // ---------- checks ----------
  function runChecks(M) {
    var list = MP.fc.check(M), by = {}, rank = { error: 3, warning: 2, info: 1 };
    list.forEach(function (x) { x.ids.forEach(function (id) { if (x.level !== 'info' && (!by[id] || rank[x.level] > rank[by[id]])) by[id] = x.level; }); });
    issues = { list: list, by: by };
  }

  // ---------- the bar above the chart: add, auto layout, lanes, check, walk through, ways through ----------
  function bar() {
    var host = $('fc-bar'); if (!host) return;
    host.hidden = !MP.isFlow(); if (host.hidden) return;
    Core.clear(host);
    var E = MP.editing(), errs = issues.list.filter(function (x) { return x.level === 'error'; }).length,
      warns = issues.list.filter(function (x) { return x.level === 'warning'; }).length;
    var left = el('div', { class: 'fc-tools' });
    if (E) {
      left.appendChild(el('button', { type: 'button', class: 'btn small primary', text: '+ Add step', title: 'A new step after the chosen one, with an arrow to it (Tab)',
        on: { click: function () { var n = st.sel && N(st.sel) && !MP.isRoot(st.sel) ? N(st.sel) : null; addStep(n, null); } } }));
      left.appendChild(el('button', { type: 'button', class: 'btn small ghost', text: 'Lanes', title: 'Swimlanes: the roles or departments, in order', on: { click: lanesSheet } }));
      var placed = N(MP.M.root).kids.filter(function (id) { return !!N(id).place; }).length;
      if (placed) left.appendChild(el('button', { type: 'button', class: 'btn small ghost', text: 'Auto layout', title: 'Forget where steps were put by hand (' + placed + ') and lay the chart out again', on: { click: autoLayout } }));
    }
    var chk = el('button', { type: 'button', class: 'btn small ' + (errs ? 'danger' : warns ? 'ghost fc-warnbtn' : 'ghost fc-okbtn'), 'aria-expanded': showChecks ? 'true' : 'false',
      text: errs || warns ? [errs ? MP.plural(errs, 'problem') : null, warns ? MP.plural(warns, 'warning') : null].filter(Boolean).join(' · ') : '✓ Check: all good',
      title: 'What the check found', on: { click: function () { showChecks = !showChecks; bar(); } } });
    left.appendChild(chk);
    left.appendChild(el('button', { type: 'button', class: 'btn small ghost', text: st.walk ? 'Stop walking' : 'Walk through', 'aria-pressed': st.walk ? 'true' : 'false',
      title: 'Follow the chart from the Start, choosing an answer at each decision', on: { click: function () { if (st.walk) stopWalk(); else startWalk(); } } }));
    left.appendChild(el('button', { type: 'button', class: 'btn small ghost', text: 'Ways through', title: 'Every way from a Start to an End', on: { click: waysSheet } }));
    host.appendChild(left);
    if (showChecks) {
      var box = el('div', { class: 'fc-checks', role: 'status' });
      if (!issues.list.length) box.appendChild(el('p', { class: 'fc-ok', text: 'Nothing to fix: one way in, every step reached, every way ends, every decision answered.' }));
      issues.list.forEach(function (x) {
        box.appendChild(el('div', { class: 'fc-issue ' + x.level },
          el('span', { class: 'badge ' + (x.level === 'error' ? 'danger' : x.level === 'warning' ? 'warning' : ''), text: x.level === 'error' ? 'Problem' : x.level === 'warning' ? 'Warning' : 'Note' }),
          el('span', { class: 'grow', text: x.text }),
          x.ids.length ? el('button', { type: 'button', class: 'btn ghost small', text: 'Show', on: { click: function () { MP.nav.reveal(x.ids[0]); } } }) : null));
      });
      host.appendChild(box);
    }
    if (st.walk) host.appendChild(walkPanel());
  }

  // ---------- walk through ----------
  function startWalk() {
    var M = model(), s = M.steps.filter(function (x) { return x.type === 'start'; })[0] || M.steps[0];
    if (!s) { Core.toast('No steps to walk through yet.'); return; }
    st.walk = { at: s.id, path: [s.id], flows: [] }; st.sel = s.id; MP.view.wantScroll = true; MP.page.renderView();
  }
  function stopWalk() { st.walk = null; MP.page.renderView(); }
  function walkTo(l) {
    var w = st.walk;
    w.flows.push(l.id);
    var i = w.path.indexOf(l.to);
    w.path.push(l.to); w.at = l.to; st.sel = l.to; MP.view.wantScroll = true;
    if (i >= 0) Core.toast('Back to "' + N(l.to).title + '": a loop.');
    MP.page.renderView();
  }
  function walkBack() {
    var w = st.walk; if (w.path.length < 2) return;
    w.path.pop(); w.flows.pop(); w.at = w.path[w.path.length - 1]; st.sel = w.at; MP.view.wantScroll = true; MP.page.renderView();
  }
  function walkPanel() {
    var w = st.walk, n = N(w.at), ex = exitsOf(w.at);
    var box = el('div', { class: 'fc-walk card', 'aria-live': 'polite' },
      el('div', { class: 'fc-walk-h' }, el('span', { class: 'faint', text: 'Step ' + w.path.length + ' · ' + (MP.SHAPE_NAME[n.type] || 'Step') + (n.props && n.props.lane ? ' · ' + n.props.lane : '') }),
        el('b', { text: n.title })),
      n.notes ? el('p', { class: 'fc-walk-n', text: n.notes.length > 400 ? n.notes.slice(0, 400) + '…' : n.notes }) : null);
    var row = el('div', { class: 'row' });
    if (n.type === 'end' || !ex.length) row.appendChild(el('span', { class: 'badge ' + (n.type === 'end' ? 'success' : 'warning'), text: n.type === 'end' ? 'The end of this way.' : 'No arrow out of this step: a dead end.' }));
    ex.forEach(function (l) { row.appendChild(el('button', { type: 'button', class: 'btn small ' + (l.rel === 'reply' ? 'ghost' : ex.length > 1 ? '' : 'primary'), on: { click: function () { walkTo(l); } } },
      l.rel === 'reply' ? (l.label || 'Reply') + ' ↩ ' : ex.length > 1 || l.label ? (l.label || 'Next') + ' → ' : 'Next → ', el('span', { class: 'fc-walk-to', text: N(l.to).title }))); });
    row.appendChild(el('span', { class: 'grow' }));
    if (w.path.length > 1) row.appendChild(el('button', { type: 'button', class: 'btn ghost small', text: '‹ Back', on: { click: walkBack } }));
    row.appendChild(el('button', { type: 'button', class: 'btn ghost small', text: 'Read the step', on: { click: function () { MP.editor.open(w.at); } } }));
    box.appendChild(row);
    return box;
  }

  // ---------- every way through ----------
  function waysSheet() {
    var r = MP.fc.paths(model(), 200), body = el('div', { class: 'stack' });
    if (!r.paths.length) body.appendChild(el('p', { class: 'muted', text: 'No ways yet: add a Start and arrows.' }));
    var ends = r.paths.filter(function (p) { return p.end === 'end'; }).length, loops = r.paths.filter(function (p) { return p.end === 'loop'; }).length, stops = r.paths.length - ends - loops;
    if (r.paths.length) body.appendChild(el('p', { class: 'muted', text: [MP.plural(ends, 'way', 'ways') + ' to an End', loops ? MP.plural(loops, 'way') + ' back into a loop' : null, stops ? MP.plural(stops, 'way') + ' into a dead end' : null].filter(Boolean).join(' · ') + (r.cut ? ' · the first 200 are shown' : '') + '.' }));
    r.paths.forEach(function (p, i) {
      var li = el('div', { class: 'fc-way ' + p.end }, el('b', { text: (i + 1) + '.' }));
      p.steps.forEach(function (id, k) {
        if (k) li.appendChild(el('span', { class: 'fc-way-a', text: p.answers[k - 1] ? ' —' + p.answers[k - 1] + '→ ' : ' → ' }));
        li.appendChild(el('span', { class: 'fc-way-s', text: N(id).title }));
      });
      if (p.end === 'loop') li.appendChild(el('span', { class: 'fc-way-a', text: (p.answers[p.answers.length - 1] ? ' —' + p.answers[p.answers.length - 1] + '→ ' : ' → ') + '↺ ' + N(p.loopTo).title }));
      if (p.end === 'stop') li.appendChild(el('span', { class: 'badge warning', text: 'dead end' }));
      body.appendChild(li);
    });
    Core.sheet({ title: 'Ways through ' + MP.M.map.name, body: body, actions: [{ label: 'Close', kind: 'primary', value: null }] });
  }

  // ---------- changes ----------
  // a new step: after "from" (with an arrow from it, the answer asked when it is a decision), at "place" when dropped there
  function addStep(from, place) {
    var root = N(MP.M.root);
    var ask = from && from.type === 'decision' ? answer(from, null) : Promise.resolve('');
    return ask.then(function (label) {
      if (label === null) return;
      return MP.act(function () { return MP.rpc('maps_branch_add', { p_parent: root.id, p_title: 'New step' }); }, function (c) {
        c.kids = []; c.open = false; c.special = c.special || []; c.props = c.props || {};
        MP.M.nodes[c.id] = c; root.kids.push(c.id);
        var lane = from && from.props && from.props.lane, jobs = [];
        if (lane || place) {
          var patch = {};
          if (lane) patch.props = { lane: lane };
          if (place) patch.place = place;
          jobs.push(MP.rpc('maps_branch_save', { p_branch: c.id, p_version: c.version, p_patch: patch }).then(function (r) { c.version = r.version; c.props = r.props; c.place = r.place; c.status = r.status; }));
        }
        return Promise.all(jobs).then(function () {
          if (!from || from.type === 'note') return null;
          return MP.rpc('maps_line_add', { p_from: from.id, p_kind: 'flow', p_rel: 'next', p_to: c.id, p_target: null, p_label: label || '' });
        }).then(function () { return MP.reload(function () { st.sel = c.id; MP.view.wantScroll = true; }); })
          .then(function () { MP.editor.open(c.id, 'name'); }, MP.toastErr);
      });
    });
  }
  // the answer on an arrow out of a decision: a sheet with the usual answers
  function answer(from, current) {
    var used = exitsOf(from.id).map(function (l) { return (l.label || '').toLowerCase(); });
    var inp = el('input', { id: 'fc-answer', maxlength: '40', autocomplete: 'off', placeholder: 'e.g. Yes', value: current || '' });
    var quick = el('div', { class: 'row' }, ['Yes', 'No', 'OK', 'Not OK', 'Other'].filter(function (x) { return used.indexOf(x.toLowerCase()) < 0 || (current || '').toLowerCase() === x.toLowerCase(); })
      .map(function (x) { return el('button', { type: 'button', class: 'btn small ghost', text: x, on: { click: function () { inp.value = x; inp.focus(); } } }); }));
    var err = el('p', { class: 'notice danger', hidden: true, role: 'alert' });
    return Core.sheet({ title: 'Answer on the arrow from ' + from.title, body: el('div', { class: 'stack' }, quick, MP.field('Answer', inp, 'Up to 40 characters. Every exit of a decision carries its answer.'), err),
      actions: [{ label: 'Cancel', value: null }, { label: 'Save', kind: 'primary', onClick: function () {
        var v = inp.value.replace(/\s+/g, ' ').trim();
        if (!v) { err.textContent = 'Write the answer, e.g. Yes or No.'; err.hidden = false; return false; }
        if (v.toLowerCase() !== (current || '').toLowerCase() && used.indexOf(v.toLowerCase()) >= 0) { err.textContent = 'Another exit has that answer already.'; err.hidden = false; return false; }
        return v;
      } }] }).then(function (v) { return v === undefined ? null : v; });
  }
  function addArrow(from, to, kind) {
    if (from.id === to.id) return Promise.resolve();
    if (from.type === 'note' || to.type === 'note') { Core.toast('A Note stands beside the chart: no arrows to or from it.', 'danger'); return Promise.resolve(); }
    // drawn back to a step that has an arrow to this one: a reply (dashed), unless chosen otherwise
    var reply = kind ? kind === 'reply' : exitsOf(to.id).some(function (l) { return l.to === from.id && l.rel !== 'reply'; });
    if (reply) {
      return MP.act(function () { return MP.rpc('maps_line_add', { p_from: from.id, p_kind: 'flow', p_rel: 'reply', p_to: to.id, p_target: null, p_label: '' }); },
        function () { if (!kind) Core.toast('Drawn as a reply (dashed) to the arrow from ' + to.title + '. Change it in the step panel.'); return MP.reload(); });
    }
    if (exitsOf(from.id).some(function (l) { return l.to === to.id; })) { Core.toast('There is an arrow from ' + from.title + ' to ' + to.title + ' already.', 'danger'); return Promise.resolve(); }
    var ask = from.type === 'decision' ? answer(from, null) : Promise.resolve('');
    return ask.then(function (label) {
      if (label === null) return;
      return MP.act(function () { return MP.rpc('maps_line_add', { p_from: from.id, p_kind: 'flow', p_rel: 'next', p_to: to.id, p_target: null, p_label: label }); },
        function () { return MP.reload(); });
    });
  }
  MP.flowArrow = addArrow; MP.flowAnswer = answer;
  function editArrow(l) {
    var from = N(l.from), to = N(l.to);
    if (!MP.editing()) { MP.nav.reveal(l.to); return; }
    var inp = el('input', { id: 'fc-edit-answer', maxlength: '40', autocomplete: 'off', value: l.label || '', placeholder: from.type === 'decision' ? 'e.g. Yes' : 'Usually empty' });
    var err = el('p', { class: 'notice danger', hidden: true, role: 'alert' });
    Core.sheet({ title: 'Arrow from ' + from.title + ' to ' + to.title, body: el('div', { class: 'stack' }, MP.field('Answer on the arrow', inp, 'Up to 40 characters.'), err),
      actions: [
        { label: 'Remove arrow', kind: 'danger', onClick: function () { return MP.act(function () { return MP.rpc('maps_line_delete', { p_line: l.id }); }, function () { MP.reload(); return true; }); } },
        { label: 'Cancel', value: null },
        { label: 'Save', kind: 'primary', onClick: function () {
          var v = inp.value.replace(/\s+/g, ' ').trim();
          if (v === (l.label || '')) return true;
          return MP.settled().then(function () { return MP.rpc('maps_line_save', { p_line: l.id, p_version: l.version, p_rel: null, p_label: v }); })
            .then(function () { MP.reload(); return true; }, function (e) { err.textContent = MP.msg(e); err.hidden = false; return false; });
        } }] });
  }
  function autoLayout() {
    var ids = N(MP.M.root).kids.filter(function (id) { return !!N(id).place; });
    Core.confirm('The ' + MP.plural(ids.length, 'step') + ' put somewhere by hand go back to where the layout puts them. History keeps every place.',
      { title: 'Auto layout?', ok: 'Lay it out again' }).then(function (yes) {
      if (!yes) return;
      ids.forEach(function (id) { N(id).place = null; MP.send(id, { place: null }); });
      MP.page.renderView();
    });
  }
  // lanes: names in order, kept on the centre
  function lanesSheet() {
    var root = N(MP.M.root), list = ((root.props && root.props.lanes) || []).slice();
    N(MP.M.root).kids.forEach(function (id) { var l = N(id).props && N(id).props.lane; if (l && !list.some(function (x) { return x.toLowerCase() === l.toLowerCase(); })) list.push(l); });
    var box = el('div', { class: 'fc-lanelist' }), err = el('p', { class: 'notice danger', hidden: true, role: 'alert' });
    function drawList() {
      Core.clear(box);
      if (!list.length) box.appendChild(el('p', { class: 'muted', text: 'No lanes: the chart is one column.' }));
      list.forEach(function (name, i) {
        var used = N(MP.M.root).kids.filter(function (id) { return (N(id).props.lane || '').toLowerCase() === name.toLowerCase(); }).length;
        box.appendChild(el('div', { class: 'fc-lanerow' }, el('span', { class: 'grow' }, el('b', { text: name }), el('span', { class: 'faint', text: ' · ' + MP.plural(used, 'step') })),
          el('button', { type: 'button', class: 'btn ghost small', text: '‹', title: 'Move left', 'aria-label': 'Move ' + name + ' left', disabled: i === 0, on: { click: function () { list.splice(i - 1, 0, list.splice(i, 1)[0]); drawList(); } } }),
          el('button', { type: 'button', class: 'btn ghost small', text: '›', title: 'Move right', 'aria-label': 'Move ' + name + ' right', disabled: i === list.length - 1, on: { click: function () { list.splice(i + 1, 0, list.splice(i, 1)[0]); drawList(); } } }),
          el('button', { type: 'button', class: 'btn ghost small', text: 'Remove', disabled: used > 0, title: used ? 'Move its steps to another lane first' : 'Remove the lane', on: { click: function () { list.splice(i, 1); drawList(); } } })));
      });
    }
    drawList();
    var add = el('div', { class: 'mp-add' }, el('input', { id: 'fc-lane-new', maxlength: '40', placeholder: 'e.g. Sales, Application, Factory', autocomplete: 'off' }),
      el('button', { type: 'button', class: 'btn', text: 'Add lane', on: { click: addLane } }));
    function addLane() {
      var inp = $('fc-lane-new'), v = inp.value.replace(/\s+/g, ' ').trim(); err.hidden = true;
      if (!v) { inp.focus(); return; }
      if (list.length >= 12) { err.textContent = 'A flowchart holds up to 12 lanes.'; err.hidden = false; return; }
      if (list.some(function (x) { return x.toLowerCase() === v.toLowerCase(); })) { err.textContent = 'That lane is there already.'; err.hidden = false; return; }
      list.push(v); inp.value = ''; drawList(); inp.focus();
    }
    add.querySelector('input').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addLane(); } });
    Core.sheet({ title: 'Lanes', body: el('div', { class: 'stack' }, el('p', { class: 'muted', text: 'Swimlanes: who does each step, left to right. Choose a step\'s lane in its panel, or drag it into the lane.' }), box, add, err),
      actions: [{ label: 'Cancel', value: null }, { label: 'Save', kind: 'primary', onClick: function () {
        var p = {}; for (var k in root.props) p[k] = root.props[k];
        if (list.length) p.lanes = list; else delete p.lanes;
        MP.setList(root, 'props', p); return true;
      } }] });
  }
  MP.lanesSheet = lanesSheet;
  // lanes keep their order on the map: before a step changes lane, the order shown is saved (when not saved yet)
  function keepLanes() {
    var root = N(MP.M.root), have = (root.props && root.props.lanes) || [], shown = (last ? last.lanes : []).map(function (l) { return l.name; }).filter(Boolean);
    var missing = shown.filter(function (x) { return !have.some(function (h) { return h.toLowerCase() === x.toLowerCase(); }); });
    if (!missing.length) return;
    var p = {}; for (var k in root.props) p[k] = root.props[k];
    p.lanes = have.concat(missing).slice(0, 12);
    MP.setList(root, 'props', p);
  }
  MP.keepLanes = keepLanes;

  // ---------- the pointer: choose, move, connect ----------
  function chartPoint(e) {
    var r = $('mp-stage').getBoundingClientRect();
    return { x: last.box.x + (e.clientX - r.left) / st.zoom, y: last.box.y + (e.clientY - r.top) / st.zoom };
  }
  function laneAt(x) { for (var i = 0; i < last.lanes.length; i++) { var l = last.lanes[i]; if (x >= l.x && x < l.x + l.w) return l.name; } return null; }
  function down(e) {
    if (!MP.isFlow() || !MP.editing() || MP.coarse() || e.pointerType === 'touch' || e.button !== 0 || st.walk) return;
    var h = e.target.closest && e.target.closest('[data-handle]'), g = e.target.closest && e.target.closest('.fc-step[data-node]');
    if (!h && !g) return;
    e.stopPropagation(); e.preventDefault();
    var id = h ? h.getAttribute('data-handle') : g.getAttribute('data-node'), b = last.nodes[id], p = chartPoint(e);
    drag = h ? { kind: 'link', from: id, at: null, moved: false } : { kind: 'move', id: id, dx: p.x - b.x, dy: p.y - b.y, sx: e.clientX, sy: e.clientY, moved: false, place: { x: b.x, y: b.y } };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel);
  }
  var frame = 0;
  // near the edge of the chart while dragging: it scrolls, so a step can go (or an arrow reach) anywhere
  function edgeScroll(e) {
    var c = $('mp-canvas'), r = c.getBoundingClientRect(), E = 36, k = 14;
    if (e.clientX < r.left + E) c.scrollLeft -= k; else if (e.clientX > r.right - E) c.scrollLeft += k;
    if (e.clientY < r.top + E) c.scrollTop -= k; else if (e.clientY > r.bottom - E) c.scrollTop += k;
  }
  function move(e) {
    if (!drag) return;
    if (drag.moved) edgeScroll(e);
    var p = chartPoint(e);
    if (drag.kind === 'move') {
      if (!drag.moved && Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) < 5) return;
      drag.moved = true;
      drag.place = { x: Math.round((p.x - drag.dx) / GRID) * GRID, y: Math.round((p.y - drag.dy) / GRID) * GRID };
    } else { drag.moved = true; drag.at = p; }
    if (!frame) frame = window.requestAnimationFrame(function () { frame = 0; if (drag) render(); });
  }
  function cancel() { stopDrag(); render(); }
  function stopDrag() { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); var d = drag; drag = null; return d; }
  function up(e) {
    var d = stopDrag(); if (!d) return;
    if (d.kind === 'move' && !d.moved) return;          // a plain click: the click handler chooses the step
    swallowClick();
    if (d.kind === 'move') {
      var n = N(d.id);
      var b = last.nodes[d.id], patch = { place: d.place }, before = { place: n.place, props: n.props };
      var lane = last.lanes.length ? laneAt(d.place.x + b.w / 2) : null;
      if (lane !== null && lane !== ((n.props && n.props.lane) || '')) {
        keepLanes();
        var p = {}; for (var k in n.props) p[k] = n.props[k];
        if (lane) p.lane = lane; else delete p.lane;
        patch.props = p; n.props = p;
        Core.toast('Moved to the lane ' + (lane || '"No lane"') + '.');
      }
      n.place = d.place; st.sel = n.id;
      MP.send(n.id, patch, function () { n.place = before.place; n.props = before.props; });
      render();
      return;
    }
    // drawing an arrow: onto a step, or onto empty space for a new step there
    var from = N(d.from), target = document.elementFromPoint(e.clientX, e.clientY), g = target && target.closest ? target.closest('.fc-step[data-node]') : null;
    render();
    if (!d.moved) return;
    if (g && g.getAttribute('data-node') !== d.from) { addArrow(from, N(g.getAttribute('data-node'))); return; }
    if (!g && d.at) addStep(from, { x: Math.round((d.at.x - 95) / GRID) * GRID, y: Math.round((d.at.y - 10) / GRID) * GRID });
  }
  // the click (and a double-click: a click just before the drag counts) that ends a drag is not a click on a step
  function swallowClick() {
    var c = $('mp-canvas');
    function sw(ev) { ev.stopPropagation(); ev.preventDefault(); }
    c.addEventListener('click', sw, true); c.addEventListener('dblclick', sw, true);
    // the browser sends that click right after the release, in the same turn: a click after that is a new click
    setTimeout(function () { c.removeEventListener('click', sw, true); c.removeEventListener('dblclick', sw, true); }, 0);
  }
  function select(n) {
    var was = st.sel; st.sel = n.id;
    if (was !== n.id) MP.flush();
    render(); var x = document.querySelector('[data-node="' + n.id + '"]'); if (x) x.focus({ preventScroll: true });
  }
  // a click on the chart or a row of the outline
  var lastTap = { id: null, t: 0 };
  function click(e) {
    var lab = e.target.closest && e.target.closest('[data-flow]');
    if (lab) { var l = MP.M.lines.filter(function (x) { return x.id === lab.getAttribute('data-flow'); })[0]; if (l) editArrow(l); return; }
    if (e.target.closest && e.target.closest('button, a, input, select, textarea')) return;
    var g = e.target.closest ? e.target.closest('[data-node]') : null;
    if (!g) { if (st.sel) { st.sel = null; MP.page.renderView(); } return; }
    var n = N(g.getAttribute('data-node')); if (!n) return;
    if ((MP.coarse() || e.pointerType === 'touch') && st.sel === n.id) { MP.editor.open(n.id); return; }
    // choosing a step redraws the chart, so the browser may not see a double-click: count it here
    var now = Date.now();
    if (lastTap.id === n.id && now - lastTap.t < 500) { lastTap = { id: null, t: 0 }; MP.editor.open(n.id); return; }
    lastTap = { id: n.id, t: now };
    if (st.view === 'outline') { st.sel = n.id; MP.page.renderView(); MP.nav.refocus(n.id); return; }
    select(n);
  }
  function key(e, n) {
    if (e.key === 'Tab' && MP.editing() && !e.shiftKey && !MP.phone()) { e.preventDefault(); addStep(MP.isRoot(n.id) ? null : n, null); return true; }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowRight') && !MP.isRoot(n.id)) {
      var ex = exitsOf(n.id); if (ex.length) { e.preventDefault(); MP.nav.pick(N(ex[0].to)); return true; }
    }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowLeft') && !MP.isRoot(n.id)) {
      var inn = intoOf(n.id); if (inn.length) { e.preventDefault(); MP.nav.pick(N(inn[0].from)); return true; }
    }
    return false;
  }

  // ---------- the outline of a flowchart (the default on a phone) ----------
  function outline() {
    var host = $('mp-outline'), root = N(MP.M.root);
    runChecks(model());
    Core.clear(host);
    if (!root.kids.length) { host.appendChild(el('p', { class: 'muted', text: 'No steps yet.' })); return; }
    var ol = el('ol', { class: 'fc-out', 'aria-label': 'Steps' });
    root.kids.forEach(function (id, i) {
      var n = N(id), ex = exitsOf(id), lvl = issues.by[id];
      var cls = 'fc-orow' + (n.status === 'verified' ? '' : ' mp-unv') + (st.sel === id ? ' mp-sel' : '') + (lvl ? ' fc-' + lvl : '') + (st.q ? (MP.matches(n) ? ' mp-hitn' : ' mp-dim') : '');
      ol.appendChild(el('li', { class: cls, 'data-node': id, tabindex: '0', role: 'button', 'aria-label': (MP.SHAPE_NAME[n.type] || 'Step') + ': ' + n.title },
        el('div', { class: 'fc-orow-h' }, el('span', { class: 'fc-chip fc-c-' + (n.type || 'process'), text: MP.SHAPE_NAME[n.type] || 'Process' }),
          el('b', { class: 'grow', text: n.title }), n.notes ? MP.ico('note') : null,
          n.status !== 'verified' ? el('span', { class: 'mp-tv', text: n.status === 'changed' ? 'changed' : 'to verify' }) : null),
        n.props && n.props.lane ? el('div', { class: 'faint', text: n.props.lane }) : null,
        ex.length ? el('ul', { class: 'fc-exits' }, ex.map(function (l) {
          return el('li', {}, el('span', { class: 'fc-arr', text: (l.rel === 'reply' ? '↩ ' : '→ ') + (l.label ? l.label + ': ' : '') }),
            el('button', { type: 'button', class: 'fc-go', text: N(l.to).title, on: { click: function (ev) { ev.stopPropagation(); MP.nav.pick(N(l.to)); } } }));
        })) : n.type !== 'end' ? el('div', { class: 'faint', text: 'No arrow out yet.' }) : null));
    });
    host.appendChild(ol);
    if (MP.view.wantScroll && st.sel) { var x = host.querySelector('[data-node="' + st.sel + '"]'); if (x && x.scrollIntoView) x.scrollIntoView({ block: 'nearest' }); }
    MP.view.wantScroll = false;
    bar();
  }

  // ---------- out: SVG file, print, Excel, Mermaid ----------
  function fileSvg() {
    var L = MP.fc.layout(model()), svg = svgEl('svg', { xmlns: NS, width: L.box.w, height: L.box.h, viewBox: [L.box.x, L.box.y, L.box.w, L.box.h].join(' ') });
    svgEl('rect', { x: L.box.x, y: L.box.y, width: L.box.w, height: L.box.h, fill: INK.fill }, svg);
    draw(svg, L, { ink: true });
    var t = svgEl('title', {}, svg); t.textContent = MP.M.map.name;
    svg.insertBefore(t, svg.firstChild);
    return svg;
  }
  function downloadSvg() {
    var text = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(fileSvg());
    Core.download(MP.fileName(MP.M.map.name) + ' - flowchart.svg', new Blob([text], { type: 'image/svg+xml' }));
  }
  function print(size) {
    var host = $('mp-print') || document.body.appendChild(el('div', { id: 'mp-print', 'aria-hidden': 'true' }));
    Core.clear(host); host.className = 'mp-print ' + size;
    host.appendChild(el('h1', { text: MP.M.map.name }));
    host.appendChild(el('p', { class: 'mp-print-sub', text: 'Flowchart · printed ' + Core.date(new Date().toISOString()) + ' · ' + MP.plural(N(MP.M.root).kids.length, 'step') }));
    var svg = fileSvg(); svg.removeAttribute('width'); svg.removeAttribute('height'); svg.setAttribute('class', 'mp-print-svg');
    host.appendChild(svg);
    document.documentElement.classList.add('mp-printing');
    setTimeout(function () { window.print(); }, 50);
  }
  window.addEventListener('afterprint', function () { document.documentElement.classList.remove('mp-printing'); var h = $('mp-print'); if (h) Core.clear(h); });
  function excel() {
    var root = N(MP.M.root), rows = [['No.', 'Step', 'Shape', 'Lane', 'Group', 'Next (answer: step)', 'Notes', 'Status']], num = {};
    root.kids.forEach(function (id, i) { num[id] = i + 1; });
    root.kids.forEach(function (id, i) {
      var n = N(id);
      rows.push([i + 1, n.title, MP.SHAPE_NAME[n.type] || 'Process', (n.props && n.props.lane) || '', (n.props && n.props.group) || '',
        exitsOf(id).map(function (l) { return (l.rel === 'reply' ? '(reply) ' : '') + (l.label ? l.label + ': ' : '') + num[l.to] + '. ' + N(l.to).title; }).join('\n'), n.notes || '', MP.statusWord(n)]);
    });
    Core.download(MP.fileName(MP.M.map.name) + ' - steps.xlsx', window.HubXlsx.build(rows, 'Steps', [6, 36, 14, 16, 16, 40, 50, 14]));
  }
  function mermaid() { return MP.fc.mermaid.write(model()); }

  function wire() {
    var c = $('mp-canvas');
    c.addEventListener('pointerdown', down, true);
  }

  MP.chart = { render: render, outline: outline, click: click, key: key, wire: wire, addStep: addStep, editArrow: editArrow,
    downloadSvg: downloadSvg, print: print, excel: excel, mermaid: mermaid, model: model, stopWalk: stopWalk,
    redraw: function () { firstDraw = true; } };
})();
