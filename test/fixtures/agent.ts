// Deterministic fixture agent: replays scripted replies per role, logs every invocation.
// argv[2] is the routed "model", which test routing sets to the role name.
import fs from 'node:fs';
import path from 'node:path';

const role = process.argv[2];
const prompt = fs.readFileSync(0, 'utf8');
const scriptFile = process.env.QST_FIXTURE_SCRIPT!;
const script = JSON.parse(fs.readFileSync(scriptFile, 'utf8'));
const stateFile = `${scriptFile}.state`;
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
const i = state[role] ?? 0;
state[role] = i + 1;
fs.writeFileSync(stateFile, JSON.stringify(state));
fs.appendFileSync(process.env.QST_FIXTURE_LOG!, JSON.stringify({ role, i, pid: process.pid, cwd: process.cwd(), prompt }) + '\n');

const steps = script[role] ?? [];
const step = steps[Math.min(i, steps.length - 1)] ?? { text: 'no script for this role' };
for (const [f, c] of Object.entries(step.write ?? {})) fs.writeFileSync(path.join(process.cwd(), f), c as string);
if (step.sleep_ms) await new Promise((r) => setTimeout(r, step.sleep_ms));
process.stdout.write(step.text ?? 'Done.\n```json\n' + JSON.stringify(step.json) + '\n```\n');
process.exit(step.exit ?? 0);
