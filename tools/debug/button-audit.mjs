// ============================================================================
//  tools/debug/button-audit.mjs — тотальный аудит кнопок РЕАЛЬНЫМИ тачами
//  (page.touchscreen), как на телефоне: меню → все экраны → брифинг → HUD боя →
//  пауза → настройки из паузы → результаты → тестер-панель.
//
//  Каждый тап обязан: (а) не бросать pageerror, (б) дать отклик — смена экрана,
//  тост, изменение состояния/панели. Молчаливый no-op = «кнопка не работает».
//  Перед каждым тапом проверяется, чем именно занята точка (elementFromPoint):
//  если её перекрыл другой элемент, тест сообщает об этом явно, а не «молчит».
// ============================================================================
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, '../../dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
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
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 412, height: 915, isMobile: true, hasTouch: true });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('[console] ' + m.text()); });
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 3800));

let pass = 0, fail = 0;
const log = (name, ok, extra = '') => { console.log(`${ok ? '✔' : '✘'} ${name}${extra ? ' — ' + extra : ''}`); ok ? pass++ : fail++; };

// ------------------------------------------------------------------ helpers --
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const state = () => page.evaluate(() => {
  const g = window.__GAME__;
  return {
    ui: g.ui.current, inBattle: g.inBattle, paused: g.paused,
    shots: g.shotsThisMission.length, coins: window.__S__().resources.coins,
    stone: window.__S__().resources.stone,
  };
});
const toasts = () => page.evaluate(() => Array.from(document.querySelectorAll('#toasts .toast')).map((x) => x.textContent));
const visibleText = (sel) => page.evaluate((s) => {
  const n = document.querySelector(s);
  return n ? (n.textContent || '') : null;
}, sel);

