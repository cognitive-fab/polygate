// The PAID step — mock of spec generation. Refuses to run without an API key
// in the environment, exactly like the real generate step, so the pipeline
// proves the key-scoping design: this only succeeds in the manual
// `regenerate-specs` job on a protected branch, where POLYGRAPH_ORG_KEY is
// injected. It never calls any API — it just stamps a fresh manifest.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('FAIL ANTHROPIC_API_KEY is not set.');
  console.error('     By design: generation runs only in the protected regenerate-specs job.');
  process.exit(1);
}

const MODULE = 'src/billing-machine.mjs';
const moduleHash = createHash('sha256').update(readFileSync(MODULE)).digest('hex').slice(0, 12);

const manifest = {
  machine: 'billing-lifecycle',
  moduleHash,
  verdict: 'PASS', // mock: a real run records the actual verify verdict
  specs: 3,
  generatedAt: new Date().toISOString(),
  provenance: {
    pipeline: process.env.CI_PIPELINE_ID ?? 'local',
    job: process.env.CI_JOB_ID ?? 'local',
    triggeredBy: process.env.GITLAB_USER_LOGIN ?? process.env.USERNAME ?? 'unknown',
    ref: process.env.CI_COMMIT_REF_NAME ?? 'local',
    sha: process.env.CI_COMMIT_SHA ?? 'local',
  },
};

mkdirSync('out', { recursive: true });
writeFileSync('out/verify-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log('OK   (mock) generated specs and stamped out/verify-manifest.json');
console.log(JSON.stringify(manifest, null, 2));
