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
await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
await page.goto(`http://localhost:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 4000));
// качество high (тени 2048 + bloom полный)
await page.evaluate(() => {
  const s = window.__S__().settings;
  s.quality = 0; s.autoQuality = false; s.shadows = true; s.postFx = true;
  window.__GAME__.applySettings();
});
await new Promise(r => setTimeout(r, 1500));
console.log('menu state:', JSON.stringify(await page.evaluate(() => {
  const g = window.__GAME__, w = g.world;
  return { shadowOn: w.renderer.shadowMap.enabled, sunCast: w.lights.sun.castShadow, post: w.postEnabled, bloom: w.bloomOn, tone: w.renderer.toneMapping };
})));
await page.screenshot({ path: 'shots/gfx-1-menu.png' });
// старт тренировки → скриншот боя
await page.evaluate(() => {
  const n = Array.from(document.querySelectorAll('.menu-btn')).find(x => (x.textContent||'').includes('Полигон'));
  n && n.click();
});
await new Promise(r => setTimeout(r, 900));
await page.evaluate(() => {
  const n = Array.from(document.querySelectorAll('.btn')).find(x => (x.textContent||'').includes('В ОСАДУ'));
  n && n.click();
});
await new Promise(r => setTimeout(r, 6500));
await page.evaluate(() => window.__GAME__._finishTutorial());
console.log('battle state:', JSON.stringify(await page.evaluate(() => {
  const g = window.__GAME__, w = g.world;
  const sf = w.lights.sun.shadow;
  return { inBattle: g.inBattle, shadowOn: w.renderer.shadowMap.enabled, mapSize: sf.mapSize.x, frustum: [sf.camera.left, sf.camera.right, sf.camera.far], sky: w.skyThemeId, blocksCast: g.structures.meshes.get('stone') ? g.structures.meshes.get('stone').castShadow : null, terrainRecv: g.terrainMesh.receiveShadow };
})));
await page.screenshot({ path: 'shots/gfx-2-battle.png' });
// выстрел → свечение/вспышки в полёте и при попадании
await page.evaluate(() => { const g = window.__GAME__; g._autoAimSuggest(); g.tryFire(); });
await new Promise(r => setTimeout(r, 2600));
await page.screenshot({ path: 'shots/gfx-3-flight.png' });
await new Promise(r => setTimeout(r, 3500));
await page.screenshot({ path: 'shots/gfx-4-impact.png' });
console.log('streak/flash:', JSON.stringify(await page.evaluate(() => {
  const g = window.__GAME__;
  return { streak: g.streak, best: g.streakBest, flash: +g.world.flashAmount.toFixed(2), badge: document.querySelector('#aimread .streak') ? document.querySelector('#aimread .streak').textContent : null };
})));
// ночная миссия — проверим тему неба и тени при луне
await page.evaluate(() => { window.__GAME__.world.applySkyTheme('night'); });
await new Promise(r => setTimeout(r, 900));
await page.screenshot({ path: 'shots/gfx-5-night.png' });
console.log('errors:', errors.length ? errors.slice(0,4) : 'none');
await browser.close(); server.close(); process.exit(0);
