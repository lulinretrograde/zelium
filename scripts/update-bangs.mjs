// Fetches the bang list Helium itself uses (Kagi's bangs + Helium's extras,
// MIT licensed) and writes a compact copy to src/third_party/bangs/bangs.json.
//
//   node scripts/update-bangs.mjs            # from Helium's services
//   node scripts/update-bangs.mjs ./file.json  # from a local copy
//
// Output format (compact, ~40% smaller than the source):
//   [[name, "trigger1 trigger2 …", urlTemplate, flags?, "ai"?], …]
// urlTemplate uses {searchTerms}; flags is the source's optional "f" bitmask.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SOURCE = 'https://services.helium.imput.net/bangs.json';
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'third_party', 'bangs');

const raw = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : await (await fetch(SOURCE)).text();

// The file is JSON with // comments and trailing commas.
const header = raw.match(/^(\s*\/\/.*\n)+/)?.[0] ?? '';
const json = raw.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[\]}])/g, '$1');
const entries = JSON.parse(json);

const seen = new Set();
const out = [];
for (const e of entries) {
  if (!e?.s || !Array.isArray(e.ts) || typeof e.u !== 'string') continue;
  let url;
  try {
    url = new URL(e.u.replaceAll('{searchTerms}', 'x'));
  } catch {
    continue;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
  const triggers = e.ts.filter((t) => typeof t === 'string' && t && !/\s/.test(t) && !seen.has(t.toLowerCase()));
  if (!triggers.length) continue;
  for (const t of triggers) seen.add(t.toLowerCase());
  const row = [e.s, triggers.join(' '), e.u];
  if (e.f != null || e.sc) row.push(e.f ?? 0);
  if (e.sc) row.push(e.sc);
  out.push(row);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'bangs.json'), `${JSON.stringify(out)}\n`);

const license = header
  .split('\n')
  .map((l) => l.replace(/^\s*\/\/ ?/, ''))
  .join('\n')
  .trim();
writeFileSync(
  join(OUT_DIR, 'LICENSE'),
  `Bang data from ${SOURCE}\n(the list Helium uses; based on https://github.com/kagisearch/bangs)\n\n${license}\n`,
);

console.log(`Wrote ${out.length} bangs (${seen.size} triggers) to src/third_party/bangs/`);
