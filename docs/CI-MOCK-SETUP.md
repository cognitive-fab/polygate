# CI mock — self-hosted GitLab CE for the polygraph gate

**Status:** in progress · **Date started:** 2026-07-24

Purpose: stand up a local, open-source GitLab CE instance that mocks the CI
phase of the polygraph workflow — the free verification gates on every MR, the
manual key-bearing `regenerate-specs` job, and the artifact push to the control
plane — so the pipeline design can be exercised before touching gitlab.com or a
licensed instance.

What CE gives us with full fidelity: masked variables, **protected variables**
(the org key is not injected into pipelines on unprotected branches or forks),
manual jobs, environments, protected branches, required pipeline status.
What CE lacks vs Premium: protected-environment **approval rules** (the
two-person spend gate). We approximate with a manual job restricted to a
protected branch that only maintainers can touch.

## Host prerequisites

- Windows 11 + Docker Desktop (tested: Docker 29.6.1, 16 GB RAM available).
  GitLab CE wants ~4 GB for itself.
- Ports free on the host: `8080` (web/API), `2222` (git over SSH).

## 1. Compose file

Everything lives in [`ci-mock/docker-compose.yml`](../ci-mock/docker-compose.yml):

- `gitlab/gitlab-ce:latest` with `external_url 'http://localhost:8080'`
  (nginx therefore listens on 8080 in-container; the port map is `8080:8080`,
  not `8080:80` — a classic gotcha).
- SSH remapped to host port `2222` via `gitlab_shell_ssh_port`.
- Prometheus disabled — this is a laptop mock, not a monitored instance.
- First-boot root password set via `initial_root_password` (mock only; on any
  shared instance use the generated `/etc/gitlab/initial_root_password` and
  rotate).
- `gitlab/gitlab-runner:latest` alongside, with the host Docker socket mounted
  so it can run jobs in `node:20` containers (Docker executor).
- Named volumes for config/logs/data so the instance survives restarts;
  `docker compose down -v` is the full reset.

## 2. Boot

```powershell
docker compose -f ci-mock/docker-compose.yml up -d
```

First boot pulls ~3 GB and then reconfigures for several minutes. Wait for the
healthcheck:

```powershell
docker inspect --format '{{.State.Health.Status}}' polygraph-gitlab
# starting → healthy (typically 4–6 minutes after the pull)
```

Then log in at http://localhost:8080 as `root` / the compose-file password.

### Gotcha #1 (hit on first boot): puma crash-loops on port 8080

Symptom: container reports `healthy`, all `gitlab-ctl status` services are
`run:`, but every request returns **502** forever, and
`/var/log/gitlab/puma/current` shows:

```
Address already in use - bind(2) for "127.0.0.1" port 8080 (Errno::EADDRINUSE)
```

Cause: setting `external_url` to port **8080** makes omnibus nginx listen on
8080 — but puma's *internal* listener also defaults to `127.0.0.1:8080` inside
the container. They collide; puma dies and respawns every ~90 s.

Fix (already in the compose file): move puma off 8080 and, while at it, drop
the worker count — omnibus sizes puma to the host CPU count (10 workers here),
which is far too heavy for a laptop mock:

```ruby
puma['port'] = 8081
puma['worker_processes'] = 2
```

Then `docker compose up -d` recreates the container; data survives in the
named volumes. Allow a few minutes of Rails preload before the first 200.

**Do not pick 8082** (first attempt here did): that's the sidekiq
metrics-exporter's default port, and you get the *same* crash loop with a
confusing twist — puma binds its unix socket, logs `Listening on unix://…`,
then dies on the TCP bind ~60 s into every boot. Ports already taken inside
the omnibus container (this image): 22, 8060, 8080 (nginx), 8082 (sidekiq
exporter), 8092 (sidekiq health), 8150–8155 (kas), 9229 (workhorse), 9236
(gitaly). Survey before choosing:

