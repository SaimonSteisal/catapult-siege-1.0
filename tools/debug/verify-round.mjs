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
await p.setViewport({width:1280,height:800,isMobile:false,hasTouch:true});
p.on('pageerror',e=>console.log('PAGEERROR:',(e&&e.stack||String(e)).slice(0,500)));
await p.goto(`http://localhost:${PORT}/index.html`,{waitUntil:'domcontentloaded'});
await new Promise(r=>setTimeout(r,3500));
// enable tester mode from settings
await p.evaluate(()=>{ const g=window.__GAME__; g.S ??= null; });
await p.evaluate(()=>{ const s=window.__GAME__.ui; window.__GAME__.applySettings; });
await p.evaluate(()=>{ const g=window.__GAME__; const S=g.constructor&&window.__GAME__; });
await p.evaluate(()=>{ const g=window.__GAME__; g.ui.show('settings'); });
await new Promise(r=>setTimeout(r,600));
await p.evaluate(()=>{
  const sw = Array.from(document.querySelectorAll('.setting')).find(r=>r.textContent.includes('Режим тестера'));
  sw && sw.querySelector('.switch').click();
});
await new Promise(r=>setTimeout(r,400));
const click = async (txt)=>{ await p.evaluate((t)=>{const n=Array.from(document.querySelectorAll('button,.menu-btn')).find(x=>(x.textContent||'').includes(t)); n&&n.click();}, txt); await new Promise(r=>setTimeout(r,800)); };
await click('Назад'); // head back button label is '‹' — use menu show instead
await p.evaluate(()=>window.__GAME__.ui.show('menu'));
await new Promise(r=>setTimeout(r,400));
await click('Испытание'); await click('В ОСАДУ');
await new Promise(r=>setTimeout(r,2500));
await p.evaluate(()=>{ const b=Array.from(document.querySelectorAll('.tut button')).find(x=>x.textContent.includes('Пропустить')); b&&b.click(); });
await new Promise(r=>setTimeout(r,400));
await p.screenshot({path:'shots/v2-silhouette.png'});
// cep clean vs worn
const cep = await p.evaluate(()=>{
  const g=window.__GAME__;
  g._cepDirty = true; g._updatePrediction();
  const clean = g._prediction.cep;
  for (const id of ['pivot','sling','beam']) { const n=g.trebuchet.nodes[id]; n.hp = n.max*0.15; }
  g.trebuchet._syncNodesVisual();
  g._cepDirty = true; g._updatePrediction();
  const worn = g._prediction.cep;
  const dots = g.vfx.cepDots.filter(d=>d.visible).length;
  const disk = g.vfx.cepDisk.visible;
  return {clean:+clean.toFixed(2), worn:+worn.toFixed(2), dots, disk, cepLabel:g.hud.readCep.textContent};
});
console.log('CEP:', JSON.stringify(cep));
// tester panel
const panel = await p.evaluate(()=>{
  const g=window.__GAME__;
  const btnVisible = g.hud.testBtn.style.display !== 'none';
  g.toggleDevPanel();
  const open = document.querySelector('#devpanel').classList.contains('on');
  const buttons = document.querySelectorAll('#devpanel button').length;
  return {btnVisible, open, buttons};
});
console.log('TESTER PANEL:', JSON.stringify(panel));
await p.screenshot({path:'shots/v2-tester.png'});
// enemy volley visible
await p.evaluate(()=>{ const g=window.__GAME__; if (g.enemy.engines.length) g.enemy._fireAtPlayer(0.9,2); });
await new Promise(r=>setTimeout(r,1200));
await p.screenshot({path:'shots/v2-incoming.png'});
await b.close(); server.close(); process.exit(0);
