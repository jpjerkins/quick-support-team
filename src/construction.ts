// Construction workflow: advances one approved work order by one step per call.
// Agents only propose; every status change below is the coordinator's decision.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { p, iso, newId, sha256File, installDir, readRec, writeAtomic, log } from './desk.ts';
import type { Rec } from './desk.ts';
import { saveRec, woFile, qFile, createQuestion, answerQuestion, questionText, answerText, raiseDecision } from './records.ts';
import { route, runAgent, collect, parseResult } from './agents.ts';
import type { Access } from './agents.ts';
import { checkLaunch, recordLaunch } from './capacity.ts';
import { checkImplement, checkResearchImplement, checkReview, checkResearchReview, checkArchitecture } from './schemas.ts';
import { pidAlive } from './lock.ts';
import { ingest } from './signals.ts';

export type Ctx = { owner: boolean; launches: number; deadline: number };
export type Step = 'progress' | 'wait';

export const ACTIVE = ['ready', 'correcting', 'validating', 'reviewing', 'waiting-answer'];
const MAX_QUESTIONS = 3;
const CHECKS: Record<string, (r: any) => string[]> = { implement: checkImplement, review: checkReview, architecture: checkArchitecture };
const kindOf = (wo: Rec) => wo.meta.kind ?? 'code';

function resultErrors(wo: Rec, role: 'implement' | 'review', result: any, base: string[] = []): string[] {
  const research = kindOf(wo) === 'research';
  const specific = role === 'implement'
    ? research ? checkResearchImplement(result, wo.meta.acceptance) : checkImplement(result)
    : research ? checkResearchReview(result, wo.meta.acceptance) : checkReview(result);
  return [...base, ...specific.filter((error) => !base.includes(error))];
}

export const skillPath = (name: string) => path.join(installDir(), 'skills', name, 'SKILL.md');
export const guidanceFiles = () => ['priorities', 'constraints', 'technical', 'architecture'].map((t) => p('owner', `${t}.md`));

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function snapshots(skill: string): Record<string, string | null> {
  const s: Record<string, string | null> = {};
  for (const f of guidanceFiles()) s[`owner/${path.basename(f)}`] = sha256File(f);
  s[`skills/${skill}`] = sha256File(skillPath(skill));
  return s;
}

function preserveAssignment(wo: Rec, attemptId: string, skill: string): void {
  const dir = p('work', wo.meta.id, 'assignment-bundles', 'inputs', attemptId);
  const files = [
    [woFile(wo.meta.id), path.join(dir, 'workorder.md')],
    ...guidanceFiles().map((file) => [file, path.join(dir, 'owner', path.basename(file))]),
    [skillPath(skill), path.join(dir, 'skills', `${skill}.md`)],
  ];
  for (const [source, target] of files as [string, string][]) {
    if (fs.existsSync(source) && !fs.existsSync(target)) writeAtomic(target, fs.readFileSync(source, 'utf8'));
  }
}

// Records dispatch intent before the agent starts, then the returned identity and exit.
async function launch(wo: Rec, role: string, skill: string, prompt: string, access: Access, ctx: Ctx): Promise<boolean> {
  const r = route(role);
  const v = checkLaunch(r.provider, { owner: ctx.owner, launchesThisSweep: ctx.launches });
  const timeoutMs = Math.min(v.timeoutMs, ctx.deadline - Date.now());
  if (!v.ok || timeoutMs < 30_000) {
    wo.meta.capacity_hold = `${role} not launched: ${v.ok ? 'sweep time limit nearly reached' : v.reason}`;
    saveRec(wo);
    log(`${wo.meta.id} ${wo.meta.capacity_hold}`);
    return false;
  }
  delete wo.meta.capacity_hold;
  const id = newId('A');
  const attempt: Record<string, any> = {
    id, role, status: 'dispatched', started: iso(), provider: r.provider, model: r.model, harness: r.harness,
    out_dir: p('work', wo.meta.id, 'attempts', id), snapshots: snapshots(skill),
  };
  preserveAssignment(wo, id, skill);
  wo.meta.attempts.push(attempt);
  saveRec(wo);
  recordLaunch({ provider: r.provider, model: r.model, role, ref: `${wo.meta.id}/${id}` });
  ctx.launches++;
  log(`${wo.meta.id} launched ${role} ${id} (${r.harness}/${r.model})`);
  const res = await runAgent({
    route: r, prompt, cwd: wo.meta.scratch ?? wo.meta.worktree, outDir: attempt.out_dir, access, timeoutMs,
    onSpawn: (pid) => { attempt.pid = pid; attempt.status = 'running'; saveRec(wo); },
  });
  Object.assign(attempt, { status: 'returned', ended: iso(), exit: res.exitCode, timed_out: res.timedOut, usage: collect(r.harness, attempt.out_dir).usage });
  saveRec(wo);
  return true;
}

