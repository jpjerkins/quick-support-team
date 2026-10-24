import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

const helper = pathToFileURL(path.resolve(import.meta.dirname, 'helpers.ts')).href;

for (const fail of [false, true]) {
  test(`setup temp directory is removed when child process exits${fail ? ' after failure' : ''}`, () => {
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', `
      const { setup } = await import(${JSON.stringify(helper)});
      const { root } = setup();
      console.log(root);
      if (${fail}) throw new Error('intentional test failure');
    `], { encoding: 'utf8' });
    const root = run.stdout.trim();
    assert.equal(path.dirname(root), os.tmpdir());
    assert.match(path.basename(root), /^qst-test-/);
    assert.equal(fs.existsSync(root), false, 'setup temp directory remains after child process exit');
    assert.equal(run.status, fail ? 1 : 0);
  });
}
