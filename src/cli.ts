// qst: the deterministic launcher. Agents and the owner use these commands; nothing else writes desk status.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { p, deskDir, installDir, iso, log } from './desk.ts';
import { acquireLock } from './lock.ts';
import { ingest, ensureDesk } from './signals.ts';
import { createWorkOrder, loadWO, saveRec } from './records.ts';
import { sweep, dryRun } from './sweep.ts';
import { renderDigest, writeDigest, ackDigest } from './digest.ts';
import { recordObservation, loadPolicy, launchesToday, latestObservation } from './capacity.ts';
import { writeOutcome, skillPath } from './construction.ts';
import { route } from './agents.ts';

const HELP = `qst - quick support team launcher (desk: ${deskDir()})

  qst init                                   create the desk from templates (never overwrites)
  qst ingest project  --slug S --text T --source SRC [--name N --state live|building|planned --repo PATH --purpose P --validate CMD...]
  qst ingest guidance --topic priorities|constraints|technical|architecture --text T --source SRC
  qst ingest decision --text T --source SRC [--approve WO-ID...] [--answers Q-ID] [--resolves D-ID]
  qst ingest observation|proposal --text T --source SRC --by WHO [--departure TITLE --project S]
  qst workorder integrate WO-ID                 merge ready work onto the project's main branch
  qst workorder add --project S --outcome O --accept A... [--kind code|research] [--validate CMD...] [--departure DEP-ID...] --source SRC
  qst sweep [--dry-run] [--owner]            one bounded sweep (--owner: you are explicitly authorizing this run)
  qst status [WO-ID]                         digest, or one work order in detail
  qst digest [--ack]                         decisions first; --ack marks current decisions as seen
  qst reconcile WO-ID --retry | --fail REASON
  qst capacity [observe --provider P --kind provider|estimate --source SRC [--used-pct N --resets-at T --observed-at T --note X]]
  qst open chief-of-staff|architecture       open an interactive desk session in a Herdr pane (inside Herdr only)
`;

const { values: o, positionals: pos } = parseArgs({
  allowPositionals: true,
  options: {
    text: { type: 'string' }, source: { type: 'string' }, by: { type: 'string' }, topic: { type: 'string' },
    slug: { type: 'string' }, name: { type: 'string' }, state: { type: 'string' }, repo: { type: 'string' }, purpose: { type: 'string' },
    validate: { type: 'string', multiple: true }, approve: { type: 'string', multiple: true }, answers: { type: 'string' }, resolves: { type: 'string' },
    departure: { type: 'string', multiple: true }, project: { type: 'string' }, outcome: { type: 'string' }, accept: { type: 'string', multiple: true },
    'dry-run': { type: 'boolean' }, owner: { type: 'boolean' }, ack: { type: 'boolean' }, retry: { type: 'boolean' }, fail: { type: 'string' },
    provider: { type: 'string' }, kind: { type: 'string' }, 'used-pct': { type: 'string' }, 'resets-at': { type: 'string' },
    'observed-at': { type: 'string' }, note: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  },
});

function needDesk(): void {
  if (!fs.existsSync(p('owner'))) throw new Error(`no desk at ${deskDir()}; run: qst init`);
}