const pending = (wo: Rec, role: string) => wo.meta.attempts.findLast((a: any) => a.role === role && a.status === 'returned' && !a.processed);

function take(a: any): { result: any; errors: string[] } {
  const result = parseResult(collect(a.harness, a.out_dir).text);
  const errors = CHECKS[a.role](result);
  if (a.timed_out) errors.push('agent timed out');
  if (a.exit != null && a.exit !== 0) errors.push(`agent exited ${a.exit}`);
  a.processed = iso();
  a.result_ok = errors.length === 0;
  return { result, errors };
}

async function attemptFor(wo: Rec, role: string, skill: string, prompt: () => string, access: Access, ctx: Ctx) {
  if (!pending(wo, role) && !(await launch(wo, role, skill, prompt(), access, ctx))) return null;
  return pending(wo, role);
}

function hold(wo: Rec, status: string, summary: string, next: string): Step {
  if (status !== 'failed') wo.meta.held_from = wo.meta.status;
  Object.assign(wo.meta, { status, outcome_summary: summary, next_action: next, outcome_at: iso() });
  saveRec(wo);
  writeOutcome(wo);
  log(`${wo.meta.id} -> ${status}: ${summary}`);
  return 'wait';
}

function correctOrEnd(wo: Rec, feedback: string, endStatus: string): Step {
  if (wo.meta.corrections_used < wo.meta.max_corrections) {
    Object.assign(wo.meta, { corrections_used: wo.meta.corrections_used + 1, feedback, status: 'correcting' });
    saveRec(wo);
    log(`${wo.meta.id} -> correcting (${wo.meta.corrections_used}/${wo.meta.max_corrections})`);
    return 'progress';
  }
  wo.meta.unresolved = feedback;
  return hold(wo, endStatus, `correction budget used; unresolved: ${feedback}`, 'chief-of-staff/owner: decide whether to rescope, retry with a higher limit, or drop');
}

export async function advance(wo: Rec, ctx: Ctx): Promise<Step> {
  switch (wo.meta.status) {
    case 'approved': return prepare(wo);
    case 'ready': case 'correcting': return implement(wo, ctx);
    case 'validating': return validate(wo);
    case 'reviewing': return review(wo, ctx);
    case 'waiting-answer': return awaitAnswer(wo, ctx);
    default: return 'wait';
  }
}

function prepare(wo: Rec): Step {
  if (kindOf(wo) === 'research') {
    const scratch = p('work', wo.meta.id, 'scratch');
    fs.mkdirSync(scratch, { recursive: true });
    Object.assign(wo.meta, { scratch, status: 'ready' });
    saveRec(wo);
    return 'progress';
  }
  const wt = p('worktrees', wo.meta.id);
  const branch = `qst/${wo.meta.id}`;
  if (!fs.existsSync(wt)) git(wo.meta.repo, 'worktree', 'add', '-q', '-b', branch, wt, 'HEAD');
  Object.assign(wo.meta, { base: git(wt, 'rev-parse', 'HEAD'), branch, worktree: wt, status: 'ready' });
  saveRec(wo);
  log(`${wo.meta.id} worktree ${wt} on ${branch} at ${wo.meta.base.slice(0, 8)}`);
  return 'progress';
}

