// The FREE gate — mock of "replay + model check + staleness" that runs on
// every MR with no API key. Here it does the one thing the mock needs to be
// real about: the staleness check. out/verify-manifest.json records the
// moduleHash the last (mock) generation ran against; if the machine's source
// changed since, this job fails and the MR is blocked until someone runs the
// manual regenerate-specs job.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const MODULE = 'src/billing-machine.mjs';
const MANIFEST = 'out/verify-manifest.json';

const moduleHash = createHash('sha256').update(readFileSync(MODULE)).digest('hex').slice(0, 12);

let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
} catch {
  console.error(`FAIL no ${MANIFEST} — machine has never been verified. Run the regenerate-specs job.`);
  process.exit(1);
}

console.log(`module  ${MODULE} -> ${moduleHash}`);
console.log(`manifest verified moduleHash -> ${manifest.moduleHash} (verdict: ${manifest.verdict}, at: ${manifest.generatedAt})`);

if (manifest.moduleHash !== moduleHash) {
  console.error('FAIL verification STALE — the machine changed since specs were generated.');
  console.error('     Run the manual `regenerate-specs` job (protected branch, org key) or verify locally.');
  process.exit(1);
}
if (manifest.verdict !== 'PASS') {
  console.error(`FAIL last verification verdict was ${manifest.verdict}.`);
  process.exit(1);
}

// Real pipeline: node polygraph/scripts/verify.mjs --check-only + polyvers check here.
console.log('OK   verification fresh — free gates would run here (replay, model check, polyvers).');
