#!/usr/bin/env node
/**
 * Reads the `issues/` directory (one file per issue) and prints the lists
 * that the issue process uses, or edits one file. The process, the header
 * fields and the priority table are described in `docs/ISSUE_TRACKING.md`.
 *
 *   node scripts/issues.mjs lint                  checks every file (exit 1 on an error)
 *   node scripts/issues.mjs board                 the board's list
 *   node scripts/issues.mjs backlog               the agents' list
 *   node scripts/issues.mjs in-progress           owner, start date and days
 *   node scripts/issues.mjs show <id>             prints one issue file
 *   node scripts/issues.mjs release <version>     the items of a release (exit 1 while one is open)
 *   node scripts/issues.mjs set <id> <field> <v>  changes one header field (`today` is a date value)
 *   node scripts/issues.mjs flag <id> +f | -f     adds or removes one flag
 *   node scripts/issues.mjs start <id> <owner>    sets in-progress, owner and the start date
 *   node scripts/issues.mjs new                   creates the next file from the template, prints its path
 *   node scripts/issues.mjs close <id> <reason…>  removes the file, one line to CLOSED.md
 *   node scripts/issues.mjs close --all           the same for every `state: close` file
 *
 * Options: `--dir <path>` (default `issues/` in the MAIN worktree, so that a
 * linked worktree reads and edits the same files as every other session),
 * `--today <yyyy-mm-dd>` (for tests), `--json` (lists as JSON).
 *
 * The header is a subset of YAML: `key: value`, a list as `[a, b]`, a comment
 * after two or more spaces and `#` (so that `GitHub #12` stays a value).
 * Nothing else is parsed. The script has no dependency.
 *
 * The module also exports its reading and editing functions, so that
 * `scripts/issues-ui.mjs` (the board's web page) writes the files through the
 * same checks. The command line runs only when this file is executed. An
 * importer calls `configure()` to set the directory and the date; a refused
 * edit throws an `IssueError` instead of ending the process.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

/** The main worktree: a linked worktree's `--git-common-dir` is the main `.git`. */
function mainRoot() {
  try {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: SCRIPT_ROOT,
      encoding: 'utf8',
    }).trim();
    return path.dirname(path.resolve(SCRIPT_ROOT, common));
  } catch {
    return SCRIPT_ROOT;
  }
}
const ROOT = mainRoot();

const STATES = [
  'open',
  'investigate',
  'needs-design',
  'needs-decision',
  'in-progress',
  'fixed',
  'close',
];
const PRIORITIES = ['P0', 'P1', 'P2', 'P3', 'P4'];
const FLAGS = ['needs-review', 'regression', 'blocker', 'workaround'];
const KINDS = [
  'wrong-value',
  'error',
  'decline',
  'hang',
  'performance',
  'request',
  'design',
  'documentation',
];
const IMPACTS = ['critical', 'major', 'minor', 'confidence'];
const PROBABILITIES = ['high', 'medium', 'low'];
const WITNESSES = ['corpus', 'plausible', 'crafted'];
const SOURCES = ['tycho', 'github', 'agent', 'user'];
const SIZES = ['S', 'M', 'L'];
const REQUIRED = [
  'id',
  'state',
  'priority',
  'kind',
  'impact',
  'probability',
  'source',
  'size',
  'opened',
];
const DATE_FIELDS = ['opened', 'started', 'updated', 'confirmed', 'reviewed'];
const KNOWN = [
  ...REQUIRED,
  'flags',
  'witness',
  'source-ref',
  'instrument',
  'release',
  'owner',
  'started',
  'updated',
  'confirmed',
  'reviewed',
  'fixed-in',
  'close-reason',
  'ask',
];
const ENUMS = {
  state: STATES,
  priority: PRIORITIES,
  kind: KINDS,
  impact: IMPACTS,
  probability: PROBABILITIES,
  witness: WITNESSES,
  source: SOURCES,
  size: SIZES,
};

/** The priority table: impact, then probability high, medium, low. */
const TABLE = {
  critical: ['P1', 'P2', 'P3'],
  major: ['P2', 'P3', 'P4'],
  minor: ['P3', 'P4', 'P4'],
  confidence: ['P2', 'P3', 'P4'],
};
const BODY_WORD_CAP = 500;
const IN_PROGRESS_DAYS = 3;
const AGE_DAYS = 60;
const ANSWER_DAYS = 1;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const NEXT_FILE = 'NEXT.md';
const TYCHO_ROOT = path.resolve(ROOT, '..', 'tycho');

// ---------------------------------------------------------------------------
// Options and errors

/**
 * The directory of the issue files, the date that `today` means, and whether
 * the lists print as JSON. The command line sets them from its arguments; an
 * importer sets them with `configure()`.
 */
const opts = { dir: path.join(ROOT, 'issues'), json: false };
let TODAY = localDate();

/**
 * Sets the directory and the date for the next calls. Without `today`, the
 * date is the local date at the time of the call, so that a server that runs
 * past midnight writes the new date.
 */
export function configure({ dir, today } = {}) {
  opts.dir = dir ? path.resolve(dir) : path.join(ROOT, 'issues');
  TODAY = today ?? localDate();
  if (!validDate(TODAY))
    throw new IssueError(`today must be yyyy-mm-dd, not ${TODAY}`);
}

/** The date that `today` means for the current calls. */
export function today() {
  return TODAY;
}

/** The directory of the issue files for the current calls. */
export function issuesDir() {
  return opts.dir;
}

/**
 * `ROOT` is the main worktree, where `issues/`, `ROADMAP.md` and the git
 * index are. The lists are the values that the header fields admit.
 */
export { ROOT, STATES, PRIORITIES, FLAGS, VERSION_RE };

/** A refused command or edit. The command line prints `issues: <message>` and exits with 1. */
export class IssueError extends Error {}

/**
 * A command line that is not valid. The command line prints the message and
 * the usage line; an importer catches it as an `IssueError`.
 */