async function implement(wo: Rec, ctx: Ctx): Promise<Step> {
  const research = kindOf(wo) === 'research';
  const a = await attemptFor(wo, 'implement', 'construction-implement', () => implementPrompt(wo), research ? 'read' : 'write', ctx);
  if (!a) return 'wait';
  const { result, errors: base } = take(a);
  const errors = resultErrors(wo, 'implement', result, base);
  a.result_ok = errors.length === 0;
  if (errors.length) return hold(wo, 'blocked', `implementer result rejected: ${errors.join('; ')}`, `inspect ${a.out_dir}, then qst reconcile ${wo.meta.id} --retry or --fail`);
  a.summary = result.summary;
  if (research) a.evidence = result.evidence;
  if (result.status === 'blocked') return hold(wo, 'blocked', `implementer blocked: ${result.summary}`, 'chief-of-staff: review the blocker');
  if (result.status === 'question') {
    if (wo.meta.questions.length >= MAX_QUESTIONS) return hold(wo, 'blocked', `question limit (${MAX_QUESTIONS}) reached: ${result.question.text}`, 'chief-of-staff/owner: clarify the assignment');
    const qid = createQuestion(wo.meta.id, result.question, a.id);
    wo.meta.questions.push(qid);
    Object.assign(wo.meta, { resume_status: wo.meta.status, status: 'waiting-answer', next_action: `${result.question.desk} desk answers ${qid}` });
    saveRec(wo);
    log(`${wo.meta.id} asked ${qid} -> ${result.question.desk}`);
    return 'progress';
  }
  wo.meta.status = research ? 'reviewing' : 'validating';
  saveRec(wo);
  return 'progress';
}

// Deterministic checks run by the coordinator, never taken from the agent's word.
function validate(wo: Rec): Step {
  const wt = wo.meta.worktree;
  const vid = `V${wo.meta.validations.length + 1}`;
  const dir = p('work', wo.meta.id, 'validations', vid);
  const results = wo.meta.validate.map((cmd: string, i: number) => {
    const r = spawnSync('bash', ['-c', cmd], { cwd: wt, encoding: 'utf8', timeout: 10 * 60_000 });
    const logFile = path.join(dir, `${i + 1}.log`);
    writeAtomic(logFile, `$ ${cmd}\n${r.stdout ?? ''}${r.stderr ?? ''}\n[exit ${r.status}]\n`);
    return { cmd, exit: r.status, log: logFile };
  });
  const dirty = git(wt, 'status', '--porcelain') !== '';
  const committed = git(wt, 'rev-list', '--count', `${wo.meta.base}..HEAD`) !== '0';
  const failed = results.filter((r: any) => r.exit !== 0);
  const noChange = !dirty && !committed;
  wo.meta.validations.push({ id: vid, at: iso(), results, passed: !failed.length && !noChange, no_change: noChange });
  if (failed.length || noChange) {
    const why = noChange ? 'no code change was produced' : failed.map((r: any) => `\`${r.cmd}\` exited ${r.exit} (log ${r.log})`).join('; ');
    return correctOrEnd(wo, `validation failed: ${why}`, 'failed');
  }
  if (dirty) {
    git(wt, 'add', '-A');
    git(wt, 'commit', '-q', '-m', `${wo.meta.id}: ${wo.meta.outcome}\n\nValidated by qst (${vid}): ${wo.meta.validate.join('; ')}`);
  }
  Object.assign(wo.meta, { commit: git(wt, 'rev-parse', 'HEAD'), status: 'reviewing' });
  saveRec(wo);
  log(`${wo.meta.id} validation ${vid} passed; commit ${wo.meta.commit.slice(0, 8)}`);
  return 'progress';
}

