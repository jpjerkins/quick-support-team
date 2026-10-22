import { test } from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { setup, qst, script, calls, wo, approvedWorkOrder, writeOwner, PERMISSIVE, EXEC_EMPTY, IMPL_DONE, REVIEW_OK } from './helpers.ts';

const withProvider = (patch: object) => ({ ...PERMISSIVE, providers: { ...PERMISSIVE.providers, codex: { ...PERMISSIVE.providers.codex, ...patch } } });

test('default policy: autonomous metered execution is disabled', () => {
  const e = setup();
  const id = approvedWorkOrder(e);
  writeOwner(e, 'capacity.md', { autonomous_enabled: false, max_launches_per_sweep: 4, sweep_max_minutes: 5, providers: PERMISSIVE.providers });
  qst(e, 'sweep');
  assert.equal(calls(e).length, 0);
  assert.match(wo(e, id).capacity_hold, /disabled/);
});

test('protected window blocks dispatch', () => {
  const e = setup(withProvider({ protected_windows: [{ label: 'evening', start: '18:00', end: '22:00', autonomous: false }] }));
  e.env.QST_NOW = '2026-10-21T19:30:00';
  const id = approvedWorkOrder(e);
  script(e, { implement: [IMPL_DONE], executive: [EXEC_EMPTY] });
  qst(e, 'sweep');
  assert.equal(calls(e, 'implement').length, 0);
  assert.match(wo(e, id).capacity_hold, /protected window evening/);
});

test('exhausted allowance blocks dispatch; an explicit limited override allows exactly its extra launches', () => {
  const e = setup(withProvider({ launches_per_day: 1 }));
  const id = approvedWorkOrder(e);
  const ask = { json: { status: 'question', summary: 'q', question: { text: 'which?', requested_decision: 'x', desk: 'chief-of-staff' } } };
  script(e, { implement: [ask, IMPL_DONE], review: [REVIEW_OK], executive: [{ json: { answers: [], decisions: [], workorders: [], notes: 'n' } }] });
  qst(e, 'sweep');
  assert.equal(calls(e, 'implement').length, 1);
  // Owner answers; the next implement launch would be the 2nd codex launch today.
  const q = wo(e, id).questions[0];
  qst(e, 'ingest', 'decision', '--answers', q, '--text', 'use the first one', '--source', 'test');
  qst(e, 'sweep');
  assert.equal(calls(e, 'implement').length, 1);
  assert.match(wo(e, id).capacity_hold, /allowance exhausted/);

  writeOwner(e, 'capacity.md', withProvider({ launches_per_day: 1, override: { until: '2999-01-01T00:00:00Z', extra_launches: 1, reason: 'test' } }));
  qst(e, 'sweep');
  assert.equal(calls(e, 'implement').length, 2);
});

test('stale or missing capacity observations do not become headroom', () => {
  const e = setup(withProvider({ reserve: { min_remaining_pct: 30, max_age_minutes: 60 } }));
  const id = approvedWorkOrder(e);
  script(e, { implement: [IMPL_DONE], review: [REVIEW_OK], executive: [EXEC_EMPTY] });
  qst(e, 'sweep');
  assert.equal(calls(e, 'implement').length, 0);
  assert.match(wo(e, id).capacity_hold, /no provider observation/);

  qst(e, 'capacity', 'observe', '--provider', 'codex', '--kind', 'provider', '--source', 'test', '--used-pct', '10', '--observed-at', '2020-01-01T00:00:00Z');
  qst(e, 'sweep');
  assert.match(wo(e, id).capacity_hold, /stale/);

  qst(e, 'capacity', 'observe', '--provider', 'codex', '--kind', 'estimate', '--source', 'my guess', '--used-pct', '5');
  qst(e, 'sweep');
  assert.match(wo(e, id).capacity_hold, /stale/, 'estimates never count as provider observations');

  qst(e, 'capacity', 'observe', '--provider', 'codex', '--kind', 'provider', '--source', 'test', '--used-pct', '90');
  qst(e, 'sweep');
  assert.match(wo(e, id).capacity_hold, /reserve/);
  assert.equal(calls(e, 'implement').length, 0);
});

test('per-sweep launch limit bounds a sweep', () => {
  const e = setup({ ...PERMISSIVE, max_launches_per_sweep: 1 });
  const id = approvedWorkOrder(e);
  script(e, { implement: [IMPL_DONE], review: [REVIEW_OK], executive: [EXEC_EMPTY] });
  qst(e, 'sweep');
  assert.equal(calls(e).length, 1);
  assert.equal(wo(e, id).status, 'reviewing');
});

test('daily allowance counts launches by local day', () => {
  const e = setup(withProvider({ launches_per_day: 1 }));
  e.env.TZ = 'America/Chicago';
  const id = approvedWorkOrder(e);
  // 23:30 local on the 21st is already the 22nd in UTC; a launch then must not count on the local 22nd.
  fs.mkdirSync(`${e.desk}/capacity`, { recursive: true });
  fs.appendFileSync(`${e.desk}/capacity/ledger.jsonl`, JSON.stringify({ at: '2026-10-22T04:30:00.000Z', provider: 'codex' }) + '\n');
  e.env.QST_NOW = '2026-10-22T10:00:00-05:00';
  script(e, { implement: [IMPL_DONE], review: [REVIEW_OK], executive: [EXEC_EMPTY] });
  qst(e, 'sweep');
  assert.equal(calls(e, 'implement').length, 1);
  assert.equal(wo(e, id).capacity_hold, undefined);
});
