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
p.on('pageerror',e=>console.log('PAGEERROR',(e&&e.stack||String(e)).slice(0,400)));
await p.goto(`http://localhost:${PORT}/index.html`,{waitUntil:'domcontentloaded'});
await new Promise(r=>setTimeout(r,3500));
const click = async (txt)=>{ await p.evaluate((t)=>{const n=Array.from(document.querySelectorAll('button,.menu-btn')).find(x=>(x.textContent||'').includes(t)); n&&n.click();}, txt); await new Promise(r=>setTimeout(r,800)); };
await click('Полигон'); await click('В ОСАДУ');
await new Promise(r=>setTimeout(r,2500));
await p.evaluate(()=>{ const b=Array.from(document.querySelectorAll('.tut button')).find(x=>x.textContent.includes('Пропустить')); b&&b.click(); });
// side view: camera on the +X flank, looking at the machine
await p.evaluate(()=>{ const g=window.__GAME__; g.hud.show(false);
  g.rig.setMode('battle',{force:true}); g.rig.targetGoal.set(1.5,3.2,2); g.rig.distGoal=22; g.rig.azGoal=95; g.rig.polGoal=80; });
await new Promise(r=>setTimeout(r,1200));
await p.screenshot({path:'shots/side-cocked.png'});
// slow-motion live swing: stretch the SWING phase and shoot for real
await p.evaluate(()=>{
  window.__S__().settings.cameraDynamic = false;
  window.__GAME__.applySettings();
  window.__CFG__.trebuchet.phases.swing = 8;      // 8 s swing for frame capture
  window.__CFG__.trebuchet.phases.recover = 20;   // hold the end pose
  const g=window.__GAME__;
  g.rig.setMode('battle',{force:true}); g.rig.targetGoal.set(3,3,-2); g.rig.distGoal=26; g.rig.azGoal=115; g.rig.polGoal=78;
});
await new Promise(r=>setTimeout(r,900));
await p.evaluate(()=>{ const g=window.__GAME__; g._autoAimSuggest(); g.tryFire(); });
const shotAt = async (ms, name) => { await new Promise(r=>setTimeout(r,ms)); await p.screenshot({path:`shots/phase-${name}.png`}); };
await shotAt(2500,'1-drag');
await shotAt(2500,'2-drag-end');
await shotAt(2000,'3-whip');
await shotAt(1200,'4-release');
await b.close(); server.close(); process.exit(0);