async function review(wo: Rec, ctx: Ctx): Promise<Step> {
  const a = await attemptFor(wo, 'review', 'construction-review', () => reviewPrompt(wo), 'read', ctx);
  if (!a) return 'wait';
  const { result, errors: base } = take(a);
  const errors = resultErrors(wo, 'review', result, base);
  a.result_ok = errors.length === 0;
  if (errors.length) return hold(wo, 'blocked', `review result rejected: ${errors.join('; ')}`, `inspect ${a.out_dir}, then qst reconcile ${wo.meta.id} --retry or --fail`);
  wo.meta.reviews.push({ attempt: a.id, commit: wo.meta.commit, verdict: result.verdict, summary: result.summary, findings: result.findings, ...(kindOf(wo) === 'research' ? { assessments: result.assessments } : {}) });
  const text = result.findings.map((f: any) => `[${f.severity}] ${f.text}`).join('; ');
  if (result.verdict === 'approve') {
    wo.meta.unresolved = result.findings.length ? text : null;
    if (kindOf(wo) === 'research') return hold(wo, 'complete', `research complete: ${result.summary}`, 'owner: inspect the cited evidence in the research result');
    return hold(wo, 'ready-for-integration', `ready: ${result.summary}`, `owner: inspect branch ${wo.meta.branch} (${wo.meta.commit.slice(0, 8)}) and merge if satisfied`);
  }
  return correctOrEnd(wo, `review findings: ${text}`, 'blocked');
}

async function awaitAnswer(wo: Rec, ctx: Ctx): Promise<Step> {
  const q = readRec(qFile(wo.meta.questions.at(-1)))!;
  if (q.meta.status === 'answered') {
    Object.assign(wo.meta, { status: wo.meta.resume_status, next_action: null });
    delete wo.meta.resume_status;
    saveRec(wo);
    return 'progress';
  }
  if (q.meta.status !== 'open' || q.meta.desk !== 'architecture') return 'wait';
  const a = await attemptFor(wo, 'architecture', 'architecture-desk', () => architecturePrompt(wo, q), 'read', ctx);
  if (!a) return 'wait';
  const { result, errors } = take(a);
  if (errors.length) return hold(wo, 'blocked', `architecture answer rejected: ${errors.join('; ')}`, `inspect ${a.out_dir}, then qst reconcile ${wo.meta.id} --retry`);
  for (const d of result.departures ?? []) {
    ingest('observation', { text: d.evidence ?? d.title, source: `architecture-desk ${a.id}`, by: 'architecture-desk', departure: d.title, project: d.project ?? wo.meta.project });
  }
  if (result.kind === 'proposal') {
    // A recommendation is never adopted here: it becomes a proposal signal plus an owner decision.
    ingest('proposal', { text: `${result.proposal.change}\n\nReasons: ${result.proposal.reasons}`, source: `architecture-desk ${a.id} on ${q.meta.id}`, by: 'architecture-desk' });
    const did = raiseDecision({
      key: `arch-proposal-${q.meta.id}`, title: `Architecture direction change? ${result.proposal.change}`,
      why: `Approved guidance does not settle ${q.meta.id}; answering it would set new direction.`,
      recommendation: result.answer, tradeoff: result.proposal.reasons, blocks: [wo.meta.id], priority: 2, source: 'architecture-desk',
    });
    patchRec(q, { status: 'escalated', decision: did });
    wo.meta.next_action = `owner decision ${did} (answers ${q.meta.id})`;
    saveRec(wo);
    log(`${wo.meta.id} ${q.meta.id} escalated to owner as ${did}`);
    return 'wait';
  }
  answerQuestion(q.meta.id, { answer: result.answer, kind: result.kind, by: 'architecture-desk', refs: result.guidance_refs });
  log(`${wo.meta.id} ${q.meta.id} answered by architecture desk (${result.kind})`);
  return 'progress';
}

function patchRec(q: Rec, patch: Record<string, unknown>): void {
  Object.assign(q.meta, patch);
  saveRec(q);
}

