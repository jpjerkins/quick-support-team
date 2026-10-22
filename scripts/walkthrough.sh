#!/usr/bin/env bash
# Acceptance walkthrough on a disposable tiny repo, using deterministic FIXTURE agents.
# Proves workflow mechanics only (no subscription is used); it says nothing about real agent judgement.
# Usage: scripts/walkthrough.sh [workdir]   (default: a new temp dir; nothing outside it is touched)
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
root="${1:-$(mktemp -d -t qst-walkthrough-XXXX)}"
export QST_DESK="$root/desk" QST_AGENT_HARNESS=fixture QST_FIXTURE_AGENT="$here/test/fixtures/agent.ts" \
       QST_FIXTURE_SCRIPT="$root/script.json" QST_FIXTURE_LOG="$root/agents.jsonl"
qst() { "$here/bin/qst" "$@"; }
step() { printf '\n=== %s\n' "$*"; }
field() { node -e 'const t=require("fs").readFileSync(process.argv[1],"utf8");const m=JSON.parse(t.slice(4,t.indexOf("\n---\n",4)));console.log(process.argv[2].split(".").reduce((o,k)=>o?.[k],m))' "$QST_DESK/work/$1/workorder.md" "$2"; }

step "0. Disposable repo with a real test suite: $root/tiny"
mkdir -p "$root/tiny" && cd "$root/tiny"
git init -q && git config user.email sample@example.com && git config user.name "Sample"
printf 'module.exports = (a, b) => a + b;\n' > add.js
cat > test.js <<'JS'
const assert = require('assert');
assert.strictEqual(require('./add.js')(2, 3), 5);
if (require('fs').existsSync('./mul.js')) assert.strictEqual(require('./mul.js')(2, 3), 6);
console.log('tests ok');
JS
git add -A && git commit -qm init && cd "$root"

step "1. Desk with fixture routing and a permissive SAMPLE capacity policy"
qst init
policy() { cat > "$QST_DESK/owner/capacity.md" <<JSON
---
{ "autonomous_enabled": true, "max_launches_per_sweep": 10, "sweep_max_minutes": 5, "on_window_start": "finish",
  "providers": { "claude": { "launches_per_day": $1, "max_minutes_per_run": 2 }, "codex": { "launches_per_day": $1, "max_minutes_per_run": 2 } } }
---
SAMPLE policy for the walkthrough.
JSON
}
policy 20
cat > "$QST_DESK/owner/routing.md" <<'JSON'
---
{ "roles": { "implement": {"provider":"codex","model":"implement"}, "review": {"provider":"claude","model":"review"},
  "architecture": {"provider":"claude","model":"architecture"}, "executive": {"provider":"claude","model":"executive"} } }
---
SAMPLE fixture routing (model = fixture role).
JSON

step "2. Ingest a SAMPLE owner brief (as a Chief of Staff session would)"
qst ingest project --slug tiny --name "Tiny math (SAMPLE)" --state building --repo "$root/tiny" --validate "node test.js" \
  --purpose "SAMPLE: arithmetic helpers for homework checking" --text "SAMPLE: Phil says tiny is half-built" --source "walkthrough sample brief"
qst ingest guidance --topic priorities --text "SAMPLE: finish tiny before starting anything new" --source "walkthrough sample brief"
qst ingest guidance --topic technical --text "SAMPLE: plain CommonJS modules, no dependencies" --source "walkthrough sample brief"

step "3. Bounded assignment with acceptance criteria, approved by the (sample) owner"
wo=$(qst workorder add --project tiny --outcome "Add mul(a, b)" --accept "mul(2,3) returns 6" --accept "existing tests still pass" --source "walkthrough")
echo "work order: $wo"
qst ingest decision --approve "$wo" --text "SAMPLE: approved" --source "walkthrough sample owner" >/dev/null

