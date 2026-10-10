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
p.on('pageerror',e=>console.log('PAGEERROR',(e&&e.stack||String(e)).slice(0,600)));
await p.goto(`http://localhost:${PORT}/index.html`,{waitUntil:'domcontentloaded'});
await new Promise(r=>setTimeout(r,3500));
await p.evaluate(()=>{const n=Array.from(document.querySelectorAll('button,.menu-btn')).find(x=>x.textContent.includes('Полигон'));n&&n.click();});
await new Promise(r=>setTimeout(r,900));
await p.evaluate(()=>{const n=Array.from(document.querySelectorAll('button')).find(x=>x.textContent.includes('В ОСАДУ'));n&&n.click();});
await new Promise(r=>setTimeout(r,2500));
const dbg = await p.evaluate(()=>{
  const g=window.__GAME__; const tb=g.trebuchet;
  const tgt=g.selectedTarget;
  const out={dist:g.mission.dist, tgt:tgt&&[tgt.type,tgt.center.toArray().map(v=>+v.toFixed(1))], walls:g.structures.targets.map(t=>[t.type,+t.center.z.toFixed(0),+t.center.y.toFixed(1),t.blocks.length])};
  const sol=g._solveAim(tgt.center);
  out.sol = sol && {d:+sol.d.toFixed(2), az:+sol.az.toFixed(1), el:+sol.el.toFixed(1), pw:+sol.pw.toFixed(2),
     end: (sol.pts.hit? sol.pts.hit.point : sol.pts[sol.pts.length-1]).toArray().map(v=>+v.toFixed(1)),
     hitType: sol.pts.hit? sol.pts.hit.type||sol.pts.hit.block.mat : 'ground/end'};
  // sample a few manual solutions
  out.samples=[];
  for (const [el,pw] of [[25,1],[30,1],[35,0.9],[40,0.85],[45,0.8],[50,0.75]]) {
    tb.setAim(0,el,pw);
    const dir=tb.launchDir(new (tb.root.position.constructor)());
    const o=tb.predictOrigin(new (tb.root.position.constructor)());
    const pts=g.ballistics.predict(o,dir,tb.launchSpeed(pw),'stone',{points:40,dt:0.045});
    const end=pts.hit?pts.hit.point:pts[pts.length-1];
    out.samples.push({el,pw,end:end.toArray().map(v=>+v.toFixed(1)),hit:pts.hit?(pts.hit.type||(pts.hit.block&&pts.hit.block.mat)):'-'});
  }
  return out;
});
console.log(JSON.stringify(dbg,null,1));
await b.close(); server.close(); process.exit(0);