class UsageError extends IssueError {}

function localDate() {
  // 'sv' formats a date as yyyy-mm-dd, in the local time zone.
  return new Date().toLocaleDateString('sv');
}

/** A real calendar date in the form yyyy-mm-dd. */
function validDate(v) {
  if (!DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Compares two versions x.y.z numerically. */
export function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

const USAGE =
  'usage: node scripts/issues.mjs lint | board | backlog | in-progress | show <id> | release <version> | set <id> <field> <value> | flag <id> +f|-f | start <id> <owner> | new | close <id> <reason…> | close --all   [--dir <path>] [--today <date>] [--json]';

function usage(msg) {
  throw new UsageError(msg ?? '');
}

function fail(msg) {
  throw new IssueError(msg);
}

// ---------------------------------------------------------------------------
// Reading

/** Splits a file into the header fields and the body. */
function parseFile(file) {
  return parseText(fs.readFileSync(file, 'utf8'));
}

/**
 * Splits the text of an issue file into the header fields and the body. The
 * web app uses it for the text of a file that a commit deleted, which
 * `git show` gives.
 */
export function parseText(source) {
  const text = source.replace(/\r/g, '');
  const lines = text.split('\n');
  const errors = [];
  if (lines[0] !== '---')
    return {
      fields: {},
      body: text,
      errors: ['no header: the file must start with `---`'],
    };
  const end = lines.indexOf('---', 1);
  if (end < 0)
    return {
      fields: {},
      body: text,
      errors: ['no header end: a second `---` line is missing'],
    };
  const fields = {};
  for (let i = 1; i < end; i++) {
    const raw = lines[i];
    const line = raw.replace(/\s{2,}#.*$/, '').trim();
    if (!line) continue;
    const m = /^([a-z][a-z-]*):\s*(.*)$/.exec(line);
    if (!m) {
      errors.push(`header line ${i + 1} is not \`key: value\`: ${raw}`);
      continue;
    }
    const [, key, value] = m;
    if (key in fields) errors.push(`field \`${key}\` is repeated`);
    if (key === 'flags') {
      fields[key] = value
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else fields[key] = value;
  }
  return { fields, body: lines.slice(end + 1).join('\n'), errors };
}

/** Counts the words of a body outside fenced code blocks and outside the `## CE answer` and `## Decision` sections. */
function bodyWords(body) {
  let inCode = false;
  let inAnswer = false;
  let n = 0;
  for (const line of body.split('\n')) {
    if (/^\s*```/.test(line)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    if (/^## /.test(line)) inAnswer = /^## (CE answer|Decision)/i.test(line);
    if (!inAnswer) n += line.split(/\s+/).filter(Boolean).length;
  }
  return n;
}

/** The first line of the body that is not empty: what the user sees. */
export function firstBodyLine(body) {
  return body.split('\n').find((l) => l.trim()) ?? '';
}

/** A `## CE answer` section with at least one `CE (<date>): …` line. */
function hasAnswer(body) {
  const start = body.search(/^## CE answer/im);
  if (start < 0) return false;
  const rest = body.slice(start).split('\n').slice(1);
  const end = rest.findIndex((l) => /^## /.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).some((l) =>
    /^CE \(\d{4}-\d{2}-\d{2}\):/.test(l)
  );
}

/** The longest witness text that a line of `CLOSED.md` holds, in characters. */
const WITNESS_MAX = 300;

/**
 * The witness of an issue for its line in `CLOSED.md`, on one line, as
 * Markdown. The first fenced code block of the `## Witness` section is the
 * program, and it is given as inline code. A section with no fenced block
 * describes its witness in prose (`Chain of Tycho row 453 at depth 3: the
 * \`any\` version went from 17 to 7 129`), so its first paragraph is given as
 * it is written: an inline code span of that prose is often one word, and
 * alone it is not a witness. A text longer than `WITNESS_MAX` is cut at a
 * space and ends with "…". When the cut leaves a code span of the prose
 * open (an odd number of backticks), the text ends before that span.
 */
function witnessSummary(body) {
  const start = body.search(/^## Witness/m);
  let section = body;
  if (start >= 0) {
    const rest = body.slice(start).replace(/^## Witness[^\n]*\n?/, '');
    const next = rest.search(/^## /m);
    section = next >= 0 ? rest.slice(0, next) : rest;
  }
  const oneLine = (s) => s.trim().replace(/\s+/g, ' ');
  const cut = (s) => {
    if (s.length <= WITNESS_MAX) return s;
    const head = s.slice(0, WITNESS_MAX);
    const space = head.lastIndexOf(' ');
    let kept = space > 0 ? head.slice(0, space) : head;
    if ((kept.match(/`/g) ?? []).length % 2 === 1)
      kept = kept.slice(0, kept.lastIndexOf('`')).trimEnd();
    return `${kept}…`;
  };
  const fenced = /```[^\n]*\n([\s\S]*?)```/.exec(section);
  if (fenced) {
    const code = cut(oneLine(fenced[1]));
    return code ? `\`${code}\`` : '';
  }
  const paragraph = section.trim().split(/\n\s*\n/)[0] ?? '';
  return cut(oneLine(paragraph));
}

/** The priority the table gives, with the flag adjustments. Never P0. */
function tablePriority(f) {
  const row = TABLE[f.impact];
  const col = PROBABILITIES.indexOf(f.probability);
  if (!row || col < 0) return null;
  let p = PRIORITIES.indexOf(row[col]);
  const flags = f.flags ?? [];
  if (flags.includes('regression')) p--;
  if (flags.includes('blocker') && !flags.includes('workaround')) p--;
  return PRIORITIES[Math.max(1, p)];
}

function daysBetween(from, to) {
  return Math.floor((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

function check(errors, f, key) {
  const allowed = ENUMS[key];
  if (f[key] !== undefined && f[key] !== '' && !allowed.includes(f[key])) {
    errors.push(`\`${key}: ${f[key]}\` is not one of ${allowed.join(', ')}`);
  }
}

function idNumber(id) {
  const m = /^CE-(\d+)$/.exec(id ?? '');
  return m ? Number(m[1]) : null;
}

/** Every issue file of the directory, with its lint errors and warnings. */
export function loadAll() {
  if (!fs.existsSync(opts.dir)) fail(`no directory ${opts.dir}`);
  const names = fs.readdirSync(opts.dir);
  const files = names
    .filter((n) => /^CE-\d+\.md$/.test(n))
    .sort((a, b) => idNumber(a.slice(0, -3)) - idNumber(b.slice(0, -3)));
  const strays = names.filter(
    (n) =>
      !/^CE-\d+\.md$/.test(n) &&
      !['README.md', 'CLOSED.md', NEXT_FILE, '.DS_Store'].includes(n)
  );
  return { issues: files.map(checkFile), strays };
}

/**
 * Reads one issue file (`CE-<n>.md` in the directory) and checks it: the
 * fields, the body, and the errors and warnings that `lint` prints for it.
 * The checks of the whole directory (`NEXT.md`, a repeated id, a stray file)
 * are in `lint()`.
 */
export function checkFile(name) {
  const file = path.join(opts.dir, name);
  const parsed = parseFile(file);
  const f = parsed.fields;
  const errors = [...parsed.errors];
  const warnings = [];
  for (const k of REQUIRED)
    if (!(k in f) || f[k] === '') errors.push(`missing field \`${k}\``);
  for (const k of Object.keys(f))
    if (!KNOWN.includes(k)) errors.push(`unknown field \`${k}\``);
  if (f.id && f.id !== name.slice(0, -3))
    errors.push(`id \`${f.id}\` does not match the file name`);
  for (const k of Object.keys(ENUMS)) check(errors, f, k);
  for (const fl of f.flags ?? [])
    if (!FLAGS.includes(fl)) errors.push(`unknown flag \`${fl}\``);
  for (const k of DATE_FIELDS)
    if (f[k] && !validDate(f[k]))
      errors.push(`\`${k}\` is not a date yyyy-mm-dd`);
  if (f.release && !VERSION_RE.test(f.release))
    errors.push('`release` is a version x.y.z');
  const flags = f.flags ?? [];
  if (f.state === 'in-progress' && !(f.owner && f.started))
    errors.push('`in-progress` needs `owner` and `started`');
  if (f.state === 'fixed' && !f['fixed-in'])
    errors.push('`fixed` needs `fixed-in` (the commit or the release)');
  // The Progress tab of the web app (`inRelease()` in issues-ui.mjs) tells
  // whether a fix is in a release only from a version or a commit hash, so
  // free text such as "the next release" would show the fix as unreleased.
  if (
    f['fixed-in'] &&
    !VERSION_RE.test(String(f['fixed-in']).replace(/^v(?=\d)/, '')) &&
    !/^[0-9a-f]{7,40}$/i.test(String(f['fixed-in']))
  )
    errors.push('`fixed-in` is a version x.y.z or a commit hash');
  if (f.state === 'fixed' && f.source !== 'tycho')
    errors.push(
      '`fixed` is only for `source: tycho`; a fixed issue of another source is deleted with its fix'
    );
  if (f.state !== 'fixed' && f['fixed-in'])
    errors.push(
      '`fixed-in` is set only with `state: fixed`; a reopened issue clears it'
    );
  if (f.state === 'close' && !f['close-reason'])
    errors.push('`close` needs `close-reason`');
  if (
    (flags.includes('needs-review') ||
      ['needs-decision', 'needs-design'].includes(f.state)) &&
    !f.ask
  )
    errors.push(
      '`ask` is required on a needs-review, needs-decision or needs-design item: one sentence that says what the board must do'
    );
  if (f.priority === 'P0' && !flags.includes('needs-review') && !f.confirmed)
    errors.push(
      'a P0 needs `needs-review` (proposed) or `confirmed` (set by the board)'
    );
  if (f.priority === 'P0' && flags.includes('needs-review') && f.confirmed)
    errors.push('a confirmed P0 has no `needs-review`');
  if (f.source === 'tycho') {
    if (!f.instrument) errors.push('a Tycho issue names its instrument');
    else if (!fs.existsSync(path.join(TYCHO_ROOT, f.instrument)))
      warnings.push(
        `instrument not found at ${path.join(TYCHO_ROOT, f.instrument)}`
      );
  } else if (f.source && !f.witness)
    errors.push('a Compute Engine issue names its witness');
  const first = firstBodyLine(parsed.body);
  if (!first)
    errors.push(
      'the body is empty: the first line is one sentence of user impact'
    );
  else if (/^#/.test(first))
    errors.push('the first body line must be a sentence, not a heading');
  const words = bodyWords(parsed.body);
  if (words > BODY_WORD_CAP)
    errors.push(
      `body has ${words} words outside code blocks and the CE answer; the cap is ${BODY_WORD_CAP}`
    );
  const table = tablePriority(f);
  if (
    table &&
    f.priority &&
    f.priority !== 'P0' &&
    f.priority !== table &&
    !f.reviewed
  ) {
    warnings.push(
      `priority ${f.priority} differs from the table value ${table} (the board records its decision with \`reviewed\`)`
    );
  }
  return {
    name,
    file,
    fields: f,
    body: parsed.body,
    title: first,
    words,
    table,
    errors,
    warnings,
  };
}

/** The issues without lint errors, and the names of the files left out. */
export function clean(all) {
  return {
    issues: all.issues.filter((i) => !i.errors.length),
    leftOut: all.issues.filter((i) => i.errors.length).map((i) => i.name),
  };
}

/** Prints the line that names the files a list leaves out (not in JSON). */
function printLeftOut(leftOut) {
  if (leftOut.length && !opts.json)
    console.log(
      `${leftOut.length} file(s) with errors left out (run lint): ${leftOut.join(', ')}`
    );
}

/** Whether a commit since `since` names exactly this issue. */
function hasCommitSince(id, since) {
  try {
    const out = execFileSync(
      'git',
      [
        'log',
        '--oneline',
        `--since=${since}T00:00:00`,
        '-E',
        `--grep=(^|[^0-9A-Za-z-])${id}(\\.?([^0-9.]|$))`,
      ],
      { cwd: ROOT, encoding: 'utf8' }
    );
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

function readNext() {
  const p = path.join(opts.dir, NEXT_FILE);
  if (!fs.existsSync(p)) return null;
  const n = Number(fs.readFileSync(p, 'utf8').trim().replace(/^CE-/, ''));
  return Number.isInteger(n) ? n : null;
}

/** The highest `CE-<n>` named in CLOSED.md: a closed number is never reused. */
function closedMax() {
  const p = path.join(opts.dir, 'CLOSED.md');
  if (!fs.existsSync(p)) return 0;
  const ids = [...fs.readFileSync(p, 'utf8').matchAll(/^- CE-(\d+) /gm)].map(
    (m) => Number(m[1])
  );
  return Math.max(0, ...ids);
}

/** The highest `### CE-<n>` heading of ROADMAP.md, which shares the counter. */
function roadmapMax() {
  const p = path.join(ROOT, 'ROADMAP.md');
  if (!fs.existsSync(p)) return 0;
  const ids = [...fs.readFileSync(p, 'utf8').matchAll(/^### CE-(\d+)\./gm)].map(
    (m) => Number(m[1])
  );
  return Math.max(0, ...ids);
}

// ---------------------------------------------------------------------------
// Lists

const HEADER =
  '| id | P | state | size | source | flags | opened | what the user sees |\n| --- | --- | --- | --- | --- | --- | --- | --- |';

function row(i, extra = '', withAsk = false) {
  const f = i.fields;
  const flags = (f.flags ?? []).join(',');
  const ask = withAsk ? ` ${f.ask ?? '(no ask line)'} |` : '';
  return `| ${f.id} | ${f.priority} | ${f.state} | ${f.size} | ${f.source}${f['source-ref'] ? ` (${f['source-ref']})` : ''} | ${flags} | ${f.opened} | ${i.title}${extra ? ` **${extra}**` : ''} |${ask}`;
}

function printList(title, items, withAsk = false) {
  console.log(`\n## ${title} (${items.length})\n`);
  if (items.length === 0) {
    console.log('none');
    return;
  }
  console.log(
    withAsk
      ? `${HEADER.split('\n')[0]} what the board must do |\n${HEADER.split('\n')[1]} --- |`
      : HEADER
  );
  for (const [i, extra] of items) console.log(row(i, extra, withAsk));
}

function asJson(sections, leftOut = []) {
  const plain = (i) => ({ ...i.fields, title: i.title, table: i.table });
  const out = { leftOut };
  for (const [k, v] of Object.entries(sections)) {
    out[k] = Array.isArray(v)
      ? v.map((x) =>
          Array.isArray(x) ? { ...plain(x[0]), note: x[1] } : plain(x)
        )
      : v;
  }
  console.log(JSON.stringify(out, null, 2));
}

const byPriority = (a, b) =>
  PRIORITIES.indexOf(a.fields.priority) -
    PRIORITIES.indexOf(b.fields.priority) ||
  a.fields.opened.localeCompare(b.fields.opened);
const byPrioritySizeAge = (a, b) =>
  PRIORITIES.indexOf(a.fields.priority) -
    PRIORITIES.indexOf(b.fields.priority) ||
  SIZES.indexOf(a.fields.size) - SIZES.indexOf(b.fields.size) ||
  a.fields.opened.localeCompare(b.fields.opened);

function lastTouch(f) {
  return [f.updated, f.started, f.opened].filter(Boolean).sort().at(-1);
}
const has = (i, flag) => (i.fields.flags ?? []).includes(flag);
const isWorkable = (i) =>
  ['open', 'investigate'].includes(i.fields.state) && !has(i, 'needs-review');
const isDone = (i) => ['fixed', 'close'].includes(i.fields.state);
const confirmedP0s = (issues) =>
  issues.filter(
    (i) => i.fields.priority === 'P0' && i.fields.confirmed && !isDone(i)
  );

/**
 * The sections of the board's list, in the order of `docs/ISSUE_TRACKING.md`
 * ("Who does what"). Each section is a list of `[issue, note]` pairs; the
 * files with lint errors are left out and named in `leftOut`.
 */
export function boardSections(all) {
  const { issues, leftOut } = clean(all);
  const p0 = issues
    .filter((i) => i.fields.priority === 'P0' && !isDone(i))
    .sort(byPriority)
    .map((i) => [
      i,
      has(i, 'needs-review') ? 'proposed' : `confirmed ${i.fields.confirmed}`,
    ]);
  const review = issues
    .filter((i) => i.fields.priority !== 'P0' && has(i, 'needs-review'))
    .sort(byPriority)
    .map((i) => [
      i,
      i.table && i.table !== i.fields.priority ? `table says ${i.table}` : '',
    ]);
  const fresh = issues
    .filter(
      (i) =>
        !i.fields.reviewed &&
        !has(i, 'needs-review') &&
        i.fields.priority !== 'P0' &&
        !isDone(i)
    )
    .sort(byPriority)
    .map((i) => [i, '']);
  const unanswered = issues
    .filter(
      (i) =>
        i.fields.source === 'tycho' &&
        !hasAnswer(i.body) &&
        !isDone(i) &&
        daysBetween(i.fields.opened, TODAY) >= ANSWER_DAYS
    )
    .sort(byPriority)
    .map((i) => [
      i,
      `no CE answer after ${daysBetween(i.fields.opened, TODAY)} day(s)`,
    ]);
  const decision = issues
    .filter(
      (i) => i.fields.state === 'needs-decision' && !has(i, 'needs-review')
    )
    .sort(byPriority)
    .map((i) => [i, '']);
  const design = issues
    .filter((i) => i.fields.state === 'needs-design' && !has(i, 'needs-review'))
    .sort(byPriority)
    .map((i) => [i, '']);
  const stalled = issues
    .filter(
      (i) =>
        i.fields.state === 'in-progress' &&
        daysBetween(lastTouch(i.fields), TODAY) >= IN_PROGRESS_DAYS &&
        !hasCommitSince(i.fields.id, i.fields.started)
    )
    .map((i) => [
      i,
      `${i.fields.owner}, since ${i.fields.started}, no commit and no update: return to open`,
    ]);
  const aged = issues
    .filter(
      (i) =>
        i.fields.priority === 'P2' &&
        !['close', 'in-progress', 'fixed'].includes(i.fields.state) &&
        daysBetween(lastTouch(i.fields), TODAY) >= AGE_DAYS
    )
    .map((i) => [
      i,
      `untouched since ${lastTouch(i.fields)}: demote to P3, or keep it with \`set ${i.fields.id} priority P2\``,
    ]);
  const fixed = issues
    .filter((i) => i.fields.state === 'fixed')
    .map((i) => [
      i,
      `fixed in ${i.fields['fixed-in']}, waits for Tycho's check`,
    ]);
  const closing = issues
    .filter((i) => i.fields.state === 'close')
    .map((i) => [i, i.fields['close-reason']]);
  return {
    leftOut,
    sections: {
      p0,
      review,
      fresh,
      unanswered,
      decision,
      design,
      stalled,
      aged,
      fixed,
      closing,
    },
  };
}

function board(all) {
  const { leftOut, sections } = boardSections(all);
  const {
    p0,
    review,
    fresh,
    unanswered,
    decision,
    design,
    stalled,
    aged,
    fixed,
    closing,
  } = sections;
  printLeftOut(leftOut);
  if (opts.json) {
    asJson(sections, leftOut);
    return;
  }
  console.log(`# Board list, ${TODAY}`);
  printList('1. P0, proposed or confirmed', p0, true);
  printList('2. Needs review', review, true);
  printList('3. New since the last review (no `reviewed` date)', fresh);
  printList(
    `4. Tycho issues with no CE answer after ${ANSWER_DAYS} day`,
    unanswered
  );
  printList('5a. Needs a decision', decision, true);
  printList('5b. Needs a design', design, true);
  printList(
    `6. In progress for ${IN_PROGRESS_DAYS} days or more with no commit and no update`,
    stalled
  );
  printList(`7. P2 untouched for ${AGE_DAYS} days or more`, aged);
  printList("Fixed, waiting for Tycho's check", fixed);
  printList('To close at the end of the review (`close --all`)', closing);
}

/**
 * The agents' list: the confirmed P0 items, the workable items of a release
 * and of the pool (each a list of `[issue, note]` pairs, by priority, size and
 * age), and the number of P4 items in the pool, which the list leaves out.
 * While a confirmed P0 is open, the command line prints only the P0.
 */
export function backlogSections(all) {
  const { issues, leftOut } = clean(all);
  const p0 = confirmedP0s(issues);
  const workable = issues.filter(isWorkable);
  const note = (i) => (i.fields.state === 'investigate' ? 'investigate' : '');
  const release = workable
    .filter((i) => i.fields.release)
    .sort(byPrioritySizeAge)
    .map((i) => [i, note(i)]);
  const pool = workable
    .filter((i) => !i.fields.release && i.fields.priority !== 'P4')
    .sort(byPrioritySizeAge)
    .map((i) => [i, note(i)]);
  const p4Count = workable.filter(
    (i) => !i.fields.release && i.fields.priority === 'P4'
  ).length;
  return { leftOut, p0, release, pool, p4Count };
}

function backlog(all) {
  const { leftOut, p0, release, pool, p4Count } = backlogSections(all);
  printLeftOut(leftOut);
  if (opts.json) {
    asJson(
      {
        confirmedP0: p0,
        release: p0.length ? [] : release,
        pool: p0.length ? [] : pool,
        p4Count,
      },
      leftOut
    );
    return;
  }
  console.log(`# Agents' list, ${TODAY}`);
  if (p0.length) {
    printList(
      'A confirmed P0 is open: no other work starts',
      p0.map((i) => [i, i.fields.state])
    );
    return;
  }
  const versions = [...new Set(release.map(([i]) => i.fields.release))];
  printList(
    `In the release scope${versions.length ? ` (${versions.join(', ')})` : ''}`,
    release
  );
  printList('Pool, by priority, size and age', pool);
  console.log(`\nP4 items not listed: ${p4Count}`);
}

function inProgress(all) {
  const { issues, leftOut } = clean(all);
  const items = issues.filter((i) => i.fields.state === 'in-progress');
  printLeftOut(leftOut);
  if (opts.json) {
    asJson({ inProgress: items }, leftOut);
    return;
  }
  console.log(`# In progress, ${TODAY} (${items.length})\n`);
  if (items.length === 0) {
    console.log('none');
    return;
  }
  console.log(
    '| id | P | owner | started | days | what the user sees |\n| --- | --- | --- | --- | --- | --- |'
  );
  for (const i of items)
    console.log(
      `| ${i.fields.id} | ${i.fields.priority} | ${i.fields.owner} | ${i.fields.started} | ${daysBetween(i.fields.started, TODAY)} | ${i.title} |`
    );
}

function release(all, version) {
  if (!version) usage('release needs a version');
  if (!VERSION_RE.test(version))
    usage(`release takes a version x.y.z, not ${version}`);
  // Every file counts here, also one with lint errors: an error must not hide an open item.
  const issues = all.issues;
  const broken = issues.filter((i) => i.errors.length);
  const items = issues.filter((i) => i.fields.release === version);
  const carried = issues.filter(
    (i) =>
      !isDone(i) &&
      VERSION_RE.test(i.fields.release ?? '') &&
      compareVersions(i.fields.release, version) < 0
  );
  const p0 = confirmedP0s(issues);
  const open = items.filter((i) => !isDone(i));
  const ready =
    open.length === 0 &&
    p0.length === 0 &&
    carried.length === 0 &&
    broken.length === 0;
  if (opts.json)
    asJson({
      version,
      items,
      carried,
      confirmedP0: p0,
      broken: broken.map((i) => i.name),
      ready,
    });
  else {
    // console.log(`# Release ${version}, ${TODAY}`);
    if (items.length > 0)
      printList(
        `Items of ${version}`,
        items.map((i) => [i, isDone(i) ? 'done' : 'OPEN'])
      );
    if (carried.length > 0)
      printList(
        'Carried over from an earlier version: set a new `release`',
        carried.map((i) => [i, i.fields.release])
      );
    if (p0.length > 0)
      printList(
        'Confirmed P0 open',
        p0.map((i) => [i, ''])
      );
    if (broken.length)
      console.log(
        `\nFiles with lint errors (run lint): ${broken.map((i) => i.name).join(', ')}`
      );
    console.log(
      ready
        ? `\n✓ Release ${version} is ready to ship.`
        : `\n${version} cannot ship: ${open.length} item(s) open, ${carried.length} carried over, ${p0.length} P0, ${broken.length} file(s) with errors.`
    );
  }
  process.exit(ready ? 0 : 1);
}

function lint(all) {
  let errorCount = 0;
  const report = (name, kind, msg) => {
    console.log(`${name}: ${kind}: ${msg}`);
    if (kind === 'error') errorCount++;
  };
  for (const i of all.issues) {
    for (const e of i.errors) report(i.name, 'error', e);
    for (const w of i.warnings) report(i.name, 'warning', w);
  }
  for (const s of all.strays)
    report(s, 'error', 'not an issue file: the name must be `CE-<n>.md`');
  const ids = all.issues
    .map((i) => i.fields.id)
    .filter((id) => idNumber(id) !== null);
  const dup = ids.filter((id, k) => ids.indexOf(id) !== k);
  for (const d of new Set(dup))
    report('issues', 'error', `id ${d} appears in more than one file`);
  const next = readNext();
  if (next === null)
    report(
      NEXT_FILE,
      'error',
      'missing or not a number: the file holds the next free `CE-<n>` number'
    );
  else {
    const max = Math.max(0, ...ids.map(idNumber));
    if (next <= max)
      report(NEXT_FILE, 'error', `is ${next}, but CE-${max} exists`);
    const rm = roadmapMax();
    if (next <= rm)
      report(
        NEXT_FILE,
        'error',
        `is ${next}, but ROADMAP.md has CE-${rm}; the two files share one counter`
      );
    const cm = closedMax();
    if (next <= cm)
      report(
        NEXT_FILE,
        'error',
        `is ${next}, but CLOSED.md has CE-${cm}; a closed number is not reused`
      );
  }
  console.log(`${all.issues.length} files, ${errorCount} errors`);
  process.exit(errorCount ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Edits

function fileOf(id) {
  if (idNumber(id) === null) fail(`\`${id}\` is not an id CE-<n>`);
  const file = path.join(opts.dir, `${id}.md`);
  if (!fs.existsSync(file)) fail(`no file ${file}`);
  return file;
}

/**
 * Writes header fields and `updated`; an empty value keeps the line without a
 * value. A comment after the value (two spaces and `#`) stays. Returns one
 * line per field written, which the command line prints.
 */
function writeFields(id, pairs) {
  const file = fileOf(id);
  const lines = fs.readFileSync(file, 'utf8').replace(/\r/g, '').split('\n');
  const end = lines.indexOf('---', 1);
  if (lines[0] !== '---' || end < 0) fail(`${id}: no header`);
  const put = (k, v) => {
    const ix = lines.findIndex(
      (l, n) => n > 0 && n < end && new RegExp(`^${k}:`).test(l)
    );
    const comment = ix >= 0 ? (lines[ix].match(/\s{2,}#.*$/) ?? [''])[0] : '';
    const text = `${k}: ${v}${comment}`;
    if (ix >= 0) lines[ix] = text;
    else lines.splice(end, 0, text);
  };
  for (const [k, v] of pairs) put(k, v);
  if (!pairs.some(([k]) => k === 'updated')) put('updated', TODAY);
  fs.writeFileSync(file, lines.join('\n'));
  return pairs.map(([k, v]) => `${id}: ${k} = ${v === '' ? '(empty)' : v}`);
}

function currentFields(id) {
  return parseFile(fileOf(id)).fields;
}

/**
 * Changes one header field, with the checks of the `set` command, and writes
 * `updated`. Returns the lines that the command prints.
 */
export function setField(id, key, value) {
  if (!KNOWN.includes(key)) fail(`unknown field \`${key}\``);
  if (key === 'id') fail('the id does not change');
  if (key === 'flags') fail('use `flag <id> +name` or `flag <id> -name`');
  if (REQUIRED.includes(key) && value === '')
    fail(`\`${key}\` is required and cannot be empty`);
  if (/\s{2,}#/.test(value))
    fail(
      'a value cannot contain two spaces followed by `#`: that is read as a comment'
    );
  if (/[\r\n]/.test(value))
    fail('a value is one line: a line break would end the header field');
  if (DATE_FIELDS.includes(key) && value === 'today') value = TODAY;
  if (DATE_FIELDS.includes(key) && value !== '' && !validDate(value))
    fail(`\`${key}\` takes a date yyyy-mm-dd or \`today\``);
  if (key === 'release' && value !== '' && !VERSION_RE.test(value))
    fail('`release` takes a version x.y.z');
  if (ENUMS[key] && value !== '' && !ENUMS[key].includes(value))
    fail(`\`${key}: ${value}\` is not one of ${ENUMS[key].join(', ')}`);
  if (key === 'state' && value === 'in-progress')
    fail(`use \`start ${id} <owner>\``);
  const current = currentFields(id);
  if (key === 'state' && value === 'close' && !current['close-reason'])
    fail(`set \`close-reason\` first: \`set ${id} close-reason <why>\``);
  const pairs = [[key, value]];
  if (key === 'state' && current.state === 'in-progress')
    pairs.push(['owner', ''], ['started', '']);
  if (
    key === 'confirmed' &&
    value !== '' &&
    (current.flags ?? []).includes('needs-review')
  ) {
    pairs.push([
      'flags',
      `[${(current.flags ?? []).filter((x) => x !== 'needs-review').join(', ')}]`,
    ]);
  }
  const notes = [];
  if (
    key === 'priority' &&
    value === 'P0' &&
    !(current.flags ?? []).includes('needs-review') &&
    !current.confirmed
  ) {
    notes.push(
      `${id}: a P0 needs \`needs-review\` (proposed) or \`confirmed\` (the board: \`set ${id} confirmed today\`)`
    );
  }
  return [...notes, ...writeFields(id, pairs)];
}

/** Adds (`+name`) or removes (`-name`) one flag. Returns the lines that the command prints. */
export function flag(id, spec) {
  const m = /^([+-])([a-z-]+)$/.exec(spec ?? '');
  if (!m) usage('flag takes +name or -name');
  const [, op, name] = m;
  if (!FLAGS.includes(name)) fail(`unknown flag \`${name}\``);
  const set = new Set(currentFields(id).flags ?? []);
  if (op === '+') set.add(name);
  else set.delete(name);
  return writeFields(id, [['flags', `[${[...set].join(', ')}]`]]);
}

/**
 * Records a decision of the board in the body: a paragraph
 * `User decision <today>: <text>` at the end of the `## Decision` section, or
 * a new `## Decision` section at the end of the body. Then it sets `reviewed`
 * to today and removes `needs-review`, except on a P0 that is not confirmed:
 * lint requires the flag there until the board confirms the P0 or changes the
 * priority. The header, its comments and the other sections stay as they are.
 * The text may have several lines and code blocks, but no Markdown heading
 * outside a code block (it would end the section) and no code block left open
 * (the readers of the body would take the sections after it for code).
 */
export function recordDecision(id, text) {
  const file = fileOf(id);
  const decision = (text ?? '').replace(/\r/g, '').trim();
  if (!decision) fail('the decision is empty');
  let fenced = false;
  for (const l of decision.split('\n')) {
    if (/^\s*```/.test(l)) fenced = !fenced;
    else if (!fenced && /^#{1,6}(\s|$)/.test(l))
      fail(
        'a line of the decision is a Markdown heading: it would end the section'
      );
  }
  if (fenced)
    fail('the decision opens a code block (```) and does not close it');
  const raw = fs.readFileSync(file, 'utf8').replace(/\r/g, '');
  const lines = raw.split('\n');
  const end = lines.indexOf('---', 1);
  if (lines[0] !== '---' || end < 0) fail(`${id}: no header`);
  const body = lines.slice(end + 1);
  // The line numbers of the `## ` headings of the body, outside code blocks.
  const headings = [];
  let inCode = false;
  body.forEach((l, n) => {
    if (/^\s*```/.test(l)) inCode = !inCode;
    else if (!inCode && /^## /.test(l)) headings.push(n);
  });
  // The label goes before the first line, except when that line opens a code
  // block: the fence must start its own line, so the label is a line of its own.
  const paragraph = /^\s*```/.test(decision)
    ? [`User decision ${TODAY}:`, '', ...decision.split('\n')]
    : `User decision ${TODAY}: ${decision}`.split('\n');
  const start = headings.find((n) => /^## Decision\s*$/.test(body[n]));
  let out;
  if (start === undefined) {
    while (body.length && body.at(-1).trim() === '') body.pop();
    out = [...body, '', '## Decision', '', ...paragraph, ''];
  } else {
    let stop = headings.find((n) => n > start) ?? body.length;
    while (stop > start + 1 && body[stop - 1].trim() === '') stop--;
    const after = body.slice(stop);
    while (after.length && after[0].trim() === '') after.shift();
    out = [
      ...body.slice(0, stop),
      '',
      ...paragraph,
      ...(after.length ? ['', ...after] : ['']),
    ];
  }
  fs.writeFileSync(file, [...lines.slice(0, end + 1), ...out].join('\n'));
  const messages = [`${id}: decision recorded`];
  const f = currentFields(id);
  const flags = f.flags ?? [];
  const pairs = [['reviewed', TODAY]];
  const proposedP0 = f.priority === 'P0' && !f.confirmed;
  if (proposedP0 && flags.includes('needs-review'))
    messages.push(
      `${id}: needs-review stays on a P0 that is not confirmed: confirm the P0 or change the priority`
    );
  else if (flags.includes('needs-review'))
    pairs.push([
      'flags',
      `[${flags.filter((x) => x !== 'needs-review').join(', ')}]`,
    ]);
  return [...messages, ...writeFields(id, pairs)];
}

function startIssue(id, owner) {
  const f = currentFields(id);
  if (!['open', 'investigate'].includes(f.state)) {
    fail(
      `${id} is ${f.state}${f.state === 'in-progress' ? ` for ${f.owner} since ${f.started}` : ''}; only an open or investigate item can start`
    );
  }
  if ((f.flags ?? []).includes('needs-review'))
    fail(`${id} has needs-review: the board looks at it first`);
  if (f.priority === 'P4')
    fail(`${id} is a P4: it starts only after the board promotes it`);
  const p0 = confirmedP0s(loadAll().issues).filter((i) => i.fields.id !== id);
  if (p0.length)
    fail(
      `a confirmed P0 is open (${p0.map((i) => i.fields.id).join(', ')}): no other work starts`
    );
  return writeFields(id, [
    ['state', 'in-progress'],
    ['owner', owner],
    ['started', TODAY],
  ]);
}

function newIssue() {
  const next = readNext();
  if (next === null) fail(`no ${path.join(opts.dir, NEXT_FILE)}`);
  const fileMax = Math.max(
    0,
    ...fs
      .readdirSync(opts.dir)
      .map((n) => idNumber(n.replace(/\.md$/, '')) ?? 0)
  );
  const n = Math.max(next, roadmapMax() + 1, fileMax + 1, closedMax() + 1);
  const file = path.join(opts.dir, `CE-${n}.md`);
  fs.writeFileSync(path.join(opts.dir, NEXT_FILE), `${n + 1}\n`);
  fs.writeFileSync(file, template(n), { flag: 'wx' });
  console.log(
    `${file}\n${NEXT_FILE} is now ${n + 1}. Fill in the header and the body, then run lint.`
  );
}

function template(n) {
  return `---
id: CE-${n}
state: open                 # ${STATES.join(' | ')}
priority:                   # the table value; P0 only with needs-review
flags: []                   # ${FLAGS.join(', ')}
kind:                       # ${KINDS.join(' | ')}
impact:                     # ${IMPACTS.join(' | ')}
probability:                # ${PROBABILITIES.join(' | ')}
witness:                    # ${WITNESSES.join(' | ')}; required unless source is tycho
source:                     # ${SOURCES.join(' | ')}
source-ref:
instrument:                 # a Tycho issue: the script in Tycho's scripts/repros/
size:                       # S | M | L
release:
opened: ${TODAY}
---
One sentence of what the user sees, with no engine terms.

## Witness

## Cause and options
`;
}

/**
 * Removes one issue file and appends its line to `CLOSED.md`. `issue` is an
 * item of `loadAll()`. Returns the line that the command prints.
 */
export function closeIssue(issue, reason) {
  if (!reason) fail(`${issue.fields.id}: a reason is required`);
  const f = issue.fields;
  const witness = witnessSummary(issue.body);
  const facts = [f.kind, f.impact, f.probability, f.witness]
    .filter(Boolean)
    .join(', ');
  // The instrument of a Tycho issue is the script that reproduces it, so the
  // line keeps it with the source reference.
  const refs = [f['source-ref'], f.instrument && `instrument ${f.instrument}`]
    .filter(Boolean)
    .map((r) => `; ${r}`)
    .join('');
  const line = `- ${f.id} (${TODAY}, was ${f.priority}; ${facts}${refs}): ${issue.title}${witness ? ` Witness: ${witness.endsWith('…') ? witness : `${witness.replace(/[.:]$/, '')}.`}` : ''} Closed: ${reason}\n`;
  fs.appendFileSync(path.join(opts.dir, 'CLOSED.md'), line);
  fs.unlinkSync(issue.file);
  return `closed ${f.id}: ${reason}`;
}

/**
 * Closes every file with `state: close`, with its `close-reason`. Refuses, and
 * closes nothing, when one of them has no reason. Calls `report` with each
 * line as soon as its file is closed (so that the lines printed before a
 * failed write name the files already closed), and returns the lines.
 */
export function closeAll(issues, report = () => {}) {
  const closing = issues.filter((x) => x.fields.state === 'close');
  const noReason = closing.filter((x) => !x.fields['close-reason']);
  if (noReason.length)
    fail(
      `no close-reason on ${noReason.map((x) => x.fields.id).join(', ')}; nothing was closed`
    );
  return closing.map((i) => {
    const line = closeIssue(i, i.fields['close-reason']);
    report(line);
    return line;
  });
}

// ---------------------------------------------------------------------------
// Command line

const print = (lines) => {
  for (const l of [lines].flat()) console.log(l);
};

function main(argv) {
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir' || a === '--today') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) usage(`${a} needs a value`);
      if (a === '--dir') opts.dir = path.resolve(v);
      else TODAY = v;
    } else if (a === '--json') opts.json = true;
    else positional.push(a);
  }
  if (!DATE_RE.test(TODAY)) usage(`--today must be yyyy-mm-dd, not ${TODAY}`);
  const [command, ...args] = positional;
  run(command, args);
}

function run(command, args) {
  switch (command) {
    case 'lint':
      lint(loadAll());
      break;
    case 'board':
      board(loadAll());
      break;
    case 'backlog':
      backlog(loadAll());
      break;
    case 'show': {
      if (args.length !== 1) usage('show <id>');
      process.stdout.write(fs.readFileSync(fileOf(args[0]), 'utf8'));
      break;
    }
    case 'in-progress':
      inProgress(loadAll());
      break;
    case 'release':
      release(loadAll(), args[0]);
      break;
    case 'set': {
      if (args.length < 2) usage('set <id> <field> <value>');
      print(setField(args[0], args[1], args.slice(2).join(' ')));
      break;
    }
    case 'flag': {
      if (args.length !== 2) usage('flag <id> +name|-name');
      print(flag(args[0], args[1]));
      break;
    }
    case 'start': {
      if (args.length !== 2) usage('start <id> <owner>');
      print(startIssue(args[0], args[1]));
      break;
    }
    case 'new':
      newIssue();
      break;
    case 'close': {
      const { issues } = loadAll();
      if (args.length === 0) usage('close <id> <reason…> | close --all');
      if (args[0] === '--all') closeAll(issues, print);
      else {
        const i = issues.find((x) => x.fields.id === args[0]);
        if (!i) fail(`no issue ${args[0]}`);
        print(closeIssue(i, args.slice(1).join(' ')));
      }
      break;
    }
    default:
      usage(command ? `unknown command ${command}` : undefined);
  }
}

/** Whether this file is the script that Node runs, not a module that another script imports. */
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return (
      fs.realpathSync(process.argv[1]) ===
      fs.realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (isMainModule()) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    if (e instanceof UsageError) {
      if (e.message) console.error(`issues: ${e.message}`);
      console.log(USAGE);
      process.exit(e.message ? 1 : 0);
    }
    if (e instanceof IssueError) {
      console.error(`issues: ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
}
