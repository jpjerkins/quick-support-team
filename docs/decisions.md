# Decisions and discovery findings

Recorded at build time (2026-10-21). Update this file when a decision changes; don't add a new one alongside it.

## Decisions made with Phil

| # | Decision | Why |
|---|---|---|
| 1 | **Sweeps start agents as headless child processes** (`claude -p`, `codex exec`) with timeouts. Interactive desk sessions (`qst open`) run in the current terminal | Cron runs outside Herdr. Headless runs work the same from cron or by hand, and give an exit code and output files to check. A scheduler loop inside a Herdr pane wouldn't survive a Herdr restart and isn't cron |
| 2 | **Review is a separate agent session, not necessarily a different harness** | Phil's clarification. Routing lives in `owner/routing.md` and can change |
| 3 | **Initial routing:** implement → Codex `gpt-6-luna`; review, architecture, executive → Claude `opus` | Phil: implementation mostly to Codex (Luna or Sonnet); review with Opus or Sol; design and higher-order work to Claude; UI design and prototypes Opus only; grilling interactive with Opus, Sol or Astra (on request). Fuller guidance from Phil is still to come |
| 4 | **No change to Phil's Claude status line** | Phil took the "no action" recommendation. Provider usage can still be recorded by hand with `qst capacity observe` |

## Decisions made during the build (reversible defaults)

| Decision | Why |
|---|---|
| Lives in `~/dev/quick-support-team`, a new standalone repo | The folder was empty. `simple-software-factory` and `graph-factory` are separate and untouched |
| TypeScript run directly by Node 22 (type stripping), standard library only, no build step | Smallest setup that meets the brief; no dependencies |
| Runs on the host, not in a container | Needs the host's `claude`/`codex` CLIs and logins, the git repos and Herdr. This departs on purpose from the "containers via dcm" guideline |
| Installed copy in `~/.local/share/quick-support-team`, not run from the source folder | Follows the "live separate from dev" guideline |
| Desk data in `/mnt/data/quick-support-team/desk` | Follows the "live data under /mnt/data" guideline. The folder needs a one-time `sudo` to create |
| Records are Markdown with JSON front matter | Easy to read by eye and by machine; no YAML parser needed |
| Work in progress limited to 1 active assignment; 1 correction attempt; 3 questions per work order | Brief asked for minimal, bounded work |
| Every work order needs Phil's explicit approval (`qst ingest decision --approve`) | Starting construction spends capacity, which only Phil authorizes |
| Unattended paid runs disabled until Phil edits `owner/capacity.md` | Required by the brief |
| An interrupted executive run is only marked uncertain; it isn't held for reconcile | Its output is proposals only, and decisions are de-duplicated, so a re-run does no harm |

## Discovery findings (2026-10-21)

- **Versions:** Node v22.23.3, Claude Code 2.1.307, codex-cli 0.163.0, herdr 0.9.3 (server running, compatible).
- **Codex models listed by `codex debug models`:** `gpt-6.1-sol`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`.
- **Claude permission modes:** `acceptEdits`, `auto`, `bypassPermissions`, `manual`, `dontAsk`, `plan`. Implementers use `auto`; read-only roles use `dontAsk` with a read-tool allowlist.
- **Codex sandbox modes:** `read-only`, `workspace-write`, `danger-full-access`. Implementers use `workspace-write`; reviewers use `read-only`.
- **Capacity telemetry:**
  - Claude's status line receives `rate_limits` (5-hour and 7-day used %, reset time), but only in interactive sessions.
  - Codex shows its 5-hour and weekly limits in its status bar.
  - Neither is available to a script, so the system enforces only observable limits.
- **Not inspected:** credentials and secret stores.

## Scope discipline

The `enough` skill (`~/.agents/skills/enough/SKILL.md`) was active for this build and stays the default for future changes. Agreed scope is the brief: one bounded construction workflow, two executive desks as skills, file records, a deterministic launcher, and a digest. Explicitly excluded: email, push or messaging notifications, a dashboard, a workflow engine or broker, and always-on agents. Reopen scope only for a concrete shortfall found while using it.
