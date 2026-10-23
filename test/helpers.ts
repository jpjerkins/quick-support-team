// Test harness: a throwaway desk, a tiny git repo with real tests, and fixture agents.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
export const QST = path.join(ROOT, 'bin', 'qst');

export type Env = { root: string; desk: string; repo: string; env: NodeJS.ProcessEnv };

export const PERMISSIVE = {
  autonomous_enabled: true, max_launches_per_sweep: 10, sweep_max_minutes: 5, on_window_start: 'finish',
  providers: {
    claude: { launches_per_day: 50, max_minutes_per_run: 1, protected_windows: [] },
    codex: { launches_per_day: 50, max_minutes_per_run: 1, protected_windows: [] },
  },
};

export function setup(policy: object = PERMISSIVE): Env {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qst-test-'));
  const desk = path.join(root, 'desk');
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, 'add.js'), 'module.exports = (a, b) => a + b;\n');
  fs.writeFileSync(path.join(repo, 'test.js'), "const assert = require('assert');\nassert.strictEqual(require('./add.js')(2, 3), 5);\nif (require('fs').existsSync('./mul.js')) assert.strictEqual(require('./mul.js')(2, 3), 6);\nconsole.log('ok');\n");
  for (const args of [['init', '-q', '-b', 'main'], ['config', 'user.email', 't@example.com'], ['config', 'user.name', 'Test'], ['add', '-A'], ['commit', '-qm', 'init']]) {
    spawnSync('git', args, { cwd: repo });
  }
  const env = {
    ...process.env, QST_DESK: desk, QST_AGENT_HARNESS: 'fixture',
    QST_FIXTURE_AGENT: path.join(ROOT, 'test', 'fixtures', 'agent.ts'),
    QST_FIXTURE_SCRIPT: path.join(root, 'script.json'), QST_FIXTURE_LOG: path.join(root, 'agents.jsonl'),
  };
  const e = { root, desk, repo, env };
  qst(e, 'init');
  writeOwner(e, 'capacity.md', policy);
  writeOwner(e, 'routing.md', { roles: {
    implement: { provider: 'codex', model: 'implement' }, review: { provider: 'claude', model: 'review' },
    architecture: { provider: 'claude', model: 'architecture' }, executive: { provider: 'claude', model: 'executive' },
  } });
  script(e, {});
  return e;
}

export function writeOwner(e: Env, file: string, meta: object): void {
  fs.writeFileSync(path.join(e.desk, 'owner', file), `---\n${JSON.stringify(meta, null, 2)}\n---\ntest config\n`);
}

export function script(e: Env, s: object): void {
  fs.writeFileSync(e.env.QST_FIXTURE_SCRIPT!, JSON.stringify(s));
  fs.rmSync(`${e.env.QST_FIXTURE_SCRIPT}.state`, { force: true });
}

export function qst(e: Env, ...args: string[]): { code: number; out: string } {
  const r = spawnSync('bash', [QST, ...args], { env: e.env, encoding: 'utf8' });
  return { code: r.status ?? -1, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

export function qstAsync(e: Env, ...args: string[]) {
  return spawn('bash', [QST, ...args], { env: e.env, stdio: 'ignore' });
}

export function calls(e: Env, role?: string): any[] {
  const f = e.env.QST_FIXTURE_LOG!;
  const all = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  return role ? all.filter((c) => c.role === role) : all;
}

export function wo(e: Env, id: string): any {
  const t = fs.readFileSync(path.join(e.desk, 'work', id, 'workorder.md'), 'utf8');
  return JSON.parse(t.slice(4, t.indexOf('\n---\n', 4)));
}

export function files(e: Env, dir: string): string[] {
  const d = path.join(e.desk, dir);
  return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.md')) : [];
}

// Records a sample project and an approved work order; returns the work order id.
export function approvedWorkOrder(e: Env): string {
  qst(e, 'ingest', 'project', '--slug', 'tiny', '--name', 'Tiny', '--state', 'building', '--repo', e.repo, '--validate', 'node test.js', '--text', 'SAMPLE project', '--source', 'test');
  const id = qst(e, 'workorder', 'add', '--project', 'tiny', '--outcome', 'Add mul()', '--accept', 'mul(2,3) returns 6', '--source', 'test').out.trim();
  qst(e, 'ingest', 'decision', '--approve', id, '--text', 'approved', '--source', 'test');
  return id;
}

export const EXEC_EMPTY = { json: { answers: [], decisions: [], workorders: [], notes: 'nothing to add' } };
export const IMPL_DONE = { write: { 'mul.js': 'module.exports = (a, b) => a * b;\n' }, json: { status: 'done', summary: 'added mul' } };
export const IMPL_BROKEN = { write: { 'mul.js': 'module.exports = (a, b) => a + b;\n' }, json: { status: 'done', summary: 'added mul' } };
export const REVIEW_OK = { json: { verdict: 'approve', summary: 'meets criteria', findings: [] } };
