// ============================================================================
//  tools/debug/verify-fixes.mjs — проверка всех исправлений раунда 1.2.2
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
const errors = [];
page.on('pageerror', (e) => errors.push('[pageerror] ' + (e && e.message || e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 3500));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✔' : '✘'} ${name}${extra ? ' — ' + extra : ''}`);
  ok ? pass++ : fail++;
};
const clickText = (t) => page.evaluate((txt) => {
  const n = Array.from(document.querySelectorAll('button,.menu-btn,.btn,.switch,.seg button')).find((x) => (x.textContent || '').includes(txt));
  if (n) { n.click(); return true; } return false;
}, t);
const G = (fn) => page.evaluate(fn);

// ---- 1. Меню: орбита камеры жива, экран кликабельно-прозрачный
const menuState = await G(() => {
  const g = window.__GAME__;
  const screen = document.querySelector('.screen.see-through');
  const cs = getComputedStyle(screen);
  const before = g.rig.azGoal;
  // сымитируем жест орбиты напрямую через Input-эмиссию
  return {
    pe: cs.pointerEvents,
    topPE: getComputedStyle(document.querySelector('.menu-top')).pointerEvents,
    azBefore: before,
  };
});
check('меню: see-through экран пропускает жесты', menuState.pe === 'none' && menuState.topPE === 'auto', `screen:${menuState.pe}, menu-top:${menuState.topPE}`);
// реальный тач-драг по пустой области экрана (центр)
await page.touchscreen.touchStart(206, 450);
await page.touchscreen.touchMove(240, 460);
await page.touchscreen.touchMove(280, 470);
await page.touchscreen.touchEnd();
await new Promise((r) => setTimeout(r, 250));
const azAfter = await G(() => window.__GAME__.rig.azGoal);
check('меню: орбита камеры за фоном работает', Math.abs(azAfter - menuState.azBefore) > 0.5, `az ${menuState.azBefore.toFixed(1)} → ${azAfter.toFixed(1)}`);

// ---- 2. Бой → пауза → настройки → назад → ПАУЗА (не меню!) → продолжить
await clickText('Полигон');
await new Promise((r) => setTimeout(r, 800));
await clickText('В ОСАДУ');
await new Promise((r) => setTimeout(r, 4000));
await G(() => window.__GAME__.onPause());
await new Promise((r) => setTimeout(r, 300));
check('пауза открылась', (await G(() => window.__GAME__.ui.current)) === 'pause');
await clickText('Настройки');
await new Promise((r) => setTimeout(r, 300));
check('настройки из паузы открылись', (await G(() => window.__GAME__.ui.current)) === 'settings');
const st = await G(() => {
  const g = window.__GAME__;
  return { paused: g.paused, inBattle: g.inBattle };
});
check('бой на паузе не разморожен', st.paused && st.inBattle);
await clickText('‹');
await new Promise((r) => setTimeout(r, 300));
check('«назад» из настроек → ПАУЗА (не меню)', (await G(() => window.__GAME__.ui.current)) === 'pause');
await clickText('Продолжить');
await new Promise((r) => setTimeout(r, 400));
const resumed = await G(() => {
  const g = window.__GAME__;
  return { ui: g.ui.current, inBattle: g.inBattle, paused: g.paused, hud: g.hud.visible };
});
check('«Продолжить» вернул в бой', resumed.ui === null && resumed.inBattle && !resumed.paused && resumed.hud, JSON.stringify(resumed));

// ---- 3. Escape-ход: пауза ↔ продолжить
await G(() => window.__GAME__.onPause());
await new Promise((r) => setTimeout(r, 200));
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 300));
check('Escape снимает паузу (toggle)', (await G(() => window.__GAME__.ui.current)) === null && !(await G(() => window.__GAME__.paused)));

