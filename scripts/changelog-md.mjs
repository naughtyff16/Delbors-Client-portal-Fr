// CHANGELOG-REMOVE (temporary): writes CHANGELOG.md from src/lib/shared/changelog.ts (the same entries the in-app Change log page shows).
// Usage: node scripts/changelog-md.mjs   (Node 22.6+ strips the TypeScript types on import)
import { writeFileSync } from 'node:fs';
import { CHANGELOG } from '../src/lib/shared/changelog.ts';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (iso) => { const [y, m, d] = iso.split('-'); return `${d}-${MON[+m - 1]}-${y}`; };

let md = '# Change log — Delbros Leasing frontend v0.1.0\n\n';
md += 'Temporary log of the correction and UI/UX work, newest first, so the team can follow what changed, why, and the result.\n';
md += 'The same entries open from the sticky “Change log” button (bottom-right) on both sign-in pages while `app-config.json` has `"showChangeLog": true`.\n';
md += 'Source of truth: `src/lib/shared/changelog.ts` — regenerate this file with `node scripts/changelog-md.mjs`.\n';
for (const date of [...new Set(CHANGELOG.map((e) => e.date))]) {
  md += `\n## ${day(date)}\n`;
  for (const e of CHANGELOG.filter((x) => x.date === date)) {
    md += `\n### ${e.title} \`${e.kind}\`\n\n**Why:** ${e.why}\n\n${e.changes.map((c) => `- ${c}`).join('\n')}\n`;
    if (e.result) md += `\n**Result:** ${e.result}\n`;
  }
}
md += '\n---\n\n## How to hide or remove the change log\n\n- **Hide (no rebuild):** set `"showChangeLog": false` in `public/app-config.json` (or the deployed copies). The button disappears from both sign-in pages.\n- **Remove completely:** search the code for `CHANGELOG-REMOVE` and delete those lines / files (`src/lib/shared/changelog.ts`, `src/lib/ui/ChangeLog.tsx` and its export, the `<ChangeLogLauncher />` line on each login page, this script and this file).\n';
writeFileSync(new URL('../CHANGELOG.md', import.meta.url), md);
console.log(`CHANGELOG.md written — ${CHANGELOG.length} entries`);
