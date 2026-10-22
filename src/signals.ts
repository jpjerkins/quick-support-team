// Signals: attributed records of what the owner (or an agent) supplied in a session.
// Only owner guidance/decisions reach owner/*; observations and proposals never do.
import fs from 'node:fs';
import { p, newId, iso, readRec, writeRec, listRecs, writeAtomic } from './desk.ts';

export const KINDS = ['project', 'guidance', 'decision', 'observation', 'proposal'];
export const GUIDANCE_TOPICS = ['priorities', 'constraints', 'technical', 'architecture'];

export type SignalInput = {
  text: string; source: string; by?: string;
  topic?: string;                                  // guidance
  slug?: string; name?: string; state?: string; repo?: string; purpose?: string; validate?: string[]; // project
  approve?: string[]; answers?: string; resolves?: string;  // decision
  departure?: string; project?: string;            // observation
};

function appendLine(file: string, line: string): void {
  const rec = readRec(file);
  writeRec(file, rec?.meta ?? {}, (rec?.body ?? '').replace(/\n*$/, '\n') + line + '\n');
}

export function ingest(kind: string, s: SignalInput): string {
  if (!KINDS.includes(kind)) throw new Error(`kind must be one of ${KINDS.join(', ')}`);
  if (!s.text || !s.source) throw new Error('--text and --source are required');
  const by = s.by ?? 'owner';
  if ((kind === 'guidance' || kind === 'decision') && by !== 'owner') throw new Error(`${kind} signals record the owner's own words; --by must be owner`);
  if (kind === 'guidance' && !GUIDANCE_TOPICS.includes(s.topic ?? '')) throw new Error(`--topic must be one of ${GUIDANCE_TOPICS.join(', ')}`);
  if (kind === 'project' && !s.slug) throw new Error('--slug is required for project signals');
  if (kind === 'decision' && s.answers && !s.answers.startsWith('Q-')) throw new Error('--answers takes a question id');

  const id = newId('S');
  const date = iso().slice(0, 10);
  const meta: Record<string, unknown> = { id, kind, by, source: s.source, created: iso() };
  for (const k of ['topic', 'slug', 'approve', 'answers', 'resolves', 'departure', 'project'] as const) if (s[k]?.length) meta[k] = s[k];
  writeRec(p('signals', `${id}.md`), meta, s.text + '\n');

  const ref = `_(${id}, ${s.source})_`;
  if (kind === 'guidance') appendLine(p('owner', `${s.topic}.md`), `- ${date}: ${s.text} ${ref}`);
  if (kind === 'decision') appendLine(p('owner', 'decisions.md'), `- ${date}: ${s.text} ${ref}`);
  if (kind === 'project') upsertProject(s, `- ${date}: ${s.text} ${ref}`);
  if (kind === 'observation' && s.departure) {
    writeRec(p('departures', `${newId('DEP')}.md`), { title: s.departure, project: s.project ?? null, signal: id, created: iso(), status: 'open' }, s.text + '\n');
  }
  return id;
}

function upsertProject(s: SignalInput, note: string): void {
  const file = p('portfolio', `${s.slug}.md`);
  const rec = readRec(file);
  const meta = { slug: s.slug, ...(rec?.meta ?? {}) };
  for (const k of ['name', 'state', 'repo', 'purpose', 'validate'] as const) if (s[k]?.length) meta[k] = s[k];
  writeRec(file, meta, (rec?.body ?? '').replace(/\n*$/, '\n') + note + '\n');
}

export const listSignals = () => listRecs(p('signals'));
export const listProjects = () => listRecs(p('portfolio'));
export const listDepartures = () => listRecs(p('departures'));

export function markApplied(file: string): void {
  const rec = readRec(file)!;
  writeRec(file, { ...rec.meta, applied: iso() }, rec.body);
}

export function ensureDesk(templateDir: string): void {
  for (const f of fs.readdirSync(templateDir, { recursive: true }) as string[]) {
    const src = `${templateDir}/${f}`, dst = p(f);
    if (fs.statSync(src).isFile() && !fs.existsSync(dst)) writeAtomic(dst, fs.readFileSync(src, 'utf8'));
  }
}