async function main(): Promise<number> {
  const [cmd, sub] = pos;
  if (!cmd || o.help) { console.log(HELP); return 0; }
  if (cmd === 'init') { ensureDesk(path.join(installDir(), 'templates', 'desk')); console.log(`desk ready at ${deskDir()}`); return 0; }
  needDesk();
  switch (cmd) {
    case 'ingest': {
      const id = ingest(sub, {
        text: o.text!, source: o.source!, by: o.by, topic: o.topic, slug: o.slug, name: o.name, repo: o.repo, purpose: o.purpose,
        state: o.state, validate: o.validate, approve: o.approve, answers: o.answers, resolves: o.resolves,
        departure: o.departure?.[0], project: o.project,
      });
      console.log(id);
      return 0;
    }
    case 'workorder': {
      if (sub === 'integrate') return integrate(pos[2]);
      if (sub !== 'add') throw new Error('usage: qst workorder add ... | qst workorder integrate WO-ID');
      if (!o.project || !o.outcome || !o.source) throw new Error('--project, --outcome and --source are required');
      console.log(createWorkOrder({ kind: o.kind, project: o.project, outcome: o.outcome, acceptance: o.accept ?? [], validate: o.validate, departures: o.departure, source: o.source }));
      return 0;
    }
    case 'sweep':
      if (o['dry-run']) { for (const line of dryRun({ owner: !!o.owner })) console.log(`[dry-run] ${line}`); return 0; }
      return sweep({ owner: !!o.owner });
    case 'status':
      if (sub) { const wo = loadWO(sub); console.log(wo.body); const out = p('work', wo.meta.id, 'outcome.md'); if (fs.existsSync(out)) console.log(fs.readFileSync(out, 'utf8')); console.log(`slug: ${wo.meta.slug ?? '(none)'}\nstatus: ${wo.meta.status}\nrecord: ${wo.file}`); return 0; }
      console.log(renderDigest());
      return 0;
    case 'digest':
      writeDigest();
      console.log(renderDigest());
      if (o.ack) console.log(`marked ${ackDigest()} open decision(s) as seen`);
      return 0;
    case 'reconcile': return reconcile(sub);
    case 'capacity': return capacity(sub);
    case 'open': return openDesk(sub);
    default: throw new Error(`unknown command "${cmd}"\n\n${HELP}`);
  }
}

function integrate(id?: string): number {
  if (!id) throw new Error('usage: qst workorder integrate WO-ID');
  let wo = loadWO(id);
  if (wo.meta.status !== 'ready-for-integration') throw new Error(`${id} is ${wo.meta.status}; only ready-for-integration work can be integrated`);
  const release = acquireLock();
  if (!release) throw new Error('a sweep holds the coordinator lock; try again when it finishes');
  try {
    wo = loadWO(id);
    if (wo.meta.status !== 'ready-for-integration') throw new Error(`${id} is ${wo.meta.status}; only ready-for-integration work can be integrated`);
    const repo = wo.meta.repo;
    const git = (cwd: string, ...args: string[]) => {
      const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || r.stdout).trim()}`);
      return r.stdout.trim();
    };
    const projectBranch = git(repo, 'branch', '--show-current');
    if (!projectBranch) throw new Error(`project must be checked out on its integration branch in ${repo}`);
    if (git(repo, 'status', '--porcelain')) throw new Error(`project has uncommitted changes in ${repo}`);
    if (git(wo.meta.worktree, 'branch', '--show-current') !== wo.meta.branch) throw new Error(`${id} worktree is not on branch ${wo.meta.branch}`);
    if (git(wo.meta.worktree, 'status', '--porcelain')) throw new Error(`${id} worktree has uncommitted changes`);
    const base = wo.meta.base;
    const target = git(repo, 'rev-parse', projectBranch);
    if (base !== target) {
      const rebase = spawnSync('git', ['rebase', projectBranch], { cwd: wo.meta.worktree, encoding: 'utf8' });
      if (rebase.status !== 0) {
        spawnSync('git', ['rebase', '--abort'], { cwd: wo.meta.worktree, encoding: 'utf8' });
        throw new Error(`git rebase ${projectBranch} failed: ${(rebase.stderr || rebase.stdout).trim()}`);
      }
      Object.assign(wo.meta, { base: target, commit: git(wo.meta.worktree, 'rev-parse', 'HEAD') });
      saveRec(wo);
    }
    const merge = spawnSync('git', ['merge', '--no-edit', wo.meta.branch], { cwd: repo, encoding: 'utf8' });
    if (merge.status !== 0) {
      spawnSync('git', ['merge', '--abort'], { cwd: repo, encoding: 'utf8' });
      throw new Error(`git merge ${wo.meta.branch} failed: ${(merge.stderr || merge.stdout).trim()}`);
    }
    Object.assign(wo.meta, { status: 'integrated', integrated: iso(), next_action: 'none' });
    saveRec(wo);
    writeOutcome(wo);
    log(`${id} integrated into ${projectBranch} (${git(repo, 'rev-parse', 'HEAD').slice(0, 8)})`);
    return 0;
  } finally { release(); }
}

function reconcile(id: string): number {
  if (!id || (!o.retry && !o.fail)) throw new Error('usage: qst reconcile WO-ID --retry | --fail REASON');
  const release = acquireLock();
  if (!release) throw new Error('a sweep holds the coordinator lock; try again when it finishes');
  try {
    const wo = loadWO(id);
    if (!['uncertain', 'blocked'].includes(wo.meta.status)) throw new Error(`${id} is ${wo.meta.status}; only uncertain or blocked work is reconciled`);
    for (const a of wo.meta.attempts) if (a.status === 'uncertain') a.status = 'abandoned';
    wo.meta.reconciled = [...(wo.meta.reconciled ?? []), { at: iso(), action: o.retry ? 'retry' : 'fail', from: wo.meta.status, reason: o.fail ?? null }];
    if (o.fail) {
      Object.assign(wo.meta, { status: 'failed', outcome_summary: `failed by owner: ${o.fail}`, next_action: 'none', outcome_at: iso() });
    } else {
      // An explicit owner retry grants exactly one more correction when the budget is used.
      if (wo.meta.corrections_used >= wo.meta.max_corrections) wo.meta.max_corrections = wo.meta.corrections_used + 1;
      Object.assign(wo.meta, { status: wo.meta.held_from ?? 'ready', next_action: null, outcome_at: null });
      delete wo.meta.held_from;
    }
    saveRec(wo);
    writeOutcome(wo);
    log(`${id} reconciled: ${o.retry ? `retry from ${wo.meta.status}` : 'failed'}`);
    return 0;
  } finally { release(); }
}

function capacity(sub?: string): number {
  if (sub === 'observe') {
    if (!o.provider || !o.kind || !o.source) throw new Error('--provider, --kind and --source are required');
    recordObservation({ provider: o.provider, kind: o.kind, source: o.source, used_pct: o['used-pct'] ? Number(o['used-pct']) : undefined, resets_at: o['resets-at'], observed_at: o['observed-at'], note: o.note });
    console.log('observation recorded');
    return 0;
  }
  const policy = loadPolicy();
  console.log(`autonomous metered execution: ${policy.autonomous_enabled ? 'enabled' : 'DISABLED'}; per-sweep launch limit ${policy.max_launches_per_sweep}; sweep limit ${policy.sweep_max_minutes} min; on protected window start: ${policy.on_window_start}`);
  for (const [prov, pp] of Object.entries(policy.providers)) {
    const obs = latestObservation(prov);
    console.log(`${prov}: ${launchesToday(prov)}/${pp.launches_per_day} autonomous launches today (local count, not provider usage); windows: ${JSON.stringify(pp.protected_windows ?? [])}; reserve: ${JSON.stringify(pp.reserve ?? null)}`);
    console.log(`  latest provider observation: ${obs ? JSON.stringify(obs) : 'none (remaining capacity unknown)'}`);
  }
  return 0;
}

function herdr(...args: string[]): any {
  const r = spawnSync('herdr', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`herdr ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  return r.stdout.trim().startsWith('{') ? JSON.parse(r.stdout) : r.stdout;
}

