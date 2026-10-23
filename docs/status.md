# Status

As of 2026-10-22. The first build is commit `ebebf24`. Keep this file current; it's the handoff for the next session.

## What works

- **Owner context:** recorded as attributed signals in five kinds (project, guidance, decision, observation, proposal). Only guidance and decisions marked `--by owner` reach `owner/`.
- **One bounded construction workflow:**
  1. approved work order
  2. isolated worktree
  3. implementer
  4. coordinator-run validation
  5. local commit
  6. separate reviewer session
  7. at most one correction
  8. outcome: ready-for-integration, blocked, failed or uncertain

  Nothing is pushed, merged or deployed.
- **Question routing:**
  - Architecture labels each answer as an interpretation, a request for evidence, or a proposal.
  - Proposals become decisions for Phil.
  - The Chief of Staff answers routine questions from recorded guidance, or sends them on.
- **Capacity:** per-provider protected windows, daily allowance (local midnight), per-run and per-sweep limits, expiring overrides, and an optional reserve that needs fresh provider observations. Autonomous runs are **disabled by default**.
- **Recovery:** a coordinator lock prevents overlap. A crashed run becomes `uncertain`, is never resubmitted blindly, and is settled with `qst reconcile`. If a crashed run's output is complete, it is adopted.
- **Attention:** `digest.md` lists decisions first, ranked. Decisions are de-duplicated by key, `--ack` stops repeat NEW flags, and `urgent.md` lists only decisions with a real deadline.

How to run and operate it: [operating.md](operating.md). Decisions behind the design: [decisions.md](decisions.md).

## Verification evidence

| Check | Result |
|---|---|
| `node --test test/*.test.ts` | **21/21 pass**. Covers the brief's ten required cases plus the correction limit, recovery from complete output, local-day allowances, and Chief of Staff work-order proposals |
| `scripts/walkthrough.sh` | **passes** on a throwaway repo (details below) |
| Static type check | **not run**: TypeScript isn't installed, and no dependency was added. Code runs through Node's type stripping and the tests |

The walkthrough steps:
1. A sample brief is recorded.
2. An approved work order is created.
3. A question goes to Architecture and is answered.
4. The coordinator runs the real `node test.js` and commits on the work branch; the original repo is untouched.
5. A separate review is recorded, along with the outcome.
6. With the allowance used up, the next assignment is held instead of started.
7. A `kill -9` of the coordinator and agent leaves the work `uncertain`; after `reconcile --retry` it finishes.

All agents in the tests and walkthrough are **fixtures**. They prove the workflow mechanics, not the quality of real agent judgement.

## Not yet verified live

| Item | Status |
|---|---|
| Real `claude -p` / `codex exec` runs | none performed; flags come from `--help` only |
| Authentication when run from cron | unknown |
| Claude `--permission-mode auto` without a terminal | unknown |
| Codex `workspace-write` sandbox inside a worktree whose `.git` points at the main repo | unknown |
| Whether Codex headless JSON reports usage in the shape `collect()` reads | unknown; if not, the ledger records no usage for that launch |
| `qst open` (interactive agent in current terminal) | not run against Phil's session |

## Blockers

- `/mnt/data` is owned by root, so the desk folder must be created once:
  `sudo mkdir -p /mnt/data/quick-support-team && sudo chown philj: /mnt/data/quick-support-team`

## Pending approvals (Phil)

- [ ] Create the desk folder (the `sudo` line above), then run `qst init`
- [ ] Run `./install.sh`. It links four skills into `~/.claude/skills` and `~/.agents/skills`; no name clashes were found
- [ ] Write the capacity policy in `owner/capacity.md`: enable autonomous runs, set allowances and protected windows
- [ ] Install the cron entry from [operating.md](operating.md#scheduling)
- [ ] Optional: the one-launch live smoke test below

## Live smoke test (one Codex launch)

Run this only after the install, the desk folder and `qst init`. First set `"max_launches_per_sweep": 1` in `owner/capacity.md`. The owner run skips the disabled autonomous switch, but the cap still limits it to one launch.

```bash
r=$(mktemp -d)/smoke && mkdir -p "$r" && cd "$r" && git init -q
printf 'module.exports = (a, b) => a + b;\n' > add.js
printf "const a = require('assert');\na.strictEqual(require('./add.js')(2, 3), 5);\nif (require('fs').existsSync('./mul.js')) a.strictEqual(require('./mul.js')(2, 3), 6);\n" > test.js
git add -A && git commit -qm init
qst ingest project --slug smoke --state planned --repo "$r" --validate "node test.js" --text "SMOKE TEST throwaway repo" --source "smoke test"
wo=$(qst workorder add --project smoke --outcome "Add mul(a, b) in mul.js" --accept "mul(2,3) returns 6" --source "smoke test")
qst ingest decision --approve "$wo" --text "approve smoke test" --source "smoke test"
qst sweep --owner          # exactly one implement launch (codex gpt-6-luna), then stops at the cap
qst status "$wo"           # expect status reviewing (validated and committed) or a clear rejection reason
```

A second `qst sweep --owner` runs the review, which is one Claude Opus launch. Afterwards, look in `work/$wo/attempts/*/` for the real prompt, output and usage.
