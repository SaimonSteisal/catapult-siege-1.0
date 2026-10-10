// ============================================================================
//  tools/build.mjs — esbuild bundle + fully self-contained dist/index.html
//  Usage: node tools/build.mjs [--dev] [--watch]
// ============================================================================
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, cpSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC = resolve(ROOT, 'src');
const DIST = resolve(ROOT, 'dist');
const args = process.argv.slice(2);
const isDev = args.includes('--dev');
const watch = args.includes('--watch');

const hash = Date.now().toString(36).slice(-6);

mkdirSync(DIST, { recursive: true });

const define = {
  __BUILD_HASH__: JSON.stringify(isDev ? 'dev' : hash),
  'process.env.NODE_ENV': JSON.stringify(isDev ? 'development' : 'production'),
};

const opts = {
  entryPoints: [resolve(SRC, 'main.js')],
  bundle: true,
  outfile: resolve(DIST, 'game.js'),
  format: 'iife',
  target: ['chrome90', 'es2020'],
  platform: 'browser',
  sourcemap: isDev ? 'inline' : false,
  minify: !isDev,
  treeShaking: true,
  legalComments: 'none',
  define,
  logLevel: 'info',
  absWorkingDir: ROOT,
};

async function build() {
  const t0 = Date.now();
  if (watch) {
    const ctx = await esbuild.context(opts);
    await ctx.watch();
    console.log('[build] watching…');
  } else {
    await esbuild.build(opts);
  }

  // ---- inline CSS + JS into a single self-contained index.html
  const css = readFileSync(resolve(SRC, 'ui/style.css'), 'utf8');
  const js = readFileSync(resolve(DIST, 'game.js'), 'utf8');
  let html = readFileSync(resolve(SRC, 'index.html'), 'utf8');
  // NOTE: function replacements are mandatory — the minified bundle contains
  // `$&`/`$'` sequences that String.replace would otherwise interpolate.
  html = html.replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${css}\n</style>`);
  html = html.replace('<script type="module" src="game.js"></script>', () => `<script>\n${js}\n</script>`);
  if (html.includes('src="game.js"')) throw new Error('inline replacement failed');
  writeFileSync(resolve(DIST, 'index.html'), html);

  // also ship the split files for dev/WebView caching
  writeFileSync(resolve(DIST, 'style.css'), css);

  const kb = (Buffer.byteLength(js) / 1024).toFixed(0);
  const hkb = (Buffer.byteLength(html) / 1024).toFixed(0);
  console.log(`[build] ${isDev ? 'dev' : 'release'} ${hash} — game.js ${kb} KB, index.html ${hkb} KB, ${Date.now() - t0} ms`);
}

build().catch((e) => { console.error(e); process.exit(1); });
