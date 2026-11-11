// Packages the built Portal as an AWS-ready zip (index.html at the zip root, forward-slash paths).
// Usage: npm run package:aws   (runs the production build + no-CDN check first)
// Output: ../deploy/delbros-portal-web-<version>.zip
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const outDir = join(root, '..', 'deploy');
mkdirSync(outDir, { recursive: true });

// ── Minimal ZIP writer (deflate, CRC-32) — no dependencies ─────────────────
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function dosTime(d) {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}
function zip(files) {
  const local = [], central = [];
  let offset = 0;
  const { time, date } = dosTime(new Date());
  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const comp = deflateRawSync(data, { level: 9 });
    const useStore = comp.length >= data.length;
    const body = useStore ? data : comp;
    const crc = crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(useStore ? 0 : 8, 8);
    h.writeUInt16LE(time, 10); h.writeUInt16LE(date, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(nameBuf.length, 26); h.writeUInt16LE(0, 28);
    local.push(h, nameBuf, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(useStore ? 0 : 8, 10);
    c.writeUInt16LE(time, 12); c.writeUInt16LE(date, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nameBuf.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf);
    offset += h.length + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) { const p = join(dir, n); statSync(p).isDirectory() ? walk(p, out) : out.push(p); }
  return out;
}

const targets = [{ label: 'portal' }];
for (const t of targets) {
  const dist = join(root, 'dist');
  if (!existsSync(join(dist, 'index.html'))) { console.error(`✖ ${dist} has no index.html — run the build first.`); process.exit(1); }
  const files = walk(dist).filter((p) => !p.endsWith('.map')).map((p) => ({ name: relative(dist, p).split(sep).join('/'), data: readFileSync(p) }));
  const outFile = join(outDir, `delbros-${t.label}-web-${pkg.version}.zip`);
  writeFileSync(outFile, zip(files));
  const kb = Math.round(statSync(outFile).size / 1024);
  console.log(`✓ ${outFile}  (${files.length} files, ${kb} KB, index.html at root: ${files.some((f) => f.name === 'index.html')})`);
}
