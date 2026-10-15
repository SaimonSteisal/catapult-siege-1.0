import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import puppeteer from 'puppeteer';
const DIST = resolve(process.cwd(), 'dist');
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = resolve(DIST, '.' + p);
  if (!existsSync(f)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, r));
const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--use-angle=swiftshader','--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 412, height: 915, isMobile: true, hasTouch: true });
page.on('pageerror', e => console.log('[pageerror]', String(e.message).slice(0, 200)));
await page.goto(`http://localhost:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 4000));
await page.evaluate(() => { const s = window.__S__().settings; s.quality = 0; s.autoQuality = false; });
// кампания 1-1 (гарнизон есть)
await page.evaluate(() => { const n = Array.from(document.querySelectorAll('.menu-btn')).find(x => (x.textContent||'').includes('Продолжить')); n.click(); });
await new Promise(r => setTimeout(r, 900));
console.log('briefing comp:', await page.evaluate(() => {
  const m = window.__GAME__.ui.current === 'briefing' ? null : null;
  return document.querySelector('.screen-body')?.textContent.match(/🏹×\d+[^🪙]*/)?.[0] || 'НЕ ВИДНО';
}));
await page.evaluate(() => { const n = Array.from(document.querySelectorAll('.btn')).find(x => (x.textContent||'').includes('В ОСАДУ')); n.click(); });
await new Promise(r => setTimeout(r, 7000));
await page.evaluate(() => window.__GAME__._finishTutorial());
console.log('units:', JSON.stringify(await page.evaluate(() => {
  const g = window.__GAME__, e = g.enemy;
  const byRole = {};
  for (const u of e.units) byRole[u.role] = (byRole[u.role] || 0) + 1;
  const onWall = e.units.filter(u => u.pos.y > 2.5).length;
  return { total: e.units.length, byRole, onWall, kits: Object.keys(e.engineKits || {}).length, engines: e.engines.length, meshes: Object.keys(e.roleMeshes), morale: +e.morale.toFixed(2) };
})));
// камера ближе к крепости для читаемости юнитов
await page.evaluate(() => { const g = window.__GAME__; g.rig.setMode('battle', { force: true, target: g.structures.targets[0].center.clone(), dist: 26, az: 180, pol: 70 }); });
await new Promise(r => setTimeout(r, 1500));
await page.screenshot({ path: 'shots/units-1-fort.png' });
// волна-опрос: был ли залп лучников (rattle/стрелы) за 25 c
const volleySeen = await page.evaluate(async () => {
  const g = window.__GAME__;
  for (let i = 0; i < 50; i++) {
    if (g.rattleT > 0 || (g.enemy.arrows && g.enemy.arrows.length)) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
});
console.log('volley лучников за 25 c:', volleySeen);
// прицельный выстрел ПО ЛУЧНИКУ на стене: proxy-коллизия обязана убить
const aimKill = await page.evaluate(() => {
  const g = window.__GAME__;
  const u = g.enemy.units.find((x) => x.role === 'archer' && x.alive);
  if (!u) return { ok: false, why: 'no archer' };
  const pt = u.pos.clone(); pt.y += 0.6;
  const V = pt.clone().constructor;   // THREE.Vector3 via instance
  const azT = Math.atan2(pt.x - g.trebuchet.root.position.x, pt.z - g.trebuchet.root.position.z) * 180 / Math.PI;
  let best = null;
  for (let el = 35; el <= 78; el += 4) {
    for (let pw = 0.4; pw <= 1.001; pw += 0.04) {
      g.trebuchet.setAim(azT, el, pw);
      const dir = g.trebuchet.launchDir(new V());
      const o = g.trebuchet.predictOrigin(new V());
      const pts = g.ballistics.predict(o, dir, g.trebuchet.launchSpeed(pw), 'stone', { points: 150, dt: 0.05 });
      const end = pts.hit ? pts.hit.point : pts[pts.length - 1];
      if (!end) continue;
      const d = Math.hypot(end.x - pt.x, end.z - pt.z) + Math.abs(end.y - pt.y) * 0.5;
      if (!best || d < best.d) best = { d, el, pw };
    }
  }
  if (!best || best.d > 1.6) return { ok: false, why: 'no lob solution', best };
  g.trebuchet.setAim(azT, best.el, best.pw);
  g.hud.aimValues = { az: azT, el: best.el, power: best.pw };
  g.hud.setAimReadout(g.hud.aimValues);
  const fired = g.tryFire();
  return { ok: fired, best: { d: +best.d.toFixed(2), el: best.el, pw: +best.pw.toFixed(2) } };
});
await new Promise(r => setTimeout(r, 6000));
const killState = await page.evaluate(() => ({ killed: window.__GAME__.enemy.killed, stats: window.__S__().stats.soldiersKilled, morale: +window.__GAME__.enemy.morale.toFixed(2) }));
console.log('aimKill:', JSON.stringify(aimKill), '→', JSON.stringify(killState));
console.log('after shots:', JSON.stringify(await page.evaluate(() => {
  const g = window.__GAME__;
  return { killed: g.enemy.killed, alive: g.enemy.aliveSoldiers, morale: +g.enemy.morale.toFixed(2), rattle: +g.rattleNow().toFixed(2), stats: window.__S__().stats.soldiersKilled, hud: document.querySelector('.hud-obj .t')?.textContent };
})));
await page.screenshot({ path: 'shots/units-2-after.png' });
// volley от лучников произошел?
// широкий кадр крепости для презентации
await page.evaluate(() => { const g = window.__GAME__; g.rig.setMode('battle', { force: true, target: g.structures.targets[0].center.clone(), dist: 44, az: 180, pol: 66 }); });
await new Promise(r => setTimeout(r, 1500));
await page.screenshot({ path: 'shots/units-3-wide.png' });
await browser.close(); server.close(); process.exit(0);
