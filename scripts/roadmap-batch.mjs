#!/usr/bin/env node
/** Run a batch of issues, one headless Claude Code session per item.
 *
 * The batch is a fixed list, taken from a queue file that
 * `node scripts/issues.mjs backlog --json > <file>` writes: the items of the
 * release scope, then the pool (`docs/ISSUE_TRACKING.md`). The batch ends when
 * every session of the list has ended. A defect that a session finds goes to
 * `issues/` as a new file, for a later batch, never into this one.
 *
 * Each session gets the brief `scripts/roadmap-batch-brief.md`, with the
 * item filled in. The session works in its own worktree, delivers its patch
 * to the main tree, and commits its item (the brief carries the user's
 * approval). The session name is `cebatch-<n>` for the item CE-<n>: the
 * staging queue and the box lock accept only the name of the calling session,
 * and `claude -p --name` sets it.
 *
 * How many sessions run at the same time. docs/COMPUTE-ENGINE-BOX-SPECIFICS.md
 * §9 allows at most three Compute Engine sessions at once, each in a different
 * area. A session starts only when (a) the number of running batch sessions
 * plus the number of other live Claude sessions whose directory is this repo
 * is less than `--concurrency` (default 3), and (b) no running batch session
 * has an item in one of the areas of the new item. The session that runs this
 * script, and its parents, do not count: they only wait. A runner does not
 * count the sessions of another runner, so run one batch at a time.
 *
 * With `--one-at-a-time`, the runner starts one session at a time, each item
 * after the end of the one before, whatever the number of other sessions: the
 * exception to the limit of three in §9. `--concurrency` and the areas are not
 * read, because one batch session cannot conflict with another, and the runner
 * does not know the areas of the other sessions.
 *
 * The areas of an item are the work areas of §9 (compilation, evaluation,
 * library, latex, epsil, types) of every source file that the issue body
 * names: a path such as `latex-syntax/dictionary/foo.ts`, or a bare file name
 * such as `arithmetic-mul-div.ts`, looked up in `src/` (it gives the area of
 * every file with that name). An issue that names no source file of an area
 * is `unassigned`: its session can change any file, so it starts only when no
 * batch session runs, and no other session starts while it runs. The queue
 * order still decides, but an `unassigned` item can wait until the items
 * after it that can start have run.
 *
 * The brief's parts that depend on the machine are filled in here: the path
 * of the main tree (`{{REPO}}`), the commands that link and remove the
 * `node_modules` of a worktree (`{{LINK}}`, `{{REMOVE}}`: a junction on
 * Windows, which `git worktree remove --force` would follow), and the notes on
 * the machine (`{{MACHINE}}`: Windows, no `~/dev/cortexjs.io`, `--secondary`).
 *
 * A usage limit of the account stops the batch: when a session ends on one
 * (an error result with HTTP status 429, "You've hit your weekly limit"), no
 * other session starts, because each would end on the same limit at once.
 * The sessions that run end on their own. The summary marks the items that
 * did not start `not run (usage limit)`, and the script exits with code 3.
 *
 * The full suite. A session of an item runs its targeted tests and
 * `npm run test:core`, not the full suite: in 130 earlier sessions the full
 * run found a cause in the session's change 12 times, and took about 10
 * minutes of each item under the box lock. The runner starts instead one
 * session (`cebatch-suite-<pid>-<n>`, brief
 * `scripts/roadmap-batch-suite-brief.md`) after each `--suite-every` items
 * that committed (default 5), and after the last item. It starts when no
 * session of the batch runs, and no item starts while it runs. The session
 * runs `npm test` in a worktree at HEAD under the box lock, and fixes and
 * commits each failure that a commit since the last suite causes. Its report
 * says `green`, `fixed` or `red`. After `red`, or with no report, the batch
 * starts no other item, the summary marks the rest
 * `not run (the full suite did not pass)`, and the script exits with code 5.
 * After a stop on request the suite still runs for the items that committed;
 * after a usage limit it does not.
 *
 * A stop on request: `roadmap-batch.mjs --stop` (or
 * `npm run roadmap-batch -- --stop`) writes a file `stop` in the output
 * directory of each batch that runs. The batch then starts no other session;
 * the sessions that run end on their own, so no item is left half done. The
 * runner reads the file when a session ends and once a minute. The summary
 * marks the items that did not start `not run (stopped on request)`, and the
 * script exits with code 4. Do not stop the process of the runner instead:
 * its sessions then stop in the middle of an item, and the status file keeps
 * no end time.
 *
 * Output, in `--out <dir>`: for each item, `<id>.jsonl` (the session's
 * stream-json output), `<id>.err`, and `<id>.report.md` (the session's last
 * message), where a run of the full suite has the id `suite-<n>`; and
 * `summary.md`, one line per item and per run of the suite, written as they
 * end.
 *
 * Status, for the Progress tab of the issue web app (`scripts/issues-ui.mjs`):
 * one JSON file per batch in `~/.local/state/compute-engine-batch/`, named by
 * the start time and the process id, and written again each time an item
 * starts or ends. It holds the process id, the output directory, the time the
 * batch ended (null while it runs) and, for each item, its priority from the
 * queue file, its state (`waiting`,
 * `running` or `ended`), its start and end times and the `Result:` line of its
 * report. The web app shows a batch whose end time is null and whose process
 * is gone as stopped before the end. The files are not removed.
 *
 * The short form, `npm run roadmap-batch -- 3` or
 * `npm run roadmap-batch -- CE-1,CE-2`: one argument, a count or a list of
 * ids, and the defaults of --queue, --out and --secondary below.
 *
 * Options:
 *   --queue <file>        The queue file. Default: the backlog of now
 *                         (`issues.mjs backlog --json`), written to
 *                         <out>/queue.json.
 *   --items CE-1,CE-2     Run these items of the queue, in this order.
 *   --count <n>           Without --items: run the first n items of the
 *                         queue (the release scope first, then the pool by
 *                         priority, size and age). With neither, the script
 *                         refuses: the whole queue holds
 *                         flagged and low-priority candidates.
 *   --out <dir>           The output directory. Default: a new directory
 *                         `~/.local/state/compute-engine-batches/<UTC time>`.
 *   --concurrency <n>     At most this many sessions in this repo (default 3).
 *   --one-at-a-time       One batch session at a time, also when other
 *                         sessions run (see above).
 *   --timeout-min <n>     Stop a session after this many minutes (default 180).
 *   --secondary           The repo is a copy on a second machine (univac):
 *                         the brief tells each session to push nothing and to
 *                         read `~/dev/tycho` only (see above). On by default
 *                         on Windows, the platform of univac's copy;
 *                         `--no-secondary` turns it off.
 *   --dry-run             Print the briefs and the launch order; start nothing.
 *   --suite-every <n>     Run the full suite after each n items that committed
 *                         and after the last item (default 5). 0: never.
 *   --stop                Ask each batch that runs to stop after the sessions
 *                         that run now (see above); start nothing.
 *
 * Examples:
 *   npm run roadmap-batch -- 3
 *   node scripts/roadmap-batch.mjs --items CE-765,CE-766 --out /tmp/batch-1
 */
