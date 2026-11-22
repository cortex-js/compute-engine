#!/usr/bin/env node
/**
 * The ids of `issues/CE-<n>.md`, shared by the machines that file issues.
 *
 * One machine holds the master counter: univac (the Windows side, which the
 * other machines reach with `ssh univac.local`). Each machine has its own copy
 * of `issues/NEXT.md`, so a counter read from that file alone gives the same
 * number on two machines, and a later merge keeps one of the two files.
 *
 *   node scripts/issue-ids.mjs take <count> <min>   (on the master) prints
 *       <count> new ids, the first one at least <min>, and stores the next
 *   node scripts/issue-ids.mjs status               the master value, or the
 *       reserve of this machine
 *
 * `issues.mjs new` calls `allocateId()`. On the master it takes the id from
 * the counter file. On another machine it runs `take` on the master over ssh,
 * and also takes ids for a reserve of RESERVE ids that it keeps in a file of
 * its own: when the master cannot be reached, the id comes from the reserve.
 * Every id comes from the master, so two machines never get the same one.
 * With the master out of reach and the reserve empty, it refuses: an id made
 * up locally is how two issues got one number.
 *
 * The master is Windows on the machine named `univac` (not its WSL), or any
 * machine with `CE_ISSUE_ID_MASTER=1`. `CE_ISSUE_ID_HOST` names the ssh host of the master
 * (default `univac.local`). The state is in `~/.local/state/compute-engine-issue-ids/`:
 * `next` on the master, `reserve.json` on another machine. The script has no
 * dependency.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** The number of spare ids that a machine other than the master keeps. */
export const RESERVE = 3;

const STATE_DIR = path.join(
  os.homedir(),
  '.local',
  'state',
  'compute-engine-issue-ids'
);
const NEXT = path.join(STATE_DIR, 'next');
const RESERVE_FILE = path.join(STATE_DIR, 'reserve.json');
const LOCK = path.join(STATE_DIR, 'lock');

/** The repo path on the master, for the ssh command (`~` is its home). */
const MASTER_SCRIPT = '~/dev/compute-engine/scripts/issue-ids.mjs';

/**
 * The Windows side of univac. Its WSL has the same host name, and a home of
 * its own, so a clone there must not count as a second master.
 */
export function isMaster() {
  if (process.env.CE_ISSUE_ID_MASTER !== undefined)
    return process.env.CE_ISSUE_ID_MASTER === '1';
  return (
    process.platform === 'win32' && os.hostname().toLowerCase() === 'univac'
  );
}

function masterHost() {
  return process.env.CE_ISSUE_ID_HOST || 'univac.local';
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Runs `fn` while holding the lock directory. A holder can wait for ssh (up
 * to about 35 s), so only a lock older than 120 s is taken as left by a
 * process that died, and removed.
 */
function withLock(fn) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  for (let k = 0; ; k++) {
    try {
      fs.mkdirSync(LOCK);
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        if (Date.now() - fs.statSync(LOCK).mtimeMs > 120_000)
          fs.rmSync(LOCK, { recursive: true, force: true });
      } catch {
        // The holder released it between the two calls.
      }
      if (k > 3000) throw new Error(`issue-ids: ${LOCK} is held`);
      sleep(50);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(LOCK, { recursive: true, force: true });
  }
}

/** On the master: `count` new ids, the first one at least `min`. */
export function take(count, min) {
  return withLock(() => {
    let stored = 0;
    if (fs.existsSync(NEXT)) {
      // A counter that does not read as a number is refused: starting again
      // at `min` would give out the ids already in another machine's reserve.
      const text = fs.readFileSync(NEXT, 'utf8').trim();
      stored = Number(text);
      if (!/^\d+$/.test(text) || stored <= 0)
        throw new Error(
          `issue-ids: ${NEXT} holds ${JSON.stringify(text)}, not a number`
        );
    }
    const first = Math.max(stored, min);
    // Written to a new file, then renamed over the counter, so that a crash
    // never leaves it empty.
    fs.writeFileSync(`${NEXT}.tmp`, `${first + count}\n`);
    fs.renameSync(`${NEXT}.tmp`, NEXT);
    return Array.from({ length: count }, (_, k) => first + k);
  });
}

function readReserve() {
  try {
    const ids = JSON.parse(fs.readFileSync(RESERVE_FILE, 'utf8'));
    return Array.isArray(ids) ? ids.filter(Number.isInteger) : [];
  } catch {
    return [];
  }
}

function writeReserve(ids) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(RESERVE_FILE, `${JSON.stringify(ids)}\n`);
}

/**
 * Runs `take` on the master: `{ ids }`, or `{ why }` when it failed (the ssh
 * exit status and the last line of its error output).
 */
function takeRemote(count, min) {
  try {
    const out = execFileSync(
      'ssh',
      [
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=5',
        masterHost(),
        `node ${MASTER_SCRIPT} take ${count} ${min}`,
      ],
      { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const ids = out.trim().split(/\s+/).map(Number);
    return ids.length === count && ids.every(Number.isInteger)
      ? { ids }
      : {
          why: `unexpected output ${JSON.stringify(out.trim().slice(0, 200))}`,
        };
  } catch (err) {
    const stderr = String(err.stderr ?? '')
      .trim()
      .split('\n')
      .pop();
    return {
      why: `ssh exit ${err.status ?? err.signal ?? err.code}${stderr ? `: ${stderr}` : ''}`,
    };
  }
}

/**
 * The id of a new issue, at least `min` when it comes from the master.
 * `isFree(n)` tells whether no file of this machine already has the id `n`
 * (a reserve id can be older than files that a sync brought).
 */
export function allocateId(min, isFree = () => true) {
  if (isMaster()) return take(1, min)[0];
  // The local lock keeps two sessions of this machine from taking the same
  // reserve id, or from writing the reserve over each other.
  return withLock(() => {
    const reserve = readReserve().filter(isFree);
    const result = takeRemote(1 + Math.max(0, RESERVE - reserve.length), min);
    if (result.ids) {
      writeReserve([...reserve, ...result.ids.slice(1)]);
      return result.ids[0];
    }
    if (reserve.length > 0) {
      console.error(
        `issue-ids: the master counter (ssh ${masterHost()}) failed (${result.why}); ` +
          `CE-${reserve[0]} comes from the reserve, ${reserve.length - 1} left`
      );
      writeReserve(reserve.slice(1));
      return reserve[0];
    }
    throw new Error(
      `issue-ids: the master counter (ssh ${masterHost()}) failed (${result.why}) and the reserve is empty; ` +
        'file the issue when the master is back, or name the defect in your report'
    );
  });
}

function main(argv) {
  const [command, ...args] = argv;
  if (command === 'take') {
    const [count, min] = args.map(Number);
    if (!Number.isInteger(count) || count < 0 || !Number.isInteger(min)) {
      console.error('usage: issue-ids.mjs take <count> <min>');
      process.exit(2);
    }
    if (!isMaster()) {
      console.error('issue-ids: this machine is not the master');
      process.exit(2);
    }
    console.log(take(count, min).join(' '));
  } else if (command === 'status') {
    if (isMaster())
      console.log(
        `master: next ${fs.existsSync(NEXT) ? fs.readFileSync(NEXT, 'utf8').trim() : '(not set)'}`
      );
    else
      console.log(
        `reserve: [${readReserve().join(', ')}], master ${masterHost()}`
      );
  } else {
    console.error('usage: issue-ids.mjs take <count> <min> | status');
    process.exit(2);
  }
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) ===
    fs.realpathSync(fileURLToPath(import.meta.url))
)
  main(process.argv.slice(2));
