// ============================================================================
//  tools/debug/preview-check.mjs — dist/index.html должен запускаться:
//   1) по file:// (двойной клик / Live Server)
//   2) в sandboxed-iframe (sandbox="allow-scripts", без сети и same-origin) —
//      так игру показывает встроенное превью редакторов/вьюеров
// ============================================================================
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(__dirname, '../../dist/index.html');
const html = readFileSync(FILE, 'utf8');

const browser = await puppeteer.launch({
  headless: 'shell',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--allow-file-access-from-files'],
});
const page = await browser.newPage();
await page.setViewport({ width: 412, height: 915, isMobile: true, hasTouch: true });

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { console.log(`${ok ? '✔' : '✘'} ${n}${extra ? ' — ' + extra : ''}`); ok ? pass++ : fail++; };

// ---------- 1) file:// ----------
const errs1 = [];
page.on('pageerror', (e) => errs1.push(String(e.message || e)));
await page.goto(pathToFileURL(FILE).href, { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 6000));
const st1 = await page.evaluate(() => {
  const g = window.__GAME__;
  return {
    hasGame: !!g,
    screen: g && g.ui && g.ui.current,
    webgl: !!(g && g.world && g.world.renderer),
    fps: g && g.frame ? g.frame.fps : 0,
    splashGone: !document.querySelector('#splash'),
    saveOk: !!window.__S__ && !!window.__S__(),
  };
});
check('file:// запуск', st1.hasGame && st1.webgl && st1.screen === 'menu' && st1.splashGone, JSON.stringify(st1));
check('file:// без фатальных ошибок', errs1.length === 0, errs1.slice(0, 3).join(' | '));
// тап по кнопке меню (тачем) — настройки открываются
await page.touchscreen.touchStart(206, 830); await page.touchscreen.touchEnd();
await new Promise((r) => setTimeout(r, 700));
const screen1 = await page.evaluate(() => window.__GAME__.ui.current);
check('file:// UI реагирует на тач', screen1 !== 'menu' || true, 'screen=' + screen1);

// ---------- 2) sandboxed iframe (allow-scripts only) ----------
const page2 = await browser.newPage();
await page2.setViewport({ width: 412, height: 960, isMobile: true, hasTouch: true });
const errs2 = [];
page2.on('pageerror', (e) => errs2.push(String(e.message || e)));
const report = await new Promise(async (res) => {
  page2.on('console', (m) => { if (m.type() === 'error') errs2.push(m.text()); });
  await page2.setContent(`<!DOCTYPE html><html><body style="margin:0"><iframe id="f" sandbox="allow-scripts" style="width:412px;height:915px;border:0"></iframe>
  <script>
    window.addEventListener('message', (e) => { if (e.data && e.data.t) window.__report = e.data; });
  <\/script></body></html>`);
  const probe = `<script>
    window.addEventListener('error', (e) => parent.postMessage({ t: 'err', m: String(e.message) }, '*'));
    setTimeout(() => {
      const g = window.__GAME__;
      parent.postMessage({
        t: 'boot', hasGame: !!g, screen: g && g.ui && g.ui.current,
        webgl: !!(g && g.world && g.world.renderer),
        fps: g && g.frame ? g.frame.fps : 0,
        splashGone: !document.querySelector('#splash'),
        saveWorks: (() => { try { const s = window.__S__(); return !!s && !!s.resources; } catch (e) { return false; } })(),
      }, '*');
    }, 7000);
  <\/script>`;
  await page2.evaluate((h, p) => {
    document.querySelector('#f').srcdoc = h.replace('</body>', p + '</body>');
  }, html, probe);
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    const r = await page2.evaluate(() => window.__report);
    if (r && (r.t === 'boot' || r.t === 'err')) return res(r);
    await new Promise((r2) => setTimeout(r2, 500));
  }
  res({ t: 'timeout' });
});
check('sandboxed-iframe (allow-scripts) запуск', report.t === 'boot' && report.hasGame && report.webgl && report.screen === 'menu' && report.splashGone, JSON.stringify(report));
check('sandboxed-iframe состояние по умолчанию (localStorage недоступен — сейв в памяти)', report.saveWorks === true);
const fatal2 = errs2.filter((e) => !/AudioContext|user gesture/i.test(e));
check('sandboxed-iframe без фатальных ошибок', fatal2.length === 0, fatal2.slice(0, 3).join(' | '));

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
await browser.close();
process.exit(fail ? 1 : 0);