import { parseArgs } from 'node:util';
import { spawn, execFileSync } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
  readdirSync,
  existsSync,
  rmSync,
  createWriteStream,
  renameSync,
} from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const sessionsDir = join(homedir(), '.claude', 'sessions');

const usage =
  'Usage: npm run roadmap-batch -- <n | CE-1,CE-2> [--one-at-a-time] [--dry-run]\n' +
  '   or: roadmap-batch.mjs [--queue <file>] [--out <dir>] [--count <n> | --items CE-1,CE-2] [--concurrency 3 | --one-at-a-time] [--[no-]secondary] [--dry-run]\n' +
  '   or: roadmap-batch.mjs --stop';
const { values, positionals } = parseArgs({
  allowPositionals: true,
  allowNegative: true,
  options: {
    'queue': { type: 'string' },
    'items': { type: 'string' },
    'count': { type: 'string' },
    'out': { type: 'string' },
    'concurrency': { type: 'string', default: '3' },
    'timeout-min': { type: 'string', default: '180' },
    'dry-run': { type: 'boolean', default: false },
    'one-at-a-time': { type: 'boolean', default: false },
    'stop': { type: 'boolean', default: false },
    'suite-every': { type: 'string', default: '5' },
    // On Windows the tree is univac's copy, the only Windows machine with one.
    'secondary': { type: 'boolean', default: process.platform === 'win32' },
  },
});
const statusDir = join(homedir(), '.local', 'state', 'compute-engine-batch');
// The name of the file, in the output directory of a batch, that asks the
// batch to start no other session (see the header).
const STOP_FILE = 'stop';

