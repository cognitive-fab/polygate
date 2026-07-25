// Mock of `polycp push` — assembles the artifact bundle that would go to the
// control plane (hashes + verdicts + provenance ONLY, per the whitelist) and
// POSTs it to CONTROL_PLANE_URL if set, else prints it. This doubles as the
// first integration probe of the ingest endpoint.
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('out/verify-manifest.json', 'utf8'));

const bundle = {
  schema: 'polycp/run-bundle@0',
  project: process.env.CI_PROJECT_PATH ?? 'ci-mock/sample-project',
  machine: manifest.machine,
  versionHash: manifest.moduleHash, // mock: real versionHash is the 6-component hash
  engine: 'polygraph-verify',
  verdict: manifest.verdict,
  summary: { specs: manifest.specs },
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
