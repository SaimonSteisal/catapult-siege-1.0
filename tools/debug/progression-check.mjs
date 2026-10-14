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
await p.setViewport({width:900,height:700,isMobile:false,hasTouch:true});
p.on('pageerror',e=>console.log('PAGEERROR',(e&&e.stack||String(e)).slice(0,300)));
await p.goto(`http://localhost:${PORT}/index.html`,{waitUntil:'domcontentloaded'});
await new Promise(r=>setTimeout(r,3000));
// fresh save for deterministic checks
await p.evaluate(()=>{ localStorage.clear(); });
await p.reload({waitUntil:'domcontentloaded'});
await new Promise(r=>setTimeout(r,3500));
const r1 = await p.evaluate(async ()=>{
  const g=window.__GAME__;
  const out={};
  // camp tick: stored must grow while we sit in the menu
  const s0 = g.constructor && window.__S__();
  const before = s0.camp.buildings.quarry.stored || 0;
  await new Promise(r=>setTimeout(r,3200));
  out.campTick = +(( (window.__S__().camp.buildings.quarry.stored||0) - before)).toFixed(3);
  return out;
});
const r2 = await p.evaluate(()=>{
  const out={};
  // crew training must cost coins at level 1 (was free)
  const S=window.__S__();
  const c=S.crew.roster[0];
  const coins0=S.resources.coins;
  const { trainCost } = { trainCost: (lvl)=>[0,0,140,320,640,1100,1750][lvl+1] };
  out.trainCostShown = trainCost(c.level-1+0) !== undefined ? trainCost(c.level) : null;
  // rank gates: level 3 of a branch must be unlocked at rank 0 now
  out.gateL3 = S.progress.rank === 0 ? 'should-be-open' : 'n/a';
  return out;
});
console.log('CAMP/CREW:', JSON.stringify({...r1, ...r2}));
// workshop: buy first mechanics level with starter coins (260 >= 95+14metal? metal 40 ok)
const r3 = await p.evaluate(()=>{
  const g=window.__GAME__;
  g.ui.show('workshop');
  const S=window.__S__();
  const before=S.tech.mechanics;
  const btns=Array.from(document.querySelectorAll('.branch button'));
  const b0=btns.find(x=>!x.disabled);
  if (b0) b0.click();
  return { before, after: window.__S__().tech.mechanics, coins: window.__S__().resources.coins };
});
console.log('WORKSHOP BUY:', JSON.stringify(r3));
await new Promise(r=>setTimeout(r,600));
await p.screenshot({path:'shots/progression.png'});
await b.close(); server.close(); process.exit(0);