```sh
docker exec polygraph-gitlab bash -c \
  'awk "\$4==\"0A\" {print \$2}" /proc/net/tcp | cut -d: -f2 | sort -u | while read h; do printf "%d\n" 0x$h; done | sort -n'
```

(No `ss`/`netstat`/`lsof` in the image — `/proc/net/tcp` is what you have.)

### Gotcha #2: `docker compose up -d` is not "done"

The healthcheck can flip to `healthy` while puma is still preloading (or, per
gotcha #1, crash-looping — the healthcheck endpoint is served by workhorse and
can succeed regardless). The reliable readiness probe is:

```powershell
docker exec polygraph-gitlab sh -c "curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/users/sign_in"
# 502 = still booting · 200 = actually up
```

<!-- Sections below are filled in as the setup proceeds. -->

## 3. Post-boot configuration (scripted)

Everything after boot is one script — [`ci-mock/setup-gitlab.ps1`](../ci-mock/setup-gitlab.ps1):

```powershell
pwsh ci-mock/setup-gitlab.ps1
```

What it does, in order (each step is also the manual recipe):

1. **Mint a root PAT** via `gitlab-rails runner` inside the container (slow,
   ~1 min — it boots Rails). This is the only scriptable path on a fresh
   instance; tokens are stored hashed, so re-runs revoke + recreate.
2. **Create the project** (`root/sample-project`) via `POST /api/v4/projects`.
3. **Create + register the runner** — modern flow: `POST /api/v4/user/runners`
   returns a `glrt-…` token, then `gitlab-runner register --non-interactive`
   in the runner container with `--executor docker --docker-image node:20-alpine`.
   Two flags matter:
   - `--url http://gitlab:8080` — the compose-network alias, not `localhost`.
   - `--clone-url http://gitlab:8080` — **required**: job containers are
     siblings on the Docker network, so the `external_url` host (`localhost`)
     would point a job at itself and every checkout would fail.
4. **Set the protected + masked variable** `POLYGRAPH_ORG_KEY` via
   `POST /projects/:id/variables` with `protected=true&masked=true`. Protected
   ⇒ it is not injected into pipelines on unprotected branches or MR pipelines.
   `main` (the initial default branch) is protected out of the box.
5. **Push the sample project** (`ci-mock/sample-project`) over HTTP with the PAT.

## 4. The pipeline, exercised

Three jobs in `.gitlab-ci.yml`, three trust levels:

| job | trigger | key present? | result on first run |
|---|---|---|---|
| `polygraph-check` | every MR + main | no | ✅ success (manifest fresh) |
| `regenerate-specs` | manual, main only | **yes** (protected var) | ✅ success when played; provenance (pipeline id, job id, actor, SHA) stamped into the artifact |
| `push-artifacts` | main | no | ✅ success (dry-run bundle print; set `CONTROL_PLANE_URL` to make it POST) |

### Demo 1 — the paid step is governed

Playing the manual `regenerate-specs` job on `main` injected
`POLYGRAPH_ORG_KEY` (as `ANTHROPIC_API_KEY`), the mock generation ran, and the
job log + artifact carry full attribution:

```json
"provenance": { "pipeline": "2", "job": "5", "triggeredBy": "root",
                "ref": "main", "sha": "4d785f91…" }
```

### Demo 2 — the staleness gate blocks unverified machine changes

An MR (`change-dunning`) that edits `src/billing-machine.mjs` (dunning
`>= 3` → `>= 2`) without regenerating fails its pipeline:

```
module  src/billing-machine.mjs -> 3b8a006baee0
manifest verified moduleHash    -> 7cbd0107e804 (verdict: PASS)
FAIL verification STALE — the machine changed since specs were generated.
```

With **Settings → Merge requests → "Pipelines must succeed"** enabled, that
MR cannot merge until someone with access to the protected job regenerates.
And because `POLYGRAPH_ORG_KEY` is protected, an MR pipeline that tried to run
the generation step would fail on the missing key — the negative control is
structural, not procedural.

