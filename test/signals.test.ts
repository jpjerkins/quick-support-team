import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setup, qst, files } from './helpers.ts';

test('signal categories stay distinguishable and attributed', () => {
  const e = setup();
  qst(e, 'ingest', 'project', '--slug', 'chores', '--state', 'live', '--text', 'SAMPLE: chore tracker in use', '--source', 'session 1');
  qst(e, 'ingest', 'guidance', '--topic', 'priorities', '--text', 'SAMPLE: finish chores before new apps', '--source', 'session 1');
  qst(e, 'ingest', 'decision', '--text', 'SAMPLE: no new projects this month', '--source', 'session 1');
  qst(e, 'ingest', 'proposal', '--text', 'SAMPLE: merge two apps', '--source', 'session 1', '--by', 'chief-of-staff');
  const kinds = files(e, 'signals').map((f) => JSON.parse(fs.readFileSync(`${e.desk}/signals/${f}`, 'utf8').split('\n---\n')[0].slice(4)));
  assert.deepEqual(kinds.map((k) => k.kind).sort(), ['decision', 'guidance', 'project', 'proposal']);
  assert.ok(kinds.every((k) => k.source && k.by && k.created));
  assert.match(fs.readFileSync(`${e.desk}/owner/priorities.md`, 'utf8'), /finish chores/);
  assert.doesNotMatch(fs.readFileSync(`${e.desk}/owner/architecture.md`, 'utf8'), /merge two apps/);
});

test('agents cannot record guidance or decisions as their own', () => {
  const e = setup();
  const r = qst(e, 'ingest', 'guidance', '--topic', 'technical', '--text', 'use Rust', '--source', 's', '--by', 'architecture-desk');
  assert.equal(r.code, 1);
  assert.match(r.out, /owner's own words/);
});

test('a Chief of Staff work-order proposal stays proposed and asks the owner for approval', async () => {
  const { script, calls, wo } = await import('./helpers.ts');
  const e = setup();
  qst(e, 'ingest', 'project', '--slug', 'tiny', '--repo', e.repo, '--validate', 'node test.js', '--text', 'SAMPLE', '--source', 'test');
  script(e, { executive: [{ json: { answers: [], decisions: [], workorders: [{ project: 'tiny', outcome: 'Add mul', acceptance: ['mul(2,3)=6'], why: 'finishes tiny' }], notes: 'n' } }] });
  qst(e, 'sweep');
  const id = fs.readdirSync(`${e.desk}/work`)[0];
  assert.equal(wo(e, id).status, 'proposed');
  assert.equal(calls(e, 'implement').length, 0);
  assert.match(qst(e, 'digest').out, new RegExp(`Approve work order ${id}`));
  assert.match(fs.readFileSync(`${e.desk}/decisions/${files(e, 'decisions')[0]}`, 'utf8'), /node test\.js/);
});