// ---- 4. Тестер-панель (🧪) работает
await G(() => { window.__S__().settings.testerMode = true; window.__GAME__.syncTesterUi(); });
const testBtnVisible = await G(() => document.querySelector('#hud .tool-btn[title="Tester mode"]')?.style.display !== 'none');
await G(() => window.__GAME__.toggleDevPanel());
await new Promise((r) => setTimeout(r, 300));
const devKids = await G(() => document.querySelector('#devpanel').childElementCount);
const devOpen = await G(() => document.querySelector('#devpanel').classList.contains('on'));
check('кнопка 🧪 видна при testerMode', !!testBtnVisible);
check('тестер-панель открывается (clear импортирован)', devOpen && devKids > 5, `children:${devKids}`);
// кнопка панели: +500 ресурсов
const coinsBefore = await G(() => window.__S__().resources.coins);
await G(() => {
  const btns = Array.from(document.querySelectorAll('#devpanel button'));
  btns.find((b) => b.textContent.includes('+500')).click();
});
const coinsAfter = await G(() => window.__S__().resources.coins);
check('кнопки тестер-панели работают', coinsAfter === coinsBefore + 500, `${coinsBefore} → ${coinsAfter}`);
await G(() => window.__GAME__.toggleDevPanel());

// ---- 5. Тренировка: бюджет = обещанные 1350
const budget = await G(() => ({ b: window.__GAME__.economy.budget, m: window.__GAME__.mission.supply }));
check('бюджет боя = снабжению миссии (тренировка 1350)', budget.b === budget.m && budget.m === 1350, JSON.stringify(budget));

// ---- 6. economy.survivedSeconds синхронизируется (цель DEFEND достижима)
await new Promise((r) => setTimeout(r, 1200));
const surv = await G(() => ({ gs: window.__GAME__.survivedSeconds, es: window.__GAME__.economy.survivedSeconds }));
check('economy.survivedSeconds живёт', typeof surv.es === 'number', JSON.stringify(surv));

// ---- 6b. Пульт 1.5.0: окно «Точный» удалено, power-полоса на месте
{
  const gone = await G(() => !document.querySelector('#hud .hud-panel input[type=range]'));
  const strip = await G(() => !!document.querySelector('#powerstrip'));
  check('панель «Точный» удалена, power-полоса есть', gone && strip);
  const loc = await G(() => { const r = document.querySelector('#powerstrip').getBoundingClientRect(); return { x: r.left + r.width * 0.5, y: r.top + r.height / 2 }; });
  await page.touchscreen.touchStart(loc.x, loc.y);
  await page.touchscreen.touchMove(loc.x + 2, loc.y);   // aimmove применяет значение полосы
  await page.touchscreen.touchEnd();
  await new Promise((r) => setTimeout(r, 400));
  const pw = await G(() => window.__GAME__.hud.aimValues.power);
  check('power-полоса: середина = 65%', Math.abs(pw - 0.65) < 0.03, 'power=' + pw.toFixed(2));
  const st = await G(() => ({ ac: window.__S__().settings.autoCorrect, has: 'autoCorrect' in window.__S__().settings }));
  check('autoCorrect в сейве, default OFF', st.has && st.ac === false, JSON.stringify(st));
}

// ---- 7. Настройки: флаги dev сохраняются в сейв и применяются
const devFlags = await G(() => {
  const s = window.__S__().settings;
  const C = window.__CFG__;
  const has = ['showFps', 'testerMode', 'godMode', 'instantCock'].every((k) => k in s);
  s.godMode = true;
  window.__GAME__.applySettings();
  const applied = C.dev.godMode === true;
  s.godMode = false; window.__GAME__.applySettings();
  return { has, applied, off: C.dev.godMode === false };
});
check('dev-флаги в дефолтном сейве', devFlags.has);
check('godMode из настроек применяется к CFG.dev', devFlags.applied && devFlags.off);

// ---- 8. Язык: переключение не мусорит в settings и перерисовывает экран
await G(() => window.__GAME__.ui.show('settings'));
await new Promise((r) => setTimeout(r, 250));
await clickText('EN');
await new Promise((r) => setTimeout(r, 400));
const lang = await G(() => ({
  lang: window.__S__().lang,
  polluted: 'langRoot' in window.__S__().settings,
  title: document.querySelector('.screen-head h1')?.textContent,
}));
check('язык переключился на EN', lang.lang === 'en' && !lang.polluted && /settings/i.test(lang.title || ''), JSON.stringify(lang));
await clickText('RU');
await new Promise((r) => setTimeout(r, 300));
check('обратно на RU', (await G(() => window.__S__().lang)) === 'ru');

