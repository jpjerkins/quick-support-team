// The owner's notification surface: decisions first, then outcomes, then detail.
import { p, now, iso, readState, writeState, writeAtomic } from './desk.ts';
import type { Rec } from './desk.ts';
import { listWOs, listQuestions, listDecisions, decisionHash, questionText } from './records.ts';
import { loadPolicy, launchesToday, latestObservation } from './capacity.ts';
import { ACTIVE } from './construction.ts';

const URGENT_HOURS = 48;

function openDecisions(): Rec[] {
  return listDecisions().filter((d) => d.meta.status === 'open')
    .sort((a, b) => a.meta.priority - b.meta.priority || String(a.meta.deadline ?? '9').localeCompare(String(b.meta.deadline ?? '9')) || a.meta.raised.localeCompare(b.meta.raised));
}

export const isNew = (d: Rec, acked: Record<string, string>) => acked[d.meta.id] !== decisionHash(d);

export function renderDigest(): string {
  const acked = readState().acked ?? {};
  const ds = openDecisions();
  const wos = listWOs().filter((w) => w.meta.status !== 'integrated');
  const out: string[] = [`# Digest (${iso().slice(0, 16)}Z)`, ''];

  out.push(`## Decisions for you: ${ds.length} open, ${ds.filter((d) => isNew(d, acked)).length} new`, '');
  ds.forEach((d, i) => {
    const title = d.body.split('\n')[0].replace(/^# /, '');
    const rec = (d.body.match(/\*\*Recommendation:\*\* (.*)/) ?? [])[1] ?? '';
    out.push(`${i + 1}. [P${d.meta.priority}]${isNew(d, acked) ? ' NEW' : ''} ${title} (${d.meta.id}; deadline ${d.meta.deadline ?? 'none'}; blocks ${d.meta.blocks.join(', ') || 'nothing'})`, `   Recommendation: ${rec}`);
  });

  const done = wos.filter((w) => w.meta.outcome_at).sort((a, b) => b.meta.outcome_at.localeCompare(a.meta.outcome_at));
  out.push('', '## Outcomes', '', ...(done.length ? done.slice(0, 10).map((w) => `- ${w.meta.id}${w.meta.slug ? ` (${w.meta.slug})` : ''} **${w.meta.status}**: ${w.meta.outcome_summary}\n  Next: ${w.meta.next_action}`) : ['- none yet']));

  const active = wos.filter((w) => ACTIVE.includes(w.meta.status) || w.meta.status === 'approved');
  out.push('', '## Active work', '', ...(active.length ? active.map((w) => `- ${w.meta.id}${w.meta.slug ? ` (${w.meta.slug})` : ''} ${w.meta.status}: ${w.meta.outcome}${w.meta.next_action ? ` (next: ${w.meta.next_action})` : ''}${w.meta.capacity_hold ? ` [${w.meta.capacity_hold}]` : ''}`) : ['- none']));

  const proposed = wos.filter((w) => w.meta.status === 'proposed');
  if (proposed.length) out.push('', '## Proposed (awaiting approval)', '', ...proposed.map((w) => `- ${w.meta.id}${w.meta.slug ? ` (${w.meta.slug})` : ''}: ${w.meta.outcome} (${w.meta.project})`));

  const qs = listQuestions().filter((q) => q.meta.status !== 'answered');
  if (qs.length) out.push('', '## Questions in flight', '', ...qs.map((q) => `- ${q.meta.id} (${q.meta.wo}) ${q.meta.status} at ${q.meta.desk}: ${questionText(q).slice(0, 160)}`));

  const policy = loadPolicy();
  out.push('', '## Capacity', '', `Autonomous metered execution: ${policy.autonomous_enabled ? 'enabled' : 'DISABLED'}.`);
  if (readState().exec_hold) out.push(`Executive review held: ${readState().exec_hold}`);
  for (const [prov, pp] of Object.entries(policy.providers)) {
    const o = latestObservation(prov);
    const obs = o ? `provider observation ${o.used_pct ?? '?'}% used (source: ${o.source}, observed ${o.observed_at})` : 'no provider telemetry recorded; only local launch counts are known';
    out.push(`- ${prov}: ${launchesToday(prov)}/${pp.launches_per_day} autonomous launches today (local count). ${obs}.`);
  }
  out.push('', `Detailed logs: ${p('logs')}`, '');
  return out.join('\n');
}

export function writeDigest(): void {
  writeAtomic(p('digest.md'), renderDigest());
  const soon = openDecisions().filter((d) => d.meta.deadline && Date.parse(d.meta.deadline) - now().getTime() < URGENT_HOURS * 3_600_000);
  writeAtomic(p('urgent.md'), soon.length
    ? `# Urgent decisions (real deadline within ${URGENT_HOURS}h)\n\n${soon.map((d) => `- ${d.meta.id}: ${d.body.split('\n')[0].replace(/^# /, '')} (deadline ${d.meta.deadline})`).join('\n')}\n`
    : '# Urgent decisions\n\nNone.\n');
}

// Marks the open decisions as seen; an unchanged decision is not shown as NEW again.
export function ackDigest(): number {
  const state = readState();
  const acked = state.acked ?? {};
  const ds = openDecisions();
  for (const d of ds) acked[d.meta.id] = decisionHash(d);
  writeState({ ...state, acked });
  return ds.length;
}