// --stop: write the stop file of each batch that runs (a status file with no
// end time whose process is alive), then exit.
if (values.stop) {
  let names = [];
  try {
    names = readdirSync(statusDir).filter((n) => n.endsWith('.json'));
  } catch {}
  let asked = 0;
  for (const n of names) {
    try {
      const b = JSON.parse(readFileSync(join(statusDir, n), 'utf8'));
      if (b.finished) continue;
      process.kill(b.pid, 0); // throws when the process is gone
      writeFileSync(join(b.out, STOP_FILE), new Date().toISOString() + '\n');
      const now = b.items.filter((x) => x.state === 'running');
      console.log(
        `roadmap-batch: the batch in ${b.out} stops after ${now.map((x) => x.id).join(', ') || 'no session'}`
      );
      asked++;
    } catch {}
  }
  if (asked === 0) console.log('roadmap-batch: no batch runs');
  process.exit(asked === 0 ? 1 : 0);
}

// One positional argument: a count (`3`) or a list of ids (`CE-1,CE-2`).
if (
  positionals.length > 1 ||
  (positionals.length === 1 && (values.count || values.items))
) {
  console.error(usage);
  process.exit(2);
}
if (positionals.length === 1) {
  if (/^\d+$/.test(positionals[0])) values.count = positionals[0];
  else values.items = positionals[0];
}
if (!values.count && !values.items) {
  console.error(`No items: give a count or a list of ids.\n${usage}`);
  process.exit(2);
}
// Without --out: a new directory under ~/.local/state/compute-engine-batches,
// named by the UTC date and time (`20261120T041841Z`).
values.out ??= join(
  homedir(),
  '.local',
  'state',
  'compute-engine-batches',
  new Date().toISOString().replace(/\.\d+/, '').replace(/[-:]/g, '')
);
// Without --queue: the backlog of now, written to <out>/queue.json.
if (!values.queue) {
  mkdirSync(values.out, { recursive: true });
  values.queue = join(values.out, 'queue.json');
  writeFileSync(
    values.queue,
    execFileSync(
      process.execPath,
      [join(repo, 'scripts', 'issues.mjs'), 'backlog', '--json'],
      {
        cwd: repo,
        encoding: 'utf8',
      }
    )
  );
}
console.log(`roadmap-batch: output in ${values.out}`);
if (values.secondary)
  console.log(
    'roadmap-batch: secondary machine: the sessions commit here and push nothing'
  );

const oneAtATime = values['one-at-a-time'];
const concurrency = Number(values.concurrency);
const timeoutMs = Number(values['timeout-min']) * 60_000;
const queueFile = JSON.parse(readFileSync(values.queue, 'utf8'));
/**
 * The work area of a source path (relative to the repo), from the table of
 * docs/COMPUTE-ENGINE-BOX-SPECIFICS.md §9, or undefined for a path outside
 * the six areas.
 */
