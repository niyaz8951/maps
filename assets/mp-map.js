/* Maps tile - the Map view (owner, 20 Oct 2026: "a complete free-flow page"). The map is text on lines, not boxes:
   every branch is its name on a line of its branch colour, and the lines flow from the branch it grows from. The page
   scrolls both ways; press and hold (drag) moves it; Ctrl + wheel zooms; Full screen fills the screen.
   One click on a branch shows what grows from it and closes the rest (21 Oct 2026); Ctrl + click opens or closes one
   branch only; a double-click (or Enter) reads it. A branch with nothing under it opens its notes card on the map (peek).
   A branch with Layout "columns" lays out its branches side by side, each with what is under it as a list.
   Links between branches are drawn on top, each meaning in its own line style, with words on the line.
   On a phone the map is for reading: pan, zoom, tap; changes are made in the Outline or the branch panel. */
(function () {
  'use strict';
  var MP = window.MP, el = MP.el, $ = MP.$, st = MP.st, N = MP.N;
  var SVGNS = 'http://www.w3.org/2000/svg';
  var GX = 44, GY = 8, GTOP = 18, PAD = 60, IND = 18, GCOL = 70;
  var seen = {}, firstDraw = true, peekEl = null, peekEdit = false;
  MP.view = { wantScroll: false };

  function svgEl(tag, attrs) { var e = document.createElementNS(SVGNS, tag); for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]); return e; }

  // ---------- one branch, as it shows on the map and in the outline ----------
  function cls(base, n) {
    var c = base;
    if (n.id === st.focus) c += ' mp-root';
    if (n.id !== st.focus && n.status === 'to_verify') c += ' mp-unv';
    if (n.id !== st.focus && n.status === 'changed') c += ' mp-chg';
    if (n.id === st.sel) c += ' mp-sel';
    if (st.q) c += MP.matches(n) ? ' mp-hitn' : ' mp-dim';
    return c;
  }
  function marks(n) {
    var out = [], outLinks = MP.linesFrom(n.id).length;
    if (n.notes) out.push(el('button', { type: 'button', class: 'mp-nb', title: 'Read the notes', 'aria-label': 'Read the notes of ' + n.title, 'data-act': 'note' }, MP.ico('note')));
    if (n.special.length && !st.special) out.push(el('span', { class: 'mp-sp', title: n.special.join('\n') }, el('i', { text: '!' }), String(n.special.length)));
    if (outLinks) out.push(el('span', { class: 'mp-lk', title: MP.plural(outLinks, 'link') }, MP.ico('link')));
    var fromOther = MP.linesTo(n.id).filter(function (l) { return l.kind === 'link' && l.other; });
    if (fromOther.length) out.push(el('span', { class: 'mp-lf', title: 'Linked from another map: ' + fromOther.map(function (l) { return l.other.title + ' (' + l.other.map + ')'; }).join(', '),
      text: '← ' + fromOther.length }));
    if (n.id !== st.focus && n.review) out.push(el('span', { class: 'mp-tv', title: 'Sent back: ' + n.review.note, text: 'sent back' }));
    else if (n.id !== st.focus && n.status === 'to_verify') out.push(el('span', { class: 'mp-tv', title: 'To verify: not checked yet', text: 'to verify' }));
    if (n.id !== st.focus && n.status === 'changed') out.push(el('span', { class: 'mp-tv', title: 'Changed since it was verified', text: 'changed' }));
    if (n.id !== st.focus && n.kids.length)
      out.push(el('button', { type: 'button', class: 'mp-al', title: 'Show this branch alone', 'aria-label': 'Show ' + n.title + ' alone', 'data-act': 'alone' }, MP.ico('focus')));
    return out;
  }
  function nodeEl(n, base) {
    var kids = n.kids.length, hue = MP.hue(n.id);
    var e = el('div', { class: cls(base, n), tabindex: '0', role: 'treeitem', 'data-node': n.id, 'data-accent': hue,
      'aria-level': String(MP.pathOf(n.id).length - MP.pathOf(st.focus).length + 1),
      'aria-expanded': kids ? (n.open ? 'true' : 'false') : null, 'aria-selected': n.id === st.sel ? 'true' : 'false',
      'aria-label': n.title + (n.notes ? ', has notes' : '') + (n.status === 'verified' ? '' : ', ' + MP.statusWord(n).toLowerCase()) + (kids ? ', ' + MP.plural(kids, 'branch', 'branches') : '') },
      el('span', { class: 'mp-t', text: n.title }), marks(n));
    if (st.special && n.special.length) e.appendChild(el('span', { class: 'mp-sps' }, n.special.slice(0, 6).map(function (s) { return el('span', { text: s }); })));
    if (kids) e.appendChild(el('button', { type: 'button', class: 'mp-tg', tabindex: '-1', 'data-act': 'toggle', 'aria-hidden': 'true',
      title: n.open ? 'Close' : 'Open ' + MP.plural(kids, 'branch', 'branches'), text: n.open ? '−' : String(kids) }));
    return e;
  }

  // ---------- drawing ----------
  function render() {
    var stage = $('mp-stage'), canvas = $('mp-canvas'), els = {}, now = {}, first = !Object.keys(seen).length, maxX = 0;
    var act = document.activeElement, keepFocus = peekEl && act && peekEl.contains(act) ? { el: act, a: act.selectionStart, b: act.selectionEnd } : null;
    Core.clear(stage);
    var svg = svgEl('svg', { 'aria-hidden': 'true' }); stage.appendChild(svg);
    (function walk(id) {
      var n = N(id); now[id] = 1; n._inCol = false; n._colHead = false; n._flat = false; n._aside = false;
      var e = nodeEl(n, 'mp-n' + (!first && !seen[id] ? ' mp-grow' : ''));
      stage.appendChild(e); els[id] = e;
      // a branch laid out in columns is a diagram, not a tree to fold: everything in its columns stays open
      if (n.open && MP.columns(n)) n.kids.forEach(function openAll(k) { var c = N(k); if (!c.kids.length) return; if (MP.columns(c)) { c.open = false; return; } c.open = true; c.kids.forEach(openAll); });
      if (n.open) n.kids.forEach(walk);
    })(st.focus);
    Object.keys(els).forEach(function (id) { var n = N(id); n._w = els[id].offsetWidth; n._h = els[id].offsetHeight; });
    // the notes card of a branch with nothing under it (peek), drawn where its next level would grow
    var pk = st.peek && els[st.peek] && st.peek !== st.focus && !N(st.peek).kids.length ? N(st.peek) : null, card = null;
    if (!pk) { st.peek = null; peekEdit = false; peekEl = null; }
    else { card = peekCard(pk); stage.appendChild(card); pk._pw = card.offsetWidth; pk._ph = card.offsetHeight; }

    // across: a branch starts right after the text it grows from; columns side by side
    function colAcross(id, x0, depth) {
      var n = N(id), right; n._inCol = true; n._x = x0 + depth * IND; right = n._x + n._w;
      if (pk && pk.id === id) right = Math.max(right, n._x + pk._pw);
      if (n.open) n.kids.forEach(function (k) { right = Math.max(right, colAcross(k, x0, depth + 1)); });
      return right;
    }
    // a diagram at the centre starts straight away: the centre top left, its leading notes-only branches (the guide)
    // listed under it, the columns beside it from the same top
    function asidesOf(n) { var out = []; for (var i = 0; i < n.kids.length && !N(n.kids[i]).kids.length; i++) out.push(n.kids[i]); return out.length < n.kids.length ? out : []; }
    (function across(id, x) {
      var n = N(id); n._x = x; maxX = Math.max(maxX, x + n._w);
      if (n.open && MP.columns(n) && id === st.focus) {
        var side = asidesOf(n), right = x + n._w; n._flat = true;
        side.forEach(function (k) { N(k)._aside = true; right = Math.max(right, colAcross(k, x, 1)); });
        var fx = right + GCOL;
        n.kids.forEach(function (k) { if (N(k)._aside) return; var r = colAcross(k, fx, 0); N(k)._colHead = true; maxX = Math.max(maxX, r); fx = r + GCOL; });
        maxX = Math.max(maxX, right);
        return;
      }
      if (n.open && MP.columns(n)) {
        var cx = x + n._w + GX + 24;
        n.kids.forEach(function (k) { var r = colAcross(k, cx, 0); N(k)._colHead = true; maxX = Math.max(maxX, r); cx = r + GCOL; });
        return;
      }
      if (n.open) n.kids.forEach(function (k) { across(k, x + n._w + GX); });
    })(st.focus, PAD);
    if (pk && !pk._inCol) maxX = Math.max(maxX, pk._x + pk._w + GX + pk._pw);

    // down: every branch takes the height of what grows from it and sits in the middle of it
    function shift(id, dy) { var n = N(id); n._y += dy; if (n.open) n.kids.forEach(function (k) { shift(k, dy); }); }
    var total = (function lay(id, top) {
      var n = N(id), kh = 0, gap = id === st.focus ? GTOP : GY;
      if (n === pk && !n._inCol) { var ps = Math.max(n._h, n._ph); n._y = top + (ps - n._h) / 2; return ps; }
      function colLay(cid, yy) { var c = N(cid); c._y = yy; yy += c._h + (c._colHead ? 10 : GY); if (c === pk) yy += pk._ph + 12; if (c.open) c.kids.forEach(function (g) { yy = colLay(g, yy); }); return yy; }
      if (n._flat) {
        n._y = top;
        var fy = top + n._h + 12, fb = top + n._h;
        n.kids.forEach(function (k) { if (N(k)._aside) fy = colLay(k, fy); else fb = Math.max(fb, colLay(k, top)); });
        return Math.max(fy, fb) - top;
      }
      if (n.open && MP.columns(n)) {
        var bh = 0;
        n.kids.forEach(function (k) { var y = colLay(k, 0); bh = Math.max(bh, y); });
        var cs = Math.max(n._h, bh), y0 = top + (cs - bh) / 2;
        n.kids.forEach(function (k) { shift(k, y0); });
        n._y = top + (cs - n._h) / 2;
        return cs;
      }
      if (!n.open || !n.kids.length) { n._y = top; return n._h; }
      n.kids.forEach(function (k, i) { N(k)._sub = lay(k, 0); kh += N(k)._sub + (i ? gap : 0); });
      var sub = Math.max(kh, n._h), y = top + (sub - kh) / 2;
      n.kids.forEach(function (k) { shift(k, y); y += N(k)._sub + gap; });
      n._y = top + (sub - n._h) / 2;
      return sub;
    })(st.focus, 0);

    Object.keys(els).forEach(function (id) {
      var n = N(id); n._y += PAD;
      els[id].style.left = n._x + 'px'; els[id].style.top = n._y + 'px';
    });
    // the tree's lines: one path per hue (and per "to verify" state), drawn in the branch's colour
    var paths = {};
    function add(k, n, d) { var key = (MP.hue(k) || 'c') + '|' + (n.status === 'verified' ? '' : 'u'); paths[key] = (paths[key] || '') + d; }
    Object.keys(els).forEach(function (id) {
      var n = N(id), root = id === st.focus;
      if (!n.open) return;
      if (n._flat) {
        n.kids.forEach(function (k) { var c = N(k); if (c._aside) add(k, c, 'M' + (n._x + 7) + ' ' + (n._y + n._h) + 'V' + (c._y + c._h - 1) + 'H' + c._x); });
        return;
      }
      if (MP.columns(n) && n.kids.length && N(n.kids[0])._colHead) {
        var heads = n.kids.map(N), ry = Math.min.apply(null, heads.map(function (h) { return h._y; })) - 12;
        var d = 'M' + (n._x + n._w) + ' ' + (n._y + n._h / 2) + 'H' + (heads[0]._x - 14) + 'V' + ry + 'H' + (heads[heads.length - 1]._x + 6);
        heads.forEach(function (h) { d += 'M' + (h._x + 6) + ' ' + ry + 'V' + h._y; });
        add(n.kids[0], { status: 'verified' }, d);
        return;
      }
      if (n._inCol) {
        n.kids.forEach(function (k) { var c = N(k); add(k, c, 'M' + (n._x + 7) + ' ' + (n._y + n._h) + 'V' + (c._y + c._h - 1) + 'H' + c._x); });
        return;
      }
      n.kids.forEach(function (k) {
        var c = N(k), x1 = n._x + n._w, y1 = root ? n._y + n._h / 2 : n._y + n._h - 1, x2 = c._x, y2 = c._y + c._h - 1, mx = x1 + (x2 - x1) * 0.55;
        add(k, c, 'M' + x1 + ' ' + y1 + 'C' + mx + ' ' + y1 + ',' + (x1 + (x2 - x1) * 0.45) + ' ' + y2 + ',' + x2 + ' ' + y2);
      });
    });
    if (pk) {
      if (pk._inCol) {
        pk._px = pk._x; pk._py = pk._y + pk._h + 6;
        add(pk.id, pk, 'M' + (pk._x + 7) + ' ' + (pk._y + pk._h) + 'V' + pk._py);
      } else {
        pk._px = pk._x + pk._w + GX; pk._py = Math.max(PAD, pk._y + pk._h / 2 - pk._ph / 2);
        var x1 = pk._x + pk._w, y1 = pk._y + pk._h - 1, x2 = pk._px, y2 = pk._py + 18;
        add(pk.id, pk, 'M' + x1 + ' ' + y1 + 'C' + (x1 + GX * 0.55) + ' ' + y1 + ',' + (x1 + GX * 0.45) + ' ' + y2 + ',' + x2 + ' ' + y2);
      }
      card.style.left = pk._px + 'px'; card.style.top = pk._py + 'px';
      if (keepFocus && card.contains(keepFocus.el)) {
        keepFocus.el.focus({ preventScroll: true });
        try { if (keepFocus.a != null) keepFocus.el.setSelectionRange(keepFocus.a, keepFocus.b); } catch (x) { /* ignore */ }
      }
    }
    Object.keys(paths).forEach(function (k) {
      var parts = k.split('|');
      svg.appendChild(svgEl('path', { d: paths[k], class: 'mp-line' + (parts[1] ? ' u' : ''), 'data-accent': parts[0] === 'c' ? null : parts[0] }));
    });
    maxX = Math.max(maxX, drawLinks(stage, svg, els));
    var w = maxX + PAD, ht = total + PAD * 2;
    stage.style.width = w + 'px'; stage.style.height = ht + 'px';
    stage.style.transform = 'scale(' + st.zoom + ')';
    var sizer = $('mp-sizer'); sizer.style.width = Math.ceil(w * st.zoom) + 'px'; sizer.style.height = Math.ceil(ht * st.zoom) + 'px';
    seen = now;
    var z = st.zoom, s = st.sel && els[st.sel] ? N(st.sel) : null;
    if (firstDraw) {
      var r = N(st.focus);
      canvas.scrollLeft = 0;
      canvas.scrollTop = Math.max(0, (r._y + r._h / 2) * z - canvas.clientHeight / 2);
      firstDraw = false;
    }
    if (s && MP.view.wantScroll) keepInView(s, z);
    MP.view.wantScroll = false;
    $('mp-zoom-pct').textContent = Math.round(z * 100) + '%';
  }

  // ---------- links drawn on the map ----------
  // Links: chosen (default) = the lines of the chosen branch, with their words; all = every line of the branches in
  // view (words only on the chosen branch's); off. A line ends at the branch, or at the nearest branch in view that
  // holds it when it is folded away ("folded" in the words). A link to another map ends in a chip at the side.
  function shownAs(id, els) { while (id && N(id)) { if (els[id]) return id; id = N(id).parent; } return null; }
  function drawLinks(stage, svg, els) {
    if (st.xlinks === 'off') return 0;
    var xi = MP.linkIndex(), sel = st.sel && els[st.sel] ? st.sel : null, right = 0, done = {}, chips = {};
    if (st.xlinks === 'chosen' && !sel) return 0;
    var defs = svgEl('defs', {});
    MP.RELS.forEach(function (r) {
      if (r.ends === 'none') return;
      var m = svgEl('marker', { id: 'mpx-' + r.id, class: 'mpx-m x-' + r.id, viewBox: '0 0 10 10', refX: '8.5', refY: '5', markerWidth: '9', markerHeight: '9', orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse' });
      m.appendChild(svgEl('path', { d: r.id === 'replaced' ? 'M1,1 L9,5 L1,9' : 'M0,0 L10,5 L0,10 z' }));
      defs.appendChild(m);
    });
    svg.appendChild(defs);
    var placed = [];
    function label(x, y, text, rel, go, side) {
      for (var tries = 0; tries < 12 && placed.some(function (q) { return Math.abs(q.y - y) < 22 && Math.abs(q.x - x) < 200; }); tries++) y += 22;
      placed.push({ x: x, y: y });
      var c = el('button', { type: 'button', class: 'mp-xl ' + (side || '') + ' x-' + rel.id, title: text + '\n' + rel.hint, text: text, on: { click: go } });
      c.style.left = x + 'px'; c.style.top = y + 'px';
      stage.appendChild(c);
    }
    xi.list.forEach(function (l) {
      var rel = MP.rel(l.rel);
      if (st.xlinks === 'chosen' && l.from !== sel && l.to !== sel) return;
      var a = shownAs(l.from, els), b = shownAs(l.to, els);
      // one end outside this view (a branch shown alone): a chip under the end in view leads there
      if ((a && !b) || (b && !a)) {
        var at = a || b, far = a ? l.to : l.from;
        if (st.xlinks === 'chosen' && sel !== at) return;
        var ck = at + '>' + far + rel.id; if (done[ck]) return; done[ck] = 1;
        var A0 = N(at), k0 = chips[at] = (chips[at] || 0) + 1, cy = A0._y + A0._h + 4 + k0 * 24;
        svg.appendChild(svgEl('path', { d: 'M' + (A0._x + 7) + ' ' + (A0._y + A0._h) + 'V' + cy + 'H' + (A0._x + 22), class: 'mpx x-' + rel.id }));
        var cc = el('button', { type: 'button', class: 'mp-xl mp-xout x-' + rel.id, title: 'Outside this view: ' + rel.hint, on: { click: function () { MP.flush(); MP.nav.reveal(far); } } },
          el('span', { text: (a ? rel.label : rel.back) + ' · ' }), el('b', { text: N(far).title }), el('small', { text: ' (outside this view) ›' }));
        cc.style.left = (A0._x + 24) + 'px'; cc.style.top = cy + 'px';
        stage.appendChild(cc);
        right = Math.max(right, A0._x + 360);
        return;
      }
      if (!a || !b || a === b) return;
      var key = rel.ends === 'end' ? a + '>' + b + rel.id : [a, b].sort().join('|') + rel.id;
      if (done[key]) return; done[key] = 1;
      var A = N(a), B = N(b), ay = A._y + A._h / 2, by = B._y + B._h / 2, x1, x2, c1, c2;
      if (B._x >= A._x + A._w + 10) { x1 = A._x + A._w; x2 = B._x; var d = Math.max(40, (x2 - x1) / 2); c1 = x1 + d; c2 = x2 - d; }
      else if (A._x >= B._x + B._w + 10) { x1 = A._x; x2 = B._x + B._w; var d2 = Math.max(40, (x1 - x2) / 2); c1 = x1 - d2; c2 = x2 + d2; }
      else { x1 = A._x + A._w; x2 = B._x + B._w; c1 = c2 = Math.max(x1, x2) + 50 + Math.min(140, Math.abs(by - ay) * 0.25); }
      right = Math.max(right, c1 + 20, c2 + 20);
      var p = svgEl('path', { d: 'M' + x1 + ' ' + ay + 'C' + c1 + ' ' + ay + ',' + c2 + ' ' + by + ',' + x2 + ' ' + by, class: 'mpx x-' + rel.id });
      if (rel.ends !== 'none') p.setAttribute('marker-end', 'url(#mpx-' + rel.id + ')');
      if (rel.ends === 'both') p.setAttribute('marker-start', 'url(#mpx-' + rel.id + ')');
      svg.appendChild(p);
      if (sel && (l.from === sel || l.to === sel)) {
        var mine = l.from === sel, other = mine ? l.to : l.from, proxy = mine ? b !== l.to : a !== l.from;
        // the words sit near the other end, where the lines of a busy branch fan out (B(t) of the curve)
        var tt = mine ? 0.93 : 0.07, u = 1 - tt;
        var mx = u * u * u * x1 + 3 * u * u * tt * c1 + 3 * u * tt * tt * c2 + tt * tt * tt * x2;
        var my = u * u * u * ay + 3 * u * u * tt * ay + 3 * u * tt * tt * by + tt * tt * tt * by;
        var ex = mine ? x2 : x1;
        label(mx, my, (l.label || (mine ? rel.label : rel.back)) + (proxy ? ' · ' + N(other).title + ' (folded)' : ''), rel, function () { MP.flush(); MP.nav.reveal(other); }, ex >= mx ? 'ra' : 'la');
      }
    });
    // links that leave this map: a short line to a chip beside the chosen branch
    if (sel) xi.out.forEach(function (l) {
      if (l.from !== sel && l.to !== sel) return;
      var rel = MP.rel(l.rel), mine = l.from === sel, A = N(sel), k = chips[sel] = (chips[sel] || 0) + 1;
      var x1 = A._x + A._w, y1 = A._y + A._h / 2, x2 = x1 + 70, y2 = y1 + (k - 1) * 30 - 34;
      if (st.peek === sel && A._px !== undefined) y2 = A._py + A._ph + 22 + (k - 1) * 30;
      var p = svgEl('path', { d: 'M' + x1 + ' ' + y1 + 'C' + (x1 + 35) + ' ' + y1 + ',' + (x2 - 35) + ' ' + y2 + ',' + x2 + ' ' + y2, class: 'mpx x-' + rel.id });
      if (rel.ends !== 'none') p.setAttribute(mine ? 'marker-end' : 'marker-start', 'url(#mpx-' + rel.id + ')');
      svg.appendChild(p);
      var c = el('button', { type: 'button', class: 'mp-xl mp-xout x-' + rel.id, title: 'Opens the other map: ' + rel.hint, on: { click: function () { MP.nav.follow(l, sel); } } },
        el('span', { text: (mine ? rel.label : rel.back) + ' · ' }), el('b', { text: l.other ? l.other.title : '' }), el('small', { text: ' (' + (l.other ? l.other.map : 'other map') + ') ›' }));
      c.style.left = x2 + 'px'; c.style.top = y2 + 'px';
      stage.appendChild(c);
      right = Math.max(right, x2 + 320);
    });
    return right;
  }
  // the meanings used on this map, each with a sample of its line
  function legend(show) {
    var box = $('mp-legend'); Core.clear(box);
    var used = {};
    if (show) MP.M.lines.forEach(function (l) { if (l.kind === 'link') used[l.rel] = 1; });
    var any = false;
    MP.RELS.forEach(function (r) {
      if (!used[r.id]) return;
      any = true;
      var s = svgEl('svg', { viewBox: '0 0 34 10', width: '34', height: '10', 'aria-hidden': 'true' });
      s.appendChild(svgEl('path', { d: 'M2 5 L32 5', class: 'mpx x-' + r.id }));
      box.appendChild(el('span', { class: 'mp-lg', title: r.hint }, s, r.label));
    });
    box.hidden = !any;
  }

  // ---------- the notes card on the map (peek, 23 Oct 2026) ----------
  function peekCard(n) {
    if (peekEdit && peekEl && peekEl._for === n.id) return peekEl;        // kept while writing: the text box keeps its place
    var may = MP.editing() && !st.note && !MP.phone(), E = peekEdit && may;
    var box = el('div', { class: 'mp-peek', role: 'region', 'aria-label': 'Notes of ' + n.title, 'data-accent': MP.hue(n.id) });
    box._for = n.id;
    box.appendChild(el('div', { class: 'mp-peek-top' },
      E ? el('span', { class: 'mp-status', id: 'mp-status', role: 'status' }) : el('span', { class: 'mp-peek-h', text: 'Notes' }),
      may ? el('button', { type: 'button', class: 'btn small' + (E ? '' : ' ghost'), text: E ? 'Done' : 'Edit', title: E ? 'Stop editing' : 'Write in the notes',
        on: { click: function () { peekEdit = !E; if (!peekEdit) MP.flush(); peekEl = null; MP.page.renderView(); var t = $('mp-peek-text'); if (peekEdit && t) t.focus({ preventScroll: true }); } } }) : null,
      el('button', { type: 'button', class: 'btn small ghost', text: 'Open', title: 'Open this branch', on: { click: function () { MP.editor.open(n.id); } } }),
      el('button', { type: 'button', class: 'mp-peek-x', text: '×', title: 'Close', 'aria-label': 'Close the notes', on: { click: function () { closePeek(); } } })));
    if (E) {
      var ta = el('textarea', { class: 'mp-peek-in', id: 'mp-peek-text', maxlength: '8000', placeholder: 'What to know about ' + n.title + '...', 'aria-label': 'Notes of ' + n.title });
      ta.value = n.notes;
      ta.addEventListener('input', function () { MP.typed(n.id, 'notes', ta.value); });
      ta.addEventListener('blur', MP.flush);
      ta.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); peekEdit = false; MP.flush(); peekEl = null; MP.page.renderView(); MP.nav.refocus(n.id); } });
      box.appendChild(ta);
    } else box.appendChild(n.notes ? el('div', { class: 'mp-peek-text', text: n.notes })
      : el('p', { class: 'mp-peek-none', text: 'No notes on this branch.' + (may ? ' Press Edit to write some.' : '') }));
    if (n.special.length) box.appendChild(el('div', { class: 'mp-chips mp-peek-sp' }, n.special.map(function (x) { return el('span', { class: 'mp-chip' }, el('b', { text: '!' }), x); })));
    if (n.status !== 'verified') box.appendChild(el('p', { class: 'mp-peek-st' }, el('span', { class: 'badge warning', text: MP.statusWord(n) })));
    peekEl = box;
    return box;
  }
  function closePeek(quiet) {
    var id = st.peek;
    MP.flush(); st.peek = null; peekEdit = false; peekEl = null;
    if (!quiet) { MP.page.renderView(); if (id && N(id)) MP.nav.refocus(id); }
  }
  function resetPeek() { peekEdit = false; peekEl = null; }

  function keepInView(s, z) {
    var canvas = $('mp-canvas');
    if (!s || s._x === undefined) return;
    var pv = st.peek === s.id && s._px !== undefined;
    var right = ((pv ? s._px + s._pw : s._x + s._w + (s.open && s.kids.length ? 260 : 0)) + 30) * z, left = (s._x - 30) * z;
    if (right > canvas.scrollLeft + canvas.clientWidth) canvas.scrollLeft = Math.min(left, right - canvas.clientWidth);
    if (left < canvas.scrollLeft) canvas.scrollLeft = Math.max(0, left);
    var top = (s._y - 30) * z, bottom = (s._y + s._h + 30) * z;
    if (s.open && s.kids.length) { top = Math.min(top, (N(s.kids[0])._y - 20) * z); bottom = Math.max(bottom, (N(s.kids[s.kids.length - 1])._y + 50) * z); }
    if (pv) { top = Math.min(top, (s._py - 20) * z); bottom = Math.max(bottom, (s._py + s._ph + 20) * z); }
    if (bottom - top > canvas.clientHeight) bottom = top + canvas.clientHeight;
    if (top < canvas.scrollTop) canvas.scrollTop = Math.max(0, top);
    else if (bottom > canvas.scrollTop + canvas.clientHeight) canvas.scrollTop = bottom - canvas.clientHeight;
  }

  // ---------- zoom, fit, full screen ----------
  function setZoom(z, cx, cy) {
    var c = $('mp-canvas'), old = st.zoom;
    z = Math.max(0.3, Math.min(2, Math.round(z * 100) / 100));
    if (z === old) return;
    if (cx === undefined) { cx = c.clientWidth / 2; cy = c.clientHeight / 2; }
    var px = (c.scrollLeft + cx) / old, py = (c.scrollTop + cy) / old;
    st.zoom = z; MP.store('zoom:' + MP.M.map.id, z);
    var stage = $('mp-stage'), sizer = $('mp-sizer');
    stage.style.transform = 'scale(' + z + ')';
    sizer.style.width = Math.ceil(stage.offsetWidth * z) + 'px'; sizer.style.height = Math.ceil(stage.offsetHeight * z) + 'px';
    c.scrollLeft = px * z - cx; c.scrollTop = py * z - cy;
    $('mp-zoom-pct').textContent = Math.round(z * 100) + '%';
  }
  function zoomBy(k, cx, cy) { setZoom(st.zoom * k, cx, cy); }
  function fit() {
    var c = $('mp-canvas'), stage = $('mp-stage');
    var z = Math.min(1, (c.clientWidth - 10) / stage.offsetWidth, (c.clientHeight - 10) / stage.offsetHeight);
    setZoom(Math.max(0.3, z)); c.scrollLeft = 0; c.scrollTop = 0;
  }
  function full(on, fromBrowser) {
    st.full = on;
    $('mp-map').classList.toggle('mp-fullscreen', on);
    document.documentElement.classList.toggle('mp-noscroll', on);
    $('mp-full').setAttribute('aria-pressed', on ? 'true' : 'false');
    $('mp-full').title = on ? 'Leave full screen (Esc)' : 'Full screen (F)';
    $('mp-full-txt').textContent = on ? 'Exit full screen' : 'Full screen';
    if (!fromBrowser) {
      try {
        if (on && document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(function () { /* the page alone is enough */ });
        if (!on && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () { /* ignore */ });
      } catch (e) { /* ignore */ }
    }
    if (on && st.view === 'outline') MP.page.setView('map'); else MP.page.renderView();
  }

  // ---------- the mouse on the map ----------
  // Press and hold, then move: the map moves with it (a click that did not move picks the branch). The wheel scrolls,
  // Shift + wheel (or a touchpad) sideways, Ctrl + wheel zooms where the pointer is. A finger scrolls natively.
  function wire() {
    var c = $('mp-canvas'), drag = null;
    c.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || e.pointerType === 'touch') return;
      if (e.target.closest && e.target.closest('.mp-peek, .mp-xl')) return;
      drag = { x: e.clientX, y: e.clientY, sl: c.scrollLeft, st: c.scrollTop, moved: false, id: e.pointerId };
    });
    c.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
      if (!drag.moved) { drag.moved = true; c.classList.add('mp-panning'); try { c.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } }
      c.scrollLeft = drag.sl - dx; c.scrollTop = drag.st - dy;
    });
    function end(e) {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      if (drag.moved) { c.classList.remove('mp-panning'); c.addEventListener('click', swallow, true); }
      drag = null;
    }
    function swallow(e) { e.stopPropagation(); e.preventDefault(); c.removeEventListener('click', swallow, true); }
    c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', function (e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      var r = c.getBoundingClientRect();
      zoomBy(Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    c.addEventListener('click', function (e) { MP.nav.click(e, true); });
    c.addEventListener('dblclick', MP.nav.dblclick);
    c.addEventListener('keydown', function (e) {
      var nodeE = e.target.closest ? e.target.closest('[data-node]') : null;
      if (!nodeE || e.target !== nodeE) return;
      MP.nav.key(e, N(nodeE.getAttribute('data-node')));
    });
    $('mp-zoom-in').addEventListener('click', function () { zoomBy(1.2); });
    $('mp-zoom-out').addEventListener('click', function () { zoomBy(1 / 1.2); });
    $('mp-zoom-pct').addEventListener('click', function () { setZoom(1); });
    $('mp-fit').addEventListener('click', fit);
    $('mp-full').addEventListener('click', function () { full(!st.full); });
    document.addEventListener('fullscreenchange', function () { if (!document.fullscreenElement && st.full) full(false, true); });
  }

  MP.mapView = { render: render, nodeEl: nodeEl, legend: legend, wire: wire, setZoom: setZoom, zoomBy: zoomBy, fit: fit, full: full,
    closePeek: closePeek, resetPeek: resetPeek, keepInView: keepInView,
    redraw: function () { seen = {}; firstDraw = true; } };
})();
