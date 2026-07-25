# polygate

CI/CD integration for the [Polygraph](https://github.com/jdubray/polygraph)
verification engines — a merge gate for verified stateful code: how a team wires `verify` / `polygen` / `polyvers` into
a merge pipeline so that stateful code cannot merge unverified — with no API
key on the free checking path, and the org key confined to one governed job.

## The design in one paragraph

Only spec **generation/authoring** calls a paid model; **replay, model
checking, and compat gates run locally, free**. So the pipeline splits into
three jobs with three trust levels: `polygraph-check` (every MR — staleness by
content hash, exhaustive model check, trace replay; keyless), `regenerate-specs`
(manual, protected branch only — the single key-bearing job, fed by a masked +
protected group variable), and `push-artifacts` (whitelisted hashes/verdicts/
provenance to a control plane; keyless).

## What's here

- **[`docs/CI-MOCK-SETUP.md`](docs/CI-MOCK-SETUP.md)** — the full walkthrough:
  a self-hosted GitLab CE mock (Docker Compose), its boot gotchas, scripted
  configuration, and the demos that prove the design.
- **[`ci-mock/`](ci-mock/)** — everything runnable:
  - `docker-compose.yml` + `setup-gitlab.ps1` — the instance and its scripted setup
  - `sample-project/` — minimal pipeline mock (hash-only staleness gate)
  - `demo-app/` — the real thing: a polygen-authored subscription-billing
    machine (12 states exhaustive, 0 violations, 65-window trace corpus) whose
    CI runs the actual polygraph engines from a pinned public clone

## The proof points (both demonstrated on the mock instance)

1. **Gates block unverified change**: an MR editing the machine without
   re-verification fails the staleness gate; merge is blocked.
2. **Gates survive a gamed hash**: an MR that seeds a real bug *and* re-stamps
   the manifest passes the hash gate — and the exhaustive model check still
   fails it, with a shortest-path counterexample as the repro.

Quick start: `docker compose -f ci-mock/docker-compose.yml up -d`, wait for
boot (§2 of the setup doc), then `pwsh ci-mock/setup-gitlab.ps1`.
