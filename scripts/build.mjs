// Packs src/ into dist/zelium-<version>.zip for distribution / Web Store upload.
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const dist = join(root, 'dist');
const { version } = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8'));
const out = join(dist, `zelium-${version}.zip`);

mkdirSync(dist, { recursive: true });
rmSync(out, { force: true });
execFileSync('zip', ['-r', '-X', '-q', out, '.', '-x', '.*', '-x', '*/.*'], { cwd: src, stdio: 'inherit' });
console.log(`Built ${out}`);
