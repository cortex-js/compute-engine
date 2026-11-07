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
 * Output, in `--out <dir>`: for each item, `<id>.jsonl` (the session's
 * stream-json output), `<id>.err`, and `<id>.report.md` (the session's last
 * message); and `summary.md`, one line per item, written as items end.
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
 * Options:
 *   --queue <file>        The queue file (required).
 *   --items CE-1,CE-2     Run these items of the queue, in this order.
 *   --count <n>           Without --items: run the first n items of the
 *                         queue (the release scope first, then the pool by
 *                         priority, size and age). With neither, the script
 *                         refuses: the whole queue holds
 *                         flagged and low-priority candidates.
 *   --out <dir>           The output directory (required).
 *   --concurrency <n>     At most this many sessions in this repo (default 3).
 *   --timeout-min <n>     Stop a session after this many minutes (default 180).
 *   --dry-run             Print the briefs and the launch order; start nothing.
 *
 * Example:
 *   node scripts/issues.mjs backlog --json > /tmp/queue.json
 *   node scripts/roadmap-batch.mjs --queue /tmp/queue.json \
 *     --items CE-765,CE-766 --out /tmp/batch-1
 */
import { parseArgs } from 'node:util';
import { spawn, execFileSync } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
  readdirSync,
  createWriteStream,
  renameSync,
} from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const sessionsDir = join(homedir(), '.claude', 'sessions');

const { values } = parseArgs({
  options: {
    'queue': { type: 'string' },
    'items': { type: 'string' },
    'count': { type: 'string' },
    'out': { type: 'string' },
    'concurrency': { type: 'string', default: '3' },
    'timeout-min': { type: 'string', default: '180' },
    'dry-run': { type: 'boolean', default: false },
  },
});
if (!values.queue || !values.out) {
  console.error(
    'Usage: roadmap-batch.mjs --queue <file> --out <dir> [--items CE-1,CE-2] [--concurrency 3] [--dry-run]'
  );
  process.exit(2);
}

const concurrency = Number(values.concurrency);
const timeoutMs = Number(values['timeout-min']) * 60_000;
const queueFile = JSON.parse(readFileSync(values.queue, 'utf8'));
/**
 * The work area of a source path (relative to the repo), from the table of
 * docs/COMPUTE-ENGINE-BOX-SPECIFICS.md §9, or undefined for a path outside
 * the six areas.
 */
function areaOfPath(path) {
  if (/^src\/compute-engine\/compilation\/|^src\/(compile|runtime)\.ts$/.test(path))
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
  console.error(
    'No items: pass --items CE-1,CE-2 or --count <n> (the queue is `node scripts/issues.mjs backlog --json`).'
  );
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
const nameOf = (item) => `cebatch-${item.id.slice(3)}`;
const briefOf = (item) =>
  template
    .replaceAll('{{ID}}', item.id)
    .replaceAll('{{TITLE}}', item.title)
    .replaceAll('{{NAME}}', nameOf(item));

mkdirSync(values.out, { recursive: true });

if (values['dry-run']) {
  for (const item of items)
    console.log(`${item.id}  ${nameOf(item)}  [${item.area}]  ${item.title}`);
  console.log('\n--- brief of the first item ---\n');
  console.log(briefOf(items[0]));
  process.exit(0);
}

/** The pids of this process and its parents: the session that started the
 *  batch is one of them, and it does not count against the limit. */
function ancestors() {
  const pids = new Set();
  let pid = process.pid;
  for (let i = 0; i < 30 && pid > 1; i++) {
    pids.add(pid);
    try {
      pid = Number(
        execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], {
          encoding: 'utf8',
        }).trim()
      );
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

const statusDir = join(homedir(), '.local', 'state', 'compute-engine-batch');
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
      concurrency,
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

const pending = [...items];
const running = new Map(); // id -> { item, child, started }

function launch(item) {
  const name = nameOf(item);
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
      briefOf(item),
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
  running.set(item.id, { item, child, started: Date.now() });
  Object.assign(itemStatus.get(item.id), {
    state: 'running',
    started: new Date().toISOString(),
  });
  writeStatus();
  log(`${item.id} started as ${name} [${item.area}]`);

  child.on('exit', (code, signal) => {
    clearTimeout(timer);
    const minutes = (
      (Date.now() - running.get(item.id).started) /
      60_000
    ).toFixed(0);
    running.delete(item.id);
    out.end();
    err.end();
    let result;
    try {
      result = finalResult(jsonl);
    } catch {}
    const text = result?.result ?? '(no result message)';
    writeFileSync(join(values.out, `${item.id}.report.md`), text + '\n');
    const status =
      /^Result:\s*(.+)$/m.exec(text)?.[1]?.trim() ??
      `no report (exit ${code ?? signal})`;
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
    writeStatus();
    schedule();
  });
}

let waitingNoted = '';
function schedule() {
  while (pending.length > 0) {
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
    launch(item);
  }
  if (running.size === 0) {
    log('batch finished');
    writeStatus(new Date().toISOString());
    process.exit(0);
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
