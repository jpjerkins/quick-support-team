# Operating the Quick Support Team

## Supplying context through an agent

Talk to the Chief of Staff in an agent session. The usual way is `qst open chief-of-staff` from a Herdr pane. It splits a sibling pane, starts the agent routed for `executive` (Claude Opus by default), and points it at the skill. Outside Herdr, start `claude` and say "use the chief-of-staff skill".

As you talk, the agent records each statement as an attributed **signal** (`signals/`), in one of five kinds:

| Kind | Meaning | Effect |
|---|---|---|
| `project` | a project or update | creates/updates `portfolio/<slug>.md` |
| `guidance` | a priority, constraint, technical or architecture rule **you stated** | appended to `owner/<topic>.md` with the signal id |
| `decision` | a decision **you made** | logged in `owner/decisions.md`; `--approve`, `--answers`, `--resolves` take effect at the next sweep |
| `observation` | something noticed, not approved | recorded only (`--departure` also opens a departure record) |
| `proposal` | a recommendation, not approved | recorded only; the Chief of Staff may raise it as a decision for you |

Only `guidance` and `decision` can change `owner/`, and both require `--by owner`. An agent cannot record its own recommendation as your guidance. The skill tells it to ask you when it can't tell whether you stated something or it inferred it. That check is a prompt, not an enforcement.

For grilling or brainstorming, use whichever model you like interactively. `owner/routing.md` records your preferences.

## How a work order reaches a reviewed result

1. **Propose:** `qst workorder add` (you, or a Chief of Staff proposal); pass `--implementer claude:MODEL` or `codex:MODEL` to override the implement route. Work orders default to `--kind code`; code orders use acceptance criteria and validation commands from the project record unless given. Use `--kind research` for read-only, evidence-based work; it needs a project record but no repo or validation commands. The only kinds are `code` and `research`.
2. **Approve:** `qst ingest decision --approve WO-...`. Nothing is dispatched without this.
3. **Sweep** (coordinator; one active assignment at a time):
   - For `code`, creates worktree `desk/worktrees/WO-...` on branch `qst/WO-...` from the repo's HEAD. For `research`, creates `work/WO-.../scratch` instead; the implementer works read-only, then a separate reviewer checks the cited evidence.
   - **Implement** with the `implement` route (Codex `gpt-6-luna`). The agent must end with a JSON result. A missing or malformed result never counts as done.
   - **Validate:** the coordinator runs the validation commands itself and logs to `work/WO/validations/`. If they fail, or there is no change, a correction attempt is used.
   - **Commit** locally on the work branch after the checks pass. Nothing is pushed or merged.
   - **Review** with the `review` route (Claude Opus), a separate read-only session. Blocking findings use the one correction attempt.
   - **Outcome** is one of:
     - `ready-for-integration`: branch and commit ready for you to merge
     - `blocked`: needs a decision or reconcile
     - `failed`: checks still failing after correction
     - `uncertain`: interrupted
     - `complete`: research accepted against cited evidence
   - It is written to `work/WO/outcome.md` and appears in the digest. The Chief of Staff reviews new outcomes at its next executive run.

Each work order record keeps:
- base revision, branch and commit
- every attempt: provider, model, harness, pid, exit, usage reported by the CLI, prompt and output files
- guidance and skill file hashes, as snapshots
- validation results and logs
- review findings and anything unresolved
- the next action

## How questions reach each desk, and you

- The implementer returns `status: question` with the question, the evidence, the decision it needs, and a desk.
- The coordinator records `questions/Q-...` and the work waits.
- **Architecture** questions are answered during the same sweep. The desk labels each answer:
  - `interpretation`: cites your guidance. Work resumes, and the answer is included in the next implementer prompt.
  - `needs-evidence`: same flow; the implementer brings the evidence back.
  - `proposal`: recorded as a proposal plus a **decision for you**. The work keeps waiting and no more model capacity is spent on it.
- **Chief of Staff** questions are answered at the executive run from recorded guidance, sent on to Architecture, or raised as a decision.
- **You** answer with `qst ingest decision --answers Q-... --resolves D-... --text "..."`.
- Questions are files, so they survive session loss.

Decisions are listed in `digest.md` by priority. Each one shows the recommendation, tradeoff, what it blocks and the deadline. Raising the same issue again (same key) updates the existing record instead of adding a new one. `qst digest --ack` stops current decisions from showing as NEW until their content changes. `urgent.md` lists only decisions with a real deadline within 48 hours.