function areaOfPath(path) {
  if (
    /^src\/compute-engine\/compilation\/|^src\/(compile|runtime)\.ts$/.test(
      path
    )
  )
    return 'compilation';
  if (
    /^src\/compute-engine\/(boxed-expression|numerics)\/|^src\/compute-engine\/engine-[^/]*\.ts$/.test(
      path
    )
  )
    return 'evaluation';
  if (/^src\/compute-engine\/(library|symbolic|rubi)\//.test(path))
    return 'library';
  if (/^src\/compute-engine\/latex-syntax\/|^src\/latex-syntax\.ts$/.test(path))
    return 'latex';
  if (/^src\/epsil\/|^src\/epsil\.ts$/.test(path)) return 'epsil';
  if (/^src\/common\/type\/|^src\/compute-engine\/types-[^/]*\.ts$/.test(path))
    return 'types';
  return undefined;
}

// The areas of each bare file name of `src/`: the area of every file with that
// name, so that a name shared by files in two areas counts for both.
const areasOfBasename = new Map();
for (const file of execFileSync('git', ['ls-files', 'src'], {
  cwd: repo,
  encoding: 'utf8',
})
  .trim()
  .split('\n')) {
  const area = areaOfPath(file);
  if (!area) continue;
  const name = basename(file);
  if (!areasOfBasename.has(name)) areasOfBasename.set(name, new Set());
  areasOfBasename.get(name).add(area);
}

/**
 * The work areas of one `.ts` reference in an issue body (empty when it is in
 * no area). A reference with directories is decided by its directories alone:
 * from its first `src/` when it has one, else as a path below
 * `src/compute-engine/` or below `src/`. A test path (`test/...`) is in no
 * area. A bare file name gives the area of every file of `src/` with that
 * name.
 */
function areasOfReference(reference, name) {
  if (!reference.includes('/')) return [...(areasOfBasename.get(name) ?? [])];
  const path = reference.replace(/^(\.{1,2}\/)+/, '');
  const src = path.indexOf('src/');
  const area =
    src >= 0
      ? areaOfPath(path.slice(src))
      : /^test\//.test(path)
        ? undefined
        : (areaOfPath(`src/compute-engine/${path}`) ??
          areaOfPath(`src/${path}`));
  return area ? [area] : [];
}

/**
 * The work areas of an issue: every area of the source files that its body
 * names, or `['unassigned']` when it names none (see the header).
 */
function areasOfIssue(id) {
  let body;
  try {
    body = readFileSync(join(repo, 'issues', `${id}.md`), 'utf8');
  } catch {
    return ['unassigned'];
  }
  const areas = new Set();
  for (const m of body.matchAll(/[\w./-]*?([\w-]+\.ts)\b/g))
    for (const area of areasOfReference(m[0], m[1])) areas.add(area);
  return areas.size > 0 ? [...areas].sort() : ['unassigned'];
}

// The backlog JSON of issues.mjs: `release` and `pool` are lists of issues with
// their header fields. `area` is the areas joined with '+', for the log and the
// status file.
const fromBacklog = (list) =>
  (list ?? []).map((x) => {
    const areas = areasOfIssue(x.id);
    return {
      id: x.id,
      title: x.title,
      priority: x.priority,
      areas,
      area: areas.join('+'),
    };
  });
const queue = [
  ...fromBacklog(queueFile.release),
  ...fromBacklog(queueFile.pool),
];
const byId = new Map(queue.map((c) => [c.id, c]));

const ids = values.items
  ? values.items.split(',')
  : values.count
    ? queue.slice(0, Number(values.count)).map((c) => c.id)
    : [];
if (ids.length === 0) {
  console.error(`No items: give a count or a list of ids.\n${usage}`);
  process.exit(2);
}
let items;
{
  items = ids.map((id) => {
    const item = byId.get(id.trim());
    if (!item) {
      console.error(`${id} is not in the queue file.`);
      process.exit(2);
    }
    return item;
  });
}

const template = readFileSync(
  join(repo, 'scripts', 'roadmap-batch-brief.md'),
  'utf8'
);
const suiteTemplate = readFileSync(
  join(repo, 'scripts', 'roadmap-batch-suite-brief.md'),
  'utf8'
);
const nameOf = (item) => `cebatch-${item.id.slice(3)}`;

// The parts of the brief that depend on the machine (see the header).
const windows = process.platform === 'win32';
const repoPath = repo.replaceAll('\\', '/');
const linkOf = (name) =>
  windows
    ? // `ln -s` in Git Bash copies the directory: a junction instead.
      `powershell -NoProfile -Command "New-Item -ItemType Junction -Path '$(cygpath -w /tmp/wt-${name}/node_modules)' -Target '$(cygpath -w ${repoPath}/node_modules)'" > /dev/null`
    : `ln -s ${repoPath}/node_modules /tmp/wt-${name}/node_modules`;
const removeOf = (name) =>
  windows
    ? // `git worktree remove --force` follows a junction and deletes the
      // files of its target, the `node_modules` of the main tree.
      `cmd //c rmdir "$(cygpath -w /tmp/wt-${name}/node_modules)" && git worktree remove --force /tmp/wt-${name}`
    : `git worktree remove --force /tmp/wt-${name}`;
const machineNotes = [
  ...(windows
    ? [
        'This machine runs Windows; your shell is Git Bash. Remove a worktree only with the command that the steps give, never with a bare `git worktree remove --force`, because Git for Windows follows the `node_modules` junction and deletes the files of the main tree.',
      ]
    : []),
  ...(existsSync(join(homedir(), 'dev', 'cortexjs.io'))
    ? []
    : [
        'There is no `~/dev/cortexjs.io` on this machine: when a guide page must change, edit nothing outside the repo, and name the page and the change in the `Open:` line of the report.',
      ]),
  ...(values.secondary
    ? [
        'This tree is a copy on a second machine: commit as the steps say, and push nothing; the orchestrator moves the commit to the main machine. `~/dev/tycho` here can be out of date: read it, never edit it, and name a change that Tycho needs in the `Open:` line.',
      ]
    : []),
];
const briefOf = (item) =>
  template
    .replaceAll('{{REPO}}', repoPath)
    .replaceAll(
      '{{MACHINE}}',
      machineNotes.length > 0 ? '\n\n' + machineNotes.join('\n\n') : ''
    )
    .replaceAll('{{LINK}}', linkOf(nameOf(item)))
    .replaceAll('{{REMOVE}}', removeOf(nameOf(item)))
    .replaceAll('{{ID}}', item.id)
    .replaceAll('{{TITLE}}', item.title)
    .replaceAll('{{NAME}}', nameOf(item));

/** The full hash of the HEAD of the main tree. */
function headOf() {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
}

/** The brief of a session that runs the full suite on the commits after
 *  `base` (see the header). */
const suiteBriefOf = (name, base) =>
  suiteTemplate
    .replaceAll('{{REPO}}', repoPath)
    .replaceAll(
      '{{MACHINE}}',
      machineNotes.length > 0 ? '\n\n' + machineNotes.join('\n\n') : ''
    )
    .replaceAll('{{LINK}}', linkOf(name))
    .replaceAll('{{REMOVE}}', removeOf(name))
    .replaceAll('{{BASE}}', base)
    .replaceAll(
      '{{COMMITS}}',
      execFileSync('git', ['log', '--format=- %H %s', `${base}..HEAD`], {
        cwd: repo,
        encoding: 'utf8',
      }).trim() || '- (no commit)'
    )
    .replaceAll('{{NAME}}', name);

mkdirSync(values.out, { recursive: true });

if (values['dry-run']) {
  for (const item of items)
    console.log(`${item.id}  ${nameOf(item)}  [${item.area}]  ${item.title}`);
  console.log('\n--- brief of the first item ---\n');
  console.log(briefOf(items[0]));
  console.log('\n--- brief of a run of the full suite ---\n');
  console.log(suiteBriefOf(`cebatch-suite-${process.pid}-1`, headOf()));
  process.exit(0);
}

/** The parent pid of a process. On Windows, Git Bash's `ps` has no `-o`
 *  option and lists MSYS pids, so the parent comes from PowerShell. */
function parentOf(pid) {
  const [command, args] =
    process.platform === 'win32'
      ? [
          'powershell',
          [
            '-NoProfile',
            '-Command',
            `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').ParentProcessId`,
          ],
        ]
      : ['ps', ['-o', 'ppid=', '-p', String(pid)]];
  return Number(
    execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  );
}

/** The pids of this process and its parents: the session that started the
 *  batch is one of them, and it does not count against the limit. */
function ancestors() {
  const pids = new Set();
  let pid = process.pid;
  for (let i = 0; i < 30 && pid > 1; i++) {
    pids.add(pid);
    try {
      pid = parentOf(pid);
    } catch {
      break;
    }
  }
  return pids;
}
const own = ancestors();

/** Live Claude sessions in this repo that the batch did not start. */
function otherSessions() {
  const names = [];
  for (const file of readdirSync(sessionsDir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const record = JSON.parse(readFileSync(join(sessionsDir, file), 'utf8'));
      if (!String(record.cwd ?? '').startsWith(repo)) continue;
      if (
        own.has(record.pid) ||
        String(record.name ?? '').startsWith('cebatch-')
      )
        continue;
      process.kill(record.pid, 0); // throws when the process is gone
      names.push(record.name ?? String(record.pid));
    } catch {}
  }
  return names;
}

function log(line) {
  const stamped = `${new Date().toISOString()} ${line}`;
  console.log(stamped);
  appendFileSync(join(values.out, 'batch.log'), stamped + '\n');
}

const batchStarted = new Date().toISOString();
const statusFile = join(
  statusDir,
  `${batchStarted.replace(/[:.]/g, '-')}-${process.pid}.json`
);
const itemStatus = new Map(
  items.map((item) => [
    item.id,
    {
      id: item.id,
      title: item.title,
      priority: item.priority,
      area: item.area,
      session: nameOf(item),
      state: 'waiting',
    },
  ])
);
let waitingNote = '';

/**
 * Writes the status file of the batch (see the header). The file is written
 * under another name and renamed, so that a reader never gets half a file. A
 * failure to write it does not stop the batch.
 */
function writeStatus(finished = null) {
  try {
    mkdirSync(statusDir, { recursive: true });
    const status = {
      pid: process.pid,
      repo,
      out: values.out,
      started: batchStarted,
      updated: new Date().toISOString(),
      finished,
      concurrency: oneAtATime ? 1 : concurrency,
      oneAtATime,
      waiting: waitingNote,
      items: [...itemStatus.values()],
    };
    writeFileSync(`${statusFile}.tmp`, JSON.stringify(status, null, 2) + '\n');
    renameSync(`${statusFile}.tmp`, statusFile);
  } catch (e) {
    console.error(`could not write ${statusFile}: ${e.message}`);
  }
}

/** The session's last message and its cost, from the stream-json output. */
function finalResult(jsonlFile) {
  let result;
  for (const line of readFileSync(jsonlFile, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === 'result') result = event;
    } catch {}
  }
  return result;
}

