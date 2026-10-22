// One bounded coordinator sweep: lock, recover, cheap precheck, construction, executive review.
import fs from 'node:fs';
import { p, readRec, log } from './desk.ts';
import type { Rec } from './desk.ts';
import { acquireLock, pidAlive } from './lock.ts';
import { loadPolicy, checkLaunch } from './capacity.ts';
import { listWOs, qFile } from './records.ts';
import { listSignals } from './signals.ts';
import { advance, recover, ACTIVE } from './construction.ts';
import type { Ctx } from './construction.ts';
import { applyOwnerSignals, executiveReasons, runExecutive, recoverExecutiveRuns } from './executive.ts';
import { writeDigest } from './digest.ts';
import { route } from './agents.ts';

const WIP_LIMIT = 1;
const MAX_STEPS = 25;

// Which role (if any) the next step of this work order would launch.
function nextRole(wo: Rec): string | null | false {
  switch (wo.meta.status) {
    case 'approved': case 'validating': return null;
    case 'ready': case 'correcting': return 'implement';
    case 'reviewing': return 'review';
    case 'waiting-answer': {
      const q = readRec(qFile(wo.meta.questions.at(-1)))!;
      if (q.meta.status === 'answered') return null;
      return q.meta.status === 'open' && q.meta.desk === 'architecture' ? 'architecture' : false;
    }
    default: return false;
  }
}

export function selectWO(skip: Set<string>): Rec | null {
  const all = listWOs();
  const movable = all.find((w) => !skip.has(w.meta.id) && ACTIVE.includes(w.meta.status) && nextRole(w) !== false);
  if (movable) return movable;
  if (all.filter((w) => ACTIVE.includes(w.meta.status)).length >= WIP_LIMIT) return null;
  return all.filter((w) => w.meta.status === 'approved').sort((a, b) => a.meta.rank - b.meta.rank || a.meta.created.localeCompare(b.meta.created))[0] ?? null;
}

export async function sweep(opts: { owner: boolean }): Promise<number> {
  const release = acquireLock();
  if (!release) { log('another sweep holds the coordinator lock; exiting without action'); return 0; }
  try {
    const policy = loadPolicy();
    const ctx: Ctx = { owner: opts.owner, launches: 0, deadline: Date.now() + policy.sweep_max_minutes * 60_000 };
    recoverExecutiveRuns();
    const skip = new Set<string>();
    for (const wo of listWOs()) if (recover(wo) === 'busy') skip.add(wo.meta.id);
    applyOwnerSignals();

    if (!selectWO(skip) && !executiveReasons().length) {
      log('nothing actionable; no agent started');
      writeDigest();
      return 0;
    }
    for (let i = 0; i < MAX_STEPS && Date.now() < ctx.deadline; i++) {
      const wo = selectWO(skip);
      if (!wo || (await advance(wo, ctx)) === 'wait') break;
    }
    const reasons = executiveReasons();
    if (reasons.length) await runExecutive(ctx, reasons);
    writeDigest();
    return 0;
  } finally {
    release();
  }
}

// Dry run: reports what a sweep would do; writes nothing and starts no agent.
export function dryRun(opts: { owner: boolean }): string[] {
  const out: string[] = [];
  if (fs.existsSync(p('coordinator.lock'))) out.push('a coordinator lock file exists; a real sweep may exit immediately');
  const pendingApprovals = listSignals().filter((s) => s.meta.kind === 'decision' && !s.meta.applied);
  if (pendingApprovals.length) out.push(`would apply ${pendingApprovals.length} owner decision signal(s) first${pendingApprovals.flatMap((s) => s.meta.approve ?? []).map((id: string) => `; approve ${id}`).join('')}`);
  const skip = new Set<string>();
  for (const wo of listWOs()) {
    const a = wo.meta.attempts?.find((x: any) => ['dispatched', 'running'].includes(x.status));
    if (a) { skip.add(wo.meta.id); out.push(`${wo.meta.id}: attempt ${a.id} ${a.pid && pidAlive(a.pid) ? 'still running' : 'interrupted; would inspect evidence or mark uncertain'}`); }
  }
  const wo = selectWO(skip);
  const verdict = (role: string) => {
    const r = route(role);
    const v = checkLaunch(r.provider, { owner: opts.owner, launchesThisSweep: 0 });
    return `${role} via ${r.harness}/${r.model}: ${v.ok ? 'ALLOWED' : `BLOCKED (${v.reason})`}`;
  };
  if (wo) {
    const role = nextRole(wo);
    out.push(`${wo.meta.id} (${wo.meta.status}): next step ${role ? `would launch ${verdict(role)}` : 'is deterministic (no agent)'}`);
  }
  const reasons = executiveReasons();
  if (reasons.length) out.push(`executive review (${reasons.join('; ')}): would launch ${verdict('executive')}`);
  if (!wo && !reasons.length) out.push('nothing actionable; a sweep would exit without starting an agent');
  return out;
}
