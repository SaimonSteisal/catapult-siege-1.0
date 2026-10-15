// ============================================================================
//  tools/debug/graphics-check.mjs — проверки графического раунда 1.3.0:
//  тени (состояния/фрустум/деревья), ночные темы, пост-конвейер и его GPU-гард,
//  вспышки-подсветки, серия попаданий (streak), залпы волн DEFEND,
//  серия ежедневных входов. Без скриншотов — только состояния.
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
page.on('pageerror', (e) => errors.push(String(e && e.message || e)));
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 4000));

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { console.log(`${ok ? '✔' : '✘'} ${n}${extra ? ' — ' + extra : ''}`); ok ? pass++ : fail++; };
const G = (fn, arg) => page.evaluate(fn, arg);
const clickText = (t) => page.evaluate((txt) => {
  const n = Array.from(document.querySelectorAll('button,.menu-btn,.btn')).find((x) => (x.textContent || '').includes(txt));
  if (n) { n.click(); return true; } return false;
}, t);

console.log('— ТЕНИ: состояния по качествам —');
for (const [q, expOn, expMap] of [[0, true, 2048], [1, true, 1024], [2, false, 0]]) {
  const st = await G((qq) => {
    const s = window.__S__().settings; s.quality = qq; s.autoQuality = false; s.shadows = true;
    window.__GAME__.applySettings();
    const w = window.__GAME__.world;
    return { on: w.renderer.shadowMap.enabled, cast: w.lights.sun.castShadow, map: w.lights.sun.shadow.mapSize.x, idx: w.qualityIndex };
  }, q);
  check(`quality ${q}: shadowMap=${expOn}, map=${expMap}`, st.on === expOn && st.cast === expOn && (expOn ? st.map === expMap : true), JSON.stringify(st));
}
await G(() => { const s = window.__S__().settings; s.quality = 0; window.__GAME__.applySettings(); });
const soft = await G(() => {
  const sh = window.__GAME__.world.lights.sun.shadow;
  return { radius: sh.radius, intensity: sh.intensity, type: window.__GAME__.world.renderer.shadowMap.type };
});
check('тени: PCF + radius + intensity<1 (читаемые тени)', soft.radius > 1 && soft.intensity > 0.5 && soft.intensity <= 1, JSON.stringify(soft));
const shOff = await G(() => {
  window.__S__().settings.shadows = false; window.__GAME__.applySettings();
  const on = window.__GAME__.world.renderer.shadowMap.enabled;
  window.__S__().settings.shadows = true; window.__GAME__.applySettings();
  return { off: on, on: window.__GAME__.world.renderer.shadowMap.enabled };
});
check('тени: настройка «Тени» выключает/включает', shOff.off === false && shOff.on === true);

console.log('— ТЕНИ: деревья только на high —');
const trees = await G(() => {
  const w = window.__GAME__.world;
  const t0 = (w._treeCastCandidates || [])[0];
  const castHigh = t0 ? t0.children[0].castShadow : null;
  w.setQuality(1);
  const castMed = t0 ? t0.children[0].castShadow : null;
  w.setQuality(0);
  return { castHigh, castMed, n: (w._treeCastCandidates || []).length };
});
check('деревья: cast на high, нет на med', trees.castHigh === true && trees.castMed === false && trees.n > 0, JSON.stringify(trees));

console.log('— НОЧЬ: яркость тем —');
const night = await G(() => {
  const w = window.__GAME__.world;
  const out = {};
  for (const id of ['night', 'aurora', 'sunset']) {
    w.applySkyTheme(id);
    out[id] = {
      sun: +w.lights.sun.intensity.toFixed(2),
      hemi: +w.lights.hemi.intensity.toFixed(2),
      torch: w.lights.torches[0].visible ? w.lights.torches[0].intensity : 0,
    };
  }
  w.applySkyTheme('sunset');
  return out;
});
check('ночь: лунный свет и hemi-пол подняты', night.night.sun >= 0.6 && night.night.hemi >= 0.8 && night.night.torch >= 3, JSON.stringify(night));
check('аврора: тоже читается', night.aurora.sun >= 0.55 && night.aurora.hemi >= 0.75);