/** The text of a usage limit when the session ended on one ("You've hit
 *  your weekly limit · resets 1am …", an error result with HTTP status 429),
 *  else undefined. */
function usageLimit(result) {
  if (result?.is_error !== true) return undefined;
  const text = String(result.result ?? '');
  if (result.api_error_status === 429 || /hit your .*limit/i.test(text))
    return text.trim() || 'usage limit (HTTP 429)';
  return undefined;
}

const pending = [...items];
const running = new Map(); // id -> { item, child, started }
// Set when a session ends on a usage limit: no other session starts, because
// each would end on the same limit at once.
let limitReached;
// Set when the stop file is found: no other session starts (see the header).
// A stop file that an earlier batch left in the same directory is removed.
let stopRequested = false;
// The full suite (see the header): the items committed since its last run,
// the commit of that run, the number of runs, whether one runs now, and the
// `Result:` line of a run that did not pass.
const suiteEvery = Number(values['suite-every']);
const sinceSuite = [];
let suiteBase = headOf();
let suiteCount = 0;
let suiteRunning = false;
let suiteFailed;
const stopFile = join(values.out, STOP_FILE);
rmSync(stopFile, { force: true });

/**
 * Starts one headless session and records its end. `entry` is an item of the
 * batch, or a run of the full suite (`entry.suite` is true): `id` names its
 * files in the output directory and its row of the status file, `name` is
 * the session name, `brief` its prompt, and `onEnd(status, limit)` gets the
 * `Result:` line of its report and whether it ended on a usage limit.
 */
