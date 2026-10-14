// ============================================================================
//  tools/gradle.mjs — cross-platform gradle wrapper runner
//  Usage: node tools/gradle.mjs assembleDebug   (npm run apk:debug)
//  Picks gradlew.bat on Windows and ./gradlew elsewhere (and makes sure the
//  unix wrapper is executable — git on Windows can check it out without +x).
// ============================================================================
import { spawn } from 'node:child_process';
import { chmodSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID = resolve(ROOT, 'android');
const isWin = process.platform === 'win32';
const wrapper = resolve(ANDROID, isWin ? 'gradlew.bat' : 'gradlew');

if (!existsSync(wrapper)) {
  console.error(`[gradle] wrapper not found: ${wrapper}`);
  console.error('[gradle] run `npm install` and make sure the android/ folder is present');
  process.exit(1);
}
if (!isWin) { try { chmodSync(wrapper, 0o755); } catch (e) { /* best effort */ } }

if (!existsSync(resolve(ANDROID, 'local.properties')) && !process.env.ANDROID_HOME && !process.env.ANDROID_SDK_ROOT) {
  console.warn('[gradle] WARNING: no android/local.properties and no ANDROID_HOME — "SDK location not found" is likely.');
  console.warn('[gradle] Windows: create local.properties with  sdk.dir=C:\\Users\\<you>\\AppData\\Local\\Android\\Sdk');
}

const args = process.argv.slice(2);
if (!args.length) args.push('assembleDebug');

console.log(`[gradle] cd android && ${isWin ? 'gradlew.bat' : './gradlew'} ${args.join(' ')}`);
const child = spawn(wrapper, args, { cwd: ANDROID, stdio: 'inherit', shell: isWin });
child.on('exit', (code) => process.exit(code ?? 0));
