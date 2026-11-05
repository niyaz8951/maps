/* Maps tile - the page: the guard first, then the list (/maps/) or one map (/maps/?map=<id>; #<branch> shows that
   branch alone, #at-<branch> chooses it). Moving around a map, the bar above it, and redrawing. */
(function () {
  'use strict';
  var MP = window.MP, el = MP.el, $ = MP.$, st = MP.st, N = MP.N;

  // ---------- the head, the path and the counters ----------
  function head() {
    var m = MP.M.map;
    $('mp-title').textContent = m.name; Core.setTitle(m.name + ' - Maps');
    $('mp-sub').textContent = [MP.KIND[m.kind] + ' map', m.mine ? 'yours' : 'by ' + m.owner, MP.SHARE[m.share], m.right === 'read' ? 'you can read it' : null,
      'changed ' + Core.date(m.updated_at) + (m.updated_by ? ' by ' + m.updated_by : '')].filter(Boolean).join(' · ');
    $('mp-mode').hidden = !MP.canEdit();
    $('mp-import').hidden = !(MP.canEdit() && st.edit);
    $('mp-settings').hidden = !MP.canManage();
    $('mp-btrash').hidden = !MP.canManage();
  }
  function crumbs() {
    var c = $('mp-crumbs'), p = MP.pathOf(st.focus); Core.clear(c);
    p.forEach(function (id, i) {
      if (i) c.appendChild(el('span', { class: 'sep', text: '›' }));
      if (i === p.length - 1) c.appendChild(el('span', { class: 'here', text: N(id).title }));
      else c.appendChild(el('button', { type: 'button', text: N(id).title, on: { click: function () { focusOn(id); } } }));
    });
    if (p.length > 1) c.appendChild(el('button', { type: 'button', class: 'btn ghost small', text: 'Whole map', on: { click: function () { focusOn(MP.M.root); } } }));
  }
  function pills() {
    var b = 0, s = 0, tv = 0, ch = 0, hits = 0, first = null, p = $('mp-pills');
    MP.each(MP.M.root, function (n) {
      b++; s += n.special.length;
      if (n.id !== MP.M.root && n.status === 'to_verify') { tv++; first = first || n.id; }
      if (n.id !== MP.M.root && n.status === 'changed') { ch++; first = first || n.id; }
    });
    if (st.q) MP.each(st.focus, function (n) { if (MP.matches(n)) hits++; });
    Core.clear(p);
    if (st.q) p.appendChild(el('span', { class: 'badge accent', text: hits + ' found' }));
    p.appendChild(el('span', { class: 'badge', text: MP.plural(b - 1, 'branch', 'branches') }));
    if (s) p.appendChild(el('span', { class: 'badge', text: MP.plural(s, 'special note') }));
    if (tv || ch) p.appendChild(el('button', { type: 'button', class: 'badge warning mp-badgebtn', title: 'Show the first one',
      text: [tv ? tv + ' to verify' : null, ch ? ch + ' changed since verified' : null].filter(Boolean).join(' · '),
      on: { click: function () { MP.flush(); reveal(first); } } }));
    else p.appendChild(el('span', { class: 'badge success', text: 'All verified' }));
  }

  // ---------- redrawing ----------
  var queued = false;
  function renderView() {
    crumbs(); pills();
    var map = st.view === 'map';
    $('mp-canvas').hidden = !map; $('mp-outline').hidden = map; $('mp-tools').hidden = !map;
    $('mp-view-map').setAttribute('aria-selected', map ? 'true' : 'false'); $('mp-view-out').setAttribute('aria-selected', map ? 'false' : 'true');
    $('mp-read').setAttribute('aria-selected', st.edit ? 'false' : 'true'); $('mp-edit').setAttribute('aria-selected', st.edit ? 'true' : 'false');
    $('mp-special').setAttribute('aria-pressed', st.special ? 'true' : 'false');
    var anyX = MP.linkIndex().list.length + MP.linkIndex().out.length > 0;
    $('mp-xlinks').hidden = !anyX;
    $('mp-xlinks').setAttribute('aria-pressed', anyX && st.xlinks !== 'off' ? 'true' : 'false');
    $('mp-xlinks-txt').textContent = 'Links: ' + st.xlinks;
    MP.mapView.legend(map && anyX && st.xlinks !== 'off');
    var touch = MP.coarse();
    $('mp-hint').textContent = touch ? 'Tap a branch to open it, tap it again to read it' + (map ? ' · two fingers to move' : '')
      : 'Click a branch to open it · double-click to read it' + (map ? ' · drag to move · Ctrl + wheel to zoom' : '') + (MP.editing() && !MP.phone() ? ' · Tab adds a branch' : '');
    if (map) MP.mapView.render(); else MP.outline.render();
    MP.saveOpen();
  }
  function soon() {                       // while typing a name: one redraw per frame
    if (queued) return; queued = true;
    window.requestAnimationFrame(function () { queued = false; renderView(); });
  }
  function render() { renderView(); MP.editor.render(); }
  function setView(v) { st.view = v; MP.mapView.redraw(); MP.store('view', v); MP.view.wantScroll = true; renderView(); }
  function setEdit(on, quiet) {
    if (!MP.canEdit()) return;
    MP.flush();
    st.edit = on; head(); render();
    if (on && !quiet) Core.toast(MP.coarse() ? 'Edit is on. Tap a branch, then tap it again to change it.' : 'Edit is on. Double-click a branch to write in it; Tab adds a branch under the chosen one.');
  }

  // ---------- moving around ----------
  function hashOf() { var h = ''; try { h = decodeURIComponent(location.hash.slice(1)); } catch (e) { h = ''; } return h; }
  function applyHash(first) {
    var h = hashOf(), at = /^at-/.test(h) ? h.slice(3) : '';
    if (at) {
      if (N(at)) reveal(at, true); else if (first) Core.toast('The branch you followed is not on this map any more.', 'danger');
      return;
    }
    var id = h && N(h) ? h : MP.M.root;
    if (id !== st.focus) { st.focus = id; N(id).open = true; MP.mapView.redraw(); if (st.sel && MP.pathOf(st.sel).indexOf(id) < 0) st.sel = null; MP.view.wantScroll = true; }
  }
  function setHash(h) {
    try { if (hashOf() !== h) { if (h) location.hash = h; else history.pushState(null, '', location.pathname + location.search); } } catch (e) { /* ignore */ }
  }
  function focusOn(id) {
    MP.flush();
    st.focus = id; N(id).open = true; MP.mapView.redraw();
    if (st.sel && MP.pathOf(st.sel).indexOf(id) < 0) st.sel = null;
    setHash(id === MP.M.root ? '' : id);
    render();
  }
  // show a branch wherever it is: open what leads to it and choose it
  function reveal(id, quiet) {
    if (!N(id)) return;
    var p = MP.pathOf(id);
    p.forEach(function (a) { if (a !== id) N(a).open = true; });
    if (p.indexOf(st.focus) < 0) { st.focus = MP.M.root; MP.mapView.redraw(); }
    st.sel = id; MP.view.wantScroll = true;
    if (!quiet) { setHash(st.focus === MP.M.root ? '' : st.focus); render(); }
  }
  // follow a link: a branch of this map, or another map (opened at that branch)
  function follow(l, here) {
    var far = l.from === here ? l.to : l.from;
    if (N(far)) { MP.flush(); if (st.note) MP.editor.close(); reveal(far); return; }
    if (l.other) { MP.settled().then(function () { Core.go('/maps/?map=' + encodeURIComponent(l.other.map_id) + '#at-' + encodeURIComponent(far)); }); return; }
    Core.toast('That branch is not there any more.', 'danger');
  }
  function refocus(id) { var x = document.querySelector('[data-node="' + id + '"]'); if (x && document.activeElement !== x) x.focus({ preventScroll: true }); }
  // choosing a branch only moves the highlight (the page is not redrawn, so a double-click lands on the same branch)
  function pick(n) {
    if (st.sel !== n.id) MP.flush();
    var was = st.sel;
    st.sel = n.id;
    if (st.view === 'map' && st.xlinks !== 'off' && was !== n.id && (MP.hasLines(was) || MP.hasLines(n.id))) { renderView(); refocus(n.id); return; }
    [].forEach.call(document.querySelectorAll('[data-node].mp-sel'), function (x) { x.classList.remove('mp-sel'); x.setAttribute('aria-selected', 'false'); });
    var x = document.querySelector('[data-node="' + n.id + '"]');
    if (!x) { MP.view.wantScroll = true; renderView(); x = document.querySelector('[data-node="' + n.id + '"]'); }
    if (x) { x.classList.add('mp-sel'); x.setAttribute('aria-selected', 'true'); if (x.scrollIntoView) x.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    refocus(n.id);
  }
  function toggle(n) { if (!n.kids.length) return; n.open = !n.open; if (n.open) { st.sel = n.id; MP.view.wantScroll = true; } renderView(); refocus(n.id); }
  function opensAlone(n) { return st.view === 'map' && n.id !== st.focus && MP.columns(n) && !!n._inCol; }
  // one click: open the way to the branch and its next level, close everything else under the centre
  function drill(n) {
    if (opensAlone(n)) { focusOn(n.id); return false; }
    if (st.sel !== n.id) MP.flush();
    var closing = st.sel === n.id && n.open && n.id !== st.focus && n.kids.length > 0, keep = {};
    MP.pathOf(n.id).forEach(function (a) { keep[a] = 1; });
    MP.each(st.focus, function (x) { if (!keep[x.id]) x.open = false; });
    MP.pathOf(n.id).forEach(function (a) { if (a !== n.id) N(a).open = true; });
    n.open = n.id === st.focus || (!closing && n.kids.length > 0);
    var leaf = st.view === 'map' && !n.kids.length && n.id !== st.focus;
    if (leaf && st.peek === n.id && st.sel === n.id) { closing = true; MP.mapView.closePeek(true); }
    else { if (st.peek !== (leaf ? n.id : null)) MP.mapView.resetPeek(); st.peek = leaf ? n.id : null; }
    st.sel = n.id;
    redrawAt(n.id);
    return closing;
  }
  // Ctrl + click and the count button: one branch opens or closes, the others stay as they are
  function toggleOne(n) {
    if (opensAlone(n)) { focusOn(n.id); return; }
    if (!n.kids.length || n.id === st.focus) { pick(n); return; }
    if (st.sel !== n.id) MP.flush();
    n.open = !n.open; st.sel = n.id;
    redrawAt(n.id);
  }
  // redraw with the clicked branch staying where it was on the screen, then bring what it grew into view
  function redrawAt(id) {
    var map = st.view === 'map', box = map ? $('mp-canvas') : $('mp-outline');
    var x0 = box.querySelector('[data-node="' + id + '"]'), r0 = x0 ? x0.getBoundingClientRect() : null;
    MP.view.wantScroll = false;
    renderView();
    var x1 = box.querySelector('[data-node="' + id + '"]');
    if (r0 && x1) { var r1 = x1.getBoundingClientRect(); box.scrollLeft += r1.left - r0.left; box.scrollTop += r1.top - r0.top; }
    if (map) MP.mapView.keepInView(N(id), st.zoom);
    else if (x1 && N(id).open) { var last = box.querySelector('[data-node="' + N(id).kids[N(id).kids.length - 1] + '"]'); if (last && last.scrollIntoView) last.scrollIntoView({ block: 'nearest' }); if (x1.scrollIntoView) x1.scrollIntoView({ block: 'nearest' }); }
    refocus(id);
  }

  // a click on a branch, on the map or in the outline. The second click of a double-click does nothing here.
  var lastClick = { id: null, t: 0, closed: false };
  function click(e, onMap) {
    if (e.detail > 1) return;
    if (e.target.closest && e.target.closest('.mp-peek, .mp-xl')) return;
    var nodeE = e.target.closest ? e.target.closest('[data-node]') : null;
    if (!nodeE) { if (onMap && (st.sel || st.peek)) { st.sel = null; if (st.peek) MP.mapView.closePeek(true); renderView(); } return; }
    var n = N(nodeE.getAttribute('data-node')), act = e.target.closest('[data-act]');
    if (!n) return;
    lastClick = { id: null, t: 0, closed: false };
    if (act && act.getAttribute('data-act') === 'toggle') { toggleOne(n); return; }
    if (act && act.getAttribute('data-act') === 'note') { MP.editor.open(n.id); return; }
    if (act && act.getAttribute('data-act') === 'alone') { focusOn(n.id); return; }
    // a finger has no double-click: a tap on the chosen branch reads it
    if ((MP.coarse() || e.pointerType === 'touch') && st.sel === n.id) { MP.editor.open(n.id); return; }
    if (e.ctrlKey || e.metaKey) { toggleOne(n); return; }
    lastClick = { id: n.id, t: Date.now(), closed: false };
    lastClick.closed = drill(n);
  }
  function dblclick(e) {
    var nodeE = e.target.closest ? e.target.closest('[data-node]') : null;
    var recent = lastClick.id && Date.now() - lastClick.t < 900 && N(lastClick.id) ? lastClick.id : null;
    if (e.target.closest && e.target.closest('[data-act]')) return;
    if (!recent && e.target.closest && e.target.closest('.mp-peek, .mp-xl')) return;
    var id = recent || (nodeE ? nodeE.getAttribute('data-node') : null);
    if (!id) return;
    e.preventDefault();
    if (lastClick.id === id && lastClick.closed) { N(id).open = true; if (!N(id).kids.length && st.view === 'map') st.peek = id; }
    lastClick = { id: null, t: 0, closed: false };
    MP.editor.open(id);
    setTimeout(function () { if (window.getSelection) { try { window.getSelection().removeAllRanges(); } catch (x) { /* ignore */ } } }, 0);
  }
  function key(e, n) {
    if (!n) return;
    var vis = MP.visible(), i = vis.indexOf(n.id), go = null, E = MP.editing() && !(MP.phone() && st.view === 'map');
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); MP.editor.open(n.id); return; }
    if (e.key === 'ArrowDown') go = vis[i + 1];
    else if (e.key === 'ArrowUp') go = vis[i - 1];
    else if (e.key === 'ArrowRight') { if (n.kids.length && !n.open) { e.preventDefault(); toggle(n); return; } go = n.open ? n.kids[0] : null; }
    else if (e.key === 'ArrowLeft') { if (n.open && n.kids.length) { e.preventDefault(); toggle(n); return; } go = n.id !== st.focus ? n.parent : null; }
    else if (e.key === 'Home') go = st.focus;
    else if (e.key === 'Tab' && E && !e.shiftKey) { e.preventDefault(); addBranch(n, 'New branch', true); return; }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && E && n.id !== MP.M.root) { e.preventDefault(); remove(n); return; }
    else if (e.key === 'F2' && E) { e.preventDefault(); MP.editor.open(n.id, 'name'); return; }
    if (go !== null) e.preventDefault();
    if (go && N(go)) pick(N(go));
  }
  function pageKeys(e) {
    if (!MP.M || st.note || document.querySelector('.sheet-back')) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '')) return;
    var map = st.view === 'map';
    if ((e.key === '+' || e.key === '=') && map) { e.preventDefault(); MP.mapView.zoomBy(1.2); }
    else if ((e.key === '-' || e.key === '_') && map) { e.preventDefault(); MP.mapView.zoomBy(1 / 1.2); }
    else if (e.key === '0' && map) { e.preventDefault(); MP.mapView.setZoom(1); }
    else if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); MP.mapView.full(!st.full); }
    else if (e.key === 'Escape' && st.full) { e.preventDefault(); MP.mapView.full(false); }
  }

  // ---------- changes to the structure ----------
  function addBranch(n, title, nameIt) {
    return MP.act(function () { return MP.rpc('maps_branch_add', { p_parent: n.id, p_title: title }); }, function (c) {
      c.kids = []; c.open = false; c.special = c.special || []; c.props = c.props || {};
      MP.M.nodes[c.id] = c; n.kids.push(c.id); n.open = true;
      MP.view.wantScroll = true;
      if (nameIt) { MP.editor.open(c.id, 'name'); return; }
      render();
      var a = $('mp-child'); if (a) { a.value = ''; a.focus(); }
    });
  }
  function remove(n) {
    var c = MP.under(n.id);
    return Core.confirm((c ? 'The branch and the ' + MP.plural(c, 'branch', 'branches') + ' under it go' : 'The branch goes') +
      ' to the trash for 30 days. The owner of the map, a tile admin or the super user can restore it from there.',
      { title: 'Delete ' + n.title + '?', ok: 'Delete branch', danger: true }).then(function (yes) {
      if (!yes) return;
      return MP.act(function () { return MP.rpc('maps_branch_delete', { p_branch: n.id }); }, function () {
        var par = N(n.parent), gone = {};
        MP.each(n.id, function (x) { gone[x.id] = 1; });
        par.kids.splice(par.kids.indexOf(n.id), 1);
        if (gone[st.focus]) { st.focus = MP.M.root; setHash(''); }
        Object.keys(gone).forEach(function (id) { delete MP.M.nodes[id]; });
        MP.M.lines = MP.M.lines.filter(function (l) { return !gone[l.from] && !gone[l.to]; });
        if (st.note && gone[st.note]) st.note = null;
        if (st.peek && gone[st.peek]) st.peek = null;
        st.sel = par.id; render(); refocus(par.id);
        Core.toast('Moved ' + n.title + ' to the trash.', 'success');
      });
    });
  }
  function move(n, parent, index) {
    return MP.act(function () { return MP.rpc('maps_branch_move', { p_branch: n.id, p_parent: parent, p_index: index }); }, function (r) {
      var old = N(n.parent);
      old.kids.splice(old.kids.indexOf(n.id), 1);
      n.parent = r.parent;
      var to = N(r.parent); to.kids = r.order.filter(function (id) { return !!N(id); }); to.open = true;
      to.kids.forEach(function (id, k) { N(id).sort = k; });
      MP.view.wantScroll = true; st.sel = n.id; render();
    });
  }

  // ---------- one map ----------
  function mapState(node, cls) {
    var s = $('mp-state'); Core.clear(s); s.hidden = !node; s.className = cls || '';
    if (node) s.appendChild(node);
    $('mp-work').hidden = !!node; $('mp-meta').hidden = !!node; $('mp-bar').hidden = !!node;
  }
  function notAvailable(msg) {
    $('mp-title').textContent = 'Map'; $('mp-sub').textContent = '';
    mapState(el('div', { class: 'state' }, el('h2', { text: 'Not available' }), el('p', { text: msg }), el('a', { class: 'btn', href: '/maps/', text: 'All maps' })));
  }
  function openMap(id) {
    $('mp-map').hidden = false; $('mp-main').classList.add('mp-wide');
    if (!MP.UUID.test(id)) { notAvailable('The link is not complete.'); return; }
    mapState(el('div', { class: 'loading-veil' }, el('span', { class: 'spin' }), 'Loading the map'));
    MP.rpc('maps_get', { p_map: id }).then(function (r) {
      MP.build(r);
      mapState(null);
      wire();
      applyHash(true);
      head(); render();
    }, function (err) { notAvailable(MP.msg(err)); });
  }
  var wired = false;
  function wire() {
    if (wired) return; wired = true;
    var v = MP.store('view');
    st.view = MP.phone() ? 'outline' : v === 'outline' ? 'outline' : 'map';      // a phone opens on the Outline
    var z = parseFloat(MP.store('zoom:' + MP.M.map.id)); if (z >= 0.3 && z <= 2) st.zoom = z;
    st.special = MP.store('special') === '1';
    var xl = MP.store('xlinks'); if (xl === 'all' || xl === 'off' || xl === 'chosen') st.xlinks = xl;
    if (MP.canEdit() && MP.store('edit-next') === MP.M.map.id) { st.edit = true; st.sel = MP.M.root; }
    MP.store('edit-next', null);
    $('mp-view-map').addEventListener('click', function () { setView('map'); });
    $('mp-view-out').addEventListener('click', function () { setView('outline'); });
    $('mp-read').addEventListener('click', function () { setEdit(false); });
    $('mp-edit').addEventListener('click', function () { setEdit(true); });
    $('mp-import').addEventListener('click', MP.sheets.importSheet);
    $('mp-export').addEventListener('click', MP.sheets.exportSheet);
    $('mp-history').addEventListener('click', function () { MP.sheets.history(null); });
    $('mp-btrash').addEventListener('click', function () { MP.sheets.trash(MP.M.map.id); });
    $('mp-settings').addEventListener('click', MP.sheets.settings);
    $('mp-special').addEventListener('click', function () { st.special = !st.special; MP.store('special', st.special ? '1' : '0'); renderView(); });
    $('mp-xlinks').addEventListener('click', function () {
      st.xlinks = st.xlinks === 'chosen' ? 'all' : st.xlinks === 'all' ? 'off' : 'chosen';
      MP.store('xlinks', st.xlinks); renderView();
      Core.toast(st.xlinks === 'all' ? 'Showing every link.' : st.xlinks === 'off' ? 'Links between branches hidden.' : 'Showing the links of the chosen branch.');
    });
    var timer, q = $('mp-q');
    q.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        st.q = q.value.replace(/\s+/g, ' ').trim().toLowerCase();
        if (st.q) MP.each(st.focus, function (n) { if (MP.matches(n)) MP.pathOf(n.id).forEach(function (a) { if (a !== n.id) N(a).open = true; }); });
        renderView();
      }, 150);
    });
    window.addEventListener('hashchange', function () { applyHash(false); render(); });
    window.addEventListener('beforeunload', function (e) { if (MP.pending()) { MP.flush(); e.preventDefault(); e.returnValue = ''; } });
    document.addEventListener('keydown', pageKeys);
    MP.mapView.wire(); MP.outline.wire(); MP.editor.wire();
  }

  // ---------- start: the guard first ----------
  Core.requireLogin({ tile: MP.TILE }).then(function (me) {
    MP.me = me;
    MP.flags = { editor: me.is_super || me.rights.indexOf('edit') >= 0, verifier: me.is_super || me.rights.indexOf('verify') >= 0, admin: !!me.tile_admin || me.is_super };
    var id = Core.param('map');
    if (id) openMap(id); else MP.list.show();
  });

  MP.page = { head: head, render: render, renderView: renderView, soon: soon, setView: setView, setEdit: setEdit, notAvailable: notAvailable };
  MP.nav = { click: click, dblclick: dblclick, key: key, focusOn: focusOn, reveal: reveal, follow: follow, refocus: refocus, addBranch: addBranch, remove: remove, move: move, pick: pick };
})();