/** найти элемент по тексту среди интерактивных, отскроллить в вид, вернуть центр + что в этой точке */
async function locate(label, opt = {}) {
  if (opt.rowText) {
    return page.evaluate((rt, ts) => {
      const row = Array.from(document.querySelectorAll('.setting')).find((x) => (x.textContent || '').includes(rt));
      if (!row) return { found: false };
      const n = row.querySelector(ts || '.switch');
      if (!n) return { found: false };
      n.scrollIntoView({ block: 'center' });
      const r = n.getBoundingClientRect();
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      const top = document.elementFromPoint(cx, cy);
      return { found: true, x: cx, y: cy, cls: 'row-switch', topCls: top ? top.tagName + '.' + top.className : null, covered: !(top === n || n.contains(top) || (top && top.contains(n))), rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
    }, opt.rowText, opt.targetSel);
  }
  return page.evaluate((t, o) => {
    const SEL = 'button, .menu-btn, .btn, .switch, .seg button, .mission-tile, .ammo-chip, .skill-btn, .tool-btn, .noderow';
    const nodes = Array.from(document.querySelectorAll(o.scope ? o.scope + ' ' + SEL : SEL))
      .filter((x) => x.offsetParent !== null || o.allowHidden);
    let n = null;
    if (t) n = o.exact ? nodes.find((x) => (x.textContent || '').trim() === t) : nodes.find((x) => (x.textContent || '').includes(t));
    if (!n && o.selectorFallback) n = document.querySelector(o.selectorFallback);
    if (!n) return { found: false };
    n.scrollIntoView({ block: 'center', inline: 'center' });
    const r = n.getBoundingClientRect();
    const cx = r.x + r.width / 2 + (o.dx || 0), cy = r.y + r.height / 2 + (o.dy || 0);
    const top = document.elementFromPoint(cx, cy);
    return {
      found: true, x: cx, y: cy,
      cls: (n.className || '').toString().slice(0, 40),
      topCls: top ? (top.tagName + '.' + (top.className || '').toString().slice(0, 40)) : null,
      covered: !(top === n || n.contains(top) || (top && top.contains && top.contains(n))),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    };
  }, label, opt);
}

/** реальный тач-тап; возвращает {tapped, covered, topCls} */
async function tap(label, opt = {}) {
  const loc = await locate(opt.rowText ? '' : label, opt);
  if (!loc.found) return { tapped: false, reason: 'not-found' };
  if (loc.covered && !opt.force) return { tapped: false, reason: 'covered', topCls: loc.topCls, loc };
  await page.touchscreen.touchStart(loc.x, loc.y);
  await wait(opt.holdMs || 30);
  await page.touchscreen.touchEnd();
  await wait(opt.wait === undefined ? 500 : opt.wait);
  return { tapped: true, covered: loc.covered, topCls: loc.topCls, loc };
}

/** тап + проверка отклика (экран сменился ИЛИ появился тост ИЛИ pred(before,after)) */
async function tapExpect(name, label, predicate, opt = {}) {
  const before = { ...(await state()), toastList: (await toasts()).join('|') };
  const r = await tap(label, opt);
  if (!r.tapped) {
    log(name, false, r.reason === 'covered' ? `точку перехватывает ${r.topCls} (rect ${JSON.stringify(r.loc.rect)})` : 'элемент не найден: ' + label);
    return false;
  }
  await wait(opt.extraWait || 0);
  const after = { ...(await state()), toastList: (await toasts()).join('|') };
  const responded = after.ui !== before.ui || after.toastList !== before.toastList;
  const ok = predicate ? predicate(before, after) : responded;
  log(name, ok, ok ? '' : `отклика нет: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  return ok;
}
const screenChanged = (b, a) => a.ui !== b.ui;
const toastShown = (b, a) => a.toastList !== b.toastList && a.toastList.length > 0;
const anyResponse = (b, a) => a.ui !== b.ui || a.toastList !== b.toastList;

/** гарантированно вернуться в главное меню */
async function toMenu() {
  for (let i = 0; i < 4; i++) {
    const s = await state();
    if (s.ui === 'menu') return true;
    await page.evaluate(() => { const g = window.__GAME__; if (g.inBattle) { g.inBattle = false; g.hud.show(false); } g.ui.show('menu'); });
    await wait(450);
  }
  return (await state()).ui === 'menu';
}
/** стартовать бой через UI (Полигон → В ОСАДУ) */
let tutSkipped = false;
async function startBattle(label = 'Полигон') {
  await toMenu();
  await tap(label); await wait(700);
  await tap('В ОСАДУ'); await wait(5000);
  const s = await state();
  // свежий профиль: бокс обучения перекрывает часть HUD — скипаем его РЕАЛЬНЫМ тапом
  if (s.inBattle && !tutSkipped) {
    const has = await page.evaluate(() => !!document.querySelector('.tut'));
    if (has) {
      const r = await tap('Пропустить обучение');
      await wait(500);
      const gone = await page.evaluate(() => !document.querySelector('.tut'));
      log('обучение: «Пропустить обучение» закрывает бокс', r.tapped && gone, r.tapped ? '' : r.reason + ':' + r.topCls);
      tutSkipped = true;
    }
  }
  return s.inBattle;
}
const toolBtn = (i) => ({ selectorFallback: `#hud .tool-row .tool-btn:nth-child(${i + 1})`, exact: false });

// ================================================================ АУДИТ ======
console.log('— ГЛАВНОЕ МЕНЮ: все 10 кнопок —');
for (const label of ['Кампания', 'Чертёжная', 'Расчёт', 'Мастерская ядер', 'Лагерь', 'Контракт дня', 'Испытание', 'Полигон', 'Настройки']) {
  const ok = await tapExpect(`меню: «${label}»`, label, screenChanged);
  if (ok) {
    const back = await tap('‹');
    const s = await state();
    log(`меню: «‹» из «${label}» → меню`, back.tapped && s.ui === 'menu', back.tapped ? 'ui=' + s.ui : back.reason + ':' + back.topCls);
  }
  await toMenu();
}
{
  // «Выход из игры» в браузере обязан честно объяснить, что вкладку нужно закрыть
  const r = await tap('Выход из игры');
  await wait(600);
  const tt = (await toasts()).join(' ');
  log('меню: «Выход из игры» объясняет (веб не может закрыться сам)', r.tapped && /вкладк|закрыт|close/i.test(tt), tt.slice(0, 70));
  await toMenu();
}
{
  const before = (await state()).ui;
  const r = await tap('Продолжить');
  const s = await state();
  log('меню: «Продолжить» → брифинг', r.tapped && s.ui === 'briefing', `ui ${before} → ${s.ui}`);
  await toMenu();
}

console.log('— НАСТРОЙКИ из меню: свитчи, сегменты, слайдеры, модалки —');
await tap('Настройки'); await wait(600);
{
  const before = await page.evaluate(() => window.__S__().settings.muted);
  const r = await tap(null, { rowText: 'Без звука' });
  const after = await page.evaluate(() => window.__S__().settings.muted);
  log('настройки: свитч «Без звука»', r.tapped && before !== after, `${before} → ${after}${r.tapped ? '' : ' (' + r.reason + ':' + r.topCls + ')'}`);
  if (after) await tap(null, { rowText: 'Без звука' });   // вернуть
}
{
  const r = await tap(null, { rowText: 'Показывать FPS' });
  const on = await page.evaluate(() => ({ s: !!window.__S__().settings.showFps, cfg: window.__CFG__.dev.showFps }));
  log('настройки: «Показывать FPS» → settings + CFG.dev.showFps', r.tapped && on.s && on.cfg, JSON.stringify(on));
  await tap(null, { rowText: 'Показывать FPS' });   // вернуть
}
{
  const r = await tap('Низкое');
  await wait(500);
  const q = await page.evaluate(() => ({ q: window.__S__().settings.quality, auto: window.__S__().settings.autoQuality, perf: window.__GAME__.perf.index, ui: window.__GAME__.ui.current }));
  log('настройки: качество «Низкое» + авто выкл + остались в настройках', r.tapped && q.q === 2 && q.auto === false && q.perf === 2 && q.ui === 'settings', JSON.stringify(q));
  await page.evaluate(() => { window.__S__().settings.quality = 1; window.__GAME__.applySettings(); });
}
{
  const before = await page.evaluate(() => window.__S__().settings.music);
  const loc = await locate('Музыка', { scope: '.setting' });
  // слайдер: тап по правой части дорожки меняет значение
  const slider = await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.setting')).find((x) => (x.textContent || '').includes('Музыка'));
    const inp = row && row.querySelector('input[type=range]');
    if (!inp) return null;
    const r = inp.getBoundingClientRect();
    return { x: r.x + r.width * 0.85, y: r.y + r.height / 2 };
  });
  if (slider) { await page.touchscreen.touchStart(slider.x, slider.y); await wait(40); await page.touchscreen.touchEnd(); }
  await wait(600);
  const after = await page.evaluate(() => window.__S__().settings.music);
  log('настройки: слайдер «Музыка» меняется тачем', !!slider && after !== before, `${before} → ${after}`);
}
{
  const before = await page.evaluate(() => window.__GAME__.world.renderer.shadowMap.enabled);
  const r = await tap(null, { rowText: 'Тени' });
  const after = await page.evaluate(() => ({ on: window.__GAME__.world.renderer.shadowMap.enabled, set: window.__S__().settings.shadows }));
  log('настройки: «Тени» переключают shadowMap.live', r.tapped && after.on !== before && after.set === false, JSON.stringify(after));
  await tap(null, { rowText: 'Тени' });   // вернуть
  await new Promise((rr) => setTimeout(rr, 400));
}
{
  const r = await tap(null, { rowText: 'Пост-обработка' });
  const after = await page.evaluate(() => ({ s: window.__S__().settings.postFx, want: window.__GAME__.world.postFxWanted, en: window.__GAME__.world.postEnabled, ok: window.__GAME__.world.postSelfOk }));
  log('настройки: «Пост-обработка».toggle (с GPU-гардом)', r.tapped && after.s === false && after.want === false && after.en === (after.s !== false && after.ok !== false), JSON.stringify(after));
  await tap(null, { rowText: 'Пост-обработка' });   // вернуть
  await new Promise((rr) => setTimeout(rr, 400));
}
{
  const r = await tap('Импорт сейва');
  await wait(500);
  const modal = await page.evaluate(() => !!document.querySelector('.modal-bg textarea'));
  log('настройки: «Импорт сейва» → модалка с textarea (не prompt)', r.tapped && modal, r.tapped ? '' : r.reason);
  const c = await tap('Отмена');
  await wait(400);
  const closed = await page.evaluate(() => !document.querySelector('.modal-bg'));
  log('настройки: «Отмена» закрывает модалку', c.tapped && closed, c.tapped ? '' : c.reason + ':' + c.topCls);
}
{
  const r = await tap('Сброс прогресса');
  await wait(500);
  const modal = await page.evaluate(() => !!document.querySelector('.modal-bg'));
  log('настройки: «Сброс прогресса» требует подтверждения', r.tapped && modal);
  const c = await tap('Отмена');
  await wait(400);
  const still = await state();
  log('настройки: отмена сброса не удаляет сейв', c.tapped && still.ui === 'settings', 'ui=' + still.ui);
}
{
  const r = await tap('RU');
  await wait(400);
  const l1 = await page.evaluate(() => ({ lang: window.__S__().lang, ui: window.__GAME__.ui.current, junk: 'langRoot' in window.__S__().settings }));
  const r2 = await tap('EN');
  await wait(600);
  const l2 = await page.evaluate(() => ({ lang: window.__S__().lang, h1: (document.querySelector('.screen-head h1') || {}).textContent, junk: 'langRoot' in window.__S__().settings }));
  log('настройки: язык RU→EN переключается и перерисовывает экран', l1.lang === 'ru' && l2.lang === 'en' && /settings/i.test(l2.h1 || '') && !l2.junk, JSON.stringify(l2));
  await tap('RU'); await wait(500);
}
{
  const r = await tap('‹');
  await wait(500);
  log('настройки: «‹» из меню → меню', r.tapped && (await state()).ui === 'menu', r.tapped ? 'ui=' + (await state()).ui : r.reason);
}

console.log('— КАМПАНИЯ: плитки миссий —');
await tap('Кампания'); await wait(600);
await tapExpect('кампания: залоченная плитка объясняет (тост)', '.mission-tile.locked', toastShown, { selectorFallback: '.mission-tile.locked' });
{
  const r = await tap('1-1', { selectorFallback: '.mission-tile:not(.locked)' });
  const s = await state();
  log('кампания: открытая плитка → брифинг', r.tapped && s.ui === 'briefing', r.tapped ? 'ui=' + s.ui : r.reason);
}
await toMenu();

console.log('— БРИФИНГ: +/− боезапаса и старт —');
await tap('Полигон'); await wait(800);
{
  const cnt = () => page.evaluate(() => {
    const tag = Array.from(document.querySelectorAll('.grid2 .card .tag.gold')).find((x) => (x.textContent || '').includes('×'));
    return tag ? parseInt((tag.textContent || '').replace(/\D/g, ''), 10) : -1;
  });
  const c0 = await cnt();
  const plus = await tap('+', { scope: '.grid2 .card' });
  const c1 = await cnt();
  log('брифинг: «+» добавляет ядро', plus.tapped && c1 === c0 + 1, `${c0} → ${c1}${plus.tapped ? '' : ' (' + plus.reason + ')'}`);
  const minus = await tap('−', { scope: '.grid2 .card' });
  const c2 = await cnt();
  log('брифинг: «−» убирает ядро', minus.tapped && c2 === c0, `${c1} → ${c2}`);
}
{
  const r = await tap('В ОСАДУ');
  await wait(5500);
  const s = await state();
  log('брифинг: «В ОСАДУ» начинает бой', r.tapped && s.inBattle && (s.ui === null || s.ui === 'none'), JSON.stringify({ ui: s.ui, inBattle: s.inBattle }));
  // обучение перекрывает HUD — скипаем реальным тапом (заодно проверяем кнопку)
  const hasTut = await page.evaluate(() => !!document.querySelector('.tut'));
  if (hasTut) {
    const rs = await tap('Пропустить обучение');
    await wait(500);
    const gone = await page.evaluate(() => !document.querySelector('.tut'));
    log('обучение: «Пропустить обучение» закрывает бокс', rs.tapped && gone, rs.tapped ? '' : rs.reason + ':' + rs.topCls);
    tutSkipped = true;
  }
}

console.log('— HUD БОЯ: все 6 инструментов + чипы + умения + ОГОНЬ —');
const TOOL = ['Ремонт (hold)', 'Осмотр', 'Точный', '⌂', '🧪', '⏸'];
{
  // power-полоса: меняет ТОЛЬКО мощность (U1-фикс) и не стреляет при отпускании
  const before = await page.evaluate(() => ({ ...window.__GAME__.hud.aimValues, shots: window.__GAME__.shotsThisMission.length }));
  const loc = await page.evaluate(() => { const r = document.querySelector('#powerstrip').getBoundingClientRect(); return { x: r.left + r.width * 0.9, y: r.top + r.height / 2 }; });
  await page.touchscreen.touchStart(loc.x, loc.y);
  await page.touchscreen.touchMove(loc.x + 3, loc.y);
  await page.touchscreen.touchEnd();
  await wait(500);
  const after = await page.evaluate(() => ({ ...window.__GAME__.hud.aimValues, shots: window.__GAME__.shotsThisMission.length }));
  log('HUD: power-полоса меняет только мощность и не стреляет',
    Math.abs(after.power - (0.3 + 0.9 * 0.7)) < 0.03 && after.az === before.az && after.el === before.el && after.shots === before.shots,
    JSON.stringify({ pw: +after.power.toFixed(2), az: after.az, el: after.el, shots: after.shots }));
}
{
  // стик-зона: аз/выс меняются, мощность НЕ трогается
  const before = await page.evaluate(() => ({ ...window.__GAME__.hud.aimValues }));
  const pad = await page.evaluate(() => { const r = document.querySelector('#aimpad').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height * 0.4 }; });
  await page.touchscreen.touchStart(pad.x, pad.y);
  await page.touchscreen.touchMove(pad.x + 30, pad.y - 20);
  const during = await page.evaluate(() => ({ ...window.__GAME__.hud.aimValues }));
  await page.touchscreen.touchMove(pad.x, pad.y);
  await page.touchscreen.touchEnd();   // релиз в стик-зоне = выстрел
  await wait(900);
  log('HUD: стик меняет аз/выс БЕЗ мощности', during.az !== before.az && during.el !== before.el && during.power === before.power,
    JSON.stringify({ dAz: +(during.az - before.az).toFixed(1), dEl: +(during.el - before.el).toFixed(1), dPw: +(during.power - before.power).toFixed(3) }));
  await wait(4000);   // договорить цикл выстрела
}
{
  const gone = await page.evaluate(() => !document.querySelector('#hud .hud-panel input[type=range]') && !Array.from(document.querySelectorAll('#hud .tool-btn')).some(b => (b.textContent || '').includes('Точный')));
  log('HUD: окно «Точный» и его кнопка удалены', gone);
}
{
  // «Осмотр» — панель узлов + тап по узлу
  const r = await tap('', { selectorFallback: '#hud .tool-row .tool-btn:nth-child(2)' });
  const vis = await page.evaluate(() => document.querySelector('#nodepanel').style.display !== 'none');
  log('HUD: «Осмотр» открывает панель узлов', r.tapped && vis);
  await tapExpect('HUD: тап по узлу чинит/объясняет', '.noderow', toastShown, { selectorFallback: '.noderow' });
  await tap('', { selectorFallback: '#hud .tool-row .tool-btn:nth-child(2)' });
}
await tapExpect('HUD: ⌂ сброс камеры — тост', '', toastShown, { selectorFallback: '#hud .tool-row .tool-btn:nth-child(3)' });
{
  // «Ремонт»: короткий тап обязан объяснить, что нужно удерживать
  const before = (await toasts()).join('|');
  const r = await tap('', { selectorFallback: '#hud .tool-row .tool-btn:nth-child(1)', holdMs: 40, wait: 700 });
  const after = (await toasts()).join('|');
  const explained = after !== before && /удержив|hold/i.test(after);
  log('HUD: короткий тап «Ремонт» объясняет (hold-подсказка)', r.tapped && explained, after.slice(0, 70) || (r.tapped ? 'тишина' : r.reason));
}
{
  // удержание «Ремонт» ~1.6 c → ремонт худшего узла (или «Орудие в порядке»)
  const r = await tap('', { selectorFallback: '#hud .tool-row .tool-btn:nth-child(1)', holdMs: 1200, wait: 400 });
  const tt = (await toasts()).join(' ');
  log('HUD: удержание «Ремонт» срабатывает', r.tapped && /Ремонт|Орудие в порядке|Рама|Коромысло|Стропа|Ось|Противовес|Ложе|снабжения/i.test(tt), tt.slice(0, 70));
}
await page.evaluate(() => { window.__S__().tech.ordnance = 10; window.__GAME__.hud.buildAmmo(); });   // открываем все типы, чтобы появились залоченные чипы
await wait(400);
await tapExpect('HUD: залоченный чип боеприпаса объясняет отказ', '.ammo-chip.locked', toastShown, { selectorFallback: '.ammo-chip.locked' });
await page.evaluate(() => { window.__S__().tech.ordnance = 0; window.__GAME__.hud.buildAmmo(); });
await tapExpect('HUD: кнопка умения расчёта откликается', '.skill-btn', anyResponse, { selectorFallback: '.skill-btn', extraWait: 400 });
{
  const before = (await state()).shots;
  const disabled = await page.evaluate(() => document.querySelector('#firebtn').disabled);
  const r = await tap('', { selectorFallback: '#firebtn', wait: 1200 });
  const after = (await state()).shots;
  log('HUD: «ОГОНЬ» стреляет (или честно disabled)', r.tapped && (after > before || disabled), `${before} → ${after}, disabled:${disabled}`);
}
await wait(7000);   // дождаться завершения цикла выстрела

