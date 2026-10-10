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
await p.setViewport({width:900,height:600,isMobile:false,hasTouch:true});
p.on('pageerror',e=>console.log('PAGEERROR',(e&&e.stack||String(e)).slice(0,300)));
await p.goto(`http://localhost:${PORT}/index.html`,{waitUntil:'domcontentloaded'});
await new Promise(r=>setTimeout(r,3500));
const click = async (txt)=>{ await p.evaluate((t)=>{const n=Array.from(document.querySelectorAll('button,.menu-btn')).find(x=>(x.textContent||'').includes(t)); n&&n.click();}, txt); await new Promise(r=>setTimeout(r,800)); };
await click('Полигон'); await click('В ОСАДУ');
await new Promise(r=>setTimeout(r,2500));
const res = await p.evaluate(()=>{
  const g=window.__GAME__; const tb=g.trebuchet; const V=tb.root.position.constructor;
  const wp=(o)=>o.getWorldPosition(new V());
  const rodEnds=(rod)=>{ // rope geometry is translated: ROOT at origin, end at (0,-L,0)
    const len = tb.rope1.geometry.parameters.height * rod.scale.y;
    const q = rod.getWorldQuaternion(new (rod.quaternion.constructor)());
    const c = wp(rod);
    const end = new V(0,-len,0).applyQuaternion(q).add(c);
    return [c, end];
  };
  const tipAnchor = wp(tb.slingAnchor);
  const pouch = wp(tb.pouch);
  const [r1a, r1b] = rodEnds(tb.rope1);
  const dTip = r1a.distanceTo(tipAnchor);          // rope ROOT must sit on the lever tip
  const dPouch = r1b.distanceTo(pouch);            // rope END must sit on the pouch
  const stone = wp(tb.channelStone);
  return {
    phase: tb.phase,
    ropeTouchTip: +dTip.toFixed(3), ropeTouchPouch: +dPouch.toFixed(3),
    cradleRockVisible: tb.channelStone.visible, shellVisible: tb.projectileMesh.visible,
    stoneNearPouch: +stone.distanceTo(pouch).toFixed(2),
    stoneY: +stone.y.toFixed(2), groundAtStone: +g.terrain.heightAt(stone.x, stone.z).toFixed(2),
  };
});
console.log('IDLE:', JSON.stringify(res));
// start a shot and check the swap
await p.evaluate(()=>{ const g=window.__GAME__; g._autoAimSuggest(); g.tryFire(); });
await new Promise(r=>setTimeout(r,1500));
const res2a = await p.evaluate(()=>{ const tb=window.__GAME__.trebuchet;
  return { phase: tb.phase, phaseT: +tb.phaseT.toFixed(2), prev: tb._prevPhase, cradle: tb.channelStone.visible, shell: tb.projectileMesh.visible, loaded: tb.loadedAmmo }; });
await new Promise(r=>setTimeout(r,1200));
const res2b = await p.evaluate(()=>{ const tb=window.__GAME__.trebuchet;
  return { phase: tb.phase, phaseT: +tb.phaseT.toFixed(2), prev: tb._prevPhase, cradle: tb.channelStone.visible, shell: tb.projectileMesh.visible, loaded: tb.loadedAmmo }; });
console.log('LIVE-A:', JSON.stringify(res2a)); console.log('LIVE-B:', JSON.stringify(res2b));
const res2 = res2b;
console.log('LOAD:', JSON.stringify(res2));
await p.evaluate(()=>{ const g=window.__GAME__; g.hud.show(false); window.__S__().settings.cameraDynamic=false; g.applySettings();
  g.rig.setMode('battle',{force:true}); g.rig.targetGoal.set(2.2,1.6,-5.2); g.rig.distGoal=11; g.rig.azGoal=120; g.rig.polGoal=78; });
await new Promise(r=>setTimeout(r,4500));
await p.screenshot({path:'shots/sling-closeup.png'});
await b.close(); server.close();
process.exit(res.ropeTouchTip < 0.05 && res.ropeTouchPouch < 0.25 && res.cradleRockVisible && !res2.cradleRockVisible && res2.shellVisible ? 0 : 1);
