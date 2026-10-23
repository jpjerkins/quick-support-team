// Agent runner: one headless, time-limited agent invocation per call.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { p, readRec } from './desk.ts';

export type Route = { provider: string; model: string; harness: string };
export type Access = 'write' | 'read';

// Roles are routed by owner/routing.md. QST_AGENT_HARNESS=fixture swaps the
// harness for deterministic test agents while keeping provider accounting.
export function route(role: string, implementer?: { provider: string; model: string }): Route {
  if (role === 'implement' && implementer) return { ...implementer, harness: process.env.QST_AGENT_HARNESS ?? implementer.provider };
  const r = readRec(p('owner', 'routing.md'))?.meta?.roles?.[role];
  if (!r?.provider || !r?.model) throw new Error(`no route for role "${role}" in owner/routing.md`);
  return { provider: r.provider, model: r.model, harness: process.env.QST_AGENT_HARNESS ?? r.harness ?? r.provider };
}

const READ_TOOLS = ['Read', 'Grep', 'Glob', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)', 'Bash(git status:*)'];

export function command(r: Route, prompt: string, cwd: string, outDir: string, access: Access): { cmd: string; args: string[]; stdin?: string } {
  if (r.harness === 'claude') {
    const perms = access === 'write' ? ['--permission-mode', 'auto'] : ['--permission-mode', 'dontAsk', '--allowedTools', ...READ_TOOLS];
    return { cmd: 'claude', args: ['-p', prompt, '--model', r.model, '--output-format', 'json', ...perms] };
  }
  if (r.harness === 'codex') {
    return {
      cmd: 'codex',
      args: ['exec', '-m', r.model, '-C', cwd, '--json', '--skip-git-repo-check',
        '-s', access === 'write' ? 'workspace-write' : 'read-only', '-o', path.join(outDir, 'last-message.txt'), prompt],
    };
  }
  if (r.harness === 'fixture') {
    const agent = process.env.QST_FIXTURE_AGENT;
    if (!agent) throw new Error('QST_FIXTURE_AGENT not set');
    return { cmd: process.execPath, args: [agent, r.model], stdin: prompt };
  }
  throw new Error(`unsupported harness "${r.harness}"`);
}

export type RunResult = { exitCode: number | null; timedOut: boolean };

export function runAgent(opts: {
  route: Route; prompt: string; cwd: string; outDir: string; access: Access; timeoutMs: number; onSpawn: (pid: number) => void;
}): Promise<RunResult> {
  const { cmd, args, stdin } = command(opts.route, opts.prompt, opts.cwd, opts.outDir, opts.access);
  fs.mkdirSync(opts.outDir, { recursive: true });
  fs.writeFileSync(path.join(opts.outDir, 'prompt.txt'), opts.prompt);
  const out = fs.openSync(path.join(opts.outDir, 'stdout'), 'w');
  const err = fs.openSync(path.join(opts.outDir, 'stderr'), 'w');
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, stdio: ['pipe', out, err] });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 10_000).unref();
    }, opts.timeoutMs);
    child.on('spawn', () => opts.onSpawn(child.pid!));
    child.stdin.on('error', () => {});
    child.stdin.end(stdin ?? '');
    child.on('error', (e) => { fs.writeSync(err, String(e)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      fs.closeSync(out); fs.closeSync(err);
      resolve({ exitCode: code, timedOut });
    });
  });
}

// Reads what an agent left in its output directory; works after a coordinator crash too.
export function collect(harness: string, outDir: string): { text: string; usage: unknown } {
  const read = (f: string) => (fs.existsSync(path.join(outDir, f)) ? fs.readFileSync(path.join(outDir, f), 'utf8') : '');
  const stdout = read('stdout');
  if (harness === 'claude') {
    try {
      const j = JSON.parse(stdout);
      return { text: j.result ?? '', usage: { usage: j.usage, modelUsage: j.modelUsage, num_turns: j.num_turns } };
    } catch { return { text: '', usage: null }; }
  }
  if (harness === 'codex') {
    const usageLine = stdout.split('\n').reverse().find((l) => l.includes('"usage"'));
    let usage = null;
    try { usage = usageLine ? JSON.parse(usageLine) : null; } catch { /* keep null */ }
    return { text: read('last-message.txt'), usage };
  }
  return { text: stdout, usage: null };
}

// Agents end with a JSON object, ideally in a ```json fence; take the last one.
export function parseResult(text: string): any | null {
  const fences = [...text.matchAll(/```json\s*\n([\s\S]*?)```/g)];
  const candidate = fences.length ? fences[fences.length - 1][1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try { return candidate ? JSON.parse(candidate) : null; } catch { return null; }
}
