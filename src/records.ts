// Work orders, questions and decisions. Status fields are written only by the coordinator.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { p, newId, iso, readRec, writeRec, listRecs } from './desk.ts';
import type { Rec } from './desk.ts';

export const woFile = (id: string) => p('work', id, 'workorder.md');
const slugWords = 'amber apple bird blue breeze calm candle cedar cloud coral crisp dawn deer dream eagle ember fern field fire flame flower fog forest fox frost garden gold green harbor hazel hill honey lake leaf light maple meadow moon moss mountain north oak ocean olive orchid paper peach pine river robin rose silver sky snow soft stone sunny swift tide tree violet water wheat willow wind winter'.split(' ');
function newSlug(): string {
  const used = new Set(listWOs().map((w) => w.meta.slug));
  let slug: string;
  do { slug = `${slugWords[crypto.randomInt(slugWords.length)]}-${slugWords[crypto.randomInt(slugWords.length)]}`; }
  while (used.has(slug));
  return slug;
}
export const loadWO = (id: string) => {
  const direct = readRec(woFile(id));
  if (direct) return direct;
  const matches = listWOs().filter((w) => w.meta.slug === id);
  if (matches.length === 1) return matches[0];
  throw new Error(matches.length ? `ambiguous work order slug ${id}` : `no work order ${id}`);
};
export const saveRec = (r: Rec) => writeRec(r.file, r.meta, r.body);
export function listWOs(): Rec[] {
  const dir = p('work');
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort().map((id) => readRec(woFile(id))).filter((r): r is Rec => !!r) : [];
}

export function createWorkOrder(w: { project: string; outcome: string; acceptance: string[]; validate?: string[]; departures?: string[]; source: string; rank?: number }): string {
  const proj = readRec(p('portfolio', `${w.project}.md`));
  if (!proj) throw new Error(`unknown project "${w.project}"; record it first with: qst ingest project --slug ${w.project} ...`);
  if (!proj.meta.repo) throw new Error(`project "${w.project}" has no repo`);
  const validate = w.validate?.length ? w.validate : proj.meta.validate;
  if (!validate?.length) throw new Error(`no validation commands for "${w.project}"; pass --validate or set them on the project`);
  if (!w.acceptance.length) throw new Error('at least one --accept criterion is required');
  const id = newId('WO');
  const meta = {
    id, slug: newSlug(), project: w.project, repo: proj.meta.repo, outcome: w.outcome, acceptance: w.acceptance, validate,
    departures: w.departures ?? [], rank: w.rank ?? 100, source: w.source, created: iso(), status: 'proposed',
    corrections_used: 0, max_corrections: 1, attempts: [], questions: [], validations: [], reviews: [],
  };
  const body = `# ${id} (${meta.slug}): ${w.outcome}\n\nProject: ${w.project} (${proj.meta.repo})\n\n## Acceptance criteria\n${w.acceptance.map((a) => `- ${a}`).join('\n')}\n\n## Validation\n${validate.map((v: string) => `- \`${v}\``).join('\n')}\n`;
  writeRec(woFile(id), meta, body);
  return id;
}

export const qFile = (id: string) => p('questions', `${id}.md`);
export const listQuestions = () => listRecs(p('questions'));

export function createQuestion(wo: string, q: { text: string; evidence?: string; requested_decision: string; desk: string }, asker: string): string {
  const id = newId('Q');
  writeRec(qFile(id), { id, wo, desk: q.desk, status: 'open', asked_by: asker, created: iso(), requested_decision: q.requested_decision },
    `## Question\n${q.text}\n\n## Evidence\n${q.evidence ?? '(none given)'}\n`);
  return id;
}

export function answerQuestion(id: string, a: { answer: string; kind: string; by: string; refs?: string[] }): void {
  const r = readRec(qFile(id))!;
  writeRec(r.file, { ...r.meta, status: 'answered', answer_kind: a.kind, answered_by: a.by, answered: iso(), guidance_refs: a.refs ?? [] },
    r.body + `\n## Answer (${a.kind}, ${a.by})\n${a.answer}\n`);
}

export const questionText = (r: Rec) => r.body.split('## Evidence')[0].replace('## Question', '').trim();
export const answerText = (r: Rec) => r.body.split(/## Answer[^\n]*\n/).pop()!.trim();

// Decisions for the owner. Re-raising the same key updates the existing record instead of creating a new interruption.
export const dFile = (id: string) => p('decisions', `${id}.md`);
export const listDecisions = () => listRecs(p('decisions'));

export function raiseDecision(d: { key?: string; title: string; why: string; recommendation: string; tradeoff: string; blocks?: string[]; deadline?: string | null; priority: number; source: string }): string {
  const key = d.key ?? d.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const existing = listDecisions().find((r) => r.meta.status === 'open' && r.meta.key === key);
  if (existing) {
    writeRec(existing.file, { ...existing.meta, last_seen: iso(), times_raised: (existing.meta.times_raised ?? 1) + 1 }, existing.body);
    return existing.meta.id;
  }
  const id = newId('D');
  const meta = { id, key, status: 'open', priority: d.priority, deadline: d.deadline ?? null, blocks: d.blocks ?? [], source: d.source, raised: iso(), times_raised: 1 };
  const body = `# ${d.title}\n\n**Why it needs you:** ${d.why}\n\n**Recommendation:** ${d.recommendation}\n\n**Tradeoff:** ${d.tradeoff}\n\n**Blocks:** ${(d.blocks ?? []).join(', ') || 'nothing'}\n\n**Deadline:** ${d.deadline ?? 'none'}\n`;
  writeRec(dFile(id), meta, body);
  return id;
}

export function resolveDecision(id: string, text: string, signal: string): void {
  const r = readRec(dFile(id));
  if (!r || r.meta.status !== 'open') return;
  writeRec(r.file, { ...r.meta, status: 'resolved', resolved: iso(), resolution_signal: signal }, r.body + `\n## Resolution\n${text}\n`);
}

export const decisionHash = (r: Rec) => crypto.createHash('sha256').update(r.body + r.meta.priority + r.meta.deadline).digest('hex').slice(0, 12);