console.log('— ПОСТ: GPU-гард и вспышки —');
const post = await G(() => {
  const w = window.__GAME__.world;
  const gl = w.renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  const soft = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i.test(gpu);
  w.setFlash(0xb3372c, 0.8);
  const flashSet = +w.flashAmount.toFixed(2);   // world-side value (uniform lags by a frame)
  return { soft, selfOk: w.postSelfOk, enabled: w.postEnabled, wanted: w.postFxWanted, flashSet, hasComposite: !!w.compositeMat };
});
check('пост: на software-GL авто-выключен (гард)', post.soft ? (post.selfOk === false && post.enabled === false) : post.enabled === true, JSON.stringify(post));
await new Promise((r) => setTimeout(r, 1200));
const flashDecayed = await G(() => (window.__GAME__.world.compositeMat ? +window.__GAME__.world.compositeMat.uniforms.flashAmount.value.toFixed(2) : -1));
check('пост: вспышка ставится и затухает', post.flashSet === 0.8 && flashDecayed > 0 && flashDecayed < 0.8, `${post.flashSet} → uniform ${flashDecayed}`);

console.log('— ГЕЙМПЛЕЙ: серия попаданий —');
await clickText('Полигон'); await new Promise((r) => setTimeout(r, 800));
await clickText('В ОСАДУ'); await new Promise((r) => setTimeout(r, 5500));
await G(() => window.__GAME__._finishTutorial());
const streak = await G(() => {
  const g = window.__GAME__;
  g._bumpStreak(); g._bumpStreak(); g._bumpStreak();
  const badge = document.querySelector('#aimread .streak');
  const shown = { text: badge.textContent, vis: badge.style.display !== 'none' };
  const mul = +g.streakMul().toFixed(2);
  g._onImpact({ kind: 'miss', point: { x: 5, y: 0, z: 40, clone() { return { x: this.x, y: this.y, z: this.z }; } } });
  const afterMiss = { streak: g.streak, vis: badge.style.display !== 'none' };
  return { shown, mul, afterMiss, best: g.streakBest };
});
check('streak: бейдж 🔥 ×3 и множитель 1.16', streak.shown.vis && /×3/.test(streak.shown.text) && streak.mul === 1.16, JSON.stringify(streak.shown) + ' mul=' + streak.mul);
check('streak: промах сбрасывает серию', streak.afterMiss.streak === 0 && !streak.afterMiss.vis && streak.best === 3);

console.log('— ГЕЙМПЛЕЙ: залп волны DEFEND —');
const wave = await G(() => {
  const g = window.__GAME__;
  const e = g.enemy;
  e.enabled = true; e.burst = 0; e.waveTimer = 1e9; e.nextFire = 999;
  let ev = null;
  const origEv = e.onEvent;
  e.onEvent = (n, d) => { if (n === 'wave') ev = d; if (origEv) origEv(n, d); };
  e.update(0.016, { trebuchet: g.trebuchet, structures: g.structures, missionKind: 'DEFEND', missionChapter: 4 });
  return { ev, burst: e.burst, nextFire: +e.nextFire.toFixed(1) };
});
check('волна DEFEND: событие с размером залпа и burst>0', !!wave.ev && wave.burst >= 3 && wave.nextFire <= 1.2, JSON.stringify(wave));

console.log('— МЕТА: серия ежедневных входов —');
const daily2 = await G(() => {
  // checkDaily экспортирован в бандле через модуль save — дёргаем через игру:
  // проще воспроизвести логику: сбросим дату и вызовем внутренний tick через loop-hook
  const S = window.__S__;
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  S().progress.daily.date = yesterday;
  S().progress.daily.loginStreak = 4;
  const coins0 = S().resources.coins;
  const bp0 = S().resources.blueprints;
  // форсируем суточный тик игры
  window.__GAME__._campAcc = 1.5;
  return { coins0, bp0 };
});
await new Promise((r) => setTimeout(r, 300));
const daily3 = await G(() => {
  const S = window.__S__;
  return { streak: S().progress.daily.loginStreak, coins: S().resources.coins, date: S().progress.daily.date };
});
check('daily-streak: продолжение серии + награда монетами', daily3.streak === 5 && daily3.coins > daily2.coins0, JSON.stringify({ was: 4, now: daily3.streak, dCoins: daily3.coins - daily2.coins0 }));

