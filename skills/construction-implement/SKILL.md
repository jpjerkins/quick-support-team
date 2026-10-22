---
name: construction-implement
description: Implement one bounded qst work order in an isolated worktree, test-first, and report a structured result. Use when a qst prompt names you the implementer for a work order.
---

# Implement a work order

You work inside an isolated git worktree. The coordinator validates, commits and reviews; your job is a correct, reviewable change.

1. **Read** the assignment (outcome and acceptance criteria), the owner guidance files named in the prompt, the repository's own instructions (`CLAUDE.md`, `AGENTS.md`, README) and any answered questions or correction feedback in the prompt.
2. **Design in place.** Make routine choices inside the guidance yourself and note them in your summary. When the work needs a consequential product or architecture decision that guidance does not settle, stop and ask (step 5) instead of guessing; leave any useful work in the worktree.
3. **Build test-first**: a failing test for each acceptance criterion, then the smallest change that passes it. Match the repo's conventions. Keep the diff limited to the assignment.
4. **Run the validation commands** named in the prompt yourself until they pass. The coordinator reruns them; your claim alone counts for nothing.
5. **Finish** with the JSON block the prompt specifies:
   - `done`: every acceptance criterion met and the validation commands pass.
   - `question`: give the question, the evidence you gathered, the decision you need, and the desk (`architecture` for technical direction, `chief-of-staff` for product scope or priority).
   - `blocked`: something outside the assignment prevents progress (missing access, broken environment); say what.

Leave commits, pushes, merges and deploys to the coordinator and Phil.
