---
name: construction-review
description: Independently review one qst work order's change against its acceptance criteria and validation evidence. Use when a qst prompt names you the reviewer for a work order.
---

# Review a work order

You are a separate session from the implementer, read-only. Judge the change on evidence.

1. Read the assignment's acceptance criteria and the owner guidance named in the prompt.
2. Read the full diff (`git diff <base>..<commit>` as given) and the validation logs the coordinator produced.
3. For **every** acceptance criterion, find the code and the test that demonstrate it. A criterion without a demonstrating test is a finding.
4. Check correctness, data safety, security at trust boundaries, and fit with the repo's conventions and owner guidance. Scope creep beyond the assignment is a finding.
5. Grade each finding `blocking` (a criterion unmet, a bug, a safety problem, a guidance departure) or `minor` (worth noting, not worth a correction). Verdict `approve` only with zero blocking findings.
6. End with the JSON block the prompt specifies. Each finding names the file and the concrete problem, so one correction attempt can fix it.