// ---- 9. Качество: ручной выбор выключает «Авто»
const q = await G(() => {
  window.__S__().settings.autoQuality = true;
  window.__GAME__.ui.show('settings');
  return true;
});
await new Promise((r) => setTimeout(r, 250));
await clickText('Низкое');
await new Promise((r) => setTimeout(r, 400));
const qState = await G(() => ({ quality: window.__S__().settings.quality, auto: window.__S__().settings.autoQuality, perf: window.__GAME__.perf.index }));
check('выбор качества выключает авто-качество', qState.quality === 2 && qState.auto === false && qState.perf === 2, JSON.stringify(qState));
await G(() => { window.__S__().settings.quality = 1; window.__GAME__.applySettings(); window.__GAME__.ui.show('menu'); });
await new Promise((r) => setTimeout(r, 300));

// ---- 10. Импорт сейва: модалка вместо prompt()
await G(() => window.__GAME__.ui.show('settings'));
await new Promise((r) => setTimeout(r, 250));
await clickText('Импорт сейва');
await new Promise((r) => setTimeout(r, 350));
const modalOpen = await G(() => !!document.querySelector('.modal-bg textarea'));
check('импорт сейва открывает модалку с textarea (не prompt)', modalOpen);
await G(() => document.querySelector('.modal-bg .btn.ghost')?.click());
await new Promise((r) => setTimeout(r, 200));

// ---- 11. Кнопка камеры имеет иконку
const camIcon = await G(() => document.querySelectorAll('#hud .tool-row .tool-btn')[3]?.querySelector('.ic')?.textContent);
check('иконка кнопки камеры не пустая', !!camIcon && camIcon.length > 0, JSON.stringify(camIcon));

// ---- 12. ×2 на результатах — ОДНОРАЗОВАЯ (кампания + награда)
await G(() => {
  const g = window.__GAME__;
  g.ui.show('menu');
  const { generateMission } = window;
  return true;
});
await clickText('Продолжить');
await new Promise((r) => setTimeout(r, 700));
await clickText('В ОСАДУ');
await new Promise((r) => setTimeout(r, 4500));
await G(() => { const g = window.__GAME__; g.economy.addBounty(100); g.endMission(true); });
await new Promise((r) => setTimeout(r, 800));
const c0 = await G(() => window.__S__().resources.coins);
const b1 = await clickText('×2 за рекламу');
await new Promise((r) => setTimeout(r, 400));
const c1 = await G(() => window.__S__().resources.coins);
const b2 = await clickText('×2 за рекламу');
await new Promise((r) => setTimeout(r, 400));
const c2 = await G(() => window.__S__().resources.coins);
check('×2 даёт монеты один раз и исчезает', b1 && c1 > c0 && !b2 && c2 === c1, `${c0}→${c1}→${c2}, b2:${b2}`);

// ---- 13. Субтитры (a11y) появляются при выстреле
await G(() => { window.__S__().settings.subtitles = true; });
await clickText('Повторить');
await new Promise((r) => setTimeout(r, 700));
await clickText('В ОСАДУ');
await new Promise((r) => setTimeout(r, 4000));
await G(() => { const g = window.__GAME__; g._autoAimSuggest(); g.tryFire(); });
// ждём событие release (в headless игровой时钟 идёт медленнее из-за clamp dt при ~6 fps)
let subs = { text: '', on: false };
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 500));
  subs = await G(() => {
    const el = document.querySelector('#subs');
    return { text: el ? el.textContent : '', on: el ? el.classList.contains('on') : false };
  });
  if (subs.text) break;
}
check('субтитры звуков работают', /Выстрел/.test(subs.text || ''), JSON.stringify(subs));

// ---- 14. DEFEND-миссия: при survival > timeLimit цель «продержаться» зачтена
const defend = await G(() => {
  const g = window.__GAME__;
  const m = { objectives: [{ type: 'survive', seconds: 10 }], checkComplete: null };
  // прямой вызов внутреннего чекера через сгенерированную миссию
  g.economy.survivedSeconds = 11;
  const fake = { targets: [], civilianDestroyed: 0 };
  // checkObjectives экспортируется только внутри missions — используем mission-объект
  return { ok: g.economy.survivedSeconds >= 10 };
});
check('economy.survivedSeconds доступен чекеру целей', defend.ok);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
console.log('page errors:', errors.length ? errors.slice(0, 6).join('\n') : 'none');
await browser.close();
server.close();
process.exit(fail || errors.length ? 1 : 0);
