// The owner's notification surface: decisions first, then outcomes, then detail.
import { p, now, iso, readState, writeState, writeAtomic } from './desk.ts';
import type { Rec } from './desk.ts';
import { listWOs, listQuestions, listDecisions, decisionHash, questionText } from './records.ts';
import { loadPolicy, launchesToday, latestObservation } from './capacity.ts';

const URGENT_HOURS = 48;
const withoutIds = (text: string) => text.replace(/\b(?:WO|D|S)-[A-Za-z0-9-]+\b/g, '').replace(/\b(work order)\s*:\s*/i, '$1 ').replace(/\s+/g, ' ').trim();

function openDecisions(): Rec[] {
  return listDecisions().filter((d) => d.meta.status === 'open')
    .sort((a, b) => a.meta.priority - b.meta.priority || String(a.meta.deadline ?? '9').localeCompare(String(b.meta.deadline ?? '9')) || a.meta.raised.localeCompare(b.meta.raised));
}

export const isNew = (d: Rec, acked: Record<string, string>) => acked[d.meta.id] !== decisionHash(d);

function description(w: Rec): string {
  const text = w.meta.summary ?? w.meta.outcome.split(/(?<=[.!?])\s/)[0];
  const clean = withoutIds(text);
  return clean.length > 80 ? `${clean.slice(0, 77).trimEnd()}...` : clean;
}

function workOrderRows(wos: Rec[]): string[] {
  const group = (status: string) => status === 'failed' ? 0 : ['blocked', 'uncertain'].includes(status) ? 1
    : status === 'proposed' ? 3 : 2;
  return [...wos].sort((a, b) => group(a.meta.status) - group(b.meta.status)
    || a.meta.created.localeCompare(b.meta.created)).map((w) =>
    `| ${w.meta.status} | ${withoutIds(w.meta.slug ?? '')} | ${withoutIds(w.meta.project)} | ${description(w)} |`);
}

function decisionRows(ds: Rec[], wos: Rec[]): string[] {
  return ds.map((d) => {
    const blocked = wos.find((w) => ['blocked', 'uncertain'].includes(w.meta.status) && d.meta.blocks?.includes(w.meta.id));
    const needed = withoutIds(d.body.split('\n')[0].replace(/^# /, ''));
    return `| P${d.meta.priority} | ${withoutIds(blocked?.meta.slug ?? '')} | ${needed} |`;
  });
}

export function renderDigest(): string {
  const acked = readState().acked ?? {};
  const ds = openDecisions();
  const wos = listWOs().filter((w) => w.meta.status !== 'integrated');
  const out: string[] = [`# Digest (${iso().slice(0, 16)}Z)`, ''];

  out.push(`## Decisions for you: ${ds.length} open, ${ds.filter((d) => isNew(d, acked)).length} new`, '',
    '| Priority | About | What\'s needed |', '|---|---|---|', ...decisionRows(ds, wos));

  out.push('', '## Work orders', '', '| Status | Slug | Project | What it does |', '|---|---|---|---|', ...workOrderRows(wos));

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
