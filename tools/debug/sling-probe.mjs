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
const d = await p.evaluate(()=>{
  const g=window.__GAME__; const tb=g.trebuchet; const V=tb.root.position.constructor;
  const w = (o)=>o.getWorldPosition(new V()).toArray().map(v=>+v.toFixed(2));
  return {
    yaw: +tb.root.rotation.y.toFixed(2), baseRotY: +tb.baseRotY.toFixed(2), theta: +tb.theta.toFixed(2),
    phase: tb.phase,
    tip: w(tb.slingAnchor), pouch: w(tb.pouch), proj: w(tb.projectileMesh),
    rope1: w(tb.rope1), channel: w(tb.channel), cw: w(tb.cwHanger),
    fortZ: +g.structures.targets[0].center.z.toFixed(1),
    pouchLocal: tb.pouchLocal(0, new V(), new V()).toArray().map(v=>+v.toFixed(2)),
    tipLocal: tb.tipLocal(tb.theta, new V()).toArray().map(v=>+v.toFixed(2)),
  };
});
console.log(JSON.stringify(d,null,1));
await b.close(); server.close(); process.exit(0);