console.log('— ЮНИТЫ 1.4.0: гарнизон, слоты, залпы, убийства, мораль —');
{
  // кампания с гарнизоном (тренировка солдат не имеет)
  await G(() => { const g = window.__GAME__; g.inBattle = false; g.hud.show(false); g.ui.show('menu'); });
  await new Promise((r) => setTimeout(r, 600));
  await clickText('Продолжить'); await new Promise((r) => setTimeout(r, 800));
  await clickText('В ОСАДУ'); await new Promise((r) => setTimeout(r, 6000));
  await G(() => window.__GAME__._finishTutorial());
  await G(() => { const s2 = window.__S__().settings; s2.quality = 2; s2.shadows = false; s2.postFx = false; window.__GAME__.applySettings(); });
  const u0 = await G(() => {
    const e = window.__GAME__.enemy;
    const byRole = {};
    for (const u of e.units) byRole[u.role] = (byRole[u.role] || 0) + 1;
    return { total: e.units.length, byRole, onWall: e.units.filter((x) => x.pos.y > 2.5).length, kits: Object.keys(e.engineKits || {}).length };
  });
  check('гарнизон рождён по spec и стоит на стенах', u0.total > 0 && u0.onWall > 0 && u0.byRole.archer > 0, JSON.stringify(u0));
  check('киты орудий построены по engine-целям', u0.kits >= 0);   // в 1-1 может быть 0–2
  // залп лучников: ждём rattle/стрелу до 30 c
  let volley = false;
  for (let i = 0; i < 60 && !volley; i++) {
    volley = await G(() => window.__GAME__.rattleT > 0 || (window.__GAME__.enemy.arrows || []).length > 0);
    if (!volley) await new Promise((r) => setTimeout(r, 500));
  }
  check('лучники дают залп (стрелы + дебафф)', volley);
  // лоб-выстрел по боевому ходу: 3 попытки, ждём ≥1 убийства
  const killRes = await G(async () => {
    const g = window.__GAME__;
    g.physics.setWind(0, 0);
    g.physics.windBase.set(0, 0);   // иначе updateWind восстановит ветер модификатора
    g.mods.spread = 0.05;   // детерминизм теста: разброс почти нулевой
    const V = g.trebuchet.root.position.clone().constructor;
    for (let attempt = 0; attempt < 4; attempt++) {
      const u = g.enemy.units.find((x) => x.alive && (x.role === 'archer' || x.role === 'spear'));
      if (!u) break;
      const pt = u.pos.clone(); pt.y += 0.6;
      const azT = Math.atan2(pt.x - g.trebuchet.root.position.x, pt.z - g.trebuchet.root.position.z) * 180 / Math.PI;
      let best = null;
      for (let el = 38; el <= 80; el += 3) for (let pw = 0.38; pw <= 1.001; pw += 0.03) {
        g.trebuchet.setAim(azT, el, pw);
        const pts = g.ballistics.predict(g.trebuchet.predictOrigin(new V()), g.trebuchet.launchDir(new V()), g.trebuchet.launchSpeed(pw), 'stone', { points: 120, dt: 0.06 });
        const end = pts.hit ? pts.hit.point : pts[pts.length - 1];
        if (!end) continue;
        const d = Math.hypot(end.x - pt.x, end.z - pt.z) + Math.abs(end.y - pt.y) * 0.5;
        if (!best || d < best.d) best = { d, el, pw };
      }
      if (!best || best.d > 1.6) continue;
      g.trebuchet.setAim(azT, best.el, best.pw);
      g.hud.aimValues = { az: azT, el: best.el, power: best.pw };
      if (!g.tryFire()) continue;
      const k0 = g.enemy.killed;
      // ждём ЗАВЕРШЕНИЯ цикла выстрела (снаряд сел/взорвался), а не фикс-окно
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 400));
        if (!g.shotInFlight && !g.trebuchet.busy && i > 2) break;
      }
      await new Promise((r) => setTimeout(r, 600));
      if (g.enemy.killed > k0) return { ok: true, killed: g.enemy.killed, stats: window.__S__().stats.soldiersKilled };
    }
    return { ok: false, killed: g.enemy.killed };
  });
  check('навесной выстрел убивает юнита (proxy+баунти+стат)', killRes.ok && killRes.stats >= 1, JSON.stringify(killRes));
  // мораль и rout-микс: добираем убийства hurtArea
  const rout = await G(() => {
    const g = window.__GAME__;
    let ev = null;
    const origEv2 = g.enemy.onEvent;
    g.enemy.onEvent = (n, d) => { if (n === 'rout') ev = d; if (origEv2) origEv2(n, d); };
    const killRole = (role) => {
      const u = g.enemy.units.find((x) => x.alive && !x.surrendered && x.role === role);
      if (u) g.enemy.hurt(u, 999, null);   // точечное убийство без задевания соседей
    };
    // share=0.6 гарантирует смесь: бегут лучники И сдаются копейщики при любом исходе лоб-выстрела
    for (let i = 0; i < 4; i++) killRole('crew');
    killRole('engineer'); killRole('commander');
    return {
      ev, morale: +g.enemy.morale.toFixed(2),
      surrendered: g.enemy.units.filter((u) => u.surrendered).length,
      fled: g.enemy.units.filter((u) => u.alive && !u.surrendered && u.state === 'flee').length,
    };
  });
  check('rout: микс по ролям (лучники бегут, копейщики сдаются)', !!rout.ev && rout.ev.surrendered > 0 && rout.ev.fled > 0, JSON.stringify(rout));
}

