import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setup, qst } from './helpers.ts';

test('status and digest render every in-flight work order and blocked decisions as compact tables', () => {
  const e = setup();
  qst(e, 'ingest', 'project', '--slug', 'tiny', '--repo', e.repo, '--validate', 'node test.js', '--text', 'SAMPLE', '--source', 'test');
  const proposed = qst(e, 'workorder', 'add', '--project', 'tiny', '--outcome', 'Proposed outcome. More detail.', '--summary', 'Short proposal', '--accept', 'works', '--source', 'test').out.trim();
  const fallback = qst(e, 'workorder', 'add', '--project', 'tiny', '--outcome', `${'Fallback sentence '.repeat(10)}. More detail.`, '--accept', 'works', '--source', 'test').out.trim();
  const blocked = qst(e, 'workorder', 'add', '--project', 'tiny', '--outcome', 'Blocked outcome.', '--accept', 'works', '--source', 'test').out.trim();
  const blockedFile = `${e.desk}/work/${blocked}/workorder.md`;
  const blockedText = fs.readFileSync(blockedFile, 'utf8');
  fs.writeFileSync(blockedFile, blockedText.replace('"status": "proposed"', '"status": "blocked"'));
  const blockedSlug = JSON.parse(blockedText.slice(4, blockedText.indexOf('\n---\n', 4))).slug;
  fs.mkdirSync(`${e.desk}/decisions`, { recursive: true });
  fs.writeFileSync(`${e.desk}/decisions/D-test.md`, `---\n${JSON.stringify({ id: 'D-test', status: 'open', priority: 1, blocks: [blocked], deadline: null, raised: '2026-01-01' })}\n---\n# Need an owner choice for ${blocked}\n\n**Recommendation:** Choose one\n`);

  for (const command of ['status', 'digest']) {
    const output = qst(e, command).out;
    const workTable = output.split('## Work orders')[1]?.split('\n## ')[0] ?? '';
    const decisionsTable = output.split('## Decisions')[1]?.split('\n## ')[0] ?? '';
    assert.match(workTable, /\| blocked \|/);
    assert.match(workTable, /\| proposed \|/);
    assert.match(workTable, /Short proposal/);
    assert.match(workTable, /Blocked outcome\./);
    assert.ok(workTable.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('|---')).some((line) => line.includes('Fallback sentence')));
    const rows = workTable.split('\n').filter((line) => line.startsWith('| ') && !line.includes('Status |') && !line.startsWith('|---'));
    assert.equal(rows.length, 3);
    assert.ok(rows.every((line) => line.split('|')[4].trim().length <= 80));
    assert.doesNotMatch(`${workTable}\n${decisionsTable}`, /\b(?:WO|D|S)-[A-Z0-9-]+/);
    assert.ok(workTable.split('\n').filter((line) => line.startsWith('|')).every((line) => line.split('|').length === 6));
    assert.match(decisionsTable, /Need an owner choice/);
    assert.match(decisionsTable, new RegExp(`\\| ${blockedSlug} \\|`));
    assert.match(output, /## Capacity/);
    assert.match(output, /Detailed logs:/);
  }
});
