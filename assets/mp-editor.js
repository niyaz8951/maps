/* Maps tile - the branch panel: one branch read or written, in front of the map (focus mode). Its name, notes,
   special notes, layout, links, the branches linked to it, what grows from it, verify, move, delete, history.
   Text typed is saved by itself shortly after the typing stops, with the version read (the clash guard). */
(function () {
  'use strict';
  var MP = window.MP, el = MP.el, $ = MP.$, st = MP.st, N = MP.N;
  var noteFor = null, noteLast = null, want = '', lastMsg = { id: null, text: '', bad: false };

  function status(text, bad) {
    lastMsg = { id: st.note || st.peek, text: text, bad: !!bad };
    var s = $('mp-status'); if (!s) return;
    s.textContent = text; s.className = 'mp-status' + (bad ? ' bad' : '');
  }
  function foot() {
    var f = $('mp-foot'), n = st.note && N(st.note); if (!f || !n) return;
    f.textContent = n.updated_at ? 'Last changed' + (n.updated_by ? ' by ' + n.updated_by : '') + ', ' + Core.dateTime(n.updated_at) : '';
  }

  function open(id, w) {
    if (!N(id)) return;
    MP.mapView.resetPeek();
    if (st.note !== id) MP.flush();
    if (!st.note) noteLast = document.activeElement;
    st.note = id; st.sel = id; want = w || '';
    render(); MP.page.renderView();
  }
  function close() {
    MP.flush();
    var id = st.note; st.note = null; render();
    MP.view.wantScroll = true; MP.page.renderView();
    MP.nav.refocus(id);
  }
  function step(dir) {
    var o = MP.order(), i = o.indexOf(st.note);
    if (i < 0) { MP.nav.reveal(st.note, true); o = MP.order(); i = o.indexOf(st.note); }
    var to = o[i + dir]; if (!to) return;
    MP.pathOf(to).forEach(function (a) { if (a !== to) N(a).open = true; });
    open(to);
  }
  function toggleEdit() {
    var on = !st.edit;
    MP.page.setEdit(on, true);
    var f = on ? $('mp-notes') || $('mp-name') : $('mp-note-edit');
    if (f) { f.focus({ preventScroll: true }); if (on && f.tagName === 'TEXTAREA') { try { f.setSelectionRange(f.value.length, f.value.length); } catch (x) { /* ignore */ } } }
  }
  function grow(t) { t.style.height = 'auto'; t.style.height = Math.max(160, t.scrollHeight + 2) + 'px'; }
  function adder(id, placeholder, label, max, fn) {
    var inp = el('input', { id: id, placeholder: placeholder, maxlength: String(max), autocomplete: 'off' });
    function go() { var v = inp.value.replace(/\s+/g, ' ').trim(); if (!v) { inp.focus(); return; } fn(v, inp); }
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    return el('div', { class: 'mp-add' }, inp, el('button', { type: 'button', class: 'btn', text: label, on: { click: go } }));
  }
  function section(title) { return el('section', { class: 'mp-nsec' }, el('h3', { text: title })); }

  // ---------- links ----------
  function lineText(l, from) {
    if (l.kind === 'web') { var host = ''; try { host = new URL(l.target).hostname.replace(/^www\./, ''); } catch (e) { host = 'Web'; } return host; }
    var r = MP.rel(l.rel);
    return (from ? r.label : r.back) + (l.other ? ' · ' + l.other.map : '');
  }
  function lineNode(l, fromHere) {
    var far = fromHere ? l.to : l.from, title;
    if (l.kind === 'web') {
      if (!/^https:\/\/[^\s<>"']+$/i.test(l.target || '')) return el('span', { class: 'mp-link', text: l.label || 'Web link' });
      return el('a', { class: 'mp-link', href: l.target, target: '_blank', rel: 'noopener noreferrer' }, MP.ico('link'),
        el('span', { class: 't', text: l.label || l.target }), el('small', { text: lineText(l, true) }));
    }
    title = N(far) ? N(far).title : l.other ? l.other.title : '';
    return el('button', { type: 'button', class: 'mp-link', on: { click: function () { MP.nav.follow(l, fromHere ? l.from : l.to); } } },
      el('i', { class: 'mp-relsw x-' + MP.rel(l.rel).id, 'aria-hidden': 'true' }),
      el('span', { class: 't', text: fromHere && l.label ? l.label : title }), el('small', { text: lineText(l, fromHere) }));
  }
  function relOptions() { return MP.RELS.map(function (r) { return el('option', { value: r.id, text: r.label }); }); }

  // ---------- what changed since it was verified ----------
  function lineWords(x) { return x.kind === 'web' ? 'Web link: ' + (x.label || x.target) : MP.rel(x.rel).label + ': ' + (x.to_title || 'a branch') + (x.label ? ' ("' + x.label + '")' : ''); }
  function nowFact(n) {
    return { title: n.title, notes: n.notes, special: n.special, props: n.props,
      lines: MP.linesFrom(n.id).map(function (l) { return { kind: l.kind, rel: l.rel, label: l.label, target: l.target, to_title: N(l.to) ? N(l.to).title : l.other ? l.other.title : '' }; }) };
  }
  // lines of text: kept, removed (-), added (+), by the longest common run (notes are at most 8000 characters)
  function lineDiff(a, b) {
    var A = a ? a.split('\n') : [], B = b ? b.split('\n') : [], n = A.length, m = B.length, L = [], i, j, out = [];
    for (i = 0; i <= n; i++) { L.push(new Array(m + 1).fill(0)); }
    for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    i = 0; j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { out.push([' ', A[i]]); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) out.push(['-', A[i++]]);
      else out.push(['+', B[j++]]);
    }
    while (i < n) out.push(['-', A[i++]]);
    while (j < m) out.push(['+', B[j++]]);
    return out;
  }
  function diffBlock(n) {
    var was = MP.M.facts[n.id]; if (!was) return null;
    var now = nowFact(n), box = el('div', { class: 'mp-diff' }), any = false;
    function row(label, node) { any = true; box.appendChild(el('div', { class: 'mp-drow' }, el('b', { text: label }), node)); }
    if (was.title !== now.title) row('Name', el('span', {}, el('del', { text: was.title }), ' → ', el('ins', { text: now.title })));
    if ((was.notes || '') !== (now.notes || '')) {
      var pre = el('div', { class: 'mp-dlines' });
      lineDiff(was.notes || '', now.notes || '').forEach(function (d) {
        if (d[0] === ' ' && pre.childNodes.length > 40) return;
        pre.appendChild(el('div', { class: d[0] === '-' ? 'mp-del' : d[0] === '+' ? 'mp-ins' : 'same', text: (d[0] === ' ' ? '  ' : d[0] + ' ') + d[1] }));
      });
      row('Notes', pre);
    }
    var ws = was.special || [], ns = now.special || [];
    var gone = ws.filter(function (s) { return ns.indexOf(s) < 0; }), added = ns.filter(function (s) { return ws.indexOf(s) < 0; });
    if (gone.length || added.length) row('Special notes', el('div', {}, gone.map(function (s) { return el('div', { class: 'mp-del', text: '- ' + s }); }),
      added.map(function (s) { return el('div', { class: 'mp-ins', text: '+ ' + s }); })));
    if (((was.props || {}).layout || 'tree') !== ((now.props || {}).layout || 'tree')) row('Layout', el('span', { text: ((was.props || {}).layout || 'tree') + ' → ' + ((now.props || {}).layout || 'tree') }));
    var wl = (was.lines || []).map(lineWords), nl = now.lines.map(lineWords);
    var lg = wl.filter(function (s) { return nl.indexOf(s) < 0; }), la = nl.filter(function (s) { return wl.indexOf(s) < 0; });
    if (lg.length || la.length) row('Links', el('div', {}, lg.map(function (s) { return el('div', { class: 'mp-del', text: '- ' + s }); }),
      la.map(function (s) { return el('div', { class: 'mp-ins', text: '+ ' + s }); })));
    return any ? box : el('p', { class: 'muted', text: 'Only the order or the details of its links changed.' });
  }

  // ---------- the panel ----------
  function render() {
    var back = $('mp-note-back'), box = $('mp-note'), n = st.note && N(st.note);
    if (!n) { back.hidden = true; Core.clear(box); noteFor = null; document.documentElement.classList.toggle('mp-noscroll', !!st.full); return; }
    back.hidden = false; document.documentElement.classList.add('mp-noscroll');
    var keep = noteFor === n.id ? box.scrollTop : 0, had = document.activeElement && box.contains(document.activeElement) ? document.activeElement.id : '';
    noteFor = n.id;
    Core.clear(box);
    box.setAttribute('aria-label', n.title);
    var E = MP.editing(), isRoot = MP.isRoot(n.id), o = MP.order(), at = o.indexOf(n.id);
    var trail = MP.pathOf(n.id).slice(0, -1);
    var clashed = MP.clashed && MP.clashed.id === n.id, failed = MP.failed && MP.failed.id === n.id;
    // top: where it is, place in the reading order, edit, close
    box.appendChild(el('div', { class: 'mp-ntop' },
      el('nav', { class: 'mp-ntrail', 'aria-label': 'Where this branch is' }, trail.map(function (id, i) {
        return el('span', {}, i ? el('span', { class: 'sep', text: '›' }) : null, el('button', { type: 'button', text: N(id).title, on: { click: function () { open(id); } } }));
      })),
      el('div', { class: 'mp-nnav' },
        at >= 0 ? el('span', { class: 'faint', text: (at + 1) + ' of ' + o.length }) : null,
        el('button', { type: 'button', class: 'btn ghost small', text: '‹ Previous', title: 'Previous branch (Alt + ←)', disabled: at <= 0, on: { click: function () { step(-1); } } }),
        el('button', { type: 'button', class: 'btn ghost small', text: 'Next ›', title: 'Next branch (Alt + →)', disabled: at < 0 || at >= o.length - 1, on: { click: function () { step(1); } } }),
        MP.canEdit() ? el('button', { type: 'button', class: 'btn small' + (E ? ' primary' : ' ghost'), id: 'mp-note-edit', 'aria-pressed': E ? 'true' : 'false',
          text: E ? 'Done' : 'Edit', title: E ? 'Stop editing (E)' : 'Edit this branch (E)', on: { click: toggleEdit } }) : null,
        el('button', { type: 'button', class: 'btn small', text: 'Close', title: 'Close (Esc)', on: { click: close } }))));
    // a save refused because someone changed the branch meanwhile
    if (clashed) {
      box.appendChild(el('div', { class: 'notice warning mp-clash', role: 'alert' },
        el('p', { text: 'Not saved: this branch was ' + MP.clashed.text }),
        el('div', { class: 'row' },
          el('button', { type: 'button', class: 'btn small', text: 'Copy my text', on: { click: function () { copyMine(MP.clashed.patch); } } }),
          el('button', { type: 'button', class: 'btn small primary', text: 'Reload', on: { click: function () { MP.reload(); } } }))));
    } else if (failed) {
      box.appendChild(el('div', { class: 'notice danger', role: 'alert' }, el('span', { text: 'Not saved yet. ' + MP.failed.text + ' ' }),
        el('button', { type: 'button', class: 'btn small', text: 'Save again', on: { click: MP.retry } })));
    }
    // the name
    if (E && !clashed) {
      var name = el('input', { class: 'mp-ntitle-in', id: 'mp-name', value: n.title, maxlength: isRoot ? '80' : '120', autocomplete: 'off',
        disabled: isRoot && !MP.canManage(), 'aria-label': isRoot ? 'Map name' : 'Branch name' });
      name.addEventListener('input', function () {
        var v = name.value.replace(/\s+/g, ' ').trim();
        if (!v) { status('Give the branch a name.', true); return; }
        MP.typed(n.id, 'title', v); MP.page.soon();
      });
      name.addEventListener('blur', function () { if (!name.value.trim()) { name.value = n.title; status(''); } MP.flush(); });
      name.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); var t = $('mp-notes'); if (t) t.focus(); } });
      box.appendChild(name);
    } else box.appendChild(el('h2', { class: 'mp-ntitle', id: 'mp-ntitle', text: n.title }));
    // verification
    var word = MP.statusWord(n);
    box.appendChild(el('div', { class: 'row mp-nstate' },
      isRoot ? el('span', { class: 'badge', text: MP.KIND[MP.M.map.kind] + ' map' }) :
        el('span', { class: 'badge ' + (n.status === 'verified' ? 'success' : 'warning'), text: word }),
      !isRoot && n.status !== 'to_verify' && n.verified_by ? el('span', { class: 'faint', text: 'verified by ' + n.verified_by + (n.verified_at ? ', ' + Core.date(n.verified_at) : '') }) : null,
      E && !clashed ? el('span', { class: 'mp-status', id: 'mp-status', role: 'status' }) : null));
    if (E && lastMsg.id === n.id && lastMsg.text) status(lastMsg.text, lastMsg.bad);
    if (!isRoot && n.status === 'changed') {
      var dsec = section('Changed since it was verified');
      dsec.classList.add('mp-changed');
      dsec.appendChild(diffBlock(n));
      box.appendChild(dsec);
    }
    // notes: the heart of it
    var notes;
    if (E && !clashed) {
      notes = el('textarea', { class: 'mp-ntext-in', id: 'mp-notes', maxlength: '8000', placeholder: 'What to know about ' + n.title + '...', 'aria-label': 'Notes' });
      notes.value = n.notes;
      notes.addEventListener('input', function () { MP.typed(n.id, 'notes', notes.value); grow(notes); });
      notes.addEventListener('blur', MP.flush);
    } else notes = n.notes ? el('div', { class: 'mp-ntext', text: n.notes }) : n.special.length ? null : el('p', { class: 'muted', text: 'No notes on this branch.' });
    if (notes) box.appendChild(notes);
    // special notes (for people)
    if (n.special.length || (E && !clashed)) {
      var sp = section('Special notes');
      if (n.special.length) sp.appendChild(el('div', { class: 'mp-chips' }, n.special.map(function (s, i) {
        return el('span', { class: 'mp-chip' }, el('b', { text: '!' }), s,
          E && !clashed ? el('button', { type: 'button', 'aria-label': 'Remove special note: ' + s, text: '×', on: { click: function () { MP.setList(n, 'special', n.special.filter(function (x, j) { return j !== i; })); } } }) : null);
      })));
      if (E && !clashed) sp.appendChild(adder('mp-special-in', 'e.g. 50 Hz for Egypt, or Terms: air tightness, casing leakage', 'Add', 200, function (v, inp) {
        if (n.special.length >= 20) { Core.toast('A branch holds up to 20 special notes.', 'danger'); return; }
        MP.setList(n, 'special', n.special.concat([v])); var again = $('mp-special-in'); if (again) again.focus();
        inp.value = '';
      }));
      box.appendChild(sp);
    }
    // layout of what grows from it
    if (E && !clashed && n.kids.length) {
      var lay = MP.select('mp-layout', [['tree', 'Tree: each level to the right'], ['columns', 'Columns: its branches side by side, each with a list under it']], n.props.layout || 'tree');
      lay.addEventListener('change', function () {
        var p = {}; for (var k in n.props) p[k] = n.props[k];
        if (lay.value === 'columns') p.layout = 'columns'; else delete p.layout;
        MP.setList(n, 'props', p);
      });
      var ls = section('Layout on the map'); ls.appendChild(lay); box.appendChild(ls);
    }
    // links from it
    var out = MP.linesFrom(n.id).filter(function (l) { return l.kind === 'link' || l.kind === 'web'; });
    if (out.length || (E && !clashed)) {
      var lsec = section('Links');
      out.forEach(function (l) {
        if (!(E && !clashed)) { lsec.appendChild(lineNode(l, true)); return; }
        var kind = null;
        if (l.kind === 'link') {
          kind = el('select', { class: 'mp-relsel', 'aria-label': 'What the link means' }, relOptions());
          kind.value = MP.rel(l.rel).id;
          kind.addEventListener('change', function () {
            MP.act(function () { return MP.rpc('maps_line_save', { p_line: l.id, p_version: l.version, p_rel: kind.value, p_label: null }); },
              function () { return MP.reload(); });
          });
        }
        lsec.appendChild(el('div', { class: 'mp-linkrow' }, lineNode(l, true), kind,
          el('button', { type: 'button', class: 'btn ghost small', text: 'Remove', 'aria-label': 'Remove the link ' + (l.label || ''),
            on: { click: function () { MP.act(function () { return MP.rpc('maps_line_delete', { p_line: l.id }); }, function () { return MP.reload(); }); } } })));
      });
      if (E && !clashed) lsec.appendChild(el('div', {}, el('button', { type: 'button', class: 'btn ghost small', text: 'Add link', on: { click: function () { MP.sheets.link(n); } } })));
      box.appendChild(lsec);
    }
    // the other end: branches that link here (this map and others the reader may open)
    var inbound = MP.linesTo(n.id);
    if (inbound.length) {
      var isec = section('Linked from');
      inbound.forEach(function (l) { isec.appendChild(lineNode(l, false)); });
      box.appendChild(isec);
    }
    // what grows from it
    if (n.kids.length || (E && !clashed)) {
      var kids = section(n.kids.length ? MP.plural(n.kids.length, 'branch', 'branches') + ' under it' : 'Branches under it');
      if (n.kids.length) kids.appendChild(el('ul', { class: 'mp-nkids' }, n.kids.map(function (k) {
        var c = N(k);
        return el('li', {}, el('button', { type: 'button', class: c.status === 'verified' ? '' : 'unv', on: { click: function () { n.open = true; open(k); } } },
          el('span', { text: c.title }), c.notes ? MP.ico('note') : null, c.kids.length ? el('small', { text: String(c.kids.length) }) : null));
      })));
      if (E && !clashed) kids.appendChild(adder('mp-child', 'Name of a new branch under ' + n.title, 'Add', 120, function (v) { MP.nav.addBranch(n, v, false); }));
      box.appendChild(kids);
    }
    // this branch: alone, verify, move, delete, history
    var tools = [];
    if (n.id !== st.focus && n.kids.length) tools.push(el('button', { type: 'button', class: 'btn ghost small', text: 'Show this branch alone', on: { click: function () { var id = n.id; close(); MP.nav.focusOn(id); } } }));
    if (MP.canVerify()) {
      var below = 0; MP.each(n.id, function (x) { if (x.id !== n.id && x.status !== 'verified') below++; });
      if (n.status !== 'verified') tools.push(el('button', { type: 'button', class: 'btn small primary', text: n.status === 'changed' ? 'Verify the change' : 'Mark as verified', on: { click: function () { verify(n, true, false); } } }));
      if (below) tools.push(el('button', { type: 'button', class: 'btn ghost small', text: 'Verify it and the ' + MP.plural(below, 'branch', 'branches') + ' under it', on: { click: function () { verify(n, true, true); } } }));
    }
    if (n.status !== 'to_verify' && !isRoot && (MP.canEdit() || MP.canVerify())) tools.push(el('button', { type: 'button', class: 'btn ghost small', text: 'Mark to verify', on: { click: function () { verify(n, false, false); } } }));
    if (E && !isRoot) {
      var sibs = N(n.parent).kids, pos = sibs.indexOf(n.id);
      tools.push(el('button', { type: 'button', class: 'btn ghost small', text: 'Move up', disabled: pos <= 0, on: { click: function () { MP.nav.move(n, n.parent, pos - 1); } } }));
      tools.push(el('button', { type: 'button', class: 'btn ghost small', text: 'Move down', disabled: pos < 0 || pos >= sibs.length - 1, on: { click: function () { MP.nav.move(n, n.parent, pos + 1); } } }));
      tools.push(el('button', { type: 'button', class: 'btn ghost small', text: 'Move to...', on: { click: function () { MP.sheets.moveTo(n); } } }));
      tools.push(el('button', { type: 'button', class: 'btn danger small', text: 'Delete branch', on: { click: function () { MP.nav.remove(n); } } }));
    }
    tools.push(el('button', { type: 'button', class: 'btn ghost small', text: 'History of this branch', on: { click: function () { MP.sheets.history(n.id); } } }));
    var tsec = section('This branch'); tsec.appendChild(el('div', { class: 'row' }, tools)); box.appendChild(tsec);
    box.appendChild(el('p', { class: 'mp-foot', id: 'mp-foot' }));
    foot();
    box.scrollTop = keep;
    if (notes && notes.tagName === 'TEXTAREA') grow(notes);
    var f = had && $(had) ? $(had) : want === 'name' && $('mp-name') ? $('mp-name') : null;
    if (f) { f.focus(); if (want === 'name' && f.select) f.select(); }
    else if (!box.contains(document.activeElement)) box.focus({ preventScroll: true });
    want = '';
  }

  function copyMine(patch) {
    var text = [patch.title, patch.notes].filter(function (x) { return typeof x === 'string' && x; }).join('\n\n');
    if (!text) { Core.toast('Nothing typed to copy.'); return; }
    try { navigator.clipboard.writeText(text).then(function () { Core.toast('Your text is copied.', 'success'); }, function () { Core.toast('Copy did not work. Select the text and copy it.', 'danger'); }); }
    catch (e) { Core.toast('Copy did not work. Select the text and copy it.', 'danger'); }
  }

  function verify(n, on, deep) {
    MP.act(function () { return MP.rpc('maps_verify', { p_branch: n.id, p_on: on, p_deep: deep }); }, function (r) {
      Core.toast(on ? (r.changed ? MP.plural(r.changed, 'branch', 'branches') + ' verified.' : 'Already verified.') : 'Marked to verify.', 'success');
      return MP.reload();
    });
  }

  function wire() {
    var back = $('mp-note-back'), downOn = null;
    back.addEventListener('mousedown', function (e) { downOn = e.target; });
    back.addEventListener('click', function (e) { if (e.target === back && downOn === back) close(); });
    document.addEventListener('keydown', function (e) {
      if (!st.note || document.querySelector('.sheet-back')) return;
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '');
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      else if (!typing && (e.key === 'ArrowRight' || e.key === 'j')) { e.preventDefault(); step(1); }
      else if (!typing && (e.key === 'ArrowLeft' || e.key === 'k')) { e.preventDefault(); step(-1); }
      else if (!typing && (e.key === 'e' || e.key === 'E') && !e.ctrlKey && !e.metaKey && !e.altKey && MP.canEdit()) { e.preventDefault(); toggleEdit(); }
    });
  }

  MP.editor = { open: open, close: close, render: render, status: status, foot: foot, wire: wire, lineDiff: lineDiff };
})();
