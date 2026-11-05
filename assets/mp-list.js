/* Maps tile - every map: the list, search across maps, Add map (blank or a starter), the trash. */
(function () {
  'use strict';
  var MP = window.MP, el = MP.el, $ = MP.$;

  // Starter templates: JSON files in the repo, created through the same function as Import (all "to verify").
  var STARTERS = [
    ['', 'Blank: only the centre'],
    ['knowledge-product', 'Product breakdown: components, options, ratings, standards, selection ...'],
    ['knowledge-process', 'Process: purpose, steps, roles, checks ...']
  ];

  function show() {
    $('mp-list').hidden = false;
    Core.setTitle('Maps');
    $('mp-new').hidden = !MP.flags.editor;
    $('mp-trash').hidden = !(MP.flags.editor || MP.flags.admin);
    $('mp-new').addEventListener('click', newMap);
    $('mp-trash').addEventListener('click', function () { MP.sheets.trash(null); });
    var timer, box = $('mp-find');
    box.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { find(box.value); }, 300); });
    load();
  }

  function skeleton(grid) {
    Core.clear(grid);
    for (var i = 0; i < 3; i++) grid.appendChild(el('div', { class: 'tile skeleton', 'aria-hidden': 'true' }, el('span', { class: 'sk ic' }),
      el('div', { class: 'grow' }, el('span', { class: 'sk l1' }), el('span', { class: 'sk l2' }))));
  }

  function load() {
    var grid = $('mp-grid'), empty = $('mp-empty');
    skeleton(grid); empty.hidden = true; grid.setAttribute('aria-busy', 'true');
    return MP.rpc('maps_list').then(function (r) {
      MP.flags = r.me;
      $('mp-new').hidden = !MP.flags.editor;
      $('mp-trash').hidden = !(MP.flags.editor || MP.flags.admin);
      Core.clear(grid); grid.removeAttribute('aria-busy');
      if (!r.maps.length) {
        Core.clear(empty); empty.hidden = false;
        empty.appendChild(el('div', { class: 'state' }, el('h2', { text: 'No maps yet' }),
          el('p', { text: MP.flags.editor ? 'Press Add map and name it after a product or a process, for example Chiller.' : 'When someone shares a map with the team, it shows here.' })));
        return;
      }
      r.maps.forEach(function (m) {
        var tag = [MP.plural(m.branches, 'branch', 'branches'), MP.SHARE[m.share] || m.share].join(' · ');
        grid.appendChild(el('a', { class: 'tile mp-tile', href: '/maps/?map=' + encodeURIComponent(m.id) },
          el('span', { class: 'icon i-map', 'aria-hidden': 'true' }),
          el('span', { class: 'grow' },
            el('span', { class: 'name', text: m.name }),
            el('span', { class: 'tagline', text: tag }),
            el('span', { class: 'flag' },
              el('span', { class: 'mp-who', text: (m.mine ? 'Yours' : 'By ' + m.owner) + ' · changed ' + Core.date(m.updated_at) }),
              m.to_verify ? el('span', { class: 'badge warning', text: m.to_verify + ' to verify' }) : null,
              m.right === 'read' && !m.mine ? el('span', { class: 'badge', text: 'Read only' }) : null))));
      });
    }, function (err) {
      Core.clear(grid); grid.removeAttribute('aria-busy');
      Core.clear(empty); empty.hidden = false;
      empty.appendChild(el('div', { class: 'notice danger row between' }, el('span', { text: 'The maps could not be loaded. ' + MP.msg(err) }),
        el('button', { class: 'btn small', type: 'button', text: 'Try again', on: { click: load } })));
    });
  }

  var seq = 0;
  function find(text) {
    var host = $('mp-hits'), q = text.replace(/\s+/g, ' ').trim(), mine = ++seq;
    if (q.length < 2) { host.hidden = true; Core.clear(host); return; }
    MP.rpc('maps_search', { p_q: q }).then(function (hits) {
      if (mine !== seq) return;
      Core.clear(host); host.hidden = false;
      if (!hits.length) { host.appendChild(el('p', { class: 'notice', text: 'Nothing found for "' + q + '" in the maps you can open.' })); return; }
      hits.forEach(function (h) {
        host.appendChild(el('a', { class: 'mp-hit', href: '/maps/?map=' + encodeURIComponent(h.map_id) + '#at-' + encodeURIComponent(h.branch_id) },
          el('b', { text: h.title }), ' ', el('span', { text: h.map + (h['in'] === 'name' ? '' : ' · found in the ' + h['in']) }),
          h.text ? el('p', { text: h.text }) : null));
      });
      if (hits.length >= 60) host.appendChild(el('p', { class: 'faint', text: 'The first 60 branches are shown. Type more to narrow it.' }));
    }, function (err) {
      if (mine !== seq) return;
      Core.clear(host); host.hidden = false;
      host.appendChild(el('p', { class: 'notice danger', text: 'The search did not work. ' + MP.msg(err) }));
    });
  }

  function newMap() {
    var name = el('input', { id: 'mp-new-name', maxlength: '80', placeholder: 'e.g. Chiller', autocomplete: 'off' });
    var start = MP.select('mp-new-start', STARTERS, '');
    var share = MP.shareSelect('mp-new-share', 'private');
    var err = el('p', { class: 'notice danger', hidden: true, role: 'alert' });
    var body = el('div', { class: 'stack' },
      MP.field('Map name', name, 'Usually the product or the process.'),
      MP.field('Start from', start, 'A starter adds the usual branches to fill in, each one "to verify".'),
      MP.field('Shared with', share, MP.SHARE_HINT + ' You can change it later.'),
      err);
    name.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    var busy = false;
    function go() {
      var v = name.value.replace(/\s+/g, ' ').trim();
      err.hidden = true;
      if (!v) { err.textContent = 'Give the map a name, usually the product.'; err.hidden = false; name.focus(); return false; }
      if (busy) return false;
      busy = true;
      var items = start.value ? fetch('/maps/templates/' + start.value + '.json', { credentials: 'same-origin' }).then(function (res) {
        if (!res.ok) throw new Error('The starter could not be loaded.');
        return res.json();
      }).then(function (t) { return t.items; }) : Promise.resolve(null);
      return items.then(function (list) {
        return MP.rpc('maps_create', { p_name: v, p_kind: 'knowledge', p_share: share.value, p_items: list });
      }).then(function (r) {
        MP.store('edit-next', r.id);                     // a new map opens in Edit
        Core.go('/maps/?map=' + encodeURIComponent(r.id));
        return true;
      }, function (e) { busy = false; err.textContent = MP.msg(e); err.hidden = false; return false; });
    }
    Core.sheet({ title: 'Add a map', body: body, actions: [{ label: 'Cancel', value: null }, { label: 'Add map', kind: 'primary', onClick: go }] });
  }

  MP.list = { show: show, load: load };
})();
