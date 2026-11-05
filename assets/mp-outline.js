/* Maps tile - the Outline view: the same branches as indented text. The default on a phone. */
(function () {
  'use strict';
  var MP = window.MP, el = MP.el, $ = MP.$, st = MP.st, N = MP.N;

  function render() {
    var host = $('mp-outline');
    Core.clear(host);
    host.appendChild(el('ul', { role: 'tree', 'aria-label': 'Outline' }, (function li(id) {
      var n = N(id);
      return el('li', { role: 'none' }, MP.mapView.nodeEl(n, 'mp-orow'),
        n.open && n.kids.length ? el('ul', { role: 'group' }, n.kids.map(li)) : null);
    })(st.focus)));
    if (MP.view.wantScroll && st.sel) { var x = host.querySelector('[data-node="' + st.sel + '"]'); if (x && x.scrollIntoView) x.scrollIntoView({ block: 'nearest' }); }
    MP.view.wantScroll = false;
  }

  function wire() {
    var o = $('mp-outline');
    o.addEventListener('click', function (e) { MP.nav.click(e, false); });
    o.addEventListener('dblclick', MP.nav.dblclick);
    o.addEventListener('keydown', function (e) {
      var nodeE = e.target.closest ? e.target.closest('[data-node]') : null;
      if (nodeE && e.target === nodeE) MP.nav.key(e, N(nodeE.getAttribute('data-node')));
    });
  }

  MP.outline = { render: render, wire: wire };
})();
