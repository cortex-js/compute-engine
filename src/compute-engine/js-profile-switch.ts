/**
 * The internal switch that makes `implicitCompile()` try the
 * `numeric-kernel` profile of the JavaScript target first, and its counters
 * (`docs/plans/2026-11-10-js-profile-first-consumer.md`). The switch is off
 * by default. It is not a public option.
 *
 * The engine reads its initial value at construction
 * (`jsProfileSwitchDefault()`): `CE_JS_PROFILE=numeric-kernel` turns it on,
 * and `CE_JS_PROFILE_CONSUMERS=<names>` (separated by commas) limits it to
 * these consumers. A test can set `ce._jsProfile` on an engine.
 *
 * The counters are kept per engine and per consumer (`_jsProfileStats()`).
 * When `CE_JS_PROFILE_STATS=<directory>` is set, the totals of each instance
 * of this module, summed over its engines, are also written to
 * `<directory>/<pid>-<time>.json` after each attempt
 * (`statsAccumulator()`); `scripts/js-profile-stats.mjs` sums these files.
 *
 * A browser has no `process` object: the switch is then off and nothing is
 * written. This module imports nothing, so that the engine can import it with
 * no dependency cycle.
 */

/** The value of the switch: `undefined` is off. With no `consumers`, every
 * consumer tries the profile. */
export type JsProfileSwitch = {
  readonly profile: 'numeric-kernel';
  readonly consumers?: ReadonlySet<string>;
};

/** The counters of one consumer. `declinedMessages` and `failedMessages`
 * map a message to its count; at most `MAX_MESSAGES` distinct messages are
 * kept per consumer, and `otherMessages` counts the attempts whose message
 * was not kept. */
export type JsProfileConsumerStats = {
  attempts: number;
  admitted: number;
  declined: number;
  failed: number;
  declinedMessages: Record<string, number>;
  failedMessages: Record<string, number>;
  otherMessages: number;
};

export type JsProfileOutcome = 'admitted' | 'declined' | 'failed';

const MAX_MESSAGES = 50;

type ProcessLike = {
  env?: Record<string, string | undefined>;
  pid?: number;
  getBuiltinModule?: (name: string) => unknown;
  hrtime?: { bigint?: () => bigint };
};

function currentProcess(): ProcessLike | undefined {
  try {
    return (globalThis as { process?: ProcessLike }).process;
  } catch {
    return undefined;
  }
}

/** The initial value of the switch of an engine, from the environment. */
export function jsProfileSwitchDefault(): JsProfileSwitch | undefined {
  const env = currentProcess()?.env;
  if (env?.CE_JS_PROFILE !== 'numeric-kernel') return undefined;
  const names = (env.CE_JS_PROFILE_CONSUMERS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return names.length === 0
    ? { profile: 'numeric-kernel' }
    : { profile: 'numeric-kernel', consumers: new Set(names) };
}

function emptyStats(): JsProfileConsumerStats {
  return {
    attempts: 0,
    admitted: 0,
    declined: 0,
    failed: 0,
    // No prototype: a message such as `toString` or `__proto__` is an
    // ordinary key.
    declinedMessages: Object.create(null) as Record<string, number>,
    failedMessages: Object.create(null) as Record<string, number>,
    otherMessages: 0,
  };
}

function add(
  table: Map<string, JsProfileConsumerStats>,
  consumer: string,
  outcome: JsProfileOutcome,
  message: string | undefined
): void {
  let stats = table.get(consumer);
  if (stats === undefined) table.set(consumer, (stats = emptyStats()));
  stats.attempts += 1;
  stats[outcome] += 1;
  if (outcome === 'admitted') return;
  const messages =
    outcome === 'declined' ? stats.declinedMessages : stats.failedMessages;
  const key = message ?? '(no message)';
  if (key in messages) messages[key] += 1;
  else if (
    Object.keys(stats.declinedMessages).length +
      Object.keys(stats.failedMessages).length <
    MAX_MESSAGES
  )
    messages[key] = 1;
  else stats.otherMessages += 1;
}

function snapshot(
  table: Map<string, JsProfileConsumerStats>
): Record<string, JsProfileConsumerStats> {
  const result: Record<string, JsProfileConsumerStats> = {};
  for (const [consumer, s] of table)
    result[consumer] = {
      ...s,
      declinedMessages: { ...s.declinedMessages },
      failedMessages: { ...s.failedMessages },
    };
  return result;
}

const engineStats = new WeakMap<object, Map<string, JsProfileConsumerStats>>();

type StatsFile = {
  table: Map<string, JsProfileConsumerStats>;
  path: string;
  write: (path: string, text: string) => void;
};

/** The accumulator of this instance of the module and the file it writes,
 * or `null` when `CE_JS_PROFILE_STATS` is not set. Each instance of the
 * module (one per Jest test file, one per Node process) has its own file,
 * `<directory>/<pid>-<time>.json`, rewritten after each attempt
 * that it counts. The `node:fs` module is reached through
 * `process.getBuiltinModule`, as in `effects-registry.ts`, so that a browser
 * bundle has no reference to it. */
let statsFile: StatsFile | null | undefined;

function statsAccumulator(): StatsFile | null {
  if (statsFile !== undefined) return statsFile;
  statsFile = null;
  const proc = currentProcess();
  const dir = proc?.env?.CE_JS_PROFILE_STATS;
  if (dir === undefined || dir === '') return null;
  if (typeof proc?.getBuiltinModule !== 'function') return null;
  const fs = proc.getBuiltinModule('node:fs') as
    | {
        mkdirSync(p: string, o: { recursive: boolean }): void;
        writeFileSync(p: string, s: string): void;
      }
    | undefined;
  if (fs === undefined) return null;
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    return null;
  }
  // Not `Math.random()`: tests count and mock its draws. The time in
  // nanoseconds tells apart the instances of the module in one process.
  const suffix = String(proc.hrtime?.bigint?.() ?? Date.now());
  statsFile = {
    table: new Map(),
    path: `${dir}/${proc.pid}-${suffix}.json`,
    write: (path, text) => fs.writeFileSync(path, text),
  };
  return statsFile;
}

/** Count one attempt of the profile by `consumer` on the engine `ce`. */
export function recordJsProfileAttempt(
  ce: object,
  consumer: string,
  outcome: JsProfileOutcome,
  message?: string
): void {
  let table = engineStats.get(ce);
  if (table === undefined) engineStats.set(ce, (table = new Map()));
  add(table, consumer, outcome, message);
  const file = statsAccumulator();
  if (file === null) return;
  add(file.table, consumer, outcome, message);
  try {
    file.write(
      file.path,
      JSON.stringify({
        pid: currentProcess()?.pid,
        consumers: snapshot(file.table),
      })
    );
  } catch {
    // A statistics file is not worth an error of the compilation.
  }
}

/** A snapshot of the counters of the engine `ce`, per consumer. A consumer
 * that never tried the profile has no entry.
 * @internal */
export function _jsProfileStats(
  ce: object
): Record<string, JsProfileConsumerStats> {
  const table = engineStats.get(ce);
  return table === undefined ? {} : snapshot(table);
}