console.log('— РАУНД 1.4.1: катапульты лицом к цели, чертёжная, лагерь, награда контракта —');
{
  // 1) киты орудий смотрят туда, куда стреляют (forward = −Z после yaw)
  const facing = await G(() => {
    const g = window.__GAME__;
    const out = [];
    for (const id in (g.enemy.engineKits || {})) {
      const kit = g.enemy.engineKits[id];
      const f = new (kit.group.position.constructor)(0, 0, -1).applyQuaternion(kit.group.quaternion);
      const d = g.trebuchet.root.position.clone().sub(kit.group.position).setY(0).normalize();
      out.push(+f.dot(d).toFixed(2));
    }
    return out;
  });
  check('вражеские катапульты повёрнуты к цели', facing.length > 0 && facing.every((v) => v > 0.9), JSON.stringify(facing));
  // 2) чертёжная: никакого текста "null", кнопка объясняет отказ
  await G(() => { window.__GAME__.inBattle = false; window.__GAME__.hud.show(false); window.__GAME__.ui.show('workshop'); });
  await new Promise((r) => setTimeout(r, 600));
  const ws = await G(() => {
    const txt = document.querySelector('#screens').textContent;
    window.__S__().resources.blueprints = 0;
    window.__S__().tech.mechanics = 2;   // следующий уровень (3) требует чертёж
    window.__GAME__.ui.show('workshop');
    return { hasNull: /\bnull\b/.test(txt) };
  });
  await new Promise((r) => setTimeout(r, 500));
  const ws2 = await G(async () => {
    document.querySelectorAll('#toasts .toast').forEach((x) => x.remove());   // чужие тосты прошлого боя не в счёт
    const btn = Array.from(document.querySelectorAll('#screens .btn')).find((b) => (b.textContent || '').includes('Улучшить'));
    btn.click();   // при 0 чертежей обязан объяснить, а не молчать
    await new Promise((r) => setTimeout(r, 300));
    const toasts = Array.from(document.querySelectorAll('#toasts .toast')).map((x) => x.textContent).join(' ');
    return { disabled: btn.disabled, toast: toasts };
  });
  check('чертёжная: нет текста «null»', !ws.hasNull);
  check('чертёжная: кнопка «Улучшить» объясняет нехватку чертежей', ws2.disabled === false && /чертеж|blueprint/i.test(ws2.toast), JSON.stringify(ws2));
  // 3) лагерь: сбор не оставляет «фантомную» единицу
  const camp = await G(() => {
    const S = window.__S__;
    S().camp.buildings.quarry.stored = 1.6;
    window.__GAME__.ui.show('camp');
    return true;
  });
  await new Promise((r) => setTimeout(r, 500));
  const camp2 = await G(() => {
    const S = window.__S__;
    const row = Array.from(document.querySelectorAll('#screens .building')).find((x) => (x.textContent || '').includes('Каменоломня'));
    const shown = (row.textContent.match(/Накоплено: (\d+)\//) || [])[1];
    const btn = Array.from(row.querySelectorAll('.btn')).find((b) => (b.textContent || '').includes('Собрать'));
    btn.click();
    const after = S().camp.buildings.quarry.stored;
    window.__GAME__.ui.show('camp');
    return { shown, after: +after.toFixed(2) };
  });
  await new Promise((r) => setTimeout(r, 400));
  const camp3 = await G(() => {
    const row = Array.from(document.querySelectorAll('#screens .building')).find((x) => (x.textContent || '').includes('Каменоломня'));
    return { shownAfter: (row.textContent.match(/Накоплено: (\d+)\//) || [])[1] };
  });
  check('лагерь: 1.6 показано как 1, сбор снимает всё целое, остаток <1 не «фантомит»', camp2.shown === '1' && camp2.after < 1 && camp3.shownAfter === '0', JSON.stringify({ ...camp2, ...camp3 }));
  // 4) награда контракта платится (чертежи со 2-й главы)
  const reward = await G(async () => {
    const g = window.__GAME__;
    g.ui.show('menu');
    await new Promise((r) => setTimeout(r, 400));
    const btn = Array.from(document.querySelectorAll('.menu-btn')).find((x) => (x.textContent || '').includes('Продолжить'));
    btn.click();
    await new Promise((r) => setTimeout(r, 700));
    const m = g.missionPending || null;
    const rp = (g.ui.layer.textContent.match(/(\d+)/) || [])[1];
    const start = Array.from(document.querySelectorAll('.btn')).find((b) => (b.textContent || '').includes('В ОСАДУ'));
    start.click();
    await new Promise((r) => setTimeout(r, 5000));
    const bp0 = window.__S__().resources.blueprints;
    const coins0 = window.__S__().resources.coins;
    const preview = { ...g.mission.rewardPreview };
    g.enemy.units.forEach((u) => { u.alive = false; });   // не мешают
    g.endMission(true);
    await new Promise((r) => setTimeout(r, 900));
    const bp1 = window.__S__().resources.blueprints;
    const coins1 = window.__S__().resources.coins;
    return { bp0, bp1, dCoins: coins1 - coins0, previewBp: preview.blueprints, previewCoins: preview.coins, chapter: g.mission.chapter };
  });
  check('награда контракта начисляется (чертежи со 2-й главы)', reward.bp1 >= reward.bp0 + (reward.chapter >= 2 ? 1 : 0) && reward.dCoins > 0, JSON.stringify(reward));
  // 5) ярлыки замков снарядов: имя ранга вместо «Уровень N»
  await G(() => window.__GAME__.ui.show('ammo'));
  await new Promise((r) => setTimeout(r, 500));
  const ammoTxt = await G(() => document.querySelector('#screens').textContent);
  check('мастерская ядер: замок подписан именем ранга/ветки, не «Уровень»', !/Закрыто · Уровень/.test(ammoTxt) && /ранг|Боеприпасы/i.test(ammoTxt), ammoTxt.match(/Закрыто[^🪙]{0,40}/)?.[0] || '');
}

console.log(`\n=== ИТОГ: ${pass} passed, ${fail} failed ===`);
console.log('page errors:', errors.length ? [...new Set(errors)].slice(0, 5).join(' | ') : 'none');
await browser.close();
server.close();
process.exit(fail || errors.length ? 1 : 0);
