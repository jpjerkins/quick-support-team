// Capacity policy: decides whether one more metered launch is allowed right now.
// Only observable limits are enforced; nothing here knows real subscription balance.
import { p, readRec, readJsonl, appendJsonl, now, iso } from './desk.ts';

type Window = { days?: string[]; start: string; end: string; autonomous: boolean; label?: string };
type ProviderPolicy = {
  launches_per_day: number; max_minutes_per_run: number; protected_windows?: Window[];
  reserve?: { min_remaining_pct: number; max_age_minutes: number } | null;
  override?: { until: string; extra_launches: number; reason: string } | null;
};
export type Policy = {
  autonomous_enabled: boolean; max_launches_per_sweep: number; sweep_max_minutes: number;
  on_window_start: 'finish' | 'stop'; executive?: { review_every_hours?: number | null };
  providers: Record<string, ProviderPolicy>;
};

const DISABLED: Policy = { autonomous_enabled: false, max_launches_per_sweep: 0, sweep_max_minutes: 10, on_window_start: 'finish', providers: {} };

export function loadPolicy(): Policy {
  return { ...DISABLED, ...(readRec(p('owner', 'capacity.md'))?.meta ?? {}) };
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const minutes = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

// Local time; a window whose end is before its start runs past midnight.
export function activeWindow(windows: Window[], at = now()): Window | null {
  const t = at.getHours() * 60 + at.getMinutes();
  const today = DAYS[at.getDay()], yesterday = DAYS[(at.getDay() + 6) % 7];
  for (const w of windows) {
    const s = minutes(w.start), e = minutes(w.end);
    const on = (d: string) => !w.days || w.days.includes(d);
    if (s <= e ? on(today) && t >= s && t < e : (on(today) && t >= s) || (on(yesterday) && t < e)) return w;
  }
  return null;
}

// Minutes until the next non-autonomous window starts (scans the next 24h by minute).
function minutesToNextProtected(windows: Window[]): number | null {
  const blocking = windows.filter((w) => !w.autonomous);
  for (let m = 1; m <= 24 * 60; m++) {
    if (activeWindow(blocking, new Date(now().getTime() + m * 60_000))) return m;
  }
  return null;
}

// Allowances reset at local midnight, matching protected windows.
const localDay = (d: Date) => d.toDateString();

export function launchesToday(provider: string): number {
  const day = localDay(now());
  return readJsonl(p('capacity', 'ledger.jsonl')).filter((l) => l.provider === provider && localDay(new Date(l.at)) === day).length;
}

export function latestObservation(provider: string): any | null {
  const obs = readJsonl(p('capacity', 'observations.jsonl')).filter((o) => o.provider === provider && o.kind === 'provider');
  return obs.length ? obs[obs.length - 1] : null;
}

export type Verdict = { ok: boolean; reason: string; timeoutMs: number };

export function checkLaunch(provider: string, opts: { owner: boolean; launchesThisSweep: number }): Verdict {
  const policy = loadPolicy();
  const pp = policy.providers[provider];
  const no = (reason: string): Verdict => ({ ok: false, reason, timeoutMs: 0 });
  if (!pp) return no(`no capacity policy for provider "${provider}"`);
  if (opts.launchesThisSweep >= policy.max_launches_per_sweep) return no(`per-sweep launch limit (${policy.max_launches_per_sweep}) reached`);
  if (!opts.owner) {
    if (!policy.autonomous_enabled) return no('autonomous metered execution is disabled in owner/capacity.md');
    const w = activeWindow(pp.protected_windows ?? []);
    if (w && !w.autonomous) return no(`protected window ${w.label ?? `${w.start}-${w.end}`} is active`);
    const ov = pp.override && new Date(pp.override.until) > now() ? pp.override : null;
    const allowed = (pp.launches_per_day ?? 0) + (ov?.extra_launches ?? 0);
    const used = launchesToday(provider);
    if (used >= allowed) return no(`${provider} autonomous allowance exhausted (${used}/${allowed} launches today, local count)`);
  }
  if (pp.reserve) {
    const o = latestObservation(provider);
    if (!o) return no(`${provider} reserve is configured but no provider observation exists; capacity unknown`);
    const ageMin = (now().getTime() - new Date(o.observed_at).getTime()) / 60_000;
    if (ageMin > pp.reserve.max_age_minutes) return no(`${provider} capacity observation is stale (${Math.round(ageMin)} min old); capacity unknown`);
    if (typeof o.used_pct !== 'number') return no(`${provider} observation has no used_pct; capacity unknown`);
    if (100 - o.used_pct < pp.reserve.min_remaining_pct) return no(`${provider} observed usage ${o.used_pct}% leaves less than the ${pp.reserve.min_remaining_pct}% reserve`);
  }
  let timeoutMin = pp.max_minutes_per_run;
  if (policy.on_window_start === 'stop' && !opts.owner) {
    const next = minutesToNextProtected(pp.protected_windows ?? []);
    if (next !== null) timeoutMin = Math.min(timeoutMin, next);
  }
  return { ok: true, reason: 'within policy', timeoutMs: timeoutMin * 60_000 };
}

export function recordLaunch(entry: Record<string, unknown>): void {
  appendJsonl(p('capacity', 'ledger.jsonl'), { at: iso(), ...entry });
}

export function recordObservation(o: { provider: string; kind: string; source: string; used_pct?: number; resets_at?: string; note?: string; observed_at?: string }): void {
  if (!['provider', 'estimate'].includes(o.kind)) throw new Error('kind must be provider or estimate');
  const given = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  appendJsonl(p('capacity', 'observations.jsonl'), { observed_at: iso(), recorded_at: iso(), ...given });
}
