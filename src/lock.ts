// Single-coordinator lock: an exclusive-create file holding the owner's pid.
import fs from 'node:fs';
import { p, iso } from './desk.ts';

export function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e: any) { return e.code === 'EPERM'; }
}

export function acquireLock(): (() => void) | null {
  const file = p('coordinator.lock');
  fs.mkdirSync(p(), { recursive: true });
  for (let tries = 0; tries < 2; tries++) {
    try {
      fs.writeFileSync(file, JSON.stringify({ pid: process.pid, started: iso() }), { flag: 'wx' });
      return () => fs.rmSync(file, { force: true });
    } catch (e: any) {
      if (e.code !== 'EEXIST') throw e;
      const holder = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (pidAlive(holder.pid)) return null;
      // Dead holder: keep its lock file as crash evidence, then retry once.
      fs.mkdirSync(p('logs'), { recursive: true });
      fs.renameSync(file, p('logs', `stale-lock-${holder.pid}.json`));
    }
  }
  return null;
}
