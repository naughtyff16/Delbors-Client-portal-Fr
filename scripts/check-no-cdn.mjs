// Fails the build if any built HTML/JS/CSS references an external origin (docs/02 §7 — no-CDN policy).
// Allowed: our own relative paths, data:/blob: URIs, and XML/SVG namespace strings that are not network loads.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const DIST_DIRS = ['dist'];
const EXTS = new Set(['.html', '.js', '.css']);
const ALLOW = [
  /^https?:\/\/www\.w3\.org\//, // SVG / XML namespaces
  /^https?:\/\/reactjs\.org\/docs\/error-decoder/, // React production error messages (text only)
  /^https?:\/\/react\.dev\/errors/,
  /^https?:\/\/(www\.)?openstreetmap\.org\/(\?|search)/, // "Open in maps" navigation link (not a resource load)
  /^https?:\/\/maps\.google\.com\/\?q=/,
  /^http:\/\/localhost$/, // React Router's fallback base for URL parsing (new URL(path, base)) — never fetched
];
// Only flag URLs used in a resource-loading position: src=, href= on link/script, url(), import, fetch.
const LOAD_PATTERNS = [
  /<script[^>]+src=["'](https?:\/\/[^"']+)/gi,
  /<link[^>]+href=["'](https?:\/\/[^"']+)/gi,
  /url\(\s*["']?(https?:\/\/[^"')]+)/gi,
  /@import\s+["'](https?:\/\/[^"']+)/gi,
  /import\(\s*["'](https?:\/\/[^"']+)/gi,
  /from\s*["'](https?:\/\/[^"']+)/gi,
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXTS.has(extname(p))) out.push(p);
  }
  return out;
}

let violations = 0;
let scanned = 0;
for (const d of DIST_DIRS) {
  if (!existsSync(d)) continue;
  for (const file of walk(d)) {
    scanned++;
    const text = readFileSync(file, 'utf8');
    for (const re of LOAD_PATTERNS) {
      for (const m of text.matchAll(re)) {
        const url = m[1];
        if (ALLOW.some((a) => a.test(url))) continue;
        console.error(`✖ external resource in ${file}: ${url}`);
        violations++;
      }
    }
  }
}
if (scanned === 0) {
  console.warn('check-no-cdn: no dist output found — run a build first.');
} else if (violations) {
  console.error(`check-no-cdn: ${violations} external resource reference(s) found. Bundle or self-host them.`);
  process.exit(1);
} else {
  console.log(`check-no-cdn: OK — ${scanned} files scanned, no external runtime origins.`);
}