console.log('— ГЛАВНЫЙ РЕГРЕСС: пауза → настройки → «‹» → пауза → продолжить —');
{
  const r = await tap('', { selectorFallback: '#hud .tool-row .tool-btn:nth-child(5)' });
  const s = await state();
  log('HUD: ⏸ открывает паузу', r.tapped && s.ui === 'pause', r.tapped ? 'ui=' + s.ui : r.reason + ':' + r.topCls);
}
await tapExpect('пауза: «Настройки» открывают настройки', 'Настройки', screenChanged);
{
  const st = await page.evaluate(() => ({ inBattle: window.__GAME__.inBattle, paused: window.__GAME__.paused, hud: window.__GAME__.hud.visible }));
  log('настройки из боя: уровень НЕ закрыт (inBattle жив, paused)', st.inBattle && st.paused, JSON.stringify(st));
}
{
  const r = await tap('‹');
  const s = await state();
  log('настройки: «‹» возвращает В ПАУЗУ (не в меню!)', r.tapped && s.ui === 'pause' && s.inBattle, r.tapped ? 'ui=' + s.ui : 'точку перехватывает ' + r.topCls);
}
{
  const r = await tap('Продолжить');
  const s = await state();
  log('пауза: «Продолжить» возвращает В БОЙ', r.tapped && s.inBattle && !s.paused && (s.ui === null || s.ui === 'none'), JSON.stringify(s));
}