function openDesk(desk?: string): number {
  const roles: Record<string, [string, string, string]> = { 'chief-of-staff': ['executive', 'chief-of-staff', 'qst-cos'], architecture: ['architecture', 'architecture-desk', 'qst-arch'] };
  if (!desk || !roles[desk]) throw new Error('usage: qst open chief-of-staff|architecture');
  if (process.env.HERDR_ENV !== '1') throw new Error('not running inside a Herdr pane; start this from a Herdr pane, or run `claude` yourself and say: "Read and follow ' + skillPath(roles[desk][1]) + '"');
  const [role, skill, name] = roles[desk];
  const r = route(role);
  const pane = herdr('pane', 'split', '--current', '--direction', 'right', '--cwd', deskDir(), '--no-focus').result.pane.pane_id;
  const modelArgs = r.harness === 'codex' ? ['-m', r.model] : ['--model', r.model];
  herdr('agent', 'start', name, '--kind', r.harness, '--pane', pane, '--', ...modelArgs);
  herdr('agent', 'prompt', name, `Read and follow ${skillPath(skill)} (interactive session with Phil). Desk: ${deskDir()}. Start by reading ${p('digest.md')}.`);
  console.log(`${desk} session "${name}" started in pane ${pane}`);
  return 0;
}

main().then((code) => process.exit(code), (e) => { console.error(`qst: ${e.message}`); process.exit(1); });