### Gotcha #3: a push does not always create the first pipeline

The initial `git push` did not produce a pipeline (freshly-booted instance;
sidekiq still settling). `POST /projects/:id/pipeline?ref=main` created it
fine. If the first push shows no pipeline, trigger one manually before
debugging the CI config — and `GET /projects/:id/ci/lint?ref=main` confirms
the config parses.

### Gotcha #4: UI actions can 500 with `Rack::Timeout` on a cold instance

Creating a group/project through the UI returned
`500 — Request ran for longer than 60000ms` (visible in
`/var/log/gitlab/gitlab-rails/production.log`). A cold 2-worker instance under
WSL2 can exceed GitLab's 60 s request budget on expensive writes. Check
whether the object was partially created (`GET /api/v4/groups?search=…`)
before retrying — here nothing had been written, and the API path succeeded
immediately. Warm instances don't do this.

## 5. Team layout: group `polygraph`, project `continuous-verification`

The single-project mock was then promoted to the team shape:

- **Group `polygraph`** with the CI/CD variable `POLYGRAPH_ORG_KEY`
  (masked + protected) set at **group** level — one place to rotate, inherited
  by every project's protected-branch pipelines.
- **Project `polygraph/continuous-verification`** with
  `only_allow_merge_if_pipeline_succeeds = true`, so the staleness FAIL is an
  actual merge block. `main` is protected by default.
- The sample repo pushed there; the instance-wide runner picks it up with no
  extra registration.

## 6. `polygraph/demo-app` — the end-to-end lifecycle with REAL gates

The mock `sample-project` proves the pipeline shape; `demo-app` replaces the
hash-only mock with the actual engines. Source in `ci-mock/demo-app/`.

**The machine**: a subscription-billing lifecycle (trial → paid → grace/dunning
≤3 attempts → lapsed, + CANCEL/REACTIVATE, stale-webhook rejects) **authored by
polygen** — contract, SAM v2 module, 6 invariants, 11-scenario/65-window trace
corpus, all committed. Authoring verdict: 12 states exhaustive, 0 violations,
65/65 replay. See `demo-app/polygen-report.md`.

**The CI gate is real**: `polygraph-check` clones public jdubray/polygraph at a
pinned SHA (`POLYGRAPH_SHA` variable — bump deliberately), `npm install`s it,
then runs the staleness gate + `check.mjs` (exhaustive model check) +
`verify.mjs --specs` (full trace replay). No API key anywhere on this path.
First run on `main`: all green, `push-artifacts` emitted the whitelisted bundle
(versionHash `44cab0c7dd17`, PASS, 12 states, 65/65 windows).

**The adversarial demo** (MR !1 on demo-app): raised the dunning cap from 3 to
9 in `next.cjs` **and re-stamped the manifest locally** so the hash gate would
pass — simulating a developer bypassing process. Result:

```
ok   contractHash / moduleHash / invariantsHash   ← staleness gate fooled
states explored: 24
1 invariant violation(s):  (attempts-in-range)
  counterexample (shortest path from init):
    CONVERT({cardOnFile:true}) → paid
    CHARGE_FAILED → grace attempts:1 → 2 → 3 → 4   ← the bug, as a repro
```

Pipeline failed → merge blocked ("pipelines must succeed"). The layered-gate
lesson: hashes catch laziness; the model check catches intent violations even
when the hashes are gamed.

## 7. Where this connects to the control plane

`push-artifacts` currently prints the whitelisted bundle (hashes, verdict,
summary counters, provenance — nothing else). Point `CONTROL_PLANE_URL` (a
project CI variable) at a stub ingest endpoint and this job becomes the first
integration test of `polycp push`.

## Teardown / reset

```powershell
docker compose -f ci-mock/docker-compose.yml down        # stop, keep data
docker compose -f ci-mock/docker-compose.yml down -v     # full reset
```