console.log('— ПАУЗА: рестарт и отступление —');
await tap('', { selectorFallback: '#hud .tool-row .tool-btn:nth-child(5)' }); await wait(600);
await tap('Начать заново'); await wait(600);
{
  const modal = await page.evaluate(() => !!document.querySelector('.modal-bg'));
  log('пауза: «Начать заново» требует подтверждения', modal);
}
await tap('Подтвердить'); await wait(900);
{
  const s = await state();
  log('пауза: после подтверждения — брифинг той же миссии', s.ui === 'briefing', 'ui=' + s.ui);
}
await tap('В ОСАДУ'); await wait(5500);
log('рестарт: бой снова начался', (await state()).inBattle);
await tap('', { selectorFallback: '#hud .tool-row .tool-btn:nth-child(5)' }); await wait(600);
await tap('Отступить'); await wait(600);
await tap('Подтвердить'); await wait(1200);
{
  const s = await state();
  log('пауза: «Отступить» → результаты (провал), бой закрыт корректно', s.ui === 'results' && !s.inBattle, JSON.stringify(s));
}
await tapExpect('результаты: «В лагерь» → меню', 'В лагерь', screenChanged);

console.log('— ТЕСТЕР-ПАНЕЛЬ реальным тачем —');
await page.evaluate(() => { window.__S__().settings.testerMode = true; window.__GAME__.syncTesterUi(); });
if (await startBattle()) {
  await tap('', { selectorFallback: '#hud .tool-row .tool-btn:nth-child(4)' }); await wait(600);
  const open = await page.evaluate(() => document.querySelector('#devpanel').classList.contains('on'));
  log('тестер: 🧪 открывает панель тапом', open);
  await tapExpect('тестер: «+500 всех ресурсов»', '+500 всех ресурсов', (b, a) => a.coins > b.coins || a.stone > b.stone);
  await tap('Закрыть'); await wait(500);
  const closed = await page.evaluate(() => !document.querySelector('#devpanel').classList.contains('on'));
  log('тестер: «Закрыть» закрывает панель', closed);
} else log('тестер: бой не стартовал', false);

console.log(`\n=== ИТОГ: ${pass} passed, ${fail} failed ===`);
console.log('page errors:', pageErrors.length ? [...new Set(pageErrors)].slice(0, 8).join('\n') : 'none');
await browser.close();
server.close();
process.exit(fail || pageErrors.length ? 1 : 0);
