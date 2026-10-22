import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { setup, qst, script, calls, wo, approvedWorkOrder, EXEC_EMPTY, IMPL_DONE, IMPL_BROKEN, REVIEW_OK } from './helpers.ts';

test('approved work order reaches ready-for-integration with real tests, a commit and a separate review', () => {
  const e = setup();
  const id = approvedWorkOrder(e);
  script(e, { implement: [IMPL_DONE], review: [REVIEW_OK], executive: [EXEC_EMPTY] });
  assert.equal(qst(e, 'sweep').code, 0);
  const m = wo(e, id);
  assert.equal(m.kind, 'code');
  assert.equal(m.status, 'ready-for-integration');
  assert.equal(m.validations.at(-1).passed, true);
  assert.match(spawnSync('git', ['-C', m.worktree, 'log', '--oneline', '-1'], { encoding: 'utf8' }).stdout, new RegExp(id));
  assert.equal(calls(e, 'implement').length, 1);
  assert.equal(calls(e, 'review').length, 1);
  assert.notEqual(calls(e, 'implement')[0].pid, calls(e, 'review')[0].pid);
  assert.ok(m.attempts[0].snapshots['skills/construction-implement']);
  assert.match(fs.readFileSync(`${e.desk}/work/${id}/outcome.md`, 'utf8'), /ready-for-integration/);
});

test('research work order needs no repo or validation and completes from cited evidence', () => {
  const e = setup();
  qst(e, 'ingest', 'project', '--slug', 'topic', '--text', 'Research topic', '--source', 'test');
  assert.notEqual(qst(e, 'workorder', 'add', '--kind', 'ops', '--project', 'topic', '--outcome', 'Bad kind', '--accept', 'x', '--source', 'test').code, 0);
  const id = qst(e, 'workorder', 'add', '--kind', 'research', '--project', 'topic', '--outcome', 'Research the topic', '--accept', 'Find primary evidence', '--source', 'test').out.trim();
  qst(e, 'ingest', 'decision', '--approve', id, '--text', 'approved', '--source', 'test');
  const evidence = [{ criterion: 'Find primary evidence', citation: 'https://example.test/source', excerpt: 'Direct source states the finding.' }];
  script(e, {
    implement: [{ json: { status: 'done', summary: 'Found primary source', evidence } }],
    review: [{ json: { verdict: 'approve', summary: 'Evidence supports the criterion', findings: [], assessments: [{ criterion: 'Find primary evidence', evidence: 'https://example.test/source', result: 'met' }] } }],
    executive: [EXEC_EMPTY],
  });
  assert.equal(qst(e, 'sweep').code, 0);
  const m = wo(e, id);
  assert.equal(m.kind, 'research');
  assert.equal(m.status, 'complete');
  assert.equal(m.repo, undefined);
  assert.equal(m.worktree, undefined);
  assert.deepEqual(m.validations, []);
  assert.match(calls(e, 'implement')[0].prompt, /read-only/);
  assert.match(calls(e, 'review')[0].prompt, /citation/);
  assert.equal(calls(e, 'implement')[0].cwd, `${e.desk}/work/${id}/scratch`);
});

test('failed checks never produce ready-for-integration; one correction, then failed, no review', () => {
  const e = setup();
  const id = approvedWorkOrder(e);
  script(e, { implement: [IMPL_BROKEN], review: [REVIEW_OK], executive: [EXEC_EMPTY] });
  qst(e, 'sweep');
  const m = wo(e, id);
  assert.equal(m.status, 'failed');
  assert.equal(calls(e, 'implement').length, 2, 'original attempt plus exactly one correction');
  assert.match(calls(e, 'implement')[1].prompt, /correction attempt/);
  assert.equal(calls(e, 'review').length, 0);
});

test('malformed agent result does not mark work complete', () => {
  const e = setup();
  const id = approvedWorkOrder(e);
  script(e, { implement: [{ write: IMPL_DONE.write, text: 'All done, everything works!' }], executive: [EXEC_EMPTY] });
  qst(e, 'sweep');
  const m = wo(e, id);
  assert.equal(m.status, 'blocked');
  assert.match(m.outcome_summary, /rejected/);
  assert.equal(m.attempts[0].result_ok, false);
  assert.equal(calls(e, 'review').length, 0);
});

test('review findings get one correction, then a second rejection blocks with unresolved findings', () => {
  const e = setup();
  const id = approvedWorkOrder(e);
  const changes = { json: { verdict: 'changes', summary: 'no docs', findings: [{ severity: 'blocking', text: 'add a comment' }] } };
  script(e, { implement: [IMPL_DONE], review: [changes], executive: [EXEC_EMPTY] });
  qst(e, 'sweep');
  const m = wo(e, id);
  assert.equal(m.status, 'blocked');
  assert.equal(calls(e, 'review').length, 2);
  assert.match(calls(e, 'implement')[1].prompt, /add a comment/);
  assert.match(m.unresolved, /add a comment/);
});

test('architecture answers a routine question from approved guidance; the answer reaches the resumed implementer', () => {
  const e = setup();
  qst(e, 'ingest', 'guidance', '--topic', 'technical', '--text', 'Use plain CommonJS modules', '--source', 'test');
  const id = approvedWorkOrder(e);
  const ask = { json: { status: 'question', summary: 'need module style', question: { text: 'ESM or CommonJS?', evidence: 'repo uses require', requested_decision: 'module style', desk: 'architecture' } } };
  const answer = { json: { kind: 'interpretation', answer: 'CommonJS, per owner technical guidance', guidance_refs: ['owner/technical.md: Use plain CommonJS modules'] } };
  script(e, { implement: [ask, IMPL_DONE], architecture: [answer], review: [REVIEW_OK], executive: [EXEC_EMPTY] });
  qst(e, 'sweep');
  assert.equal(wo(e, id).status, 'ready-for-integration');
  assert.equal(calls(e, 'architecture').length, 1);
  assert.match(calls(e, 'architecture')[0].prompt, /ESM or CommonJS/);
  assert.match(calls(e, 'implement')[1].prompt, /CommonJS, per owner technical guidance/);
});

test('an architecture proposal stays a proposal: owner guidance unchanged, decision raised, work waits', () => {
  const e = setup();
  const id = approvedWorkOrder(e);
  const before = fs.readFileSync(`${e.desk}/owner/architecture.md`, 'utf8');
  const ask = { json: { status: 'question', summary: 'storage?', question: { text: 'SQLite or files?', requested_decision: 'storage', desk: 'architecture' } } };
  const proposal = { json: { kind: 'proposal', answer: 'Recommend SQLite for all family apps', guidance_refs: [], proposal: { change: 'Standardize on SQLite', reasons: 'one backup story' } } };
  script(e, { implement: [ask], architecture: [proposal], executive: [EXEC_EMPTY] });
  qst(e, 'sweep');
  assert.equal(fs.readFileSync(`${e.desk}/owner/architecture.md`, 'utf8'), before);
  const m = wo(e, id);
  assert.equal(m.status, 'waiting-answer');
  assert.match(qst(e, 'digest').out, /Standardize on SQLite/);
  assert.ok(fs.readdirSync(`${e.desk}/signals`).some((f) => fs.readFileSync(`${e.desk}/signals/${f}`, 'utf8').includes('"kind": "proposal"')));
  // Waiting on the owner is not actionable: no further agent spend.
  const n = calls(e).length;
  qst(e, 'sweep');
  assert.equal(calls(e).length, n);
});
