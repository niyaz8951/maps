// Browser check of the Maps tile against the local mock (dev/test/run.sh starts everything). Screenshots: dev/test/out/.
// Needs playwright-core (PLAYWRIGHT_ROOT = the node_modules that holds it) and Chrome (CHROME). Not part of the delivery.
const path = require('path');
const { chromium } = require(path.join(process.env.PLAYWRIGHT_ROOT || '/opt/node-tools/node_modules', 'playwright-core'));
const BASE = 'http://localhost:8080', OUT = path.join(__dirname, 'out');
let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok    ' : 'FAIL  ') + what); if (!ok) failed++; };

async function session(user) {
  const t = await (await fetch(BASE + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: 'test' },
    body: JSON.stringify({ email: user + '@users.dame-hub.local', password: 'Local-Pass-2026' }) })).json();
  await fetch(BASE + '/rest/v1/rpc/core_session_start', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: 'test', Authorization: 'Bearer ' + t.access_token }, body: '{}' });
  return { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Math.floor(Date.now() / 1000) + 3600, user_id: t.user.id, started_at: Math.floor(Date.now() / 1000) };
}
async function open(browser, user, opts) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1360, height: 860 } }, opts || {}));
  const s = await session(user);
  await ctx.addInitScript((v) => { try { localStorage.setItem('dame.session', v); } catch (e) { /* */ } }, JSON.stringify(s));
  const p = await ctx.newPage();
  p.errors = [];
  p.on('console', (m) => { if ((m.type() === 'error' && !/status of 400/.test(m.text())) || /Content Security Policy/i.test(m.text())) p.errors.push(m.text()); });
  p.on('pageerror', (e) => p.errors.push('PAGEERROR ' + e.message));
  return p;
}
const shot = (p, name) => p.screenshot({ path: path.join(OUT, name + '.png') });
const OLD = 'Filters\n  > What the filters do.\n  ! Layout: columns\n  Pre-filter\n    > Coarse, protects the main filter.\n    ! ISO 16890 ePM10 50 %\n  Bag filter\n    ! Place: 120, 80\nFans\n  EC plug fan\n';

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const own = await open(browser, 'mt_owner');
  await own.goto(BASE + '/maps/'); await own.waitForSelector('#mp-list:not([hidden])');
  await own.click('#mp-new'); await own.fill('#mp-new-name', 'Example AHU'); await own.selectOption('#mp-new-start', 'knowledge-product');
  await own.click('.sheet .btn.primary'); await own.waitForSelector('.mp-n'); await own.waitForTimeout(500);
  check((await own.$$('.mp-n')).length === 10, 'new map from the product starter: centre + 9 top branches'); await shot(own, '01-map');
  check(await own.getAttribute('#mp-edit', 'aria-selected') === 'true', 'a new map opens in Edit');
  // Tab adds a branch and names it; notes and a special note save by themselves
  await own.click('.mp-t:text-is("Selection")'); await own.focus('.mp-n:has(.mp-t:text-is("Selection"))'); await own.keyboard.press('Tab');
  await own.waitForSelector('#mp-name'); await own.fill('#mp-name', 'Coil selection');
  await own.fill('#mp-notes', 'Face velocity at most 2.5 m/s.'); await own.fill('#mp-special-in', 'Check carry-over'); await own.click('#mp-special-in + .btn');
  await own.waitForTimeout(1500); check((await own.textContent('#mp-status')) === 'Saved', 'typing saves by itself');
  // links: to a branch, and a web link (https only)
  await own.click('.mp-nsec:has(h3:text("Links")) .btn');
  const to = await own.$$eval('#mp-link-branch option', (os) => os.find((o) => o.textContent.trim() === 'Performance and ratings').value);
  await own.selectOption('#mp-link-branch', to); await own.selectOption('#mp-link-rel', 'requires'); await own.click('.sheet .btn.primary'); await own.waitForTimeout(1000);
  await own.click('.mp-nsec:has(h3:text("Links")) .btn:text("Add link")'); await own.selectOption('#mp-link-kind', 'web');
  await own.fill('#mp-link-url', 'http://example.com/x'); await own.click('.sheet .btn.primary');
  check(/https:\/\//.test(await own.textContent('.sheet .notice.danger')), 'http:// link refused');
  await own.fill('#mp-link-url', 'https://example.com/guide'); await own.click('.sheet .btn.primary'); await own.waitForTimeout(1000);
  check((await own.$$('.mp-linkrow')).length === 2, 'two links on the branch'); await shot(own, '02-branch');
  await own.keyboard.press('Escape');
  // import an old outline; Layout and Place become typed values
  await own.click('.mp-n.mp-root'); await own.click('#mp-import'); await own.fill('#mp-import-text', OLD);
  check(/2 values \(Layout, Place\)/.test((await own.$$eval('.sheet p.muted', (x) => x.map((e) => e.textContent))).pop()), 'old outline: typed values recognised');
  await own.click('.sheet .btn.primary'); await own.waitForTimeout(1200);
  check(await own.isVisible('.mp-t:text-is("Filters")') && await own.isVisible('.mp-t:text-is("Fans")'), 'imported branches on the map');
  // delete to the trash and restore
  await own.focus('.mp-n:has(.mp-t:text-is("Fans"))'); await own.keyboard.press('Delete'); await own.click('.sheet .btn.danger'); await own.waitForTimeout(800);
  check(!(await own.isVisible('.mp-t:text-is("Fans")')), 'deleted branch leaves the map');
  await own.click('#mp-btrash'); await own.waitForSelector('.mp-trow'); await own.click('.mp-trow .btn'); await own.waitForTimeout(800); await own.click('.sheet .btn.primary');
  check(await own.isVisible('.mp-t:text-is("Fans")'), 'restored from the trash');
  // export round trip, history, share with the team
  await own.click('#mp-export'); const text = await own.inputValue('#mp-export-text'); await own.click('.sheet .btn:text("Close")');
  check(/! Layout: columns/.test(text) && /! Place: 120, 80/.test(text), 'export writes the typed values back');
  await own.click('#mp-history'); await own.waitForSelector('.mp-hrow'); check((await own.$$('.mp-hrow')).length >= 8, 'history lists the changes'); await own.click('.sheet .btn.primary');
  // Share (the core's Access panel): everyone in Maps can edit
  check(/Only you/.test(await own.textContent('#mp-sub')), 'a new map: only its owner');
  await own.click('#mp-share'); await own.waitForSelector('#sh-everyone'); await shot(own, '02-access');
  await own.selectOption('#sh-everyone', 'edit'); await own.click('.sheet .btn.primary'); await own.waitForTimeout(1000);
  check(/Everyone can edit/.test(await own.textContent('#mp-sub')), 'shared: everyone in Maps can edit');
  await own.click('#mp-settings'); check(!(await own.$('#mp-set-name + * select')), 'settings: the name only, Share from there');
  await own.click('#mp-set-share'); await own.waitForSelector('#sh-everyone'); check(await own.inputValue('#sh-everyone') === 'edit', 'settings opens Share');
  await own.click('.sheet .btn:text("Cancel")'); await own.waitForTimeout(300);
  // the clash: two editors on the same branch
  const ed = await open(browser, 'mt_edit');
  for (const p of [own, ed]) {
    await p.goto(BASE + '/maps/'); await p.click('.mp-tile'); await p.waitForSelector('.mp-n'); await p.click('#mp-edit');
    await p.click('.mp-t:text-is("Selection")'); await p.waitForTimeout(200); await p.dblclick('.mp-t:text-is("Coil selection")'); await p.waitForSelector('#mp-notes');
  }
  await ed.fill('#mp-notes', 'Face velocity at most 2.5 m/s (2.0 m/s with a high latent load).'); await ed.waitForTimeout(1500);
  await own.fill('#mp-notes', 'Typed at the same time.'); await own.waitForTimeout(1500);
  check(/changed by Test Edit/.test(await own.textContent('.mp-clash')), 'the second save is refused with the name of who changed it'); await shot(own, '03-clash');
  // the verifier sees what changed since it was verified
  const ver = await open(browser, 'mt_verify');
  await ver.goto(BASE + '/maps/'); await ver.click('.mp-tile'); await ver.waitForSelector('.mp-n');
  await ver.click('.mp-t:text-is("Selection")'); await ver.waitForTimeout(200); await ver.dblclick('.mp-t:text-is("Coil selection")');
  await ver.waitForSelector('.mp-changed'); check(/high latent load/.test(await ver.textContent('.mp-changed')), 'changed since verified, with the difference'); await shot(ver, '04-changed');
  await ver.click('.btn:text("Verify the change")'); await ver.waitForTimeout(800);
  check(/^Verified/.test(await ver.textContent('.mp-nstate')), 'verified again');
  // a reader: no editing, search across maps
  const rd = await open(browser, 'mt_read');
  await rd.goto(BASE + '/maps/'); await rd.waitForSelector('.mp-tile');
  check(await rd.isHidden('#mp-new'), 'reader cannot add maps');
  await rd.fill('#mp-find', 'latent'); await rd.waitForSelector('.mp-hit'); check(/Coil selection/.test(await rd.textContent('.mp-hit')), 'search across maps');
  await rd.click('.mp-tile'); await rd.waitForSelector('.mp-n'); check(await rd.isHidden('#mp-mode') && await rd.isHidden('#mp-settings') && await rd.isHidden('#mp-share'), 'reader: no Edit, no settings, no Share');
  // a private map of the editor: the manager of Maps opens it, the reader does not see it
  await ed.goto(BASE + '/maps/'); await ed.waitForSelector('.mp-tile'); await ed.click('#mp-new'); await ed.fill('#mp-new-name', 'Private notes');
  check(await ed.inputValue('#mp-new-share') === 'none', 'a new map starts as only its owner');
  await ed.click('.sheet .btn.primary'); await ed.waitForSelector('.mp-n');
  const adm = await open(browser, 'mt_admin');
  await adm.goto(BASE + '/maps/'); await adm.waitForSelector('.mp-tile');
  check(await adm.isVisible('.mp-tile:has-text("Private notes")'), 'a manager sees a private map');
  await adm.click('.mp-tile:has-text("Private notes")'); await adm.waitForSelector('.mp-n');
  check(await adm.isVisible('#mp-share') && await adm.isVisible('#mp-settings'), 'a manager may share it and change its settings');
  await adm.click('#mp-share'); await adm.waitForSelector('#sh-owner', { state: 'attached' }); await shot(adm, '06-access-manager'); await adm.click('.sheet .btn:text("Cancel")');
  await rd.goto(BASE + '/maps/'); await rd.waitForSelector('.mp-tile');
  check(!(await rd.isVisible('.mp-tile:has-text("Private notes")')), 'the reader does not see it');
  // phone (outline first, no sideways scroll) and night
  const ph = await open(browser, 'mt_owner', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark' });
  await ph.goto(BASE + '/maps/'); await ph.tap('.mp-tile'); await ph.waitForSelector('.mp-orow'); await ph.waitForTimeout(300);
  check(await ph.isVisible('#mp-outline'), 'phone opens on the Outline');
  check(!(await ph.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), 'phone: no sideways scroll'); await shot(ph, '05-phone-night');
  for (const p of [own, ed, ver, rd, ph, adm]) check(!p.errors.length, 'no console or CSP errors' + (p.errors.length ? ': ' + p.errors.join(' | ') : ''));
  await browser.close();
  console.log(failed ? '\n' + failed + ' FAILED' : '\nALL BROWSER CHECKS PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
