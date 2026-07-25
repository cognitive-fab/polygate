// Free staleness gate: the machine's identity (contract + module + invariants
// hashes) must match what the last governed verification stamped. Any drift
// means "verified" no longer describes this code.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const h = (f) => createHash('sha256').update(readFileSync(f)).digest('hex').slice(0, 12);
let m;
try {
  m = JSON.parse(readFileSync('out/verify-manifest.json', 'utf8'));
} catch {
  console.error('FAIL no out/verify-manifest.json — machine never verified. Run the regenerate job.');
  process.exit(1);
}
const now = { contractHash: h('contract.json'), moduleHash: h('next.cjs'), invariantsHash: h('invariants.mjs') };
let stale = false;
for (const [k, v] of Object.entries(now)) {
  const ok = m[k] === v;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${k}: ${v}${ok ? '' : ` (manifest has ${m[k]})`}`);
  if (!ok) stale = true;
}
if (stale) {
  console.error('FAIL verification STALE — machine changed since last governed verification.');
  process.exit(1);
}
console.log(`fresh: versionHash ${m.versionHash}, verified ${m.verifiedAt}`);
