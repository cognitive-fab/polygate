# Post-boot configuration for the GitLab CE mock (see docs/CI-MOCK-SETUP.md).
# Idempotent-ish: safe to re-run; steps that already exist are skipped or fail soft.
#
# What it does:
#   1. Mint a root personal access token via gitlab-rails runner (the only
#      scriptable path on a fresh instance — no UI clicking to document).
#   2. Create the `ci-mock/sample-project` project via API.
#   3. Create an instance runner (new glrt- flow) and register the runner
#      container against it (docker executor, node:20-alpine default image).
#   4. Set the masked+protected CI/CD variable POLYGRAPH_ORG_KEY (dummy value).
#   5. Push the sample project from ci-mock/sample-project.
#
# Run:  pwsh ci-mock/setup-gitlab.ps1

$ErrorActionPreference = 'Stop'
$GL = 'http://localhost:8080'
$TOKEN_NAME = 'ci-mock-admin'

# ── 1. Root PAT ──────────────────────────────────────────────────────────────
Write-Host '[1/5] minting root PAT via gitlab-rails runner (slow, ~1 min)...'
$rubyScript = @'
u = User.find_by_username("root")
t = u.personal_access_tokens.find_by(name: "ci-mock-admin")
t&.revoke!
t = u.personal_access_tokens.create!(name: "ci-mock-admin", scopes: [:api, :create_runner], expires_at: 30.days.from_now)
t.set_token("ci-mock-" + SecureRandom.hex(16))
t.save!
puts "PAT=" + t.token
'@
$out = docker exec polygraph-gitlab gitlab-rails runner "$rubyScript"
$PAT = ($out | Select-String 'PAT=(.+)').Matches[0].Groups[1].Value
if (-not $PAT) { throw "failed to mint PAT: $out" }
Write-Host "      PAT minted ($($PAT.Substring(0,12))...)"
$H = @{ 'PRIVATE-TOKEN' = $PAT }

# ── 2. Project ───────────────────────────────────────────────────────────────
Write-Host '[2/5] creating project sample-project...'
try {
  $proj = Invoke-RestMethod -Method Post -Uri "$GL/api/v4/projects" -Headers $H -Body @{
    name = 'sample-project'; initialize_with_readme = 'false'; visibility = 'private'
  }
} catch {
  $proj = (Invoke-RestMethod -Uri "$GL/api/v4/projects?search=sample-project" -Headers $H) | Select-Object -First 1
}
Write-Host "      project id $($proj.id): $($proj.path_with_namespace)"

# ── 3. Runner ────────────────────────────────────────────────────────────────
Write-Host '[3/5] creating + registering runner...'
$runner = Invoke-RestMethod -Method Post -Uri "$GL/api/v4/user/runners" -Headers $H -Body @{
  runner_type = 'instance_type'; description = 'ci-mock docker runner'; run_untagged = 'true'
}
# The runner container reaches GitLab via the compose network alias; port is the
# in-container nginx port (8080), same as external_url.
# clone-url must be the network alias: jobs run in sibling containers where
# `localhost` (the external_url host) would point at the job container itself.
docker exec polygraph-runner gitlab-runner register --non-interactive `
  --url "http://gitlab:8080" --clone-url "http://gitlab:8080" --token $runner.token `
  --executor docker --docker-image node:20-alpine `
  --docker-network-mode ci-mock_default `
  --description 'ci-mock docker runner'
Write-Host "      runner id $($runner.id) registered"

# ── 4. Protected variable ────────────────────────────────────────────────────
Write-Host '[4/5] setting masked+protected POLYGRAPH_ORG_KEY...'
try {
  Invoke-RestMethod -Method Post -Uri "$GL/api/v4/projects/$($proj.id)/variables" -Headers $H -Body @{
    key = 'POLYGRAPH_ORG_KEY'; value = 'mock-org-key-0000000000000000'
    protected = 'true'; masked = 'true'
  } | Out-Null
} catch { Write-Host '      (already exists, keeping)' }

# ── 5. Push sample project ───────────────────────────────────────────────────
Write-Host '[5/5] pushing sample-project...'
$src = Join-Path $PSScriptRoot 'sample-project'
Push-Location $src
if (-not (Test-Path .git)) { git init -b main | Out-Null; git add -A; git commit -m 'ci-mock: initial sample project' | Out-Null }
git remote remove gitlab 2>$null
git remote add gitlab "http://root:$PAT@localhost:8080/root/sample-project.git"
git push -u gitlab main
Pop-Location

Write-Host ''
Write-Host "done. UI: $GL (root / see docker-compose.yml). Pipeline: $GL/root/sample-project/-/pipelines"
