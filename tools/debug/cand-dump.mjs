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
// fire 8 solver shots to open a breach, then dump candidates
for (let i=0;i<8;i++){
  await p.evaluate(()=>{ const g=window.__GAME__; g._autoAimSuggest(); g.hud.aimValues={az:g.trebuchet.aim.az,el:g.trebuchet.aim.el,power:g.trebuchet.aim.power}; g.tryFire(); });
  await new Promise(r=>setTimeout(r,5200));
}
const dump = await p.evaluate(()=>{
  const g=window.__GAME__; const root=g.trebuchet.root.position;
  const hostile=g.structures.targets.filter(t=>t.priority>0&&!t.destroyed);
  const big=(t)=>(t.type==='wall'||t.type==='tower'||t.type==='gate'||t.type==='barracks');
  hostile.sort((a,b)=>(big(b)-big(a))||(a.center.distanceTo(root)-b.center.distanceTo(root))||(b.priority-a.priority));
  const out=[];
  for (const cand of hostile.slice(0,5)){
    const pt=g._targetAimPoint(cand);
    const sol=pt?g._solveAim(pt):null;
    out.push({t:cand.type, hp:Math.round(cand.hp/cand.hp0*100), pt:pt&&pt.toArray().map(v=>+v.toFixed(1)),
      sol:sol&&{d:+sol.d.toFixed(1), el:sol.el, pw:+sol.pw.toFixed(2), hit:sol.pts.hit?(sol.pts.hit.block?('cid'+sol.pts.hit.block.cid+(sol.pts.hit.block.civilian?' CIV':'')):'?'):'ground'}});
  }
  // probe specific lob solutions against the wall aim point
  const wall = hostile.find(t=>t.type==='wall') || hostile[0];
  const wpt = g._targetAimPoint(wall);
  const probes=[];
  for (const [el,pw] of [[30,1],[40,0.9],[45,0.85],[50,0.8],[55,0.75],[60,0.7],[65,0.65],[70,0.6]]) {
    g.trebuchet.setAim(0, el, pw);
    const V=wpt.constructor;
    const dir=g.trebuchet.launchDir(new V());
    const o=g.trebuchet.predictOrigin(new V());
    const pts=g.ballistics.predict(o, dir, g.trebuchet.launchSpeed(pw), 'stone', {points:60, dt:0.04});
    const end=pts.hit?pts.hit.point:pts[pts.length-1];
    probes.push({el,pw,end:end.toArray().map(v=>+v.toFixed(1)),hit:pts.hit?(pts.hit.block?('cid'+pts.hit.block.cid):'terrain'):'end', d:+end.distanceTo(wpt).toFixed(1)});
  }
  return {cond:Math.round(g.trebuchet.condition*100), v0:+g.trebuchet.launchSpeed(1).toFixed(1), out, wpt:wpt.toArray().map(v=>+v.toFixed(1)), probes};
});
console.log('META',JSON.stringify({cond:dump.cond,v0:dump.v0,wpt:dump.wpt}));
for(const r of dump.probes) console.log(`el${String(r.el).padStart(2)} pw${r.pw} d${String(r.d).padStart(5)} end${JSON.stringify(r.end)} ${r.hit}`);
console.log('CANDS'); for(const c of dump.out) console.log(JSON.stringify(c));
await b.close(); server.close(); process.exit(0);
