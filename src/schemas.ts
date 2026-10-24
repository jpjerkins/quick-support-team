// Shape checks for agent results. An agent's claim is adopted only if it passes.
type Errors = string[];

const isStr = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
const oneOf = (v: unknown, xs: string[]) => typeof v === 'string' && xs.includes(v);
const strArr = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string');

export function checkImplement(r: any): Errors {
  if (!r || typeof r !== 'object') return ['no JSON result'];
  const e: Errors = [];
  if (!oneOf(r.status, ['done', 'question', 'blocked'])) e.push('status must be done|question|blocked');
  if (!isStr(r.summary)) e.push('summary required');
  if (r.status === 'question') {
    const q = r.question ?? {};
    if (!isStr(q.text)) e.push('question.text required');
    if (!isStr(q.requested_decision)) e.push('question.requested_decision required');
    if (!oneOf(q.desk, ['architecture', 'chief-of-staff'])) e.push('question.desk must be architecture|chief-of-staff');
  }
  return e;
}

export function checkResearchImplement(r: any, acceptance: string[]): Errors {
  const e = checkImplement(r);
  if (r?.status === 'done') {
    if (!Array.isArray(r.evidence) || acceptance.some((criterion) => !r.evidence.some((x: any) => x?.criterion === criterion && isStr(x?.citation) && isStr(x?.finding ?? x?.excerpt)))) {
      e.push('evidence must cite a finding for every acceptance criterion');
    }
  }
  return e;
}

export function checkReview(r: any): Errors {
  if (!r || typeof r !== 'object') return ['no JSON result'];
  const e: Errors = [];
  if (!oneOf(r.verdict, ['approve', 'changes'])) e.push('verdict must be approve|changes');
  if (!isStr(r.summary)) e.push('summary required');
  if (!Array.isArray(r.findings) || !r.findings.every((f: any) => oneOf(f?.severity, ['blocking', 'minor']) && isStr(f?.text))) {
    e.push('findings must be [{severity: blocking|minor, text}]');
  }
  if (r.verdict === 'approve' && r.findings?.some?.((f: any) => f.severity === 'blocking')) e.push('approve with blocking findings');
  return e;
}

export function checkResearchReview(r: any, acceptance: string[]): Errors {
  const e = checkReview(r);
  if (!Array.isArray(r?.assessments) || acceptance.some((criterion) => !r.assessments.some((x: any) => x?.criterion === criterion && isStr(x?.evidence) && oneOf(x?.result, ['met', 'unmet'])))) {
    e.push('assessments must cite evidence and decide every acceptance criterion');
  }
  if (r?.verdict === 'approve' && r.assessments?.some?.((x: any) => x.result !== 'met')) e.push('approve requires every research criterion to be met');
  return e;
}

export function checkArchitecture(r: any): Errors {
  if (!r || typeof r !== 'object') return ['no JSON result'];
  const e: Errors = [];
  if (!oneOf(r.kind, ['interpretation', 'needs-evidence', 'proposal'])) e.push('kind must be interpretation|needs-evidence|proposal');
  if (!isStr(r.answer)) e.push('answer required');
  if (!strArr(r.guidance_refs)) e.push('guidance_refs must be a list of strings');
  if (r.kind === 'interpretation' && !r.guidance_refs?.length) e.push('an interpretation must cite guidance');
  if (r.kind === 'proposal' && (!isStr(r.proposal?.change) || !isStr(r.proposal?.reasons))) e.push('proposal.change and proposal.reasons required');
  return e;
}

export function checkDecision(d: any): Errors {
  const e: Errors = [];
  for (const k of ['title', 'why', 'recommendation', 'tradeoff']) if (!isStr(d?.[k])) e.push(`decision.${k} required`);
  if (![1, 2, 3].includes(d?.priority)) e.push('decision.priority must be 1|2|3');
  if (d?.deadline != null && Number.isNaN(Date.parse(d.deadline))) e.push('decision.deadline must be a date or null');
  return e;
}

export function checkExecutive(r: any): Errors {
  if (!r || typeof r !== 'object') return ['no JSON result'];
  const e: Errors = [];
  for (const k of ['answers', 'decisions', 'workorders']) if (!Array.isArray(r[k])) e.push(`${k} must be a list`);
  if (!isStr(r.notes)) e.push('notes required');
  for (const a of r.answers ?? []) {
    if (!isStr(a?.question)) e.push('answers[].question required');
    if (!isStr(a?.answer) && a?.route_to !== 'architecture') e.push('answers[].answer required unless route_to architecture');
  }
  for (const d of r.decisions ?? []) e.push(...checkDecision(d));
  for (const w of r.workorders ?? []) {
    if (!isStr(w?.project) || !isStr(w?.outcome) || !strArr(w?.acceptance) || !w.acceptance.length) e.push('workorders[] need project, outcome, acceptance[]');
    if (w?.summary != null && !isStr(w.summary)) e.push('workorders[].summary must be a non-empty string');
  }
  return e;
}
