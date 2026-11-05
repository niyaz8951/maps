/* Maps tile - data: the shared state, calls to public.maps_*, the tree, rights for showing and hiding (the database
   decides), plain messages, and saving with the version the page read (edit clash guard).
   Everything else hangs off window.MP: MP.list, MP.mapView, MP.outline, MP.editor, MP.io, MP.page. */
window.MP = (function () {
  'use strict';
  var el = Core.el;
  var MP = {
    TILE: 'maps',
    me: null,                 // Core.requireLogin result
    flags: { editor: false, verifier: false, admin: false },
    types: [],
    M: null,                  // the open map: { map, nodes: { id: node }, root, lines: [], facts: {} }
    st: { focus: null, sel: null, view: 'map', edit: false, q: '', note: null, zoom: 1, special: false, xlinks: 'chosen', full: false, peek: null }
  };

  MP.el = el;
  MP.$ = function (id) { return document.getElementById(id); };
  MP.plural = function (n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); };
  MP.phone = function () { return window.matchMedia ? window.matchMedia('(max-width: 640px)').matches : false; };
  MP.coarse = function () { return window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false; };
  MP.UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  MP.SHARE = { private: 'Only me', team_read: 'Team can read', team_edit: 'Team can edit' };
  MP.SHARE_HINT = 'Team = everyone who has Maps on the dashboard.';
  MP.KIND = { knowledge: 'Knowledge', piping: 'Piping', wiring: 'Wiring' };

  // View settings only (never data): kept per browser under dame.maps.* and cleared at sign-out by the core.
  MP.store = function (name, value) {
    var k = 'dame.maps.' + name;
    try {
      if (value === undefined) return localStorage.getItem(k);
      if (value === null) localStorage.removeItem(k); else localStorage.setItem(k, String(value));
    } catch (e) { /* storage blocked: nothing here is needed to work */ }
    return null;
  };

  // ---------- plain messages ----------
  var WORDS = {
    'INVALID:title': 'Give it a name: up to 120 characters for a branch, 80 for a map.',
    'INVALID:notes': 'The notes of one branch are at most 8000 characters. Split them over branches.',
    'INVALID:special': 'A branch holds up to 20 special notes, each at most 200 characters.',
    'INVALID:name_taken': 'There is already a map with that name. Choose another name.',
    'INVALID:too_many': 'You have 200 maps. Delete one you no longer need first.',
    'INVALID:size': 'A map holds up to 2000 branches. Start a second map for the rest.',
    'INVALID:items': 'Nothing to add, or more than 500 branches in one go. Import the outline in parts.',
    'INVALID:props': 'One of the values is not allowed here.',
    'INVALID:type': 'That type is not available in this map.',
    'INVALID:place': 'That place on the drawing is not valid.',
    'INVALID:parent': 'It cannot go there: never inside itself, and the branch it belongs under must be there (restore that one first).',
    'INVALID:branch': 'This is the centre of the map: rename or delete the map instead.',
    'INVALID:lines': 'A branch holds up to 20 links. Remove one first.',
    'INVALID:duplicate': 'That link is there already.',
    'INVALID:rel': 'Choose what the link means.',
    'INVALID:to': 'Choose another branch to link to.',
    'INVALID:target': 'A web link starts with https:// and has no spaces.',
    'INVALID:label': 'The text shown is at most 120 characters.',
    'INVALID:kind': 'That is not available yet.',
    'INVALID:share': 'Choose who the map is shared with.',
    'INVALID:q': 'Search for up to 100 characters.',
    'INVALID:patch': 'Nothing to save.',
    NOT_FOUND: 'That map or branch is not available. It was deleted, or it is no longer shared with you.'
  };
  MP.msg = function (err) {
    if (err && err.code === 'INVALID:version') { var c = MP.clash(err); return 'Not saved: ' + c.text; }
    return (err && WORDS[err.code]) || Api.errorMessage(err);
  };
  // A refused save: who changed it and when (from the error detail).
  MP.clash = function (err) {
    var d = {};
    try { d = JSON.parse(err && err.raw && err.raw.details || '{}') || {}; } catch (e) { d = {}; }
    var when = MP.ago(d.at);
    return { by: d.by || '', at: d.at || null, text: (d.by ? 'changed by ' + d.by : 'changed by someone else') + (when ? ' ' + when : '') + '. Reload to see it.' };
  };
  MP.ago = function (at) {
    if (!at) return '';
    var s = (Date.now() - new Date(at).getTime()) / 1000;
    if (isNaN(s)) return '';
    if (s < 90) return 'a moment ago';
    if (s < 3600) return Math.round(s / 60) + ' minutes ago';
    if (s < 86400) return Math.round(s / 3600) + ' hours ago';
    return 'on ' + Core.date(at);
  };
  MP.toastErr = function (err) { Core.toast(MP.msg(err), 'danger'); if (err && err.code === 'SIGNED_OUT') Core.showError(err); };

  MP.rpc = function (name, params) { return Api.rpc(name, params || {}); };

  // ---------- the open map as a tree ----------
  MP.build = function (r) {
    var old = MP.M ? MP.M.nodes : null, keepOpen = {};
    try { (JSON.parse(sessionStorage.getItem('dame.maps.open:' + r.map.id) || '[]') || []).forEach(function (i) { keepOpen[i] = 1; }); } catch (e) { /* ignore */ }
    var M = { map: r.map, nodes: {}, root: null, lines: r.lines || [], facts: r.verified_facts || {} };
    r.branches.forEach(function (n) {
      n.kids = []; n.special = n.special || []; n.props = n.props || {};
      n.open = old && old[n.id] ? old[n.id].open : !!keepOpen[n.id];
      M.nodes[n.id] = n;
    });
    r.branches.forEach(function (n) {
      if (n.parent && M.nodes[n.parent]) M.nodes[n.parent].kids.push(n.id);
      else if (!n.parent) M.root = n.id;
    });
    Object.keys(M.nodes).forEach(function (id) {
      M.nodes[id].kids.sort(function (a, b) { return M.nodes[a].sort - M.nodes[b].sort; });
    });
    M.nodes[M.root].open = true;
    MP.M = M;
    var st = MP.st;
    if (!st.focus || !M.nodes[st.focus]) st.focus = M.root;
    if (st.sel && !M.nodes[st.sel]) st.sel = null;
    if (st.note && !M.nodes[st.note]) st.note = null;
    if (st.peek && !M.nodes[st.peek]) st.peek = null;
    return M;
  };
  MP.saveOpen = function () {
    if (!MP.M) return;
    var open = [];
    Object.keys(MP.M.nodes).forEach(function (id) { if (MP.M.nodes[id].open) open.push(id); });
    try { sessionStorage.setItem('dame.maps.open:' + MP.M.map.id, JSON.stringify(open.slice(0, 600))); } catch (e) { /* ignore */ }
  };
  MP.N = function (id) { return MP.M && MP.M.nodes[id]; };
  MP.pathOf = function (id) { var p = []; while (id && MP.N(id)) { p.unshift(id); id = MP.N(id).parent; } return p; };
  MP.each = function (id, fn) { var n = MP.N(id); if (!n) return; fn(n); n.kids.forEach(function (k) { MP.each(k, fn); }); };
  MP.under = function (id) { var c = 0; MP.each(id, function () { c++; }); return c - 1; };
  MP.order = function () { var out = []; MP.each(MP.st.focus, function (n) { out.push(n.id); }); return out; };
  MP.visible = function () { var out = []; (function w(id) { out.push(id); if (MP.N(id).open) MP.N(id).kids.forEach(w); })(MP.st.focus); return out; };
  MP.isRoot = function (id) { return MP.M && id === MP.M.root; };
  MP.columns = function (n) { return n.kids.length > 0 && n.props && n.props.layout === 'columns'; };

  // ---------- rights (for showing and hiding; the database decides) ----------
  MP.canEdit = function () { return !!MP.M && (MP.M.map.right === 'edit' || MP.M.map.right === 'manage'); };
  MP.canManage = function () { return !!MP.M && MP.M.map.right === 'manage'; };
  MP.canVerify = function () { return !!MP.M && !!MP.M.map.can_verify; };
  MP.editing = function () { return MP.st.edit && MP.canEdit(); };

  // ---------- lines ----------
  // What a link between two branches means (owner, 23 Oct 2026): one fixed list for every map, each with its own line
  // style and words (never colour alone). "back" is how the other end reads it.
  MP.RELS = [
    { id: 'requires', label: 'Requires', back: 'Required by', ends: 'end', hint: 'One needs the other: a VFD requires a motor of a certain insulation class.' },
    { id: 'equivalent', label: 'Equivalent to', back: 'Equivalent to', ends: 'both', hint: 'The same requirement in other words or another standard: MERV 14 and F8.' },
    { id: 'excludes', label: 'Excludes', back: 'Excludes', ends: 'none', hint: 'Cannot go together: EC plug fans exclude belt drives.' },
    { id: 'replaced', label: 'Replaced by', back: 'Replaces', ends: 'end', hint: 'One took the place of the other: EN 779 was replaced by ISO 16890.' },
    { id: 'part', label: 'Part of', back: 'Has part', ends: 'end', hint: 'Belongs to the other: a filter gauge is part of the filter section.' },
    { id: 'see', label: 'See also', back: 'See also', ends: 'none', hint: 'Related: read them together.' }
  ];
  MP.rel = function (id) { for (var i = 0; i < MP.RELS.length; i++) if (MP.RELS[i].id === id) return MP.RELS[i]; return MP.RELS[MP.RELS.length - 1]; };
  MP.linesFrom = function (id) { return MP.M.lines.filter(function (l) { return l.from === id; }); };
  MP.linesTo = function (id) { return MP.M.lines.filter(function (l) { return l.to === id; }); };
  // links between two branches of this map, and links that leave it (to or from another map)
  MP.linkIndex = function () {
    var list = [], out = [];
    MP.M.lines.forEach(function (l) {
      if (l.kind !== 'link') return;
      if (MP.N(l.from) && MP.N(l.to)) list.push(l);
      else out.push(l);
    });
    return { list: list, out: out };
  };
  MP.hasLines = function (id) { return !!id && MP.M.lines.some(function (l) { return l.kind === 'link' && (l.from === id || l.to === id); }); };

  // ---------- saving: typed text goes by itself, one request at a time, with the version read ----------
  var draft = null, chain = Promise.resolve(), waiting = 0;
  MP.clashed = null;          // { id, patch, text }: a save the database refused because the branch changed meanwhile
  MP.failed = null;           // { id, patch, text }: a save that did not go through (network ...)
  function status(text, bad) { if (MP.editor && MP.editor.status) MP.editor.status(text, bad); }
  MP.typed = function (id, field, value) {
    var n = MP.N(id); if (!n) return;
    n[field] = value;
    if (draft && draft.id !== id) MP.flush();
    if (!draft) draft = { id: id, patch: {} };
    if (MP.failed && MP.failed.id === id) { for (var k in MP.failed.patch) if (!(k in draft.patch)) draft.patch[k] = MP.failed.patch[k]; MP.failed = null; }
    draft.patch[field] = value;
    clearTimeout(draft.timer); draft.timer = setTimeout(MP.flush, 800);
    status('Saving...');
  };
  MP.flush = function () {
    if (!draft) return chain;
    var d = draft; draft = null; clearTimeout(d.timer);
    return MP.send(d.id, d.patch);
  };
  MP.settled = function () { MP.flush(); return chain; };
  MP.pending = function () { return !!draft || waiting > 0; };
  // undo: puts the page back when the change was refused (lists, structure)
  MP.send = function (id, patch, undo) {
    if (MP.clashed && MP.clashed.id === id) {           // the branch changed meanwhile: nothing more goes until a reload
      for (var k in patch) MP.clashed.patch[k] = patch[k];
      status('Not saved: ' + MP.clashed.text, true);
      return chain;
    }
    waiting++; status('Saving...');
    chain = chain.then(function () {
      var n = MP.N(id); if (!n) return null;
      return MP.rpc('maps_branch_save', { p_branch: id, p_version: n.version, p_patch: patch });
    }).then(function (r) {
      waiting--;
      var n = MP.N(id);
      if (n && r) {
        ['title', 'notes', 'special', 'props', 'place', 'type'].forEach(function (f) {
          if (f in patch && !(draft && draft.id === id && f in draft.patch)) n[f] = r[f];
        });
        n.version = r.version; n.status = r.status; n.updated_by = r.updated_by; n.updated_at = r.updated_at;
        n.verified_by = r.verified_by; n.verified_at = r.verified_at;
        // renaming the centre renames the map (its version moves on too)
        if (MP.isRoot(id) && 'title' in patch) { MP.M.map.name = n.title; MP.M.map.version++; if (MP.page) MP.page.head(); }
      }
      if (!waiting && !draft) { status('Saved'); if (MP.page) MP.page.soon(); if (MP.editor) MP.editor.foot(); }
    }, function (err) {
      waiting--;
      if (undo) { undo(); MP.render(); MP.toastErr(err); return; }
      if (!MP.N(id)) return;
      if (err && err.code === 'INVALID:version') {
        MP.clashed = { id: id, patch: patch, text: MP.clash(err).text };
        status('Not saved: ' + MP.clashed.text, true);
        if (MP.editor) MP.editor.render();
        return;
      }
      MP.failed = { id: id, patch: patch, text: MP.msg(err) };
      status('Not saved. ' + MP.msg(err), true);
      if (err && err.code === 'SIGNED_OUT') Core.showError(err); else Core.toast('Not saved. ' + MP.msg(err), 'danger');
      if (MP.editor) MP.editor.render();
    });
    return chain;
  };
  MP.retry = function () { var f = MP.failed; MP.failed = null; if (f) MP.send(f.id, f.patch); };
  // one change to the structure (add, move, delete ...): everything typed goes first, a refusal says why
  MP.act = function (call, done) {
    return MP.settled().then(function () { return call(); }).then(done, function (err) { MP.toastErr(err); });
  };
  // a whole list (special notes) at once; a refusal puts it back
  MP.setList = function (n, field, list) {
    var before = n[field];
    n[field] = list; MP.render();
    MP.flush();
    var p = {}; p[field] = list;
    return MP.send(n.id, p, function () { n[field] = before; });
  };

  MP.render = function () { if (MP.page) MP.page.render(); };
  MP.reload = function (after) {
    if (!MP.M) return Promise.resolve();
    return MP.rpc('maps_get', { p_map: MP.M.map.id }).then(function (r) {
      MP.clashed = null; MP.failed = null;
      MP.build(r); if (after) after(); MP.render(); if (MP.page) MP.page.head();
    }, function (err) { if (MP.page) MP.page.notAvailable(MP.msg(err)); });
  };

  // ---------- small pieces of UI shared by the views ----------
  // Small line icons, drawn from fixed path data (no markup strings).
  var ICON = {
    note: 'M3.5 2.5h9v11h-9zM6 6h4M6 8.5h4M6 11h2.5',
    link: 'M6.8 9.2l2.4-2.4M7 4.6l1-1a2.6 2.6 0 013.7 3.7l-1 1M9 11.4l-1 1a2.6 2.6 0 01-3.7-3.7l1-1',
    focus: 'M9.5 2.5h4v4M13.5 2.5L9 7M6.5 13.5h-4v-4M2.5 13.5L7 9'
  };
  MP.ico = function (name) {
    var NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'), path = document.createElementNS(NS, 'path');
    svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.5'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('d', ICON[name]); svg.appendChild(path);
    return el('span', { class: 'mp-ico', 'aria-hidden': 'true' }, svg);
  };
  // the hue of a branch: the top branch it grows from, from the core palette in turn; the centre is the tile accent
  var HUES = ['rose', 'teal', 'violet', 'orange', 'green'];
  MP.hue = function (id) {
    var p = MP.pathOf(id), i = p.indexOf(MP.st.focus);
    if (i < 0 || i === p.length - 1) return null;
    var top = p[i + 1];
    return HUES[MP.N(MP.st.focus).kids.indexOf(top) % HUES.length];
  };
  MP.statusWord = function (n) { return n.status === 'to_verify' ? 'To verify' : n.status === 'changed' ? 'Changed since verified' : 'Verified'; };
  MP.matches = function (n) { return !!MP.st.q && (n.title + '\n' + n.notes + '\n' + n.special.join('\n')).toLowerCase().indexOf(MP.st.q) >= 0; };

  // Core.sheet with a form: build(close) gives the body; the returned promise resolves when it closes.
  MP.field = function (label, control, hint) {
    return el('div', { class: 'field' }, el('label', { text: label, for: control.id || null }), control, hint ? el('p', { class: 'hint', text: hint }) : null);
  };
  MP.select = function (id, options, value) {
    var s = el('select', { id: id }, options.map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
    if (value != null) s.value = value;
    return s;
  };
  MP.shareSelect = function (id, value, allowPrivate) {
    return MP.select(id, Object.keys(MP.SHARE).filter(function (k) { return allowPrivate !== false || k !== 'private'; }).map(function (k) { return [k, MP.SHARE[k]]; }), value);
  };
  MP.fileName = function (s) { return (String(s || '').replace(/[^A-Za-z0-9 _.-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'map'); };

  return MP;
})();
