# Quick Support Team

A minimal executive and construction assistant for Phil's family software projects.

- **Chief of Staff** and **Architecture desk** skills hold judgement.
- **`qst`** is a small deterministic launcher (TypeScript, Node 22 standard library, no dependencies). It handles locking, capacity limits, result validation and record keeping.
- **The desk** is plain Markdown with JSON front matter. It lives at `/mnt/data/quick-support-team/desk` by default, or wherever `QST_DESK` points.
- **One construction workflow:** approved work order → isolated worktree → implementer → coordinator runs the real tests → local commit → separate reviewer session → at most one correction → outcome.

- [docs/status.md](docs/status.md): current state, verification evidence, blockers, pending approvals, live smoke test. **Start here in a new session.**
- [docs/operating.md](docs/operating.md): how to supply context, the workflow, questions, capacity, pause and recovery, scheduling.
- [docs/decisions.md](docs/decisions.md): decisions made with Phil, build-time defaults, discovery findings, scope.

## Install

```bash
sudo mkdir -p /mnt/data/quick-support-team && sudo chown philj: /mnt/data/quick-support-team   # one time
./install.sh          # copies to ~/.local/share/quick-support-team, links qst and the skills
qst init              # creates the desk; autonomous metered execution starts DISABLED
```

## Use

| You want to... | Do |
|---|---|
| Give context or decisions | In a Herdr pane run `qst open chief-of-staff` (or start `claude` and say "use the chief-of-staff skill"), then talk |
| See decisions and outcomes | `qst digest` (then `qst digest --ack`) |
| See what a sweep would do | `qst sweep --dry-run` |
| Run one sweep yourself | `qst sweep --owner` (you are authorizing its metered launches) |
| Inspect a work order | `qst status WO-...` |
| Settle held work | `qst reconcile WO-... --retry` or `--fail "reason"` |

## Layout

| Path | What |
|---|---|
| `src/` | `qst`: `cli` (commands), `sweep` (one bounded run), `construction` (work-order steps), `executive` (owner signals, Chief of Staff review), `capacity`, `records`, `signals`, `digest`, `agents` (headless runner), `schemas` (result checks), `lock`, `desk` (record store) |
| `skills/` | `chief-of-staff`, `architecture-desk`, `construction-implement`, `construction-review` |
| `templates/desk/` | Initial owner files: disabled capacity policy, routing, empty guidance |
| `test/` | `node --test test/*.test.ts`, using fixture agents (no subscription use) |
| `scripts/walkthrough.sh` | Acceptance walkthrough on a throwaway repo (fixture agents) |
