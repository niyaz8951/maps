// Browser check of flowcharts (step 3) against the local mock (dev/test/run.sh starts everything). Screenshots: dev/test/out/.
// Needs playwright-core (PLAYWRIGHT_ROOT) and Chrome (CHROME). Not part of the delivery.
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
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1440, height: 900 }, acceptDownloads: true }, opts || {}));
  const s = await session(user);
  await ctx.addInitScript((v) => { try { localStorage.setItem('dame.session', v); } catch (e) { /* */ } }, JSON.stringify(s));
  const p = await ctx.newPage();
  p.errors = [];
  p.on('console', (m) => { if ((m.type() === 'error' && !/status of 400/.test(m.text())) || /Content Security Policy/i.test(m.text())) p.errors.push(m.text()); });
  p.on('pageerror', (e) => p.errors.push('PAGEERROR ' + e.message));
  return p;
}
const shot = (p, name) => p.screenshot({ path: path.join(OUT, name + '.png') });
// a step by its name (a long name wraps over lines, so not by its text on the chart)
let PAGE = null;
const idOf = (p, title) => p.evaluate((t) => { const n = Object.values(MP.M.nodes).find((x) => x.title === t); return n ? n.id : 'none'; }, title);
const step = (title) => ({ title });
async function at(p, s) { return typeof s === 'string' ? s : '.fc-step[data-node="' + await idOf(p, s.title) + '"]'; }
const centre = async (p, sel) => { const b = await p.locator(await at(p, sel)).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }; };
const settle = (p) => p.waitForFunction(() => window.MP && !window.MP.pending(), null, { timeout: 8000 }).then(() => p.waitForTimeout(250));
const MERMAID = 'flowchart TD\n  subgraph Site\n    A([Alarm]) --> B{Pump running?}\n  end\n  B -->|Yes| C[Check the strainer]\n  B -- No --> D[/Read the trip code/]\n  C --> E([Done])\n  D --> E';

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const own = await open(browser, 'mt_owner');

  // 1. a flowchart from the approval starter: ten steps in three lanes, nothing to fix
  await own.goto(BASE + '/maps/'); await own.waitForSelector('#mp-list:not([hidden])');
  await own.click('#mp-new'); await own.fill('#mp-new-name', 'Approval test'); await own.selectOption('#mp-new-start', 'flowchart-approval');
  await own.click('.sheet .btn.primary'); await own.waitForSelector('.fc-step'); await own.waitForTimeout(400);
  check((await own.$$('.fc-step')).length === 10, 'approval starter: ten steps');
  check((await own.$$('.fc-lane')).length === 3, 'three lanes');
  check((await own.$$('.fc-edge')).length === 10, 'ten arrows');
  check(/Check: all good/.test(await own.textContent('#fc-bar')), 'the check finds nothing to fix');
  check(/Flowchart/.test(await own.textContent('#mp-sub')) && /10 steps/.test(await own.textContent('#mp-pills')), 'head and counters speak of steps');
  await shot(own, '11-flowchart');

  // 2. drag a step into the next lane: it stays there, and its lane changes
  const r0 = await centre(own, step('Review the request')), lane2 = await own.locator('.fc-lane').nth(2).boundingBox();
  await own.mouse.move(r0.x, r0.y); await own.mouse.down(); await own.mouse.move(r0.x + 40, r0.y + 10, { steps: 4 });
  await own.mouse.move(lane2.x + lane2.width / 2, r0.y + 20, { steps: 8 }); await own.mouse.up();
  await settle(own);
  const moved = await own.evaluate(() => { const n = Object.values(MP.M.nodes).find((x) => x.title === 'Review the request'); return { place: n.place, lane: n.props.lane }; });
  check(moved.place && typeof moved.place.x === 'number' && moved.place.x % 10 === 0, 'dragged step has a place on the 10 grid');
  check(moved.lane === 'Approver', 'dropped in another lane: the step moved to it');
  await own.reload(); await own.waitForSelector('.fc-step'); await own.waitForTimeout(300);
  const after = await own.evaluate(() => Object.values(MP.M.nodes).find((x) => x.title === 'Review the request').place);
  check(after && after.x === moved.place.x && after.y === moved.place.y, 'the place is kept after a reload');
  check(await own.isVisible('#fc-bar button:text-is("Auto layout")') === false, 'Read mode: no Auto layout button');

  // 3. Edit: draw an arrow by dragging the + handle onto another step; a Process with two exits gets a warning
  await own.click('#mp-edit'); await own.click('#mp-fit'); await own.waitForTimeout(200);
  await own.click(await at(own, step('Tell the requester why not'))); await own.waitForSelector('.fc-handle');
  const h = await centre(own, '.fc-handle'), t1 = await centre(own, step('Request raised'));
  await own.mouse.move(h.x, h.y); await own.mouse.down(); await own.mouse.move(h.x + 30, h.y + 30, { steps: 4 }); await own.mouse.move(t1.x, t1.y, { steps: 10 }); await own.mouse.up();
  await own.waitForFunction(() => MP.M.lines.filter((l) => l.kind === 'flow').length === 11, null, { timeout: 8000 });
  check(true, 'arrow drawn by dragging the handle');
  check(/warning/.test(await own.textContent('#fc-bar')), 'a Process with two exits: a warning');
  // ... and onto empty space: a new step there, named in its panel
  await own.click(await at(own, step('Fill in the request'))); await own.waitForSelector('.fc-handle');
  const h2 = await centre(own, '.fc-handle'), cv = await own.locator('#mp-canvas').boundingBox();
  await own.mouse.move(h2.x, h2.y); await own.mouse.down(); await own.mouse.move(h2.x - 40, h2.y + 40, { steps: 4 }); await own.mouse.move(cv.x + 30, cv.y + cv.height - 40, { steps: 10 }); await own.mouse.up();
  await own.waitForSelector('#mp-name'); await own.fill('#mp-name', 'Attach the drawings'); await settle(own); await own.keyboard.press('Escape');
  await own.waitForFunction(() => Object.values(MP.M.nodes).some((x) => x.title === 'Attach the drawings'));
  const nw = await own.evaluate(() => { const n = Object.values(MP.M.nodes).find((x) => x.title === 'Attach the drawings'); const f = MP.intoOf(n.id)[0]; return { place: !!n.place, lane: n.props.lane, type: n.type, into: MP.intoOf(n.id).length, from: f && MP.N(f.from).title, fromLane: f && MP.N(f.from).props.lane }; });
  check(nw.place && nw.type === 'process' && nw.lane === 'Requester' && nw.into === 1, 'dropped on empty space: a new Process there, in the lane of the step it came from, with the arrow ' + JSON.stringify(nw));
  // the step panel: shape, lane, answers
  await own.dblclick(await at(own, step('Attach the drawings'))); await own.waitForSelector('#mp-shape');
  await own.selectOption('#mp-shape', 'decision'); await settle(own); await own.keyboard.press('Escape');
  check(/problem/.test(await own.textContent('#fc-bar')), 'made a Decision with one exit: a problem');
  await own.click('#fc-bar button[aria-expanded]'); await own.waitForSelector('.fc-issue');
  check(/needs two or more exits/.test(await own.textContent('.fc-checks')), 'the problem says what is wrong');
  await shot(own, '12-flowchart-edit');
  // change an answer on an arrow
  await own.click('.fc-lab:text-is("Yes") >> nth=0'); await own.waitForSelector('#fc-edit-answer');
  await own.fill('#fc-edit-answer', 'Yes, complete'); await own.click('.sheet .btn.primary');
  await own.waitForSelector('.fc-lab:text-is("Yes, complete")');
  check(true, 'answer on an arrow changed');
  // Tab: the next step after the chosen one, joined to it
  await own.click(await at(own, step('Record the approval'))); await own.keyboard.press('Tab'); await own.waitForSelector('#mp-name');
  await own.fill('#mp-name', 'File it'); await settle(own); await own.keyboard.press('Escape');
  check(await own.evaluate(() => { const n = Object.values(MP.M.nodes).find((x) => x.title === 'File it'); return MP.intoOf(n.id).length === 1; }), 'Tab adds the next step, joined');

  // 4. walk through and ways through
  await own.click('#mp-read'); await own.click('#fc-bar button:text-is("Walk through")'); await own.waitForSelector('.fc-walk');
  check(/Request raised/.test(await own.textContent('.fc-walk')), 'walk starts at the Start');
  for (let i = 0; i < 3; i++) await own.click('.fc-walk .btn:not(.ghost) >> nth=0');
  check((await own.$$('.fc-step.fc-on, .fc-step.fc-here')).length === 4 && (await own.$$('.fc-edge.on')).length === 3, 'the way walked lights up');
  await shot(own, '13-walk');
  await own.click('#fc-bar button:text-is("Stop walking")');
  await own.click('#fc-bar button:text-is("Ways through")'); await own.waitForSelector('.fc-way');
  check((await own.$$('.fc-way')).length >= 4, 'every way through listed');
  await own.keyboard.press('Escape');

  // 5. export: Mermaid text, an SVG file, the step list, print
  await own.click('#mp-export'); await own.waitForSelector('#mp-export-text');
  const mm = await own.inputValue('#mp-export-text');
  check(/^flowchart TD/.test(mm) && /subgraph L1\["Requester"\]/.test(mm) && /-->\|"Yes, complete"\|/.test(mm), 'Mermaid out: lanes and answers');
  const [svgDl] = await Promise.all([own.waitForEvent('download'), own.click('.sheet button:text-is("Drawing (.svg)")')]);
  const svgText = require('fs').readFileSync(await svgDl.path(), 'utf8');
  check(/^<\?xml/.test(svgText) && /<svg[^>]+xmlns="http:\/\/www.w3.org\/2000\/svg"/.test(svgText) && svgText.indexOf('Request raised') > 0 && !/var\(--/.test(svgText), 'SVG file: a standalone drawing with fixed colours');
  const [xl] = await Promise.all([own.waitForEvent('download'), own.click('.sheet button:text-is("Step list (.xlsx)")')]);
  check(/steps\.xlsx$/.test(xl.suggestedFilename()) && require('fs').statSync(await xl.path()).size > 1000, 'Excel step list downloaded');
  await own.evaluate(() => { window.print = () => { window.__printed = document.querySelector('#mp-print svg') ? document.querySelector('#mp-print').className : 'none'; }; });
  await own.click('.sheet button:text-is("Print A3")'); await own.waitForFunction(() => window.__printed);
  check(await own.evaluate(() => window.__printed) === 'mp-print a3', 'print: the chart on an A3 page');
  await own.evaluate(() => window.dispatchEvent(new Event('afterprint')));

  // 6. import Mermaid into a blank flowchart
  await own.goto(BASE + '/maps/'); await own.waitForSelector('.mp-tile');
  await own.click('#mp-new'); await own.fill('#mp-new-name', 'Mermaid test'); await own.selectOption('#mp-new-start', 'flowchart-blank');
  await own.click('.sheet .btn.primary'); await own.waitForSelector('.fc-step');
  await own.click('#mp-import'); await own.fill('#mp-import-text', MERMAID);
  check(/adds 5 steps and 5 arrows/.test(await own.textContent('.sheet')), 'Mermaid read: five steps, five arrows');
  await own.click('.sheet .btn.primary'); await own.waitForFunction(() => document.querySelectorAll('.fc-step').length === 7);
  const im = await own.evaluate(() => { const by = (t) => Object.values(MP.M.nodes).find((x) => x.title === t); return { d: by('Read the trip code').type, b: by('Pump running?').type, lane: by('Alarm').props.lane, lanes: MP.N(MP.M.root).props.lanes, no: MP.exitsOf(by('Pump running?').id).map((l) => l.label).join(',') }; });
  check(im.d === 'data' && im.b === 'decision' && im.lane === 'Site' && JSON.stringify(im.lanes) === '["Site"]' && im.no === 'Yes,No', 'imported shapes, lane and answers');
  await shot(own, '14-mermaid');

  // 8. step 2: a knowledge starter, a link to another tile, the review list and send back, print as an A4 outline
  await own.goto(BASE + '/maps/'); await own.waitForSelector('.mp-tile');
  await own.click('#mp-new'); await own.fill('#mp-new-name', 'Selection test'); await own.selectOption('#mp-new-start', 'knowledge-selection');
  await own.click('.sheet .btn.primary'); await own.waitForSelector('.mp-n'); await own.waitForTimeout(300);
  check(await own.evaluate(() => MP.M.map.kind === 'knowledge' && Object.keys(MP.M.nodes).length === 11), 'equipment selection starter: a knowledge map with its headings');
  await own.dblclick('.mp-t:text-is("Rules")'); await own.waitForSelector('#mp-notes');
  await own.click('.mp-note button:text-is("Add link")'); await own.selectOption('#mp-link-kind', 'tile');
  await own.fill('#mp-link-tile', 'https://example.test/projects/index.html'); await own.fill('#mp-link-label', 'Project register');
  await own.click('.sheet .btn.primary'); await own.waitForSelector('.mp-note a.mp-link[href="/projects/index.html"]');
  check(true, 'tile link: the site part dropped, opened at /projects/index.html');
  await own.click('.mp-note button:text-is("Send back with a comment")'); await own.fill('#mp-sendback', 'Add the source of each rule.');
  await own.click('.sheet .btn.primary'); await own.waitForSelector('.mp-back-note');
  check(/Add the source of each rule/.test(await own.textContent('.mp-back-note')), 'sent back: the comment shows on the branch');
  await own.click('.mp-note button:text-is("Close")'); await own.waitForSelector('.mp-n .mp-tv:text-is("sent back")');
  check(true, 'sent back: marked on the map');
  await own.evaluate(() => { window.__printed = null; window.print = () => { const h = document.querySelector('#mp-print'); window.__printed = h.className + ' ' + h.querySelectorAll('h2').length; }; });
  await own.click('#mp-export'); await own.click('.sheet button:text-is("Print (A4)")'); await own.waitForFunction(() => window.__printed);
  check(/^mp-print a4p outline \d+$/.test(await own.evaluate(() => window.__printed)) && +(await own.evaluate(() => window.__printed)).split(' ').pop() >= 7, 'print: the map as an A4 outline');
  await own.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await own.goto(BASE + '/maps/'); await own.waitForSelector('#mp-review:not([hidden])');
  check(/Review \(\d+\)/.test(await own.textContent('#mp-review')), 'Review shows how many wait');
  await own.click('#mp-review'); await own.waitForSelector('.mp-rrow');
  check(/Sent back by Test Owner: Add the source of each rule/.test(await own.textContent('.mp-review')), 'review list: the comment with who sent it back');
  const before = (await own.$$('.mp-rrow')).length;
  await own.click('.mp-rrow:has-text("Rules") button:text-is("Verify")'); await own.waitForFunction((n) => document.querySelectorAll('.mp-rrow').length === n - 1, before);
  check(true, 'review list: verified from the list, it leaves the list');
  await shot(own, '18-review'); await own.keyboard.press('Escape');
  const rd = await open(browser, 'mt_read');
  await rd.goto(BASE + '/maps/'); await rd.waitForSelector('.mp-tile, #mp-empty:not([hidden])');
  check(await rd.isHidden('#mp-review'), 'no Review for someone without the right verify');

  // 7. phone, night: the outline with each step's exits; no sideways scroll
  const ph = await open(browser, 'mt_owner', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark' });
  await ph.goto(BASE + '/maps/'); await ph.waitForSelector('.mp-tile');
  await ph.tap('.mp-tile:has-text("Approval test")'); await ph.waitForSelector('.fc-orow'); await ph.waitForTimeout(300);
  check(await ph.isVisible('#mp-outline') && /→ Yes, complete:/.test(await ph.textContent('#mp-outline')), 'phone: the steps with their answers');
  check(!(await ph.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), 'phone: no sideways scroll');
  check(/problem/.test(await ph.textContent('#fc-bar')), 'phone outline: the check runs there too');
  await shot(ph, '15-flow-phone-night');
  await ph.click('#mp-view-map'); await ph.waitForSelector('.fc-step'); await ph.waitForTimeout(300);
  check(!(await ph.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), 'phone chart: no sideways scroll');
  await shot(ph, '16-flow-phone-chart');
  // night on a laptop
  const nt = await open(browser, 'mt_owner', { colorScheme: 'dark' });
  await nt.goto(BASE + '/maps/'); await nt.waitForSelector('.mp-tile'); await nt.click('.mp-tile:has-text("Approval test")'); await nt.waitForSelector('.fc-step'); await nt.waitForTimeout(300);
  await shot(nt, '17-flow-night');

  for (const p of [own, ph, nt, rd]) check(!p.errors.length, 'no console or CSP errors' + (p.errors.length ? ': ' + p.errors.join(' | ') : ''));
  await browser.close();
  console.log(failed ? '\n' + failed + ' FAILED' : '\nALL FLOWCHART BROWSER CHECKS PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
