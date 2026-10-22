import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setup, qst, qstAsync, script, calls, wo, approvedWorkOrder, files, EXEC_EMPTY, IMPL_DONE, REVIEW_OK } from './helpers.ts';

const waitFor = async (cond: () => boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!cond()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 50)); }
};

test('no actionable work exits without any model invocation', () => {
  const e = setup();
  const r = qst(e, 'sweep');
  assert.equal(r.code, 0);
  assert.match(r.out, /nothing actionable/);
  assert.equal(calls(e).length, 0);
});

test('overlapping sweeps do not duplicate dispatch', async () => {
  const e = setup();
  const id = approvedWorkOrder(e);
  script(e, { implement: [{ ...IMPL_DONE, sleep_ms: 1500 }], review: [REVIEW_OK], executive: [EXEC_EMPTY] });
  const first = qstAsync(e, 'sweep');
  await waitFor(() => calls(e, 'implement').length === 1);
  const second = qst(e, 'sweep');
  assert.match(second.out, /another sweep holds the coordinator lock/);
  await new Promise((r) => first.on('exit', r));
  assert.equal(calls(e, 'implement').length, 1);
  assert.equal(wo(e, id).status, 'ready-for-integration');
});

test('interrupted dispatch is held as uncertain, not resubmitted, until reconciled', async () => {
  const e = setup();
  const id = approvedWorkOrder(e);
  script(e, { implement: [{ ...IMPL_DONE, sleep_ms: 60_000 }, IMPL_DONE], review: [REVIEW_OK], executive: [EXEC_EMPTY] });
  const sweep = qstAsync(e, 'sweep');
  await waitFor(() => calls(e, 'implement').length === 1);
  process.kill(sweep.pid!, 'SIGKILL');                       // coordinator crash
  process.kill(calls(e, 'implement')[0].pid, 'SIGKILL');     // its agent dies too
  await new Promise((r) => setTimeout(r, 200));

  qst(e, 'sweep');
  assert.equal(wo(e, id).status, 'uncertain');
  assert.equal(calls(e, 'implement').length, 1, 'no blind resubmission');
  qst(e, 'sweep');
  assert.equal(calls(e, 'implement').length, 1, 'still held on the next sweep');
  assert.match(qst(e, 'status').out, /uncertain/);

  assert.equal(qst(e, 'reconcile', id, '--retry').code, 0);
  qst(e, 'sweep');
  assert.equal(calls(e, 'implement').length, 2);
  assert.equal(wo(e, id).status, 'ready-for-integration');
});

test('an interrupted attempt whose output is complete is recovered from evidence instead of rerun', () => {
  const e = setup();
  const id = approvedWorkOrder(e);
  script(e, { implement: [IMPL_DONE], review: [REVIEW_OK], executive: [EXEC_EMPTY] });
  qst(e, 'sweep');
  // Simulate a crash after the agent wrote its result but before the coordinator recorded the return.
  const f = `${e.desk}/work/${id}/workorder.md`;
  const t = fs.readFileSync(f, 'utf8');
  const m = JSON.parse(t.slice(4, t.indexOf('\n---\n', 4)));
  const a = m.attempts.find((x: any) => x.role === 'review');
  Object.assign(a, { status: 'running', pid: 999999, processed: undefined });
  m.status = 'reviewing';
  fs.writeFileSync(f, `---\n${JSON.stringify(m)}\n---\n`);
  qst(e, 'sweep');
  assert.equal(wo(e, id).status, 'ready-for-integration');
  assert.equal(calls(e, 'review').length, 1);
});

test('unchanged pending decisions do not create repeated interruptions', () => {
  const e = setup();
  const decision = { key: 'pick-backup', title: 'Pick a backup target', why: 'no guidance', recommendation: 'use /mnt/backup', tradeoff: 'local only', blocks: [], deadline: null, priority: 2 };
  script(e, { executive: [{ json: { answers: [], decisions: [decision], workorders: [], notes: 'n' } }] });
  qst(e, 'ingest', 'observation', '--text', 'SAMPLE obs 1', '--source', 'test', '--by', 'owner');
  qst(e, 'sweep');
  assert.match(qst(e, 'digest', '--ack').out, /1 new/);
  qst(e, 'ingest', 'observation', '--text', 'SAMPLE obs 2', '--source', 'test', '--by', 'owner');
  qst(e, 'sweep');
  assert.equal(calls(e, 'executive').length, 2);
  assert.equal(files(e, 'decisions').length, 1);
  assert.match(qst(e, 'digest').out, /1 open, 0 new/);
});

test('dry run reports proposed dispatch and starts nothing', () => {
  const e = setup();
  approvedWorkOrder(e);
  const r = qst(e, 'sweep', '--dry-run');
  assert.match(r.out, /owner decision signal/);
  assert.match(r.out, /executive review .* ALLOWED/);
  assert.equal(calls(e).length, 0);
  assert.equal(fs.existsSync(`${e.desk}/digest.md`), false);
});
