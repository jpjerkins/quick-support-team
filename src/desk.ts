// Desk record store: Markdown files with JSON front matter, written atomically.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export type Meta = Record<string, any>;
export type Rec = { file: string; meta: Meta; body: string };

export const deskDir = () => process.env.QST_DESK ?? '/mnt/data/quick-support-team/desk';
export const p = (...parts: string[]) => path.join(deskDir(), ...parts);
export const installDir = () => path.resolve(import.meta.dirname, '..');

// QST_NOW lets tests pin the clock (protected windows, daily allowances).
export const now = () => (process.env.QST_NOW ? new Date(process.env.QST_NOW) : new Date());
export const iso = () => now().toISOString();

export function newId(prefix: string): string {
  const stamp = iso().replace(/[-:]/g, '').slice(0, 15);
  return `${prefix}-${stamp}-${crypto.randomBytes(2).toString('hex')}`;
}

export function writeAtomic(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

export function readRec(file: string): Rec | null {
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  if (!text.startsWith('---\n')) return { file, meta: {}, body: text };
  const end = text.indexOf('\n---\n', 4);
  if (end < 0) throw new Error(`unterminated front matter in ${file}`);
  return { file, meta: JSON.parse(text.slice(4, end)), body: text.slice(end + 5) };
}

export function writeRec(file: string, meta: Meta, body = ''): void {
  writeAtomic(file, `---\n${JSON.stringify(meta, null, 2)}\n---\n${body}`);
}

export function listRecs(dir: string): Rec[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort()
    .map((f) => readRec(path.join(dir, f))!);
}

export function appendJsonl(file: string, obj: Meta): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(obj) + '\n');
}

export function readJsonl(file: string): Meta[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

export function sha256File(file: string): string | null {
  if (!fs.existsSync(file)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);
}

export function readState(): Meta {
  const f = p('state.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
}

export function writeState(state: Meta): void {
  writeAtomic(p('state.json'), JSON.stringify(state, null, 2));
}

export function log(msg: string): void {
  const line = `${iso()} ${msg}`;
  fs.mkdirSync(p('logs'), { recursive: true });
  fs.appendFileSync(p('logs', `${iso().slice(0, 10)}.log`), line + '\n');
  console.log(msg);
}
