import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('chief of staff verifies claims and offers no-code options before work orders', () => {
  const skill = fs.readFileSync('skills/chief-of-staff/SKILL.md', 'utf8');
  const sharedRules = skill.slice(0, skill.indexOf('## Interactive session with Phil'));

  assert.match(sharedRules, /before recommending, verify claims against the code or desk, and recheck any sweep diagnosis/i);
  assert.match(sharedRules, /before proposing a work order, offer a no-code option/i);
});
