import puppeteer from 'puppeteer';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = resolve(ROOT, 'dist');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css'};
const server = createServer((q,r)=>{let p=q.url.split('?')[0];if(p==='/')p='/index.html';const f=resolve(DIST,'.'+p);
 if(!existsSync(f)){r.writeHead(404);r.end();return}r.writeHead(200,{'Content-Type':MIME[extname(f)]||'text/plain'});r.end(readFileSync(f))});
await new Promise(r=>server.listen(0,r));
const PORT=server.address().port;
const b = await puppeteer.launch({headless:'shell',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const p = await b.newPage();
await p.setViewport({width:412,height:915,isMobile:true,hasTouch:true});
p.on('pageerror',e=>console.log('PAGEERROR',(e&&e.stack||String(e)).slice(0,500)));
await p.goto(`http://localhost:${PORT}/index.html`,{waitUntil:'domcontentloaded'});
await new Promise(r=>setTimeout(r,3500));
await p.evaluate(()=>{const n=Array.from(document.querySelectorAll('button,.menu-btn')).find(x=>x.textContent.includes('Полигон'));n&&n.click();});
await new Promise(r=>setTimeout(r,900));
await p.evaluate(()=>{const n=Array.from(document.querySelectorAll('button')).find(x=>x.textContent.includes('В ОСАДУ'));n&&n.click();});
await new Promise(r=>setTimeout(r,2500));
// skip tutorial
await p.evaluate(()=>{ const btn=Array.from(document.querySelectorAll('.tut button')).find(x=>x.textContent.includes('Пропустить')); btn&&btn.click(); });
for (let i=0;i<16;i++){
  const st = await p.evaluate(()=>{ const g=window.__GAME__;
    if (!g.inBattle) return {over:true};
    g._autoAimSuggest();
    g.hud.aimValues={az:g.trebuchet.aim.az,el:g.trebuchet.aim.el,power:g.trebuchet.aim.power};
    const fired=g.tryFire();
    return {i:g.shotsThisMission.length, fired, busy:g.trebuchet.busy, phase:g.trebuchet.phase, fly:g.shotInFlight, freeze:g.timeFreeze, paused:g.paused, scale:+g.vfx.timeScale.toFixed(2), supply:Math.round(g.economy.supplyLeft), load:g.loadout.stone,
      down:g.structures.targets.filter(t=>t.destroyed&&t.priority>0).length, destr:g.structures.destroyedCount,
      tgt:g.selectedTarget&&g.selectedTarget.type, hp:g.selectedTarget&&Math.round(g.selectedTarget.hp/g.selectedTarget.hp0*100), solve:g._lastSolve&&{d:+g._lastSolve.d.toFixed(1),el:g._lastSolve.el,pw:+g._lastSolve.pw.toFixed(2)}, miss:g.lastMiss&&[+g.lastMiss.x.toFixed(0),+g.lastMiss.y.toFixed(0),+g.lastMiss.z.toFixed(0)]};
  });
  console.log(JSON.stringify(st));
  if (st.over) break;
  // wait on GAME state, not wall clock (headless GL fps is not representative)
  await p.waitForFunction(() => {
    const g = window.__GAME__;
    return !g.inBattle || (!g.trebuchet.busy && !g.shotInFlight && g.vfx.timeScale === 1);
  }, { timeout: 30000, polling: 250 }).catch(() => {});
  await new Promise(r=>setTimeout(r,400));
}
const fin = await p.evaluate(()=>{ const g=window.__GAME__; return {inBattle:g.inBattle, down:g.structures.targets.filter(t=>t.destroyed&&t.priority>0).length, total:g.structures.targets.filter(t=>t.priority>0).length, destr:g.structures.destroyedCount, supply:Math.round(g.economy.supplyLeft), shots:g.shotsThisMission.length, loot:g.structures.lootPool, screen:g.ui.current, rank:(document.querySelector('.rank-badge')||{}).textContent};});
console.log('FINAL', JSON.stringify(fin));
await p.screenshot({path:'shots/siege-check.png'});
await b.close(); server.close(); process.exit(0);
