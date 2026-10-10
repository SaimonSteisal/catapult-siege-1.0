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
const dbg = await p.evaluate(()=>{
  const g=window.__GAME__; const tb=g.trebuchet; const V=tb.root.position.constructor;
  tb.setAim(0,45,0.9);
  const dir = tb.launchDir(new V());
  const o = tb.predictOrigin(new V());
  const pts = g.ballistics.predict(o, dir, tb.launchSpeed(0.9), 'stone', {points:60, dt:0.06});
  return {
    rotY: +tb.root.rotation.y.toFixed(3), baseRotY: +tb.baseRotY.toFixed(3), aimAz: tb.aim.az,
    wind: g.physics.wind.toArray().map(v=>+v.toFixed(2)),
    dir: dir.toArray().map(v=>+v.toFixed(3)),
    origin: o.toArray().map(v=>+v.toFixed(1)),
    speed: +tb.launchSpeed(0.9).toFixed(1),
    path: pts.filter((_,i)=>i%6===0).map(v=>[+v.x.toFixed(1),+v.y.toFixed(1),+v.z.toFixed(1)]),
    end: (pts.hit?pts.hit.point:pts[pts.length-1]).toArray().map(v=>+v.toFixed(1)),
    hit: pts.hit? (pts.hit.type || (pts.hit.block&&pts.hit.block.mat)) : '-',
    dist: g.mission.dist,
  };
});
console.log('DBG '+JSON.stringify({...dbg, path: dbg.path.slice(0,4)}));
await b.close(); server.close(); process.exit(0);
