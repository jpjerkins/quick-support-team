---
{
  "roles": {
    "implement":    { "provider": "codex",  "model": "gpt-6-luna" },
    "review":       { "provider": "claude", "model": "opus" },
    "architecture": { "provider": "claude", "model": "opus" },
    "executive":    { "provider": "claude", "model": "opus" }
  }
}
---
# Agent and model routing (owner-approved)

Stated by Phil on 2026-10-21 (initial preference; fuller guidance to come):
- Implementation mostly to Codex: gpt-6-luna, or Claude sonnet.
- Review in a separate session from implementation: Claude opus or Codex gpt-6.1-sol.
- Design and higher-order work to Claude.
- UI design, including prototypes coding agents can follow/copy: Claude opus only.
- Grilling/brainstorming with Phil (interactive only): Claude opus, Codex gpt-6.1-sol, or Codex gpt-6-astra on request.

`provider` is the subscription that is charged (claude = Claude Pro, codex = Codex Pro).
