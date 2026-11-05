/* Maps tile - import and export: a plain outline.
   One branch per line, two spaces deeper for a branch under it. "> text" is a line of the notes of the branch above,
   "! text" a special note. It reads the old tool's Export exactly (Thinkneering Maps, before 5 Nov 2026), including its
   special-note lines that are now typed values: "Layout: columns" becomes the Layout of the branch, "Place: 120, 80"
   its place on the 2D drawing. Lines whose values belong to types that are not built yet (Flow, Source, Icon ... for
   piping and wiring maps) stay special notes, word for word.
   A flowchart (kind 'flowchart') also reads "Shape: Decision", "Lane: Sales" and "Next: Yes -> Step name" under each
   step; the steps are flat (all under the centre) and the arrows are matched to the steps by name.
   Pure functions: the same file runs in the browser (window.MP.io) and in node (dev/outline-check.mjs). */
(function (root) {
  'use strict';
  var LIMITS = { title: 120, notes: 8000, special: 200, specials: 20 };

  // Special-note lines that are typed values. Later steps add their keys here (per map kind) with the types they need.
  var KEYS = {
    layout: { read: function (v) { v = v.toLowerCase(); return /^columns?$/.test(v) ? 'columns' : v === 'tree' ? 'tree' : null; },
              put: function (item, v) { item.props.layout = v; } },
    place: { read: function (v) {
               var m = /^\s*(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)(?:\s*[,; ]\s*(\d+(?:\.\d+)?)\s*[,; ]\s*(\d+(?:\.\d+)?))?\s*$/.exec(v);
               if (!m) return null;
               var p = { x: +m[1], y: +m[2] };
               if (m[3] != null && +m[3] >= 1 && +m[4] >= 1) { p.w = +m[3]; p.h = +m[4]; }
               return Math.abs(p.x) <= 1e6 && Math.abs(p.y) <= 1e6 ? p : null;
             },
             put: function (item, v) { item.place = v; } }
  };

  // Flowchart lines (only in a flowchart: elsewhere they stay special notes).
  var SHAPE_NAMES = { start: 'start', begin: 'start', end: 'end', stop: 'end', terminal: 'end', process: 'process', step: 'process',
    decision: 'decision', question: 'decision', data: 'data', 'input / output': 'data', 'input/output': 'data', input: 'data', output: 'data',
    document: 'document', manual: 'manual', 'manual step': 'manual', wait: 'delay', delay: 'delay', 'sub-process': 'subprocess',
    subprocess: 'subprocess', connector: 'connector' };
  var FLOW = {
    shape: { read: function (v) { return SHAPE_NAMES[v.toLowerCase()] || null; }, put: function (item, v) { item.type = v; } },
    lane: { read: function (v) { return v.length <= 40 ? v : null; }, put: function (item, v) { item.props.lane = v; } },
    next: { read: function (v) {
              var m = /^(?:(.*?)\s*->\s*)?(.+)$/.exec(v);
              return m ? { label: (m[1] || '').slice(0, 40), to: m[2].trim() } : null;
            },
            put: function (item, v) { (item._next = item._next || []).push(v); } },
    lanes: { read: function (v) { var l = v.split(',').map(function (x) { return x.trim().slice(0, 40); }).filter(Boolean); return l.length ? l.slice(0, 12) : null; },
             put: function (item, v) { item._lanes = v; } }
  };

  // text -> { items: [{ depth, title, notes, special: [], props: {}, place }], cut, typed }
  // kind 'flowchart': items also get key, type and next [{ to: key, label }]; unknown names in Next lines are reported.
  function parse(text, kind) {
    var flow = kind === 'flowchart';
    var items = [], last = null, stack = [], cut = 0, typed = 0;
    String(text || '').replace(/^﻿/, '').replace(/\r/g, '').split('\n').forEach(function (line) {
      var raw = line.replace(/\t/g, '    '), t = raw.trim();
      if (!t) return;
      if (/^>/.test(t)) { if (last) last.notes.push(t.replace(/^>\s?/, '')); return; }
      if (/^!/.test(t)) {
        t = t.replace(/^!\s?/, '').replace(/\s+/g, ' ').trim();
        if (!last || !t) return;
        var m = /^([A-Za-z][A-Za-z ]{0,24}?)\s*:\s*(.+)$/.exec(t), key = m && (KEYS[m[1].toLowerCase()] || (flow && FLOW[m[1].toLowerCase()]));
        var v = key ? key.read(m[2].trim()) : null;
        if (v != null) { key.put(last, v); typed++; return; }
        if (t.length > LIMITS.special) { t = t.slice(0, LIMITS.special); cut++; }
        last.special.push(t);
        return;
      }
      var w = raw.match(/^ */)[0].length;
      t = t.replace(/^\\/, '').replace(/^([-*•]|\d+[.)])\s+/, '').replace(/\s+/g, ' ').trim();
      if (!t) return;
      while (stack.length > 1 && w < stack[stack.length - 1]) stack.pop();
      if (!stack.length || (stack.length === 1 && w < stack[0])) stack = [w];
      else if (w > stack[stack.length - 1]) stack.push(w);
      if (t.length > LIMITS.title) { t = t.slice(0, LIMITS.title); cut++; }
      last = { depth: stack.length - 1, title: t, notes: [], special: [], props: {}, place: null };
      items.push(last);
    });
    items.forEach(function (it) {
      while (it.notes.length && !it.notes[it.notes.length - 1].trim()) it.notes.pop();
      it.notes = it.notes.join('\n');
      if (it.notes.length > LIMITS.notes) { it.notes = it.notes.slice(0, LIMITS.notes); cut++; }
      if (it.special.length > LIMITS.specials) { it.special = it.special.slice(0, LIMITS.specials); cut++; }
      if (!it.place) delete it.place;
    });
    var flat = 0, unknown = [], centre = null;
    if (flow) {
      // a whole flowchart as Export writes it: its centre first, the steps one level under it
      if (items.length > 1 && items[0].depth === 0 && items.slice(1).every(function (it) { return it.depth > 0; })) {
        centre = { title: items[0].title, lanes: items[0]._lanes || [] };
        items.shift();
      }
      items.forEach(function (it) { if (it._lanes) { it.special.push(('Lanes: ' + it._lanes.join(', ')).slice(0, LIMITS.special)); delete it._lanes; } });
      var byTitle = {};
      items.forEach(function (it, i) { it.key = 'k' + i; if (it.depth) { flat++; it.depth = 0; } var k = it.title.toLowerCase(); if (!byTitle[k]) byTitle[k] = it.key; });
      items.forEach(function (it) {
        var seen = {};
        it.next = [];
        (it._next || []).forEach(function (n) {
          var to = byTitle[n.to.toLowerCase()];
          if (!to || to === it.key) { unknown.push(n.to); it.special.push(('Next: ' + (n.label ? n.label + ' -> ' : '') + n.to).slice(0, LIMITS.special)); return; }
          if (seen[to] || it.next.length >= 20) return;
          seen[to] = true; it.next.push({ to: to, label: n.label });
        });
        delete it._next;
        if (it.special.length > LIMITS.specials) { it.special = it.special.slice(0, LIMITS.specials); cut++; }
      });
    } else items.forEach(function (it) { delete it._next; delete it._lanes; });
    return { items: items, cut: cut, typed: typed, flat: flat, unknown: unknown, centre: centre };
  }

  // A branch and what is under it -> outline text. get(id) gives { title, notes, special, props, place, kids: [ids] }.
  // flow (a flowchart): { name(type), exits(id) -> [{ label, to_title }] } adds Shape, Lane and Next lines to every step.
  function write(get, id, flow) {
    var out = [];
    (function walk(nid, d) {
      var n = get(nid); if (!n) return;
      var pad = new Array(d + 1).join('  ');
      out.push(pad + (/^[>!\\]/.test(n.title) ? '\\' : '') + n.title);
      if (n.notes) n.notes.split('\n').forEach(function (l) { out.push(pad + '  >' + (l.trim() ? ' ' + l.replace(/\s+$/, '') : '')); });
      (n.special || []).forEach(function (s) { out.push(pad + '  ! ' + s); });
      if (n.props && n.props.layout === 'columns') out.push(pad + '  ! Layout: columns');
      if (n.place) out.push(pad + '  ! Place: ' + [n.place.x, n.place.y].concat(n.place.w ? [n.place.w, n.place.h] : []).join(', '));
      if (flow && d > 0) {
        out.push(pad + '  ! Shape: ' + flow.name(n.type));
        if (n.props && n.props.lane) out.push(pad + '  ! Lane: ' + n.props.lane);
        flow.exits(nid).forEach(function (x) { out.push(pad + '  ! Next: ' + (x.label ? x.label + ' -> ' : '-> ') + x.to_title); });
      }
      if (flow && d === 0 && n.props && n.props.lanes && n.props.lanes.length) out.push(pad + '  ! Lanes: ' + n.props.lanes.join(', '));
      (n.kids || []).forEach(function (k) { walk(k, d + 1); });
    })(id, 0);
    return out.join('\n') + '\n';
  }

  var api = { parse: parse, write: write, LIMITS: LIMITS };
  if (root.MP) root.MP.io = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
