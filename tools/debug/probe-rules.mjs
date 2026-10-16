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
await page.goto(`http://localhost:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 4000));
console.log(JSON.stringify(await page.evaluate(() => {
  const C = window.__CFG__;
  const g = window.__GAME__;
  const ammo = { explosive: C.ammo.explosive, grapeshot: C.ammo.grapeshot };
  // predictFull вне боя (menu scene) — просто математика
  const V = g.trebuchet.root.position.clone().constructor;
  const origin = new V(0, 3, 0);
  const dir = new V(0, 0.7, 0.7).normalize();
  const pr = g.ballistics.predictFull(origin, dir, 30, 'explosive', { points: 80, dt: 0.06 });
  return { ammoRadius: ammo.explosive.radius, ammoFuse: ammo.explosive.fuse, predRadius: pr.radius, predFuse: pr.fuse, det: pr.detonation ? pr.detonation.toArray().map(v => +v.toFixed(1)) : null };
})));
await browser.close(); server.close(); process.exit(0);
