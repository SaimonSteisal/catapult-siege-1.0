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
await p.setViewport({width:412,height:915,isMobile:true,hasTouch:true});
p.on('pageerror',e=>console.log('PAGEERROR',(e&&e.stack||String(e)).slice(0,400)));
await p.goto(`http://localhost:${PORT}/index.html`,{waitUntil:'domcontentloaded'});
await new Promise(r=>setTimeout(r,3500));
await p.evaluate(()=>{const n=Array.from(document.querySelectorAll('button,.menu-btn')).find(x=>x.textContent.includes('Полигон'));n&&n.click();});
await new Promise(r=>setTimeout(r,900));
await p.evaluate(()=>{const n=Array.from(document.querySelectorAll('button')).find(x=>x.textContent.includes('В ОСАДУ'));n&&n.click();});
await new Promise(r=>setTimeout(r,2500));
const dump = await p.evaluate(()=>{
  const g=window.__GAME__; const tb=g.trebuchet;
  const tgt=g.selectedTarget; const pt=g._targetAimPoint(tgt);
  const out={tgt:tgt.type, pt:pt.toArray().map(v=>+v.toFixed(1)), cond:+(tb.condition*100).toFixed(0), v0max:+tb.launchSpeed(1).toFixed(1)};
  // manual grid dump of best per elevation
  out.perEl=[];
  for (let el=2; el<=78; el+=6){
    let best=null;
    for (let pw=0.5; pw<=1.0001; pw+=0.0625){
      tb.setAim(0, el, pw);
      const dir=tb.launchDir(new pt.constructor());
      const o=tb.predictOrigin(new pt.constructor());
      const pts=g.ballistics.predict(o, dir, tb.launchSpeed(pw), 'stone', {points:30, dt:0.05});
      const end=pts.hit?pts.hit.point:pts[pts.length-1];
      const d=end.distanceTo(pt);
      const hb=pts.hit&&pts.hit.block;
      if(!best||d<best.d) best={d:+d.toFixed(1), pw:+pw.toFixed(2), end:end.toArray().map(v=>+v.toFixed(0)), hit: hb?(hb.civilian?'CIV':(hb.cid||'?')):'ground'};
    }
    out.perEl.push({el, ...best});
  }
  return out;
});
console.log('META', JSON.stringify({tgt:dump.tgt, pt:dump.pt, cond:dump.cond, v0max:dump.v0max}));
for (const r of dump.perEl) console.log(`el ${String(r.el).padStart(2)} pw ${r.pw} d ${String(r.d).padStart(5)} end ${JSON.stringify(r.end)} hit ${r.hit}`);
await b.close(); server.close(); process.exit(0);