function launch(entry) {
  const item = entry;
  const name = entry.name;
  const jsonl = join(values.out, `${item.id}.jsonl`);
  const out = createWriteStream(jsonl);
  const err = createWriteStream(join(values.out, `${item.id}.err`));
  const child = spawn(
    'claude',
    [
      '-p',
      '--name',
      name,
      '--permission-mode',
      'bypassPermissions',
      '--output-format',
      'stream-json',
      '--verbose',
      entry.brief,
    ],
    {
      cwd: repo,
      stdio: ['ignore', 'pipe', 'pipe'],
      // `claude -p` waits only 10 minutes after the last turn for the
      // background tasks of the session (a review subagent, a test run),
      // then stops them and exits without the session's report. A value of
      // 0 makes it wait for them; the time limit of this script still stops
      // a session that does not end.
      env: { ...process.env, CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '0' },
    }
  );
  child.stdout.pipe(out);
  child.stderr.pipe(err);
  const timer = setTimeout(() => {
    log(`${item.id} reached the time limit; stopping it`);
    child.kill('SIGTERM');
  }, timeoutMs);
  const startedAt = Date.now();
  if (entry.suite) suiteRunning = true;
  else running.set(item.id, { item, child, started: startedAt });
  Object.assign(itemStatus.get(item.id), {
    state: 'running',
    started: new Date().toISOString(),
  });
  writeStatus();
  log(`${item.id} started as ${name} [${item.area}]`);

  child.on('exit', (code, signal) => {
    clearTimeout(timer);
    const minutes = ((Date.now() - startedAt) / 60_000).toFixed(0);
    if (entry.suite) suiteRunning = false;
    else running.delete(item.id);
    out.end();
    err.end();
    let result;
    try {
      result = finalResult(jsonl);
    } catch {}
    const text = result?.result ?? '(no result message)';
    writeFileSync(join(values.out, `${item.id}.report.md`), text + '\n');
    const limit = usageLimit(result);
    if (limit !== undefined && limitReached === undefined) {
      limitReached = limit;
      log(
        `usage limit: ${limit}; no other session starts. ` +
          `Reopen the items that \`issues.mjs in-progress\` lists for a stopped session.`
      );
    }
    const status =
      /^Result:\s*(.+)$/m.exec(text)?.[1]?.trim() ??
      (limit !== undefined
        ? `stopped: usage limit (${limit})`
        : `no report (exit ${code ?? signal})`);
    const cost =
      result?.total_cost_usd !== undefined
        ? `$${result.total_cost_usd.toFixed(2)}`
        : 'cost unknown';
    const turns = result?.num_turns ?? '?';
    appendFileSync(
      join(values.out, 'summary.md'),
      `- ${item.id}: ${status} (${minutes} min, ${turns} turns, ${cost})\n`
    );
    log(
      `${item.id} ended: ${status} (${minutes} min, ${turns} turns, ${cost})`
    );
    Object.assign(itemStatus.get(item.id), {
      state: 'ended',
      ended: new Date().toISOString(),
      result: status,
      turns,
      cost,
      report: join(values.out, `${item.id}.report.md`),
    });
    entry.onEnd(status, limit !== undefined);
    writeStatus();
    schedule();
  });
}

