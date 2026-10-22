---
{
  "autonomous_enabled": false,
  "max_launches_per_sweep": 4,
  "sweep_max_minutes": 45,
  "on_window_start": "finish",
  "executive": { "review_every_hours": null },
  "providers": {
    "claude": {
      "launches_per_day": 0,
      "max_minutes_per_run": 20,
      "protected_windows": [],
      "reserve": null,
      "override": null
    },
    "codex": {
      "launches_per_day": 0,
      "max_minutes_per_run": 20,
      "protected_windows": [],
      "reserve": null,
      "override": null
    }
  }
}
---
# Capacity policy (owner-approved)

Autonomous metered execution is **disabled** until Phil edits the JSON above.
Field reference: see docs/operating.md in the quick-support-team repo.

Example protected window (local time; end before start runs past midnight):
`{ "label": "evenings", "days": ["Mon","Tue","Wed","Thu","Fri"], "start": "18:00", "end": "22:30", "autonomous": false }`
