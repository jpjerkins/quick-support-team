import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setup, qst } from './helpers.ts';

test('bare qst prints help for every command', () => {
  const e = setup();
  const result = qst(e);

  assert.equal(result.code, 0);
  for (const command of ['init', 'ingest', 'workorder', 'sweep', 'status', 'digest', 'reconcile', 'capacity', 'open', 'help']) {
    assert.match(result.out, new RegExp(`qst ${command}\\b`));
  }
});