/** Starts the session of an item of the batch. */
function launchItem(item) {
  launch({
    ...item,
    name: nameOf(item),
    brief: briefOf(item),
    onEnd: (status) => {
      // Only a commit of a fix can change what the suite tests.
      if (/^committed\b/.test(status)) sinceSuite.push(item.id);
    },
  });
}

/**
 * Starts a session that runs the full suite on HEAD and fixes the failures
 * that the commits since the last suite cause (see the header). Its row is
 * added to the status file when it starts.
 */
function launchSuite() {
  suiteCount++;
  const id = `suite-${suiteCount}`;
  const name = `cebatch-suite-${process.pid}-${suiteCount}`;
  const covered = sinceSuite.splice(0);
  const title = `The full test suite, after ${covered.join(', ')}`;
  itemStatus.set(id, {
    id,
    title,
    priority: '',
    area: 'suite',
    session: name,
    state: 'waiting',
  });
  launch({
    id,
    title,
    area: 'suite',
    suite: true,
    name,
    brief: suiteBriefOf(name, suiteBase),
    onEnd: (status, limit) => {
      if (/^(green|fixed)\b/.test(status)) {
        suiteBase = headOf();
      } else if (!limit) {
        // `red`, or no report: the commits of the batch are not proven, so
        // no other item starts.
        suiteFailed = status;
        log(`the full suite did not pass (${status}); no other session starts`);
      }
    },
  });
}