## Capacity policy, and what it cannot guarantee

Edit the JSON at the top of `owner/capacity.md`. Claude and Codex have separate sections.

| Field | Meaning |
|---|---|
| `autonomous_enabled` | master switch for unattended metered launches (default **false**) |
| `max_launches_per_sweep` | hard cap per sweep, owner runs included |
| `sweep_max_minutes` | sweep lifetime; agent timeouts are clipped to it |
| `on_window_start` | `finish`: running work completes. `stop`: run timeouts are clipped to the next protected window's start, then the agent is killed |
| `providers.<p>.launches_per_day` | autonomous allowance, counted per local day from `capacity/ledger.jsonl` |
| `providers.<p>.max_minutes_per_run` | per-launch timeout |
| `providers.<p>.protected_windows` | `[{label, days, start, end, autonomous}]`, local time |
| `providers.<p>.reserve` | `{min_remaining_pct, max_age_minutes}`: requires a fresh **provider** observation and blocks when it's missing, stale or below reserve |
| `providers.<p>.override` | `{until, extra_launches, reason}`: an explicit, limited, expiring extra allowance |
| `executive.review_every_hours` | optional scheduled Chief of Staff review; `null` means only on new input |

Every metered launch is checked first: implementation, review, architecture, executive, retries and corrections alike. Each launch is recorded in the ledger *before* the agent starts.

Before any model is started, a free check exits if there is no actionable work, new signal, new outcome or routed question, and no review is due.

`qst sweep --owner` is you authorizing one run. It skips the autonomous switch, protected windows and daily allowance, but still respects the per-sweep cap and the reserve rule.

**Limits, plainly:**
- No reliable remaining-capacity telemetry is available to a script. The ledger counts local launches, not provider usage.
- `qst capacity observe` records what you or an agent actually saw, for example the Claude status line's 5-hour %. Each observation keeps its source and time, and `kind: provider|estimate`. Estimates never satisfy a reserve.
- Killing an agent does not refund usage it already consumed, and one provider call can't be split.
- Nothing ever falls back to another provider or a paid API.
- Prompts are not security. The real safeguards are worktree isolation, local-only commits, Codex's sandbox, Claude's permission mode and your repos' own checks.

## Operate, pause, recover

| Action | Command |
|---|---|
| Pause everything unattended | set `"autonomous_enabled": false` (takes effect at the next launch check) |
| Pause one provider | set its `launches_per_day` to 0 |
| Remove the schedule | delete the cron line |
| See detail | `desk/logs/YYYY-MM-DD.log`, `work/WO/attempts/*/{prompt.txt,stdout,stderr}` |

**Overlap:** sweeps take `desk/coordinator.lock`, which is created exclusively and holds a pid. A second sweep exits at once. If the lock's owner is dead, the lock is moved to `logs/stale-lock-<pid>.json` and taken over.

**Crash or timeout recovery:**
- An attempt still marked dispatched/running from a dead coordinator is never resubmitted blindly.
- If its process is still alive, it is left alone.
- If its output contains a valid result, that result is adopted.
- Otherwise the work order becomes `uncertain`. You inspect the output and worktree, then run `qst reconcile WO --retry` or `--fail "reason"`.
- `--retry` on work that used up its correction grants exactly one more attempt.
- An interrupted executive run is marked uncertain, and its proposals are not applied.

## Scheduling

Cron runs outside Herdr, and Herdr's rules forbid controlling a session from outside, so **sweeps never use Herdr**. They start agents as headless child processes (`claude -p`, `codex exec`) with timeouts. That works the same from cron or by hand. Herdr is only for interactive desk sessions (`qst open`).

Proposed crontab entry. **Not installed;** it needs Phil's approval, and the desk folder must exist first:

```cron
*/30 * * * * PATH=/home/philj/.local/bin:/home/philj/.npm-global/bin:/usr/local/bin:/usr/bin:/bin timeout 50m qst sweep >> /mnt/data/quick-support-team/cron.log 2>&1
```

Nothing is launched until `owner/capacity.md` enables autonomous use and sets allowances.

## What was verified

See [status.md](status.md): verification evidence, what is still unverified live, blockers, pending approvals, and the live smoke test.
