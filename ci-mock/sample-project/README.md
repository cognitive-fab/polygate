# sample-project — polygraph CI-gate mock

A minimal repo pushed into the local GitLab CE instance
(see `../../docs/CI-MOCK-SETUP.md`) to exercise the pipeline design:

- `src/billing-machine.mjs` — the machine under verification (stand-in for
  kanjo's billing plan lifecycle).
- `out/verify-manifest.json` — what the last (mock) generation stamped:
  moduleHash + verdict + provenance.
- `scripts/check.mjs` — the free gate: fails the MR when the machine changed
  but specs weren't regenerated (hash mismatch = stale).
- `scripts/gen.mjs` — the paid step: refuses without `ANTHROPIC_API_KEY`;
  only the manual `regenerate-specs` job has it (masked + protected variable).
- `scripts/push.mjs` — mock `polycp push`: the whitelisted bundle (hashes,
  verdict, provenance — nothing else) to `CONTROL_PLANE_URL`.

## The demo loop

1. Edit `src/billing-machine.mjs`, open an MR → `polygraph-check` fails: STALE.
2. Merge attempt is blocked (required pipeline + protected `main`).
3. A maintainer runs the manual `regenerate-specs` job on `main` → fresh
   manifest artifact, attributable in the job log.
4. `polygraph-check` goes green; `push-artifacts` sends the bundle onward.

An MR pipeline that tries to run `gen.mjs` fails by construction: the protected
variable `POLYGRAPH_ORG_KEY` is not injected there. That failure is the point.
