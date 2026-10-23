import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setup, qst, wo } from './helpers.ts';

test('bare qst prints help for every command', () => {
  const e = setup();
  const result = qst(e);

  assert.equal(result.code, 0);
  for (const command of ['init', 'ingest', 'workorder', 'sweep', 'status', 'digest', 'reconcile', 'capacity', 'open', 'help']) {
    assert.match(result.out, new RegExp(`qst ${command}\\b`));
  }
});

test('work order add records a validated implementer override', () => {
  const e = setup();
  qst(e, 'ingest', 'project', '--slug', 'tiny', '--name', 'Tiny', '--state', 'building', '--repo', e.repo, '--validate', 'node test.js', '--text', 'SAMPLE project', '--source', 'test');
  const args = ['workorder', 'add', '--project', 'tiny', '--outcome', 'Change it', '--accept', 'works', '--source', 'test'];
  assert.notEqual(qst(e, ...args, '--implementer', 'vendor:model').code, 0);
  assert.notEqual(qst(e, ...args, '--implementer', 'claude:').code, 0);
  const id = qst(e, ...args, '--implementer', 'claude:sonnet').out.trim();
  assert.deepEqual(wo(e, id).implementer, { provider: 'claude', model: 'sonnet' });
  assert.match(qst(e, 'help').out, /--implementer claude\|codex:MODEL/);
});
