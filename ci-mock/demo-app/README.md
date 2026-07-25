# demo-app — end-to-end polygraph lifecycle demo

A subscription-billing state machine **authored by polygen** (SAM v2 strict
profile, self-repaired, exhaustively model-checked: 12 states, 0 violations)
with **real polygraph gates in CI** — no API key on the free path.

## The machine

`trial → paid → grace (dunning, ≤3 attempts) → lapsed`, with `CANCEL`
(autoRenew off), `REACTIVATE`, and stale-webhook safety (out-of-state
`CHARGE_OK`/`CHARGE_FAILED` are observable rejects). See `polygen-report.md`
for the full authoring + verification report.

- `contract.json` — observable scope (review before trusting: it is the
  model's reading of the feature description)
- `next.cjs` — the machine (SAM v2 strict profile)
- `invariants.mjs` — 6 rules (2 state, 4 transition)
- `traces/` — 11 scenarios, 65 windows (25 observable rejections)
- `out/verify-manifest.json` — identity hashes stamped by the last governed
  verification; the staleness gate compares against it

## CI (three jobs, three trust levels)

| job | trigger | key | what actually runs |
|---|---|---|---|
| `polygraph-check` | MRs + main | none | staleness gate, then **real** `check.mjs` (exhaustive model check) + `verify.mjs --specs` (65-window trace replay) from a pinned clone of public [jdubray/polygraph](https://github.com/jdubray/polygraph) |
| `regenerate-specs` | manual, main | `POLYGRAPH_ORG_KEY` (protected) | re-stamps the manifest after a governed re-verification |
| `push-artifacts` | main | none | the whitelisted bundle (hashes + verdicts + counters + provenance) → `CONTROL_PLANE_URL`, dry-run if unset |

## Demo loop

1. Edit `next.cjs` (say, allow a 4th dunning attempt) in an MR → staleness
   gate fails → merge blocked.
2. Even if you re-stamp locally, the *model check itself* runs on the MR — a
   change that violates `attempts-in-range` fails with a shortest
   counterexample path, not just a hash mismatch.
3. Play `regenerate-specs` on `main` (maintainer, protected key) → manifest
   re-stamped with provenance → gates green → bundle pushed.
