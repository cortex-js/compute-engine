#!/usr/bin/env node
/** Run a batch of ROADMAP items, one headless Claude Code session per item.
 *
 * The batch is a fixed list, taken from a queue file that
 * `scripts/roadmap-candidates.ts --json <file>` writes. The batch ends when
 * every session of the list has ended. A defect that a session finds goes to
 * ROADMAP.md as a new entry, for a later batch, never into this one.
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
 * has an item from the same `##` section of ROADMAP.md. The session that runs
 * this script, and its parents, do not count: they only wait.
 *
 * Output, in `--out <dir>`: for each item, `<id>.jsonl` (the session's
 * stream-json output), `<id>.err`, and `<id>.report.md` (the session's last
 * message); and `summary.md`, one line per item, written as items end.
 *
 * Options:
 *   --queue <file>        The queue file (required).
 *   --items CE-1,CE-2     Run these items of the queue, in this order.
 *                         Without it, run the field `batch` of the queue
 *                         (`roadmap-candidates.ts --batch <n>`). With
 *                         neither, the script refuses: the whole queue holds
 *                         flagged and low-priority candidates.
 *   --out <dir>           The output directory (required).
 *   --concurrency <n>     At most this many sessions in this repo (default 3).
 *   --timeout-min <n>     Stop a session after this many minutes (default 180).
 *   --dry-run             Print the briefs and the launch order; start nothing.
 *
 * Example:
 *   npx tsx scripts/roadmap-candidates.ts --json /tmp/queue.json
 *   node scripts/roadmap-batch.mjs --queue /tmp/queue.json \
 *     --items CE-765,CE-766 --out /tmp/batch-1
 */
import { parseArgs } from 'node:util';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, readdirSync, createWriteStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const sessionsDir = join(homedir(), '.claude', 'sessions');

const { values } = parseArgs({
  options: {
    queue: { type: 'string' },
    items: { type: 'string' },
    out: { type: 'string' },
    concurrency: { type: 'string', default: '3' },
    'timeout-min': { type: 'string', default: '180' },
    'dry-run': { type: 'boolean', default: false },
  },
});
if (!values.queue || !values.out) {
  console.error('Usage: roadmap-batch.mjs --queue <file> --out <dir> [--items CE-1,CE-2] [--concurrency 3] [--dry-run]');
  process.exit(2);
}

const concurrency = Number(values.concurrency);
const timeoutMs = Number(values['timeout-min']) * 60_000;
const queueFile = JSON.parse(readFileSync(values.queue, 'utf8'));
const queue = queueFile.candidates;
const byId = new Map(queue.map((c) => [c.id, c]));

const ids = values.items ? values.items.split(',') : (queueFile.batch ?? []);
if (ids.length === 0) {
  console.error('No items: pass --items, or make the queue with roadmap-candidates.ts --batch <n>.');
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

const template = readFileSync(join(repo, 'scripts', 'roadmap-batch-brief.md'), 'utf8');
const nameOf = (item) => `cebatch-${item.id.slice(3)}`;
const briefOf = (item) =>
  template.replaceAll('{{ID}}', item.id).replaceAll('{{TITLE}}', item.title).replaceAll('{{NAME}}', nameOf(item));

mkdirSync(values.out, { recursive: true });

if (values['dry-run']) {
  for (const item of items) console.log(`${item.id}  ${nameOf(item)}  [${item.area}]  ${item.title}`);
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
      pid = Number(execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' }).trim());
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
      if (own.has(record.pid) || String(record.name ?? '').startsWith('cebatch-')) continue;
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
    ['-p', '--name', name, '--permission-mode', 'bypassPermissions', '--output-format', 'stream-json', '--verbose', briefOf(item)],
    { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  child.stdout.pipe(out);
  child.stderr.pipe(err);
  const timer = setTimeout(() => {
    log(`${item.id} reached the time limit; stopping it`);
    child.kill('SIGTERM');
  }, timeoutMs);
  running.set(item.id, { item, child, started: Date.now() });
  log(`${item.id} started as ${name} [${item.area}]`);

  child.on('exit', (code, signal) => {
    clearTimeout(timer);
    const minutes = ((Date.now() - running.get(item.id).started) / 60_000).toFixed(0);
    running.delete(item.id);
    out.end();
    err.end();
    let result;
    try {
      result = finalResult(jsonl);
    } catch {}
    const text = result?.result ?? '(no result message)';
    writeFileSync(join(values.out, `${item.id}.report.md`), text + '\n');
    const status = /^Result:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? `no report (exit ${code ?? signal})`;
    const cost = result?.total_cost_usd !== undefined ? `$${result.total_cost_usd.toFixed(2)}` : 'cost unknown';
    const turns = result?.num_turns ?? '?';
    appendFileSync(join(values.out, 'summary.md'), `- ${item.id}: ${status} (${minutes} min, ${turns} turns, ${cost})\n`);
    log(`${item.id} ended: ${status} (${minutes} min, ${turns} turns, ${cost})`);
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
      return;
    }
    const busy = new Set([...running.values()].map((r) => r.item.area));
    const index = pending.findIndex((item) => !busy.has(item.area));
    if (index < 0) return;
    const [item] = pending.splice(index, 1);
    launch(item);
  }
  if (running.size === 0) {
    log('batch finished');
    process.exit(0);
  }
}

// Other sessions can end at any time: look again every minute.
setInterval(schedule, 60_000);
writeFileSync(join(values.out, 'summary.md'), `# Batch of ${new Date().toISOString()}\n\n`);
log(`batch of ${items.length} items: ${items.map((i) => i.id).join(', ')}`);
schedule();
