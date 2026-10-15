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
page.on('pageerror', e => console.log('[pageerror]', String(e.message).slice(0, 160)));
await page.goto(`http://localhost:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 4000));
await page.evaluate(() => { const s = window.__S__().settings; s.quality = 2; s.shadows = false; s.postFx = false; window.__GAME__.applySettings(); });
await page.evaluate(() => { const n = Array.from(document.querySelectorAll('.menu-btn')).find(x => (x.textContent||'').includes('Продолжить')); n.click(); });
await new Promise(r => setTimeout(r, 900));
await page.evaluate(() => { const n = Array.from(document.querySelectorAll('.btn')).find(x => (x.textContent||'').includes('В ОСАДУ')); n.click(); });
await new Promise(r => setTimeout(r, 7000));
await page.evaluate(() => window.__GAME__._finishTutorial());
const res = await page.evaluate(async () => {
  const g = window.__GAME__;
  const e = g.enemy;
  window.__sw = { calls: 0, minD: 99, hits: 0, frames: 0 };
  const orig = e.sweepSegment.bind(e);
  e.sweepSegment = (a, b, radius, maxHits) => {
    window.__sw.calls++;
    const seg = [+a.x.toFixed(1), +a.y.toFixed(1), +a.z.toFixed(1), '+', +b.x.toFixed(1), +b.y.toFixed(1), +b.z.toFixed(1)];
    if (window.__sw.calls === 1) window.__sw.first = seg;
    window.__sw.last = seg;
    // min distance to nearest alive unit for diagnostics
    for (const u of e.units) {
      if (!u.alive) continue;
      const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
      const len2 = ab.x*ab.x + ab.y*ab.y + ab.z*ab.z || 1e-6;
      const t = Math.max(0, Math.min(1, ((u.pos.x - a.x)*ab.x + (u.pos.y + 0.8 - a.y)*ab.y + (u.pos.z - a.z)*ab.z) / len2));
      const px = a.x + ab.x*t, py = a.y + ab.y*t, pz = a.z + ab.z*t;
      const d = Math.hypot(u.pos.x - px, u.pos.z - pz) + Math.abs(u.pos.y + 0.8 - py) * 0.25;
      if (d < window.__sw.minD) window.__sw.minD = +d.toFixed(2);
    }
    const r = orig(a, b, radius, maxHits);
    if (r.length) window.__sw.hits++;
    return r;
  };
  const u = e.units.find((x) => x.role === 'archer' && x.alive);
  const pt = u.pos.clone(); pt.y += 0.6;
  const V = pt.clone().constructor;
  const azT = Math.atan2(pt.x - g.trebuchet.root.position.x, pt.z - g.trebuchet.root.position.z) * 180 / Math.PI;
  let best = null;
  for (let el = 35; el <= 78; el += 4) for (let pw = 0.4; pw <= 1.001; pw += 0.04) {
    g.trebuchet.setAim(azT, el, pw);
    const pts = g.ballistics.predict(g.trebuchet.predictOrigin(new V()), g.trebuchet.launchDir(new V()), g.trebuchet.launchSpeed(pw), 'stone', { points: 150, dt: 0.05 });
    const end = pts.hit ? pts.hit.point : pts[pts.length - 1];
    if (!end) continue;
    const d = Math.hypot(end.x - pt.x, end.z - pt.z) + Math.abs(end.y - pt.y) * 0.5;
    if (!best || d < best.d) best = { d, el, pw };
  }
  g.trebuchet.setAim(azT, best.el, best.pw);
  g.hud.aimValues = { az: azT, el: best.el, power: best.pw };
  window.__imp = [];
  const origImp = g.ballistics.onImpact;
  g.ballistics.onImpact = (r2) => { window.__imp.push({ kind: r2.kind, x: r2.point && +r2.point.x.toFixed(1), y: r2.point && +r2.point.y.toFixed(1), z: r2.point && +r2.point.z.toFixed(1) }); return origImp(r2); };
  window.__archer = { x: +u.pos.x.toFixed(1), y: +u.pos.y.toFixed(1), z: +u.pos.z.toFixed(1) };
  window.__aim = { az: +azT.toFixed(1), el: best.el, pw: best.pw, applied: { ...g.trebuchet.aim } };
  g.tryFire();
  for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 500)); if (window && false) break; }
  // дочитаться до результата: ждём impact или killed
  for (let i = 0; i < 40; i++) { if (e.killed > 0 || window.__imp.length) break; await new Promise(r => setTimeout(r, 500)); }
  return { best, sw: window.__sw, killed: e.killed, imp: window.__imp, archer: window.__archer, aim: window.__aim };
});
console.log(JSON.stringify(res));
await browser.close(); server.close(); process.exit(0);
