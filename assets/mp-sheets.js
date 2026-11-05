/* Maps tile - the sheets: add a link, move a branch, import, export, map settings, trash, history. */
(function () {
  'use strict';
  var MP = window.MP, el = MP.el, $ = MP.$, st = MP.st, N = MP.N;

  function errBox() { return el('p', { class: 'notice danger', role: 'alert', hidden: true }); }
  function fail(box, text) { box.textContent = text; box.hidden = false; return false; }

  // every branch of a map, indented, for a select (skip: a branch and what is under it)
  function branchOptions(nodes, rootId, skip) {
    var out = [];
    (function walk(id, d) {
      var n = nodes[id]; if (!n || id === skip) return;
      out.push(el('option', { value: id, text: new Array(d + 1).join(' ') + n.title }));
      n.kids.forEach(function (k) { walk(k, d + 1); });
    })(rootId, 0);
    return out;
  }

  // ---------- add a link ----------
  var otherMaps = null;
  function link(n) {
    if (MP.linesFrom(n.id).length >= 20) { Core.toast('A branch holds up to 20 links. Remove one first.', 'danger'); return; }
    var err = errBox(), area = el('div', { class: 'stack' });
    var kind = MP.select('mp-link-kind', [['link', 'Another branch'], ['web', 'A web address']], 'link');
    var label = el('input', { id: 'mp-link-label', maxlength: '120', placeholder: 'Leave empty to show the name of what it leads to', autocomplete: 'off' });
    var get = function () { return null; };
    function draw() {
      Core.clear(area); err.hidden = true;
      if (kind.value === 'link') {
        var mapSel = el('select', { id: 'mp-link-map' }, el('option', { value: MP.M.map.id, text: MP.M.map.name + ' (this map)' }));
        var brSel = el('select', { id: 'mp-link-branch' }, branchOptions(MP.M.nodes, MP.M.root, null).filter(function (o) { return o.value !== n.id; }));
        var relSel = el('select', { id: 'mp-link-rel' }, MP.RELS.map(function (r) { return el('option', { value: r.id, text: r.label }); }));
        relSel.value = 'see';
        var hint = el('p', { class: 'hint' });
        var say = function () {
          var r = MP.rel(relSel.value), o = brSel.options[brSel.selectedIndex], to = o && o.value ? o.text.trim() : 'the branch';
          hint.textContent = n.title + ' ' + r.label.toLowerCase() + ' ' + to + '. ' + r.hint;
        };
        relSel.addEventListener('change', say); brSel.addEventListener('change', say); say();
        area.appendChild(MP.field('Map', mapSel)); area.appendChild(MP.field('Branch', brSel));
        area.appendChild(el('div', { class: 'field' }, el('label', { for: 'mp-link-rel', text: 'What the link means' }), relSel, hint));
        (otherMaps ? Promise.resolve(otherMaps) : MP.rpc('maps_list').then(function (r) { otherMaps = r.maps; return otherMaps; })).then(function (list) {
          list.forEach(function (m) { if (m.id !== MP.M.map.id) mapSel.appendChild(el('option', { value: m.id, text: m.name })); });
        }, function () { /* this map is enough */ });
        mapSel.addEventListener('change', function () {
          Core.clear(brSel); err.hidden = true;
          if (mapSel.value === MP.M.map.id) { branchOptions(MP.M.nodes, MP.M.root, null).forEach(function (o) { if (o.value !== n.id) brSel.appendChild(o); }); say(); return; }
          brSel.appendChild(el('option', { value: '', text: 'Loading...' }));
          MP.rpc('maps_get', { p_map: mapSel.value }).then(function (r) {
            var nodes = {}, root = null;
            r.branches.forEach(function (x) { x.kids = []; nodes[x.id] = x; });
            r.branches.forEach(function (x) { if (x.parent && nodes[x.parent]) nodes[x.parent].kids.push(x.id); else if (!x.parent) root = x.id; });
            Object.keys(nodes).forEach(function (id) { nodes[id].kids.sort(function (a, b) { return nodes[a].sort - nodes[b].sort; }); });
            Core.clear(brSel); branchOptions(nodes, root, null).forEach(function (o) { brSel.appendChild(o); }); say();
          }, function (e) { Core.clear(brSel); fail(err, MP.msg(e)); });
        });
        get = function () {
          if (!brSel.value) return 'Choose the branch to link to.';
          return { p_kind: 'link', p_rel: relSel.value, p_to: brSel.value, p_target: null };
        };
      } else {
        var url = el('input', { id: 'mp-link-url', type: 'url', maxlength: '500', placeholder: 'https://', autocomplete: 'off' });
        area.appendChild(MP.field('Web address', url, 'It opens in a new tab. Only https:// addresses.'));
        get = function () {
          var v = url.value.trim();
          return /^https:\/\/[^\s<>"']+$/i.test(v) && v.length >= 12 ? { p_kind: 'web', p_rel: null, p_to: null, p_target: v } : 'A web link starts with https:// and has no spaces.';
        };
      }
    }
    kind.addEventListener('change', draw); draw();
    var body = el('div', { class: 'stack' }, MP.field('Leads to', kind), area, MP.field('Text shown', label), err);
    Core.sheet({ title: 'Add a link from ' + n.title, body: body, actions: [{ label: 'Cancel', value: null }, { label: 'Add link', kind: 'primary', onClick: function () {
      var p = get();
      if (typeof p === 'string' || !p) return fail(err, p || 'Choose what the link leads to.');
      p.p_from = n.id; p.p_label = label.value.replace(/\s+/g, ' ').trim();
      return MP.settled().then(function () { return MP.rpc('maps_line_add', p); }).then(function () {
        MP.reload(); return true;
      }, function (e) { return fail(err, MP.msg(e)); });
    } }] });
  }

  // ---------- move a branch under another one ----------
  function moveTo(n) {
    var err = errBox();
    var sel = el('select', { id: 'mp-move-to' }, branchOptions(MP.M.nodes, MP.M.root, n.id));
    sel.value = n.parent;
    var body = el('div', { class: 'stack' }, MP.field('Under', sel, 'It goes last among the branches there, with everything under it.'), err);
    Core.sheet({ title: 'Move ' + n.title, body: body, actions: [{ label: 'Cancel', value: null }, { label: 'Move', kind: 'primary', onClick: function () {
      if (sel.value === n.parent) return true;
      return MP.nav.move(n, sel.value, null).then(function () { return true; });
    } }] });
  }

  // ---------- import ----------
  function importSheet() {
    var target = N(st.sel || st.focus);
    var ta = el('textarea', { id: 'mp-import-text', spellcheck: 'false', class: 'mp-io-text',
      placeholder: 'Components\n  Compressor\n    > Raises the refrigerant pressure.\n    ! Check the starting current\n  Evaporator\nStandards\n  AHRI 550/590' });
    var file = el('input', { type: 'file', id: 'mp-import-file', accept: '.txt,text/plain' });
    var info = el('p', { class: 'muted' }), err = errBox();
    function count() {
      var p = MP.io.parse(ta.value), s = 0; p.items.forEach(function (i) { s += i.special.length; });
      info.textContent = !p.items.length ? 'Paste an outline, or choose a .txt file, to see what it adds.'
        : 'Adds ' + MP.plural(p.items.length, 'branch', 'branches') + ' and ' + MP.plural(s, 'special note') + ' under ' + target.title + ', all marked to verify.'
          + (p.typed ? ' ' + MP.plural(p.typed, 'value') + ' (Layout, Place) read as typed values.' : '')
          + (p.cut ? ' ' + MP.plural(p.cut, 'text') + ' longer than the limit will be cut.' : '');
      return p;
    }
    ta.addEventListener('input', count);
    file.addEventListener('change', function () {
      var f = file.files && file.files[0]; if (!f) return;
      if (f.size > 2 * 1024 * 1024) { fail(err, 'Choose a text file under 2 MB.'); return; }
      var r = new FileReader();
      r.onload = function () { ta.value = String(r.result || ''); count(); };
      r.onerror = function () { fail(err, 'The file could not be read.'); };
      r.readAsText(f);
    });
    count();
    var body = el('div', { class: 'stack' },
      el('p', { class: 'muted', text: 'One branch per line, two spaces deeper for a branch under it. A line starting with > is a note, with ! a special note. An Export from the old Maps tool reads as it is. To import somewhere else, close this and choose that branch first.' }),
      ta, MP.field('Or a text file', file), info, err);
    Core.sheet({ title: 'Import under ' + target.title, body: body, actions: [{ label: 'Cancel', value: null }, { label: 'Add to map', kind: 'primary', onClick: function () {
      var p = count(); err.hidden = true;
      if (!p.items.length) return fail(err, 'Nothing to add. Paste an outline with one branch name per line.');
      if (p.items.length > 500) return fail(err, 'One import holds up to 500 branches. This outline has ' + p.items.length + '. Import it in parts.');
      return MP.settled().then(function () { return MP.rpc('maps_import', { p_parent: target.id, p_items: p.items }); }).then(function (r) {
        MP.reload(function () { if (N(target.id)) N(target.id).open = true; if (r.first && N(r.first)) MP.nav.reveal(r.first, true); });
        Core.toast('Added ' + MP.plural(r.added, 'branch', 'branches') + ' under ' + target.title + '.', 'success');
        return true;
      }, function (e) { return fail(err, MP.msg(e)); });
    } }] });
  }

  // ---------- export ----------
  function exportSheet() {
    var n = N(st.focus);
    MP.flush();
    var text = MP.io.write(function (id) { return N(id); }, n.id);
    var ta = el('textarea', { id: 'mp-export-text', class: 'mp-io-text', readonly: true, spellcheck: 'false' }); ta.value = text;
    var body = el('div', { class: 'stack' },
      el('p', { class: 'muted', text: (n.id === MP.M.root ? 'The whole map' : 'This branch and everything under it') + ' as a plain outline: names, notes (>) and special notes (!), with Layout and Place. Links stay on the map. To export one branch, show it alone first.' }),
      ta);
    Core.sheet({ title: 'Export ' + n.title, body: body, actions: [
      { label: 'Close', value: null },
      { label: 'Download .txt', onClick: function () { Core.download(MP.fileName(n.title) + ' - outline.txt', new Blob(['﻿' + text.replace(/\n/g, '\r\n')], { type: 'text/plain;charset=utf-8' })); return false; } },
      { label: 'Copy', kind: 'primary', onClick: function () {
        try { navigator.clipboard.writeText(text).then(function () { Core.toast('Copied.', 'success'); }, function () { ta.focus(); ta.select(); Core.toast('Press Ctrl+C to copy the selected text.'); }); }
        catch (e) { ta.focus(); ta.select(); Core.toast('Press Ctrl+C to copy the selected text.'); }
        return false;
      } }] });
  }

  // ---------- map settings (whoever manages the map) ----------
  function settings() {
    var m = MP.M.map, err = errBox();
    var name = el('input', { id: 'mp-set-name', value: m.name, maxlength: '80', autocomplete: 'off' });
    var share = MP.shareSelect('mp-set-share', m.share, m.mine || m.share === 'private');
    var body = el('div', { class: 'stack' },
      MP.field('Map name', name),
      MP.field('Shared with', share, MP.SHARE_HINT + (m.mine ? '' : ' Only its owner can make it private again.')),
      el('p', { class: 'faint', text: MP.KIND[m.kind] + ' map, by ' + (m.mine ? 'you' : m.owner) + '.' }), err);
    Core.sheet({ title: 'Map settings', body: body, actions: [
      { label: 'Delete map', kind: 'danger', onClick: function () {
        var b = MP.under(MP.M.root);
        return Core.confirm('The map and its ' + MP.plural(b, 'branch', 'branches') + ' go to the trash for 30 days. Its owner, a tile admin or the super user can restore it from there.',
          { title: 'Delete ' + m.name + '?', ok: 'Delete map', danger: true }).then(function (yes) {
          if (!yes) return false;
          return MP.settled().then(function () { return MP.rpc('maps_map_delete', { p_map: m.id }); }).then(function () {
            Core.toast('Moved to the trash.', 'success'); Core.go('/maps/'); return true;
          }, function (e) { MP.toastErr(e); return false; });
        });
      } },
      { label: 'Cancel', value: null },
      { label: 'Save', kind: 'primary', onClick: function () {
        var v = name.value.replace(/\s+/g, ' ').trim(); err.hidden = true;
        if (!v) return fail(err, 'Give the map a name, usually the product.');
        if (v === m.name && share.value === m.share) return true;
        return MP.settled().then(function () {
          return MP.rpc('maps_map_save', { p_map: m.id, p_version: m.version, p_name: v === m.name ? null : v, p_share: share.value === m.share ? null : share.value });
        }).then(function () { Core.toast('Map settings saved.', 'success'); MP.reload(); return true; },
          function (e) { return fail(err, MP.msg(e)); });
      } }] });
  }

  // ---------- trash: maps and branches, 30 days ----------
  function daysLeft(until) { var d = Math.ceil((new Date(until).getTime() - Date.now()) / 86400000); return d <= 1 ? 'goes for good tomorrow' : d + ' days left'; }
  function trash(mapId) {
    var body = el('div', { class: 'stack' }, el('div', { class: 'loading-veil' }, el('span', { class: 'spin' }), 'Loading'));
    function draw() {
      return MP.rpc('maps_trash', { p_map: mapId || null }).then(function (r) {
        Core.clear(body);
        if (!r.maps.length && !r.branches.length) { body.appendChild(el('p', { class: 'muted', text: 'Nothing in the trash' + (mapId ? ' of this map.' : '.') })); return; }
        body.appendChild(el('p', { class: 'muted', text: 'Deleted maps and branches stay here for 30 days. The owner of the map, a tile admin or the super user can restore them.' }));
        if (r.maps.length) {
          body.appendChild(el('h3', { class: 'section-title', text: 'Maps' }));
          r.maps.forEach(function (m) {
            body.appendChild(el('div', { class: 'mp-trow' },
              el('div', { class: 'grow' }, el('b', { text: m.name }), el('div', { class: 'faint', text: MP.plural(m.branches, 'branch', 'branches') + ' · deleted ' + Core.date(m.deleted_at) + (m.deleted_by ? ' by ' + m.deleted_by : '') + ' · ' + daysLeft(m.until) })),
              el('button', { type: 'button', class: 'btn small', text: 'Restore', on: { click: function (e) {
                Core.busy(e.currentTarget, function () { return MP.rpc('maps_map_restore', { p_map: m.id }); }).then(function (x) {
                  Core.toast('Restored ' + x.name + '.', 'success');
                  if (MP.list && !MP.M) MP.list.load();
                  return draw();
                }, MP.toastErr);
              } } })));
          });
        }
        if (r.branches.length) {
          body.appendChild(el('h3', { class: 'section-title', text: 'Branches' }));
          r.branches.forEach(function (b) {
            body.appendChild(el('div', { class: 'mp-trow' },
              el('div', { class: 'grow' }, el('b', { text: b.title }),
                el('div', { class: 'faint', text: (mapId ? '' : b.map + ' · ') + 'under ' + (b.parent_title || '') + (b['with'] ? ' · with ' + MP.plural(b['with'], 'branch', 'branches') + ' under it' : '')
                  + ' · deleted ' + Core.date(b.deleted_at) + (b.deleted_by ? ' by ' + b.deleted_by : '') + ' · ' + daysLeft(b.until) }),
                b.parent_gone ? el('div', { class: 'faint', text: 'Restore ' + (b.parent_title || 'the branch it was under') + ' first.' }) : null),
              el('button', { type: 'button', class: 'btn small', text: 'Restore', disabled: b.parent_gone, on: { click: function (e) {
                Core.busy(e.currentTarget, function () { return MP.rpc('maps_branch_restore', { p_branch: b.id }); }).then(function (x) {
                  Core.toast('Restored ' + b.title + (x.restored > 1 ? ' with ' + MP.plural(x.restored - 1, 'branch', 'branches') + ' under it' : '') + '.', 'success');
                  if (MP.M && MP.M.map.id === b.map_id) MP.reload(function () { if (N(b.id)) MP.nav.reveal(b.id, true); });
                  return draw();
                }, MP.toastErr);
              } } })));
          });
        }
      }, function (e) { Core.clear(body); body.appendChild(el('p', { class: 'notice danger', text: MP.msg(e) })); });
    }
    MP.settled().then(draw);
    Core.sheet({ title: mapId ? 'Trash of this map' : 'Trash', body: body, actions: [{ label: 'Close', kind: 'primary', value: null }] });
  }

  // ---------- history: what changed, who, when ----------
  var ACTIONS = { map_create: 'Made the map', map_settings: 'Changed the map settings', map_delete: 'Deleted the map', map_restore: 'Restored the map',
    branch_add: 'Added', branch_edit: 'Changed', branch_move: 'Moved', branch_delete: 'Deleted', branch_restore: 'Restored',
    verify: 'Verified', unverify: 'Marked to verify', line_add: 'Added a link from', line_edit: 'Changed a link from', line_delete: 'Removed a link from', 'import': 'Imported under' };
  function changes(h) {
    var b = h.before || {}, a = h.after || {}, out = [];
    if (h.action === 'map_settings') {
      if (b.name !== a.name) out.push(el('div', {}, 'Name: ', el('del', { text: b.name }), ' → ', el('ins', { text: a.name })));
      if (b.share !== a.share) out.push(el('div', { text: 'Shared: ' + (MP.SHARE[b.share] || b.share) + ' → ' + (MP.SHARE[a.share] || a.share) }));
      return out;
    }
    if (h.action === 'branch_edit') {
      if (b.title !== a.title) out.push(el('div', {}, 'Name: ', el('del', { text: b.title }), ' → ', el('ins', { text: a.title })));
      if ((b.notes || '') !== (a.notes || '')) {
        var pre = el('div', { class: 'mp-dlines' });
        MP.editor.lineDiff(b.notes || '', a.notes || '').forEach(function (d) { if (d[0] !== ' ') pre.appendChild(el('div', { class: d[0] === '-' ? 'mp-del' : 'mp-ins', text: d[0] + ' ' + d[1] })); });
        out.push(el('div', {}, 'Notes:', pre));
      }
      var bs = b.special || [], as = a.special || [];
      bs.filter(function (s) { return as.indexOf(s) < 0; }).forEach(function (s) { out.push(el('div', { class: 'mp-del', text: '- ! ' + s })); });
      as.filter(function (s) { return bs.indexOf(s) < 0; }).forEach(function (s) { out.push(el('div', { class: 'mp-ins', text: '+ ! ' + s })); });
      if (JSON.stringify(b.props || {}) !== JSON.stringify(a.props || {})) out.push(el('div', { text: 'Layout: ' + ((b.props || {}).layout || 'tree') + ' → ' + ((a.props || {}).layout || 'tree') }));
      if (JSON.stringify(b.place || null) !== JSON.stringify(a.place || null)) out.push(el('div', { text: 'Place on the drawing changed.' }));
      return out;
    }
    if (h.action === 'line_add' && a) out.push(el('div', { text: a.kind === 'web' ? 'Web: ' + (a.target || '') : MP.rel(a.rel).label + ': ' + (a.to_title || '') }));
    if (h.action === 'line_edit') out.push(el('div', { text: MP.rel(b.rel).label + (b.label ? ' "' + b.label + '"' : '') + ' → ' + MP.rel(a.rel).label + (a.label ? ' "' + a.label + '"' : '') }));
    if (h.action === 'line_delete' && b) out.push(el('div', { text: b.kind === 'web' ? 'Web: ' + (b.target || '') : MP.rel(b.rel).label + (b.label ? ' "' + b.label + '"' : '') }));
    if (h.action === 'import' && a) out.push(el('div', { text: MP.plural(a.added || 0, 'branch', 'branches') + ', all to verify' }));
    if ((h.action === 'branch_delete' || h.action === 'branch_restore') && (b['with'] || a['with'])) out.push(el('div', { text: 'with ' + MP.plural(b['with'] || a['with'], 'branch', 'branches') + ' under it' }));
    if ((h.action === 'verify' || h.action === 'unverify') && a && a.branches > 1) out.push(el('div', { text: MP.plural(a.branches, 'branch', 'branches') + (a.deep ? ', with what is under it' : '') }));
    if (h.action === 'map_create' && a && a.starter) out.push(el('div', { text: 'from a starter: ' + MP.plural(a.starter, 'branch', 'branches') }));
    return out;
  }
  function history(branchId) {
    var list = el('div', { class: 'mp-hist' }), more = el('button', { type: 'button', class: 'btn ghost small', text: 'Older', hidden: true }), last = null;
    var body = el('div', { class: 'stack' }, list, more);
    function load() {
      return MP.rpc('maps_history', { p_map: MP.M.map.id, p_branch: branchId || null, p_before: last }).then(function (rows) {
        if (!last && !rows.length) list.appendChild(el('p', { class: 'muted', text: 'Nothing changed yet.' }));
        rows.forEach(function (h) {
          last = h.id;
          var what = ACTIONS[h.action] || h.action, onBranch = h.branch && !/^map_/.test(h.action);
          var head = el('div', { class: 'mp-hhead' },
            el('span', {}, el('b', { text: what }), onBranch && !branchId ? ' ' : '',
              onBranch && !branchId ? (h.gone ? el('span', { text: h.title || 'a branch' }) :
                el('button', { type: 'button', class: 'mp-hlink', text: h.title || 'a branch', on: { click: function () { var id = h.branch; Core.$('.sheet-back') && Core.$('.sheet-back').click(); MP.nav.reveal(id); MP.editor.open(id); } } })) : null),
            el('span', { class: 'faint', text: (h.by || 'someone') + ' · ' + Core.dateTime(h.at) }));
          var detail = changes(h);
          list.appendChild(el('div', { class: 'mp-hrow' }, head, detail.length ? el('div', { class: 'mp-hdetail' }, detail) : null));
        });
        more.hidden = rows.length < 50;
      }, function (e) { list.appendChild(el('p', { class: 'notice danger', text: MP.msg(e) })); });
    }
    more.addEventListener('click', function (e) { Core.busy(e.currentTarget, load); });
    MP.settled().then(load);
    Core.sheet({ title: branchId ? 'History of ' + (N(branchId) ? N(branchId).title : 'this branch') : 'History of ' + MP.M.map.name, body: body,
      actions: [{ label: 'Close', kind: 'primary', value: null }] });
  }

  MP.sheets = { link: link, moveTo: moveTo, importSheet: importSheet, exportSheet: exportSheet, settings: settings, trash: trash, history: history };
})();
