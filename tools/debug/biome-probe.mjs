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
const click = async (txt)=>{ await p.evaluate((t)=>{const n=Array.from(document.querySelectorAll('button,.menu-btn')).find(x=>(x.textContent||'').includes(t)); n&&n.click();}, txt); await new Promise(r=>setTimeout(r,700)); };
await click('Полигон'); await click('В ОСАДУ');
await new Promise(r=>setTimeout(r,2200));
const d = await p.evaluate(()=>{
  const g=window.__GAME__;
  g.mission.biome='desert'; g.mission.mod={id:'calm',wind:0.1,reward:1,supply:1};
  g.startMission(g.mission);
  const t=g.terrain;
  const params = t.biomeParams();
  const mesh = g.terrainMesh;
  const col = mesh.geometry.attributes.color;
  const n = t.n;
  const idx = (Math.floor(n/2))*n + Math.floor(n/2);  // centre vertex (player pad)
  const at = (x, z) => {
    const i = Math.round((z + t.size/2) / t.size * t.segments);
    const j = Math.round((x + t.size/2) / t.size * t.segments);
    const k = i * n + j;
    return [col.getX(k), col.getY(k), col.getZ(k)].map(v=>+v.toFixed(2));
  };
  let maxG = 0, cnt = 0;
  for (let k = 0; k < col.count; k += 97) { const gg = col.getY(k); if (gg > maxG) maxG = gg; if (col.getY(k) > col.getX(k) && col.getY(k) > col.getZ(k)) cnt++; }
  return { biome: t.biome, tint: params.tint?.toString(16),
    c0: at(0,0), c10: at(0,10), c30: at(0,30), c60: at(0,60),
    maxGreen: +maxG.toFixed(2), greenDominantSamples: cnt,
    floraChildren: g.world.flora ? g.world.flora.children.length : -1 };
});
console.log(JSON.stringify(d));
await p.evaluate(()=>{ const g=window.__GAME__; g.hud.show(false); window.__S__().settings.cameraDynamic=false;
  g.rig.setMode('battle',{force:true}); g.rig.azGoal=200; g.rig.polGoal=76; g.rig.distGoal=36; g.rig.targetGoal.set(0,3,26); });
await new Promise(r=>setTimeout(r,1200));
await p.screenshot({path:'shots/dbg-desert-all.png'});
const hit = await p.evaluate(()=>{
  const g=window.__GAME__;
  const THREEV = g.trebuchet.root.position.constructor;
  const rc = new (Object.getPrototypeOf(g._ray).constructor)();
  rc.setFromCamera({x:-0.15, y:-0.45}, g.camera);
  const hits = rc.intersectObjects(g.scene.children, true).slice(0,4).map(h=>({
    name: h.object.name || h.object.type,
    type: h.object.type,
    y: +h.point.y.toFixed(2), z: +h.point.z.toFixed(2),
    mat: h.object.material && h.object.material.type,
    vc: !!(h.object.material && h.object.material.vertexColors),
    col: h.object.material && h.object.material.color ? h.object.material.color.getHexString() : null,
  }));
  return hits;
});
console.log('RAY:', JSON.stringify(hit));
await p.evaluate(()=>{ window.__GAME__.world.flora.visible = false; });
await new Promise(r=>setTimeout(r,400));
await p.screenshot({path:'shots/dbg-desert-noflora.png'});
await p.evaluate(()=>{ window.__GAME__.world.flora.visible = true; window.__GAME__.terrainMesh.visible = false; });
await new Promise(r=>setTimeout(r,400));
await p.screenshot({path:'shots/dbg-desert-noterrain.png'});
await b.close(); server.close(); process.exit(0);
