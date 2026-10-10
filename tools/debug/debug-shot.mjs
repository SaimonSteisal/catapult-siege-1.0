import puppeteer from 'puppeteer';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css'};
const server = createServer((q,r)=>{let p=q.url.split('?')[0];if(p==='/')p='/index.html';const f=resolve(DIST,'.'+p);
 if(!existsSync(f)){r.writeHead(404);r.end();return}r.writeHead(200,{'Content-Type':MIME[extname(f)]||'text/plain'});r.end(readFileSync(f))});
await new Promise(r=>server.listen(0,r));
const PORT = server.address().port;
const b = await puppeteer.launch({headless:'shell',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const p = await b.newPage();
await p.setViewport({width:412,height:915,isMobile:true,hasTouch:true});
p.on('pageerror',e=>console.log('PAGEERROR',(e&&e.stack||String(e)).slice(0,900)));
p.on('console', m=>{ const t=m.text(); if(m.type()==='error') console.log('CONERR',t.slice(0,400)); });
await p.goto(`http://localhost:${PORT}/index.html`,{waitUntil:'domcontentloaded'});
await new Promise(r=>setTimeout(r,4000));
// start training via UI path
await p.evaluate(()=>{ const g=window.__GAME__;
  const mods = { constructor:1 };
  // call the training mission directly
  window.__M = null;
});
await p.evaluate(()=>{
  const g = window.__GAME__;
  // find training via exported flow: replicate menu click
  const btns = Array.from(document.querySelectorAll('button, .menu-btn'));
  const tr = btns.find(x=>x.textContent.includes('Полигон')); tr && tr.click();
});
await new Promise(r=>setTimeout(r,1200));
await p.evaluate(()=>{ const btns=Array.from(document.querySelectorAll('button')); const st=btns.find(x=>x.textContent.includes('В ОСАДУ')); st && st.click(); });
await new Promise(r=>setTimeout(r,3000));
const info0 = await p.evaluate(()=>{ const g=window.__GAME__; return {inBattle:g.inBattle, az:g.trebuchet.aim.az.toFixed(1), el:g.trebuchet.aim.el.toFixed(1), pw:g.trebuchet.aim.power.toFixed(2), dist:g.mission.dist, tgt: g.selectedTarget && [g.selectedTarget.type, g.selectedTarget.center.z.toFixed(0)], targets:g.structures.targets.length}; });
console.log('aim after auto-suggest:', JSON.stringify(info0));
await p.evaluate(()=>{ window.__GAME__.tryFire(); });
for (let i=0;i<16;i++){
  await new Promise(r=>setTimeout(r,700));
  const st = await p.evaluate(()=>{ const g=window.__GAME__; const pr=g.ballistics.projectiles[0];
    return {t:g.battleTime.toFixed(1), phase:g.trebuchet.phase, busy:g.trebuchet.busy, fly:g.shotInFlight,
      proj: pr?{pos:[pr.pos.x.toFixed(1),pr.pos.y.toFixed(1),pr.pos.z.toFixed(1)], v:pr.vel.length().toFixed(1), alive:pr.alive}:null,
      hits:g.economy.hits, miss:g.economy.shots-g.economy.hits, destroyed:g.structures.destroyedCount, freeze:g.timeFreeze, scale:g.vfx.timeScale};});
  console.log(JSON.stringify(st));
}
// second shot, aimed by auto-suggest at the destroyed/next target
await p.evaluate(()=>{ const g=window.__GAME__; g._autoAimSuggest(); g.tryFire(); });
await new Promise(r=>setTimeout(r,6000));
const fin = await p.evaluate(()=>{ const g=window.__GAME__; return {shots:g.shotsThisMission.length, destroyed:g.structures.destroyedCount, targetsDown:g.structures.targets.filter(t=>t.destroyed).length, loot:g.structures.lootPool, debris:g.debris.count, lastMiss:g.lastMiss&&g.lastMiss.toArray(), launch:g.lastLaunch&&{o:g.lastLaunch.origin.toArray().map(v=>+v.toFixed(2)), d:g.lastLaunch.dir.toArray().map(v=>+v.toFixed(3)), v:+g.lastLaunch.speed.toFixed(1)}, predO:g.trebuchet.predictOrigin(new (g.trebuchet.root.position.constructor)()).toArray().map(v=>+v.toFixed(2)).map(v=>+v.toFixed(1)), tgt:g.selectedTarget&&[g.selectedTarget.type,+g.selectedTarget.center.z.toFixed(0),+g.selectedTarget.center.y.toFixed(1)], fps:g.frame.fps, dc:g.world.renderer.info.render.calls, tris:g.world.renderer.info.render.triangles};});
console.log('FINAL', JSON.stringify(fin));
await p.screenshot({path:'shots/debug-shot.png'});
await b.close(); server.close(); process.exit(0);
