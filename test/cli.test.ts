import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { setup, qst, wo } from './helpers.ts';
import { interactiveCommand } from '../src/agents.ts';

test('bare qst prints help for every command', () => {
  const e = setup();
  const result = qst(e);

  assert.equal(result.code, 0);
  for (const command of ['init', 'ingest', 'workorder', 'sweep', 'status', 'digest', 'reconcile', 'capacity', 'open', 'help']) {
    assert.match(result.out, new RegExp(`qst ${command}\\b`));
  }
});

test('interactive command uses the routed CLI, model, and initial instruction', () => {
  const prompt = 'Read and follow /skills/chief-of-staff/SKILL.md (interactive session with Phil). Desk: /desk. Start by reading /desk/digest.md.';
  assert.deepEqual(interactiveCommand({ provider: 'claude', model: 'opus', harness: 'claude' }, prompt), {
    cmd: 'claude', args: ['--model', 'opus', prompt],
  });
  assert.deepEqual(interactiveCommand({ provider: 'codex', model: 'gpt-6-sol', harness: 'codex' }, prompt), {
    cmd: 'codex', args: ['-m', 'gpt-6-sol', prompt],
  });
});

test('qst open rejects unknown roles with usage', () => {
  const e = setup();
  const result = qst(e, 'open', 'unknown');
  assert.notEqual(result.code, 0);
  assert.match(result.out, /usage: qst open chief-of-staff\|architecture/);
});

test('qst open runs the routed interactive CLI in the desk and returns its exit code', () => {
  const e = setup();
  const bin = path.join(e.root, 'bin');
  fs.mkdirSync(bin);
  const capture = path.join(e.root, 'agent-call.txt');
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\nprintf '%s\\n%s\\n' "$PWD" "$*" > '${capture}'\necho interactive-output\nexit 7\n`);
  fs.chmodSync(path.join(bin, 'claude'), 0o755);
  delete e.env.QST_AGENT_HARNESS;
  delete e.env.HERDR_ENV;
  e.env.PATH = `${bin}:${e.env.PATH}`;

  const result = qst(e, 'open', 'chief-of-staff');
  assert.equal(result.code, 7);
  assert.match(result.out, /interactive-output/);
  const [cwd, args] = fs.readFileSync(capture, 'utf8').trim().split('\n');
  assert.equal(cwd, e.desk);
  assert.match(args, /^--model executive Read and follow .*chief-of-staff.*Desk: .*Start by reading .*digest\.md\.$/);
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
