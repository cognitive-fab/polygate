// The governed (re)verification step. In the real workflow this is where spec
// generation / polygen re-authoring spends API money, so it demands a key in
// the environment — structurally limiting it to the protected regenerate job
// (or a dev's own seat locally). It stamps the machine's identity hashes into
// out/verify-manifest.json, which the free CI gate compares against.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('FAIL ANTHROPIC_API_KEY not set — (re)verification is a governed, key-bearing step.');
  process.exit(1);
}

const h = (f) => createHash('sha256').update(readFileSync(f)).digest('hex').slice(0, 12);
const components = {
  contractHash: h('contract.json'),
  moduleHash: h('next.cjs'),
  invariantsHash: h('invariants.mjs'),
};
const versionHash = createHash('sha256')
  .update(Object.values(components).join(''))
  .digest('hex')
  .slice(0, 12);

const manifest = {
  machine: 'subscription-billing',
  ...components,
  versionHash,
  verifiedAt: new Date().toISOString(),
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
console.log('stamped out/verify-manifest.json');
console.log(JSON.stringify(manifest, null, 2));
