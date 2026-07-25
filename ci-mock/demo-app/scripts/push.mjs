// Mock `polycp push` — the whitelisted run bundle: hashes, verdicts, summary
// counters, provenance. No source, no traces, no windows. POSTs to
// CONTROL_PLANE_URL if set, else dry-runs.
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('out/verify-manifest.json', 'utf8'));
const check = JSON.parse(readFileSync('out/check.json', 'utf8'));
const findings = JSON.parse(readFileSync('out/findings.json', 'utf8'));
const fs = findings.summary ?? findings;

const bundle = {
  schema: 'polycp/run-bundle@0',
  project: process.env.CI_PROJECT_PATH ?? 'polygraph/demo-app',
  machine: manifest.machine,
  versionHash: manifest.versionHash,
  components: {
    contractHash: manifest.contractHash,
    moduleHash: manifest.moduleHash,
    invariantsHash: manifest.invariantsHash,
  },
  engine: 'polygraph',
  verdict:
    (check.violations?.length ?? 0) === 0 && fs.codeFinding === 0 && fs.specError === 0
      ? 'PASS'
      : 'FAIL',
  summary: {
    statesExplored: check.statesExplored ?? null,
    violations: check.violations?.length ?? 0,
    windowsConsistent: fs.consistent ?? null,
    windowsTotal: fs.windows ?? null,
    specError: fs.specError ?? 0,
    codeFinding: fs.codeFinding ?? 0,
  },
  provenance: manifest.provenance,
};

console.log('bundle that leaves the runner (and nothing else):');
console.log(JSON.stringify(bundle, null, 2));

const url = process.env.CONTROL_PLANE_URL;
if (!url) {
  console.log('CONTROL_PLANE_URL not set — dry run, nothing pushed.');
  process.exit(0);
}
const res = await fetch(`${url.replace(/\/$/, '')}/ingest`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(bundle),
});
console.log(`ingest -> HTTP ${res.status}`);
if (!res.ok) process.exit(1);
