// ============================================================================
//  tools/test-browser.mjs — automated smoke/E2E test in headless Chrome
//  node tools/test-browser.mjs [--shots] [--play]
// ============================================================================
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');
const SHOTS = resolve(ROOT, 'shots');
mkdirSync(SHOTS, { recursive: true });
const doShots = process.argv.includes('--shots') || true;
const doPlay = process.argv.includes('--play');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = resolve(DIST, '.' + p);
  if (!existsSync(f)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;

const browser = await puppeteer.launch({
  headless: 'shell',
  args: [
    '--no-sandbox', '--disable-setuid-sandbox',
    '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader', '--disable-dev-shm-usage',
    '--window-size=412,915',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 1, isMobile: true, hasTouch: true });

const logs = [];
const errors = [];
page.on('console', (m) => {
  const txt = `[${m.type()}] ${m.text()}`;
  logs.push(txt);
  if (m.type() === 'error' || m.type() === 'warning') errors.push(txt);
});
page.on('pageerror', (e) => errors.push('[pageerror] ' + (e && e.stack || e)));
page.on('requestfailed', (r) => errors.push('[reqfail] ' + r.url() + ' ' + (r.failure() || {}).errorText));

const shot = async (name) => { if (doShots) await page.screenshot({ path: resolve(SHOTS, name + '.png') }); };

console.log('→ loading…');
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise((r) => setTimeout(r, 3500));

// --- report startup errors
const boot = await page.evaluate(() => {
  const g = window.__GAME__;
  return {
    hasGame: !!g,
    screen: g && g.ui && g.ui.current,
    webgl: !!g && !!g.world && !!g.world.renderer,
    renderer: g && g.world ? g.world.renderer.getContext().getParameter(g.world.renderer.getContext().VERSION) : null,
    trebuchet: !!g && !!g.trebuchet,
    blocks: g && g.structures ? g.structures.blocks.length : -1,
  };
});
console.log('boot:', JSON.stringify(boot, null, 1));
await shot('01-menu');

// --- navigate screens
async function clickText(txt) {
  const ok = await page.evaluate((t) => {
    const nodes = Array.from(document.querySelectorAll('button, .menu-btn, .btn, .mission-tile'));
    const n = nodes.find((x) => (x.textContent || '').includes(t));
    if (n) { n.click(); return true; }
    return false;
  }, txt);
  await new Promise((r) => setTimeout(r, 700));
  return ok;
}

for (const [label, file] of [['Чертёжная', '02-workshop'], ['Расчёт', '03-crew'], ['Лагерь', '04-camp'], ['Кампания', '05-contracts'], ['Настройки', '06-settings']]) {
  const found = await clickText(label);
  console.log(`screen "${label}": ${found ? 'ok' : 'NOT FOUND'}`);
  await shot(file);
  await page.evaluate(() => { const g = window.__GAME__; g.ui.show('menu'); });
  await new Promise((r) => setTimeout(r, 400));
}

// --- start the training mission and actually play
console.log('→ starting training mission…');
await clickText('Полигон');
await new Promise((r) => setTimeout(r, 900));
await shot('07-briefing');

const startOk = await clickText('В ОСАДУ');
console.log('start battle:', startOk);
await new Promise((r) => setTimeout(r, 4000));
await shot('08-battle');

const battle = await page.evaluate(() => {
  const g = window.__GAME__;
  return {
    inBattle: g.inBattle,
    targets: g.structures.targets.length,
    blocks: g.structures.blocks.length,
    supply: g.economy.budget,
    wind: g.physics.windSpeed().toFixed(2),
    trebuchetHp: (g.trebuchet.condition * 100).toFixed(0),
    hudVisible: g.hud.visible,
    predVisible: g.vfx.predLine.visible,
  };
});
console.log('battle:', JSON.stringify(battle));

// --- power strip: absolute power mapping, az/el untouched (1.5.0 pad redesign)
const stripBox = await (await page.$('#powerstrip')).boundingBox();
const pwBefore = await page.evaluate(() => ({ ...window.__GAME__.hud.aimValues }));
await page.touchscreen.touchStart(stripBox.x + stripBox.width * 0.84, stripBox.y + stripBox.height / 2);
await page.touchscreen.touchMove(stripBox.x + stripBox.width * 0.84, stripBox.y + stripBox.height / 2);
await page.touchscreen.touchEnd();
await new Promise((r) => setTimeout(r, 400));
const pwAfter = await page.evaluate(() => ({ ...window.__GAME__.hud.aimValues }));
console.log('power strip:', JSON.stringify({ pw: +pwAfter.power.toFixed(2), azSame: pwAfter.az === pwBefore.az, elSame: pwAfter.el === pwBefore.el }));
if (!(Math.abs(pwAfter.power - (0.3 + 0.84 * 0.7)) < 0.03 && pwAfter.az === pwBefore.az && pwAfter.el === pwBefore.el)) {
  errors.push('[assert] power strip mapping broken or leaks into az/el');
}
// precision panel must be GONE (no extra windows)
if (await page.evaluate(() => !!document.querySelector('#hud .hud-panel input[type=range]'))) {
  errors.push('[assert] precision panel still in DOM (should be removed in 1.5.0)');
}

// --- REAL TOUCH drag on the aim pad must steer the aim and fire on release
console.log('→ touch-drag aim test…');
const padBox = await (await page.$('#aimpad')).boundingBox();
const pcx = padBox.x + padBox.width / 2, pcy = padBox.y + padBox.height * 0.62;
const aimBefore = await page.evaluate(() => ({ ...window.__GAME__.hud.aimValues }));
await page.touchscreen.touchStart(pcx, pcy);
await page.touchscreen.touchMove(pcx + 34, pcy - 26);
await page.touchscreen.touchMove(pcx + 52, pcy - 40);
const aimDuring = await page.evaluate(() => ({ ...window.__GAME__.hud.aimValues }));
await page.touchscreen.touchEnd();
await new Promise((r) => setTimeout(r, 1200));
const touchShots = await page.evaluate(() => window.__GAME__.shotsThisMission.length);
console.log('touch aim:', JSON.stringify({
  azBefore: +aimBefore.az.toFixed(1), azDuring: +aimDuring.az.toFixed(1),
  elBefore: +aimBefore.el.toFixed(1), elDuring: +aimDuring.el.toFixed(1),
  pwBefore: +aimBefore.power.toFixed(2), pwDuring: +aimDuring.power.toFixed(2),
  firedOnRelease: touchShots > 0,
}));
if (!(aimDuring.az < aimBefore.az - 3 && aimDuring.el > aimBefore.el + 3 && touchShots > 0)) {
  errors.push('[assert] touch aim drag/release did not steer+fire (screen-space az flip?)');
}
if (Math.abs(aimDuring.power - aimBefore.power) > 1e-9) {
  errors.push('[assert] stick drag still leaks into power (U1 coupling not fixed)');
}
await new Promise((r) => setTimeout(r, 5000));

// --- release inside the RED CANCEL ZONE must NOT fire (device regression)
const shotsBeforeCancel = await page.evaluate(() => window.__GAME__.shotsThisMission.length);
const cancelX = padBox.x + 10 + 46, cancelY = padBox.y + padBox.height - 44 - 46;
await page.touchscreen.touchStart(pcx, pcy);
await page.touchscreen.touchMove(cancelX + 6, cancelY + 4);
await new Promise((r) => setTimeout(r, 120));
await page.touchscreen.touchEnd();
await new Promise((r) => setTimeout(r, 900));
const shotsAfterCancel = await page.evaluate(() => window.__GAME__.shotsThisMission.length);
console.log('cancel zone:', JSON.stringify({ shotsBeforeCancel, shotsAfterCancel }));
if (shotsAfterCancel !== shotsBeforeCancel) errors.push('[assert] release in cancel zone still fired');

// --- fire a shot through the solver path
console.log('→ firing…');
const before = await page.evaluate(() => ({ shots: window.__GAME__.shotsThisMission.length, alive: window.__GAME__.structures.aliveBlocks }));
await page.evaluate(() => {
  const g = window.__GAME__;
  g._autoAimSuggest();          // use the in-game solver, like a real first shot
  g.tryFire();
});
await new Promise((r) => setTimeout(r, 2500));
await shot('09-flight');
await new Promise((r) => setTimeout(r, 4000));
await shot('10-impact');
const after = await page.evaluate(() => {
  const g = window.__GAME__;
  return {
    shots: g.shotsThisMission.length,
    alive: g.structures.aliveBlocks,
    destroyed: g.structures.destroyedCount,
    loot: g.structures.lootPool,
    hp: (g.trebuchet.condition * 100).toFixed(0),
    supply: Math.round(g.economy.supplyLeft),
    debris: g.debris.count,
    fps: g.frame.fps,
    drawCalls: g.world.renderer.info.render.calls,
    tris: g.world.renderer.info.render.triangles,
  };
});
console.log('after shot:', JSON.stringify(after));

// --- fire several more shots to exercise destruction + cascade
for (let i = 0; i < 4; i++) {
  await page.evaluate((n) => {
    const g = window.__GAME__;
    g._autoAimSuggest();        // re-solve on the current target
    if (n === 1) g.trebuchet.setAim(g.trebuchet.aim.az, g.trebuchet.aim.el + 6, g.trebuchet.aim.power); // deliberate miss sample
    g.hud.aimValues = { az: g.trebuchet.aim.az, el: g.trebuchet.aim.el, power: g.trebuchet.aim.power };
    g.tryFire();
  }, i);
  await new Promise((r) => setTimeout(r, 6000));
}
await shot('11-after-many-shots');
const state2 = await page.evaluate(() => {
  const g = window.__GAME__;
  return {
    shots: g.shotsThisMission.length,
    destroyed: g.structures.destroyedCount,
    targetsDown: g.structures.targets.filter((t) => t.destroyed).length,
    targets: g.structures.targets.length,
    hp: (g.trebuchet.condition * 100).toFixed(0),
    loot: g.structures.lootPool,
    fps: g.frame.fps,
    dc: g.world.renderer.info.render.calls,
    tris: g.world.renderer.info.render.triangles,
    heap: performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(0) + 'MB' : 'n/a',
  };
});
console.log('state2:', JSON.stringify(state2));

// --- end mission & results screen
await page.evaluate(() => { const g = window.__GAME__; g.endMission(true); });
await new Promise((r) => setTimeout(r, 2500));
await shot('12-results');
const res = await page.evaluate(() => ({ screen: window.__GAME__.ui.current, coins: window.__GAME__ && window.__GAME__.ui ? document.body.innerText.slice(0, 200) : '' }));
console.log('results screen:', res.screen);

// --- summary
console.log('\n================ ERRORS ================');
if (!errors.length) console.log('none ✔');
else errors.slice(0, 40).forEach((e) => console.log(e.slice(0, 400)));
console.log('\n=============== LAST LOGS ===============');
logs.slice(-25).forEach((l) => console.log(l.slice(0, 300)));

await browser.close();
server.close();
process.exit(errors.filter((e) => !/Multiple instances|THREE.WebGLRenderer: A WebGL context could not|deprecat/i.test(e)).length ? 1 : 0);
