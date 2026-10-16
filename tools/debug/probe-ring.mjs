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
page.on('pageerror', e => console.log('[PAGEERROR]', String(e.message).slice(0, 120)));
await page.goto(`http://localhost:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 4000));
await page.evaluate(() => { const n = Array.from(document.querySelectorAll('.menu-btn')).find(x => (x.textContent||'').includes('Полигон')); n.click(); });
await new Promise(r => setTimeout(r, 800));
await page.evaluate(() => { const n = Array.from(document.querySelectorAll('.btn')).find(x => (x.textContent||'').includes('В ОСАДУ')); n.click(); });
await new Promise(r => setTimeout(r, 6000));
await page.evaluate(() => window.__GAME__._finishTutorial());
console.log(JSON.stringify(await page.evaluate(() => {
  const g = window.__GAME__;
  g.selectAmmo('explosive');
  g._autoAimSuggest();
  const pred = g._prediction;
  const r1 = { radius: pred.impact && pred.impact.radius, showPredict: window.__S__().settings.showPredict, inBattle: g.inBattle };
  g._updatePrediction();
  const r2 = { ring: g.vfx.blastRing.visible, labelOn: g.vfx.impactLabel.style.display !== 'none' };
  // кто-то прячет? обернём hidePrediction
  let hider = null;
  const origHide = g.vfx.hidePrediction.bind(g.vfx);
  g.vfx.hidePrediction = () => { hider = new Error().stack.split('\n')[2]; return origHide(); };
  g._updatePrediction();
  const r3 = { ring: g.vfx.blastRing.visible, hider };
  g.vfx.hidePrediction = origHide;
  return { r1, r2, r3 };
})));
await browser.close(); server.close(); process.exit(0);
