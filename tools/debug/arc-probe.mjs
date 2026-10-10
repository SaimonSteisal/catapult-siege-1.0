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
p.on('pageerror',e=>console.log('PAGEERROR',(e&&e.stack||String(e)).slice(0,400)));
await p.goto(`http://localhost:${PORT}/index.html`,{waitUntil:'domcontentloaded'});
await new Promise(r=>setTimeout(r,3500));
const click = async (txt)=>{ await p.evaluate((t)=>{const n=Array.from(document.querySelectorAll('button,.menu-btn')).find(x=>(x.textContent||'').includes(t)); n&&n.click();}, txt); await new Promise(r=>setTimeout(r,900)); };
await click('Испытание'); await click('В ОСАДУ');
await new Promise(r=>setTimeout(r,2500));
const d = await p.evaluate(()=>{
  const g=window.__GAME__; const pr=g._prediction;
  const pts=pr?pr.pts:null;
  const apex = pts? Math.max(...pts.map(v=>v.y)) : null;
  return { aim:{...g.trebuchet.aim}, hudAim:{...g.hud.aimValues}, cep:pr&&+pr.cep.toFixed(2),
    n: pts&&pts.length, first: pts&&pts[0].toArray().map(v=>+v.toFixed(1)), last: pts&&pts[pts.length-1].toArray().map(v=>+v.toFixed(1)),
    apex: apex&&+apex.toFixed(1), hit: pts&&pts.hit? (pts.hit.point? pts.hit.point.toArray().map(v=>+v.toFixed(1)):'?') : null,
    predVisible: g.vfx.predLine.visible, drawRange: g.vfx.predLine.geometry.drawRange.count,
    dotPos: g.vfx.predDots.filter(d=>d.visible).slice(0,4).map(d=>d.position.toArray().map(v=>+v.toFixed(1))) };
});
console.log(JSON.stringify(d,null,1));
await b.close(); server.close(); process.exit(0);
