// Chief of Staff: owner-signal application (deterministic) and the metered executive review.
import { p, iso, newId, deskDir, readRec, writeRec, readState, writeState, listRecs, log } from './desk.ts';
import { listSignals, markApplied } from './signals.ts';
import { listWOs, loadWO, saveRec, listQuestions, listDecisions, qFile, answerQuestion, resolveDecision, raiseDecision, createWorkOrder, questionText } from './records.ts';
import { route, runAgent, collect, parseResult } from './agents.ts';
import { checkLaunch, recordLaunch, loadPolicy } from './capacity.ts';
import { checkExecutive } from './schemas.ts';
import { skillPath } from './construction.ts';
import type { Ctx } from './construction.ts';
import { pidAlive } from './lock.ts';

// Owner decisions recorded in sessions take effect here, under the coordinator lock.
export function applyOwnerSignals(): void {
  for (const s of listSignals().filter((x) => x.meta.kind === 'decision' && !x.meta.applied)) {
    const text = s.body.trim();
    for (const id of s.meta.approve ?? []) {
      try {
        const wo = loadWO(id);
        if (wo.meta.status !== 'proposed') { log(`${s.meta.id}: ${id} is ${wo.meta.status}, not proposed; approval ignored`); continue; }
        Object.assign(wo.meta, { status: 'approved', approved_by: s.meta.id });
        saveRec(wo);
        const d = listDecisions().find((r) => r.meta.status === 'open' && r.meta.key === `approve-${id}`);
        if (d) resolveDecision(d.meta.id, text, s.meta.id);
        log(`${id} approved by owner (${s.meta.id})`);
      } catch (e: any) { log(`${s.meta.id}: ${e.message}`); }
    }
    if (s.meta.answers) {
      const q = readRec(qFile(s.meta.answers));
      if (q && q.meta.status !== 'answered') answerQuestion(q.meta.id, { answer: text, kind: 'owner-decision', by: 'owner' });
    }
    if (s.meta.resolves) resolveDecision(s.meta.resolves, text, s.meta.id);
    markApplied(s.file);
  }
}

export function executiveReasons(): string[] {
  const last = readState().last_exec_at ?? '';
  const reasons: string[] = [];
  const signals = listSignals().filter((s) => s.meta.created > last);
  if (signals.length) reasons.push(`${signals.length} new signal(s)`);
  const outcomes = listWOs().filter((w) => (w.meta.outcome_at ?? '') > last);
  if (outcomes.length) reasons.push(`${outcomes.length} new work outcome(s)`);
  const qs = listQuestions().filter((q) => q.meta.status === 'open' && q.meta.desk === 'chief-of-staff');
  if (qs.length) reasons.push(`${qs.length} question(s) routed to chief-of-staff`);
  const every = loadPolicy().executive?.review_every_hours;
  if (every && (!last || Date.now() - Date.parse(last) >= every * 3_600_000)) reasons.push(`scheduled review due (every ${every}h)`);
  return reasons;
}

function executivePrompt(reasons: string[]): string {
  const last = readState().last_exec_at ?? '';
  const sig = listSignals().filter((s) => s.meta.created > last).map((s) => `- ${s.file} (${s.meta.kind}, by ${s.meta.by})`);
  const qs = listQuestions().filter((q) => q.meta.status === 'open' && q.meta.desk === 'chief-of-staff').map((q) => `- ${q.meta.id} (${q.file}): ${questionText(q)}`);
  const ds = listDecisions().filter((d) => d.meta.status === 'open').map((d) => `- ${d.meta.id} key=${d.meta.key}: ${d.body.split('\n')[0]}`);
  const shape = { answers: [{ question: 'Q-...', answer: '...', guidance_refs: ['...'] }, { question: 'Q-...', route_to: 'architecture' }],
    decisions: [{ key: 'stable-key', title: '...', why: '...', recommendation: '...', tradeoff: '...', blocks: ['WO-...'], deadline: null, priority: 1 }],
    workorders: [{ project: 'slug', outcome: '...', acceptance: ['...'], validate: ['...'], why: '...', departures: [] }], notes: '...' };
  return [
    `You are the Chief of Staff running one unattended executive sweep; the owner is not present. Read and follow the "Unattended sweep" section of ${skillPath('chief-of-staff')}.`,
    `Desk: ${deskDir()} (owner/, portfolio/, work/*/workorder.md and outcome.md, questions/, decisions/, departures/, signals/).`,
    `You were started because: ${reasons.join('; ')}.`,
    sig.length ? `New signals:\n${sig.join('\n')}` : 'No new signals.',
    qs.length ? `Questions routed to you:\n${qs.join('\n')}` : 'No questions routed to you.',
    ds.length ? `Decisions already queued for the owner (reuse their key instead of duplicating):\n${ds.join('\n')}` : 'No open owner decisions.',
    'You cannot change owner guidance or approve work; propose instead.',
    'End your reply with ```json\n' + JSON.stringify(shape) + '\n```',
  ].join('\n\n');
}