let waitingNoted = '';
function schedule() {
  if (!stopRequested && existsSync(stopFile)) {
    stopRequested = true;
    log('stop requested: no other session starts');
  }
  // A usage limit comes first: it is the cause that the user must know.
  const notRun =
    limitReached !== undefined
      ? 'not run (usage limit)'
      : suiteFailed !== undefined
        ? 'not run (the full suite did not pass)'
        : stopRequested
          ? 'not run (stopped on request)'
          : undefined;
  if (notRun !== undefined && pending.length > 0) {
    for (const item of pending.splice(0)) {
      appendFileSync(
        join(values.out, 'summary.md'),
        `- ${item.id}: ${notRun}\n`
      );
      Object.assign(itemStatus.get(item.id), {
        state: 'ended',
        ended: new Date().toISOString(),
        result: notRun,
      });
    }
    log('the items that had not started are not run');
    waitingNote =
      limitReached !== undefined
        ? `stopped: usage limit (${limitReached})`
        : suiteFailed !== undefined
          ? `stopped: the full suite did not pass (${suiteFailed})`
          : 'stopped on request';
    writeStatus();
  }
  // The full suite runs alone: after each `suiteEvery` commits, and after the
  // last item. It does not run after a usage limit (its session would end on
  // the same limit) or after a suite that did not pass.
  if (suiteRunning) return;
  if (
    suiteEvery > 0 &&
    sinceSuite.length > 0 &&
    limitReached === undefined &&
    suiteFailed === undefined &&
    (sinceSuite.length >= suiteEvery || pending.length === 0)
  ) {
    if (running.size === 0) {
      waitingNote = '';
      launchSuite();
    } else {
      const note = 'waiting: the full suite runs after the sessions that run';
      if (note !== waitingNoted) log((waitingNoted = note));
      if (note !== waitingNote) {
        waitingNote = note;
        writeStatus();
      }
    }
    return;
  }
  if (oneAtATime) {
    // The queue order decides; areas and other sessions are not read.
    if (pending.length > 0 && running.size === 0) {
      waitingNote = '';
      launchItem(pending.shift());
    }
  }
  while (!oneAtATime && pending.length > 0) {
    const others = otherSessions();
    if (running.size + others.length >= concurrency) {
      const note = `waiting: ${running.size} batch sessions, other sessions in this repo: ${others.join(', ') || 'none'}`;
      if (note !== waitingNoted) log((waitingNoted = note));
      if (note !== waitingNote) {
        waitingNote = note;
        writeStatus();
      }
      return;
    }
    // An item starts only when none of its areas is busy. An `unassigned`
    // item starts only when no session runs, and nothing starts while it
    // runs (see the header).
    const runningAreas = [...running.values()].flatMap((r) => r.item.areas);
    const busy = new Set(runningAreas);
    const index = busy.has('unassigned')
      ? -1
      : pending.findIndex((item) =>
          item.areas.includes('unassigned')
            ? running.size === 0
            : !item.areas.some((area) => busy.has(area))
        );
    if (index < 0) {
      const note = busy.has('unassigned')
        ? 'waiting: an unassigned item runs alone'
        : `waiting: areas busy: ${[...busy].sort().join(', ')}`;
      if (note !== waitingNoted) log((waitingNoted = note));
      if (note !== waitingNote) {
        waitingNote = note;
        writeStatus();
      }
      return;
    }
    const [item] = pending.splice(index, 1);
    waitingNote = '';
    launchItem(item);
  }
  if (running.size === 0) {
    log(
      limitReached !== undefined
        ? 'batch stopped on a usage limit'
        : suiteFailed !== undefined
          ? 'batch stopped: the full suite did not pass'
          : stopRequested
            ? 'batch stopped on request'
            : 'batch finished'
    );
    writeStatus(new Date().toISOString());
    // Exit code 3: a usage limit stopped the batch before its end. Exit code
    // 5: a full suite that did not pass did. Exit code 4: a stop on request
    // did.
    process.exit(
      limitReached !== undefined
        ? 3
        : suiteFailed !== undefined
          ? 5
          : stopRequested
            ? 4
            : 0
    );
  }
}

// Other sessions can end at any time: look again every minute.
setInterval(schedule, 60_000);
writeFileSync(
  join(values.out, 'summary.md'),
  `# Batch of ${new Date().toISOString()}\n\n`
);
log(`batch of ${items.length} items: ${items.map((i) => i.id).join(', ')}`);
writeStatus();
schedule();