// Crash recovery: an attempt left dispatched/running by a dead coordinator is never blindly resubmitted.
export function recover(wo: Rec): 'ok' | 'busy' {
  const a = wo.meta.attempts?.find((x: any) => x.status === 'dispatched' || x.status === 'running');
  if (!a) return 'ok';
  if (a.pid && pidAlive(a.pid)) { log(`${wo.meta.id} attempt ${a.id} (pid ${a.pid}) is still running; leaving it alone`); return 'busy'; }
  const result = parseResult(collect(a.harness, a.out_dir).text);
  const errors = a.role === 'implement' || a.role === 'review'
    ? resultErrors(wo, a.role, result)
    : CHECKS[a.role](result);
  if (!errors.length) {
    Object.assign(a, { status: 'returned', recovered: iso() });
    saveRec(wo);
    log(`${wo.meta.id} attempt ${a.id} recovered from its output after an interruption`);
    return 'ok';
  }
  a.status = 'uncertain';
  hold(wo, 'uncertain', `attempt ${a.id} (${a.role}) was interrupted and its outcome cannot be established`,
    `inspect ${a.out_dir}${wo.meta.worktree ? ` and ${wo.meta.worktree}` : ''}; then qst reconcile ${wo.meta.id} --retry | --fail "<reason>"`);
  return 'busy';
}

function answeredQuestions(wo: Rec): string {
  return wo.meta.questions.map((id: string) => readRec(qFile(id))!).filter((q: Rec) => q.meta.status === 'answered')
    .map((q: Rec) => `- ${q.meta.id}: ${questionText(q)}\n  Answer (${q.meta.answer_kind}, ${q.meta.answered_by}): ${answerText(q)}`).join('\n');
}

const fence = (o: object) => '```json\n' + JSON.stringify(o) + '\n```';

function implementPrompt(wo: Rec): string {
  const answered = answeredQuestions(wo);
  return [
    `You are the implementer for work order ${wo.meta.id}. Read and follow ${skillPath('construction-implement')}.`,
    `Assignment (outcome and acceptance criteria): ${woFile(wo.meta.id)}`,
    kindOf(wo) === 'research'
      ? `Your working directory is the scratch directory ${wo.meta.scratch}. This is research work: read-only, with no side effects. Do not create, edit, or delete files, run commands that change state, or contact anyone. Cite a source for every acceptance criterion.`
      : `Your working directory is the isolated worktree ${wo.meta.worktree} (branch ${wo.meta.branch}). Do not commit, push, or merge; the coordinator commits after validation.`,
    `Owner-approved guidance: ${guidanceFiles().join(', ')}`,
    kindOf(wo) === 'code' && `The coordinator will run: ${wo.meta.validate.join(' ; ')}`,
    kindOf(wo) === 'research' && `End with evidence: [{criterion, citation, finding}] for every acceptance criterion.`,
    answered && `Answered questions:\n${answered}`,
    wo.meta.status === 'correcting' && `This is a correction attempt. Address: ${wo.meta.feedback}`,
    `End your reply with ${fence({ status: 'done|question|blocked', summary: '...', question: { text: '...', evidence: '...', requested_decision: '...', desk: 'architecture|chief-of-staff' } })} (omit "question" unless status is question).`,
  ].filter(Boolean).join('\n\n');
}

