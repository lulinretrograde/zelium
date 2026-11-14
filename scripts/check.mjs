// Syntax-checks every JS file and validates manifest.json references.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

let failed = false;
for (const file of walk(src).filter((f) => f.endsWith('.js'))) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (e) {
    failed = true;
    console.error(`✗ ${relative(root, file)}\n${e.stderr}`);
  }
}

const manifest = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8'));
const refs = [
  manifest.background.service_worker,
  ...Object.values(manifest.icons),
  ...Object.values(manifest.action.default_icon),
  'palette/palette.css',
  'fallback.html',
  'welcome.html',
  'third_party/bangs/bangs.json',
];
const bg = readFileSync(join(src, 'background.js'), 'utf8');
const files = /PALETTE_FILES = \[([^\]]+)\]/.exec(bg)[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
for (const ref of [...refs, ...files]) {
  if (!existsSync(join(src, ref))) {
    failed = true;
    console.error(`✗ missing file referenced by extension: ${ref}`);
  }
}

try {
  const bangs = JSON.parse(readFileSync(join(src, 'third_party/bangs/bangs.json'), 'utf8'));
  if (!Array.isArray(bangs) || bangs.length < 1000) throw new Error(`only ${bangs.length} entries`);
} catch (e) {
  failed = true;
  console.error(`✗ bangs.json invalid: ${e.message}`);
}

if (failed) process.exit(1);
console.log('✓ syntax and manifest references OK');
