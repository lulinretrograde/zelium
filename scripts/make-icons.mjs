// Generates src/icons/icon{16,32,48,128}.png — a sharp-edged "Z" on a Zed-dark square.
// Zero dependencies: rasterises with 4×4 supersampling and writes PNG via zlib.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'icons');
const BG = [0x28, 0x2c, 0x33];
const BORDER = [0x46, 0x4b, 0x57];
const ACCENT = [0x74, 0xad, 0xe8];

// Shape in a 0..1 unit square.
function colorAt(x, y) {
  const b = 0.045; // border width
  if (x < b || y < b || x > 1 - b || y > 1 - b) return BORDER;
  const m = 0.24; // inner margin
  const t = 0.12; // stroke thickness
  const inX = x >= m && x <= 1 - m;
  if (inX && y >= m && y <= m + t) return ACCENT; // top bar
  if (inX && y >= 1 - m - t && y <= 1 - m) return ACCENT; // bottom bar
  // diagonal from top-right (1-m, m+t) to bottom-left (m, 1-m-t)
  if (y > m + t - 0.001 && y < 1 - m - t + 0.001) {
    const x0 = 1 - m, y0 = m + t, x1 = m, y1 = 1 - m - t;
    const s = (y - y0) / (y1 - y0);
    const cx = x0 + (x1 - x0) * s;
    if (Math.abs(x - cx) <= t * 0.62 && x >= m && x <= 1 - m) return ACCENT;
  }
  return BG;
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size) {
  const SS = 4;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const c = colorAt((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size);
          r += c[0]; g += c[1]; b += c[2];
        }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      raw[o] = Math.round(r / SS / SS);
      raw[o + 1] = Math.round(g / SS / SS);
      raw[o + 2] = Math.round(b / SS / SS);
      raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(join(OUT, `icon${size}.png`), png(size));
  console.log(`icons/icon${size}.png`);
}