cat > "$QST_FIXTURE_SCRIPT" <<'JSON'
{
  "implement": [
    { "json": { "status": "question", "summary": "module style unclear", "question": { "text": "ESM export or CommonJS for mul.js?", "evidence": "add.js uses module.exports", "requested_decision": "module style", "desk": "architecture" } } },
    { "write": { "mul.js": "module.exports = (a, b) => a * b;\n" }, "json": { "status": "done", "summary": "added mul.js (CommonJS, per architecture answer)" } }
  ],
  "architecture": [ { "json": { "kind": "interpretation", "answer": "CommonJS: owner technical guidance says plain CommonJS modules.", "guidance_refs": ["owner/technical.md: plain CommonJS modules, no dependencies"] } } ],
  "review": [ { "json": { "verdict": "approve", "summary": "mul meets both criteria; tests demonstrate it", "findings": [ { "severity": "minor", "text": "no test for negative numbers" } ] } } ],
  "executive": [ { "json": { "answers": [], "decisions": [], "workorders": [], "notes": "tiny is ready for Phil to merge" } } ]
}
JSON

step "4. Dry run: proposed dispatch, nothing started"
qst sweep --dry-run

step "5. One sweep: question routed to Architecture, answered, code change, real tests, commit, separate review"
qst sweep
echo "status: $(field "$wo" status)"
echo "--- question record:"; cat "$QST_DESK"/questions/*.md | sed -n '/## Question/,$p'
echo "--- real test run by the coordinator:"; cat "$QST_DESK/work/$wo/validations/V1/1.log"
echo "--- commit on the work branch (main repo untouched):"; git -C "$(field "$wo" worktree)" log --oneline -2; git -C "$root/tiny" log --oneline -1
echo "--- outcome:"; cat "$QST_DESK/work/$wo/outcome.md"

step "6. Blocked capacity decision: allowance used up, so the next assignment is held, not dispatched"
policy 1
wo2=$(qst workorder add --project tiny --outcome "Add sub(a, b)" --accept "sub(5,3) returns 2" --source "walkthrough")
qst ingest decision --approve "$wo2" --text "SAMPLE: approved" --source "walkthrough sample owner" >/dev/null
qst sweep || true
echo "$wo2 status: $(field "$wo2" status); hold: $(field "$wo2" capacity_hold)"

step "7. Interrupted run: coordinator and agent killed mid-implementation"
policy 20
printf '{ "implement": [ { "sleep_ms": 60000, "json": { "status": "done", "summary": "x" } }, { "write": { "sub.js": "module.exports = (a, b) => a - b;\\n" }, "json": { "status": "done", "summary": "added sub.js" } } ], "review": [ { "json": { "verdict": "approve", "summary": "ok", "findings": [] } } ], "executive": [ { "json": { "answers": [], "decisions": [], "workorders": [], "notes": "n" } } ] }' > "$QST_FIXTURE_SCRIPT"
rm -f "$QST_FIXTURE_SCRIPT.state"
"$here/bin/qst" sweep >/dev/null & sweep_pid=$!
until grep -q '"role":"implement"' "$QST_FIXTURE_LOG" 2>/dev/null && [ "$(grep -c '"role":"implement"' "$QST_FIXTURE_LOG")" -ge 3 ]; do sleep 0.2; done
agent_pid=$(grep '"role":"implement"' "$QST_FIXTURE_LOG" | tail -1 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).pid))')
kill -9 "$sweep_pid" "$agent_pid"; wait "$sweep_pid" 2>/dev/null || true
echo "killed coordinator $sweep_pid and agent $agent_pid"
qst sweep
echo "$wo2 status after restart: $(field "$wo2" status) (no blind resubmission)"
qst reconcile "$wo2" --retry
qst sweep
echo "$wo2 status after owner retry: $(field "$wo2" status)"

step "8. Digest (decisions first, then outcomes)"
qst digest

step "Done. Every agent above was a FIXTURE; records are in $QST_DESK"
