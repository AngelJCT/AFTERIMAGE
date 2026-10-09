// npm run package: a self-contained web build for any static host or itch.io (an HTML game:
// upload the zip, "This file will be played in the browser"). Relative paths, so it runs from a
// subfolder; files nothing uses are left out; the result is zipped with index.html at the root.
import { execSync } from 'node:child_process';
import { existsSync, rmSync, statSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = join(root, 'dist-web');
const zip = join(root, 'afterimage-web.zip');
// In public/ but not used by the game (kept in the project, not shipped).
const EXCLUDE = [
  'audio/angel_carrion59_cinematic_motion_blurred_fast_movement_scene__002d2d77-ac78-4016-bddf-e317d00a7a29_0.png',
  'audio/part2_past (1).mp3',
];

const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });
run('npx tsc --noEmit');
run(`npx vite build --base ./ --outDir "${out}" --emptyOutDir`);
for (const f of EXCLUDE) rmSync(join(out, f), { force: true });
if (existsSync(zip)) rmSync(zip);
run(`cd "${out}" && zip -qr -9 "${zip}" . -x ".*"`);

const size = (p) => statSync(p).isDirectory() ? readdirSync(p).reduce((a, f) => a + size(join(p, f)), 0) : statSync(p).size;
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
console.log(`\n${out}: ${mb(size(out))}\n${zip}: ${mb(statSync(zip).size)}`);
