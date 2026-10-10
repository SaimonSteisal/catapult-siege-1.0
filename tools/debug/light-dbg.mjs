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
p.on('pageerror',e=>console.log('PAGEERROR',(e&&e.stack||String(e)).slice(0,400)));
await p.goto(`http://localhost:${PORT}/index.html`,{waitUntil:'domcontentloaded'});
await new Promise(r=>setTimeout(r,3500));
await p.evaluate(()=>{const n=Array.from(document.querySelectorAll('button,.menu-btn')).find(x=>x.textContent.includes('Полигон'));n&&n.click();});
await new Promise(r=>setTimeout(r,900));
await p.evaluate(()=>{const n=Array.from(document.querySelectorAll('button')).find(x=>x.textContent.includes('В ОСАДУ'));n&&n.click();});
await new Promise(r=>setTimeout(r,2500));
const info = await p.evaluate(()=>{
  const g=window.__GAME__;
  const im = g.structures.meshes.get('stone');
  const col = im.instanceColor ? Array.from(im.instanceColor.array.slice(0,9)).map(v=>+v.toFixed(2)) : null;
  const mat = im.material;
  return { hasInstanceColor: !!im.instanceColor, col, matColor: mat.color.getHexString(), hasMap: !!mat.map,
    hemi: g.world.lights.hemi.intensity, sun: g.world.lights.sun.intensity, fill: g.world.lights.fill.intensity,
    fillPos: g.world.lights.fill.position.toArray(), outCS: g.world.renderer.outputColorSpace, tone: g.world.renderer.toneMapping };
});
console.log('LIGHT', JSON.stringify(info));
// experiment: brighten
await p.evaluate(()=>{ const g=window.__GAME__; g.world.lights.hemi.intensity=1.6; g.world.lights.fill.intensity=1.4; g.world.lights.sun.intensity=1.6; });
await new Promise(r=>setTimeout(r,700));
await p.screenshot({path:'shots/light-bright.png'});
await b.close(); server.close(); process.exit(0);