export async function runExecutive(ctx: Ctx, reasons: string[]): Promise<void> {
  const r = route('executive');
  const v = checkLaunch(r.provider, { owner: ctx.owner, launchesThisSweep: ctx.launches });
  if (!v.ok) { log(`executive review not launched: ${v.reason}`); writeState({ ...readState(), exec_hold: v.reason }); return; }
  const started = iso();
  const id = newId('E');
  const file = p('runs', `${id}.md`);
  const run: Record<string, any> = { id, role: 'executive', status: 'dispatched', started, provider: r.provider, model: r.model, harness: r.harness, reasons, out_dir: p('runs', id) };
  writeRec(file, run);
  recordLaunch({ provider: r.provider, model: r.model, role: 'executive', ref: id });
  ctx.launches++;
  log(`launched executive review ${id} (${r.harness}/${r.model}): ${reasons.join('; ')}`);
  const res = await runAgent({
    route: r, prompt: executivePrompt(reasons), cwd: deskDir(), outDir: run.out_dir, access: 'read',
    timeoutMs: Math.min(v.timeoutMs, ctx.deadline - Date.now()),
    onSpawn: (pid) => { run.pid = pid; run.status = 'running'; writeRec(file, run); },
  });
  const { text, usage } = collect(r.harness, run.out_dir);
  const result = parseResult(text);
  const errors = checkExecutive(result);
  if (res.exitCode !== 0 || res.timedOut) errors.push(`agent exit ${res.exitCode}${res.timedOut ? ' (timed out)' : ''}`);
  Object.assign(run, { status: errors.length ? 'rejected' : 'applied', ended: iso(), exit: res.exitCode, usage, errors });
  writeRec(file, run);
  // Consumed either way; do not re-spend on the same inputs every sweep.
  const state = readState();
  delete state.exec_hold;
  writeState({ ...state, last_exec_at: started, last_exec_run: id });
  if (errors.length) { log(`executive result rejected: ${errors.join('; ')}`); return; }
  applyExecutive(result, id);
}

const createdValidate = (id: string) => loadWO(id).meta.validate.map((v: string) => `\`${v}\``).join(', ');

function applyExecutive(result: any, runId: string): void {
  const source = `chief-of-staff ${runId}`;
  for (const a of result.answers) {
    const q = readRec(qFile(a.question));
    if (!q || q.meta.status !== 'open' || q.meta.desk !== 'chief-of-staff') { log(`${runId}: ignored answer for ${a.question} (not an open chief-of-staff question)`); continue; }
    if (a.route_to === 'architecture') { writeRec(q.file, { ...q.meta, desk: 'architecture', rerouted_by: source }, q.body); log(`${q.meta.id} routed to architecture`); continue; }
    answerQuestion(q.meta.id, { answer: a.answer, kind: 'routine', by: source, refs: a.guidance_refs ?? [] });
  }
  for (const d of result.decisions) raiseDecision({ ...d, source });
  for (const w of result.workorders) {
    try {
      const id = createWorkOrder({ ...w, source });
      raiseDecision({
        key: `approve-${id}`, title: `Approve work order ${id}: ${w.outcome}`, priority: 2, blocks: [id], source,
        why: `Starting construction spends subscription capacity, which only you can authorize. Approving also lets these validation commands run on the host: ${createdValidate(id)}.`,
        recommendation: w.why ?? 'Approve', tradeoff: 'Uses roughly 2-4 metered launches (implement, review, maybe one correction).',
      });
    } catch (e: any) { log(`${runId}: work order proposal rejected: ${e.message}`); }
  }
  if (result.notes) writeRec(p('runs', `${runId}.notes.md`), { run: runId }, result.notes + '\n');
}

export function recoverExecutiveRuns(): void {
  for (const r of listRecs(p('runs')).filter((x) => ['dispatched', 'running'].includes(x.meta.status))) {
    if (r.meta.pid && pidAlive(r.meta.pid)) continue;
    writeRec(r.file, { ...r.meta, status: 'uncertain', noted: iso() }, r.body);
    log(`executive run ${r.meta.id} was interrupted; marked uncertain (its proposals were not applied)`);
  }
}
