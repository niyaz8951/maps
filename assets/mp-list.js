/* Maps tile - every map: the list, search across maps, Add map (blank or a starter), the trash. */
(function () {
  'use strict';
  var MP = window.MP, el = MP.el, $ = MP.$;

  // Starter templates: JSON files in the repo, created through the same function as Import (all "to verify").
  // [file, words, kind]: the kind of map it makes
  var STARTERS = [
    ['Knowledge map', [
      ['', 'Blank: only the centre', 'knowledge'],
      ['knowledge-product', 'Product breakdown: components, options, ratings, standards, selection ...', 'knowledge'],
      ['knowledge-process', 'Process: purpose, steps, roles, checks ...', 'knowledge'],
      ['knowledge-selection', 'Equipment selection: inputs, rules, steps, checks ...', 'knowledge'],
      ['knowledge-troubleshooting', 'Troubleshooting guide: alarms, symptoms, measurements ...', 'knowledge'],
      ['knowledge-standard', 'Standard or specification: scope, clauses, how we comply ...', 'knowledge']]],
    ['Flowchart or process flow', [
      ['flowchart-process', 'Process flow: two boxes, an arrow and a reply (e.g. an escalation ladder)', 'flowchart'],
      ['flowchart-blank', 'Flowchart: a Start and an End to build between', 'flowchart'],
      ['flowchart-approval', 'Flowchart: approval with review and rework, in lanes', 'flowchart'],
      ['flowchart-fault', 'Flowchart: fault finding, technician and specialist', 'flowchart'],
      ['flowchart-startstop', 'Flowchart: equipment start / stop sequence', 'flowchart']]]
  ];
  var KIND_OF = {}; STARTERS.forEach(function (g) { g[1].forEach(function (x) { KIND_OF[x[0]] = x[2]; }); });

  function show() {
    $('mp-list').hidden = false;
    Core.setTitle('Maps');
    $('mp-new').hidden = !MP.flags.editor;
    $('mp-trash').hidden = !(MP.flags.editor || MP.flags.admin);
    $('mp-new').addEventListener('click', newMap);
    $('mp-trash').addEventListener('click', function () { MP.sheets.trash(null); });
    $('mp-review').addEventListener('click', review);
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
      var waiting = r.maps.reduce(function (a, m) { return a + (m.to_verify || 0); }, 0), rb = $('mp-review');
      rb.hidden = !MP.flags.verifier; rb.textContent = waiting ? 'Review (' + waiting + ')' : 'Review';
      Core.clear(grid); grid.removeAttribute('aria-busy');
      if (!r.maps.length) {
        Core.clear(empty); empty.hidden = false;
        empty.appendChild(el('div', { class: 'state' }, el('h2', { text: 'No maps yet' }),
          el('p', { text: MP.flags.editor ? 'Press Add map and name it after a product or a process, for example Chiller.' : 'When someone shares a map with the team, it shows here.' })));
        return;
      }
      r.maps.forEach(function (m) {
        var flow = m.kind === 'flowchart';
        var tag = [flow ? 'Flowchart' : null, flow ? MP.plural(m.branches, 'step') : MP.plural(m.branches, 'branch', 'branches'), MP.SHARE[m.share] || m.share].filter(Boolean).join(' · ');
        grid.appendChild(el('a', { class: 'tile mp-tile', href: '/maps/?map=' + encodeURIComponent(m.id) },
          el('span', { class: 'icon i-map' + (flow ? ' mp-flowicon' : ''), 'aria-hidden': 'true', 'data-accent': flow ? 'teal' : null }),
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
    var start = el('select', { id: 'mp-new-start' }, STARTERS.map(function (g) {
      return el('optgroup', { label: g[0] }, g[1].map(function (x) { return el('option', { value: x[0], text: x[1] }); }));
    }));
    start.value = '';
    var share = MP.shareSelect('mp-new-share', 'private');
    var err = el('p', { class: 'notice danger', hidden: true, role: 'alert' });
    var body = el('div', { class: 'stack' },
      MP.field('Map name', name, 'Usually the product or the process.'),
      MP.field('Start from', start, 'A knowledge map is a tree of branches; a flowchart is steps joined by arrows. A starter adds the usual parts to fill in, each one "to verify".'),
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
      var tpl = null;
      var items = start.value ? fetch('/maps/templates/' + start.value + '.json', { credentials: 'same-origin' }).then(function (res) {
        if (!res.ok) throw new Error('The starter could not be loaded.');
        return res.json();
      }).then(function (t) { tpl = t; return t.items; }) : Promise.resolve(null);
      return items.then(function (list) {
        return MP.rpc('maps_create', { p_name: v, p_kind: KIND_OF[start.value] || 'knowledge', p_share: share.value, p_items: list });
      }).then(function (r) {
        // a starter may set the kind of chart (a process flow), kept on the centre
        if (!tpl || tpl.style !== 'process') return r;
        return MP.rpc('maps_get', { p_map: r.id }).then(function (g) {
          var root = g.branches.filter(function (b) { return !b.parent; })[0];
          return MP.rpc('maps_branch_save', { p_branch: root.id, p_version: root.version, p_patch: { props: Object.assign({}, root.props || {}, { style: 'process' }) } });
        }).then(function () { return r; }, function () { return r; });
      }).then(function (r) {
        MP.store('edit-next', r.id);                     // a new map opens in Edit
        Core.go('/maps/?map=' + encodeURIComponent(r.id));
        return true;
      }, function (e) { busy = false; err.textContent = MP.msg(e); err.hidden = false; return false; });
    }
    Core.sheet({ title: 'Add a map', body: body, actions: [{ label: 'Cancel', value: null }, { label: 'Add map', kind: 'primary', onClick: go }] });
  }

  // ---------- the review list (verifiers): every branch to verify across the maps they may open ----------
  function review() {
    var body = el('div', { class: 'stack mp-review' }, el('div', { class: 'loading-veil' }, el('span', { class: 'spin' }), 'Loading'));
    function draw() {
      return MP.rpc('maps_review').then(function (r) {
        Core.clear(body);
        if (!r.items.length) { body.appendChild(el('p', { class: 'muted', text: 'Nothing waits for a verifier in the maps you can open.' })); return; }
        body.appendChild(el('p', { class: 'muted', text: MP.plural(r.items.length, 'branch', 'branches') + ' to verify, the newest change first.' + (r.more ? ' The first 300 are shown.' : '') +
          ' Open one to read it in its place; verify it, or send it back with a comment for whoever writes it.' }));
        var lastMap = null;
        r.items.forEach(function (it) {
          if (it.map_id !== lastMap) { lastMap = it.map_id; body.appendChild(el('h3', { class: 'section-title', text: it.map + (it.kind === 'flowchart' ? ' · flowchart' : '') })); }
          var row = el('div', { class: 'mp-rrow' },
            el('div', { class: 'grow' },
              el('a', { class: 'mp-rtitle', href: '/maps/?map=' + encodeURIComponent(it.map_id) + '#at-' + encodeURIComponent(it.branch_id), text: it.title }),
              el('div', { class: 'faint', text: [it.status === 'changed' ? 'changed since verified' : 'to verify', it.parent && it.parent !== it.map ? 'under ' + it.parent : null,
                'changed ' + Core.date(it.updated_at) + (it.updated_by ? ' by ' + it.updated_by : '')].filter(Boolean).join(' · ') }),
              it.notes ? el('p', { class: 'mp-rnotes', text: it.notes }) : null,
              it.review ? el('p', { class: 'mp-rback' }, el('b', { text: 'Sent back' + (it.review.by ? ' by ' + it.review.by : '') + ': ' }), it.review.note,
                el('span', { class: 'faint', text: it.review.answered ? ' · changed since' : ' · not changed yet' })) : null),
            el('div', { class: 'mp-racts' },
              el('button', { type: 'button', class: 'btn small primary', text: 'Verify', on: { click: function (e) {
                Core.busy(e.currentTarget, function () { return MP.rpc('maps_verify', { p_branch: it.branch_id, p_on: true, p_deep: false }); })
                  .then(function () { Core.toast('Verified ' + it.title + '.', 'success'); load(); return draw(); }, MP.toastErr);
              } } }),
              el('button', { type: 'button', class: 'btn small ghost', text: 'Send back', on: { click: function () {
                MP.sendBack(it.branch_id, it.title).then(function (done) { if (done) { load(); draw(); } });
              } } })));
          body.appendChild(row);
        });
      }, function (e) { Core.clear(body); body.appendChild(el('p', { class: 'notice danger', text: MP.msg(e) })); });
    }
    draw();
    Core.sheet({ title: 'Review', body: body, actions: [{ label: 'Close', kind: 'primary', value: null }] });
  }

  MP.list = { show: show, load: load, review: review };
})();
