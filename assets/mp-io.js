/* Maps tile - import and export: a plain outline.
   One branch per line, two spaces deeper for a branch under it. "> text" is a line of the notes of the branch above,
   "! text" a special note. It reads the old tool's Export exactly (Thinkneering Maps, before 5 Nov 2026), including its
   special-note lines that are now typed values: "Layout: columns" becomes the Layout of the branch, "Place: 120, 80"
   its place on the 2D drawing. Lines whose values belong to types that are not built yet (Flow, Source, Icon ... for
   piping and wiring maps) stay special notes, word for word.
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

  // text -> { items: [{ depth, title, notes, special: [], props: {}, place }], cut, typed }
  function parse(text) {
    var items = [], last = null, stack = [], cut = 0, typed = 0;
    String(text || '').replace(/^﻿/, '').replace(/\r/g, '').split('\n').forEach(function (line) {
      var raw = line.replace(/\t/g, '    '), t = raw.trim();
      if (!t) return;
      if (/^>/.test(t)) { if (last) last.notes.push(t.replace(/^>\s?/, '')); return; }
      if (/^!/.test(t)) {
        t = t.replace(/^!\s?/, '').replace(/\s+/g, ' ').trim();
        if (!last || !t) return;
        var m = /^([A-Za-z][A-Za-z ]{0,24}?)\s*:\s*(.+)$/.exec(t), key = m && KEYS[m[1].toLowerCase()];
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
    return { items: items, cut: cut, typed: typed };
  }

  // A branch and what is under it -> outline text. get(id) gives { title, notes, special, props, place, kids: [ids] }.
  function write(get, id) {
    var out = [];
    (function walk(nid, d) {
      var n = get(nid); if (!n) return;
      var pad = new Array(d + 1).join('  ');
      out.push(pad + (/^[>!\\]/.test(n.title) ? '\\' : '') + n.title);
      if (n.notes) n.notes.split('\n').forEach(function (l) { out.push(pad + '  >' + (l.trim() ? ' ' + l.replace(/\s+$/, '') : '')); });
      (n.special || []).forEach(function (s) { out.push(pad + '  ! ' + s); });
      if (n.props && n.props.layout === 'columns') out.push(pad + '  ! Layout: columns');
      if (n.place) out.push(pad + '  ! Place: ' + [n.place.x, n.place.y].concat(n.place.w ? [n.place.w, n.place.h] : []).join(', '));
      (n.kids || []).forEach(function (k) { walk(k, d + 1); });
    })(id, 0);
    return out.join('\n') + '\n';
  }

  var api = { parse: parse, write: write, LIMITS: LIMITS };
  if (root.MP) root.MP.io = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