function reviewPrompt(wo: Rec): string {
  const v = wo.meta.validations.at(-1);
  const impl = wo.meta.attempts.findLast((a: any) => a.role === 'implement' && a.summary);
  return [
    `You are the reviewer for work order ${wo.meta.id}; you are a separate session from the implementer. Read and follow ${skillPath('construction-review')}.`,
    `Assignment: ${woFile(wo.meta.id)}`,
    kindOf(wo) === 'research'
      ? `Review the research result against every acceptance criterion. Check each cited source and judge whether it supports the finding. Return assessments: [{criterion, evidence, result: met|unmet}] using source citations.`
      : `Review the change in ${wo.meta.worktree} with: git diff ${wo.meta.base}..${wo.meta.commit}`,
    kindOf(wo) === 'code' && `Validation run by the coordinator (${v.id}): ${v.results.map((r: any) => `\`${r.cmd}\` exit ${r.exit}, log ${r.log}`).join('; ')}`,
    `Implementer's summary (a claim, not evidence): ${impl?.summary ?? '(none)'}`,
    kindOf(wo) === 'research' && `Implementer's cited evidence: ${JSON.stringify(impl?.evidence ?? [])}`,
    `Owner-approved guidance: ${guidanceFiles().join(', ')}`,
    `End your reply with ${fence(kindOf(wo) === 'research' ? { verdict: 'approve|changes', summary: '...', assessments: [{ criterion: '...', evidence: 'source citation', result: 'met|unmet' }], findings: [{ severity: 'blocking|minor', text: '...' }] } : { verdict: 'approve|changes', summary: '...', findings: [{ severity: 'blocking|minor', text: '...' }] })}`,
  ].join('\n\n');
}

function architecturePrompt(wo: Rec, q: Rec): string {
  return [
    `You are the Enterprise Architecture desk answering one question. Read and follow ${skillPath('architecture-desk')}.`,
    `Owner-approved guidance (the only approved direction): ${guidanceFiles().join(', ')}. Project records: ${p('portfolio')}`,
    `Question ${q.meta.id} from work order ${wo.meta.id} (${woFile(wo.meta.id)}), file ${q.file}:\n${q.body}`,
    `Requested decision: ${q.meta.requested_decision}`,
    `End your reply with ${fence({ kind: 'interpretation|needs-evidence|proposal', answer: '...', guidance_refs: ['owner/technical.md: ...'], proposal: { change: '...', reasons: '...' }, departures: [{ title: '...', project: '...', evidence: '...' }] })} (omit proposal unless kind is proposal; departures only if you found any).`,
  ].join('\n\n');
}

export function writeOutcome(wo: Rec): void {
  const m = wo.meta;
  const v = m.validations?.at(-1);
  const r = m.reviews?.at(-1);
  if (m.outcome_at) {
    const attempts = m.attempts.map((a: any) => a.id);
    const bundle = p('work', m.id, 'assignment-bundles', `assignment-bundle-${attempts.at(-1) ?? m.outcome_at}.json`);
    if (!fs.existsSync(bundle)) writeAtomic(bundle, JSON.stringify({
      workorder: 'inputs/<attempt>/workorder.md', guidance: 'inputs/<attempt>/owner/',
      skills: 'inputs/<attempt>/skills/', outcome: m.outcome, acceptance: m.acceptance,
      validate: m.validate, attempts, status: m.status, outcome_at: m.outcome_at,
    }, null, 2) + '\n');
  }
  writeAtomic(p('work', m.id, 'outcome.md'), [
    `# ${m.id} outcome: ${m.status}`, '', m.outcome_summary ?? '', '', `**Next action:** ${m.next_action ?? 'none'}`, '',
    `- Kind: ${m.kind ?? 'code'}`,
    `- Project: ${m.project}${m.repo ? ` (${m.repo})` : ''}${m.base ? `, base ${m.base}` : ''}`,
    `- Branch: ${m.branch ?? '-'}, commit ${m.commit ?? '-'}`,
    `- Attempts: ${m.attempts.map((a: any) => `${a.id} ${a.role} ${a.status}${a.result_ok === false ? ' (rejected)' : ''}`).join('; ') || 'none'}`,
    `- Last validation: ${v ? `${v.id} ${v.passed ? 'passed' : 'failed'}: ${v.results.map((x: any) => `\`${x.cmd}\`=${x.exit}`).join(', ')}` : 'none'}`,
    `- Last review: ${r ? `${r.verdict}: ${r.summary}` : 'none'}`,
    `- Unresolved: ${m.unresolved ?? 'none'}`, '',
  ].join('\n'));
}
