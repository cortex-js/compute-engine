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
 * The shadow measure (`ce._jsProfileShadow`, `CE_JS_PROFILE_SHADOW=1`) is a
 * second internal setting, also off by default: each compilation for the
 * `javascript` target that asks for no profile also compiles the expression
 * with the profile, discards that result, and counts its outcome
 * (`recordJsProfileShadow()`), per consumer: `implicit:<name>` for a
 * compilation of `implicitCompile()`, `public` for any other. Its counters
 * are separate from those of the switch (`_jsProfileShadowStats()`), and
 * the file of `CE_JS_PROFILE_STATS` holds them under `shadow`.
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

/** The counters of one consumer of the shadow measure. `attempts`,
 * `admitted`, `declined` and `failed` count the compilations that the
 * existing compiler compiled; `baselineDeclined` counts those that it
 * declined (a result with `success: false`, or an error), and
 * `baselineDeclinedAdmitted` those of them that the profile admitted. The
 * keys of the message tables are normalized (`normalizedMessage()`), and
 * `examples` holds the first message of each key as it was. */
export type JsProfileShadowStats = JsProfileConsumerStats & {
  baselineDeclined: number;
  baselineDeclinedAdmitted: number;
  examples: Record<string, string>;
};

const MAX_MESSAGES = 50;

/** The cap of `MAX_MESSAGES` for a consumer of the shadow measure, whose
 * purpose is the whole distribution of the messages. */
const MAX_SHADOW_MESSAGES = 1000;

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

/** The initial value of the shadow measure of an engine, from the
 * environment: on when `CE_JS_PROFILE_SHADOW` is `1`. */
export function jsProfileShadowDefault(): boolean {
  return currentProcess()?.env?.CE_JS_PROFILE_SHADOW === '1';
}

/** The options objects that `implicitCompile()` passes to `ce._compile()`,
 * with the name of the consumer, or `null` for a compilation that the shadow
 * measure leaves out (one that follows an attempt of the switch). */
const implicitOptions = new WeakMap<object, string | null>();

/** Mark `options`, which `implicitCompile()` passes to `ce._compile()`, as
 * a compilation of `consumer` (`null`: not measured). */
export function markImplicitCompileOptions(
  options: object,
  consumer: string | null
): void {
  implicitOptions.set(options, consumer);
}

/** The consumer of the shadow measure for a compilation with `options`:
 * `implicit:<name>` for options marked by `implicitCompile()`, `public`
 * otherwise, `undefined` for a compilation that is not measured. */
export function jsProfileShadowConsumer(
  options: object | undefined
): string | undefined {
  const consumer =
    options === undefined ? undefined : implicitOptions.get(options);
  if (consumer === null) return undefined;
  return consumer === undefined ? 'public' : `implicit:${consumer}`;
}

/** The words that a message of the profile quotes and that are not user
 * names: option names and type names (`normalizedMessage()`). */
const QUOTED_WORDS = new Set([
  'functions',
  'operators',
  'vars',
  'imports',
  'preamble',
  'broadcast',
  'function',
  'integer',
  'real',
  'complex',
  'number',
  'boolean',
  'string',
  'list',
  'tuple',
  'any',
  'unknown',
]);

/** `message` with the names of user symbols and the numbers replaced, so
 * that the declines of one cause have one key. A name is replaced where the
 * messages of the profile put one: after `binding`, in `the input|parameter|
 * helper <name> has|is`, in `and <name> is a parameter`, and in quotes
 * when it starts with a lowercase letter or `_` and is not an option or
 * type name (`QUOTED_WORDS`). A number becomes `<n>`. */
function normalizedMessage(message: string): string {
  return message
    .replace(/\bbinding [A-Za-z_]\w*/g, 'binding <name>')
    .replace(
      /\bthe (input|parameter|helper) [A-Za-z_]\w* (has|is)\b/g,
      'the $1 <name> $2'
    )
    .replace(
      /\band [A-Za-z_]\w* is a parameter\b/g,
      'and <name> is a parameter'
    )
    .replace(/`([a-z_]\w*)`/g, (quoted, name: string) =>
      QUOTED_WORDS.has(name) ? quoted : '`<name>`'
    )
    .replace(/\b\d+(\.\d+)?(e[-+]?\d+)?\b/g, '<n>');
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

function emptyShadowStats(): JsProfileShadowStats {
  return {
    ...emptyStats(),
    baselineDeclined: 0,
    baselineDeclinedAdmitted: 0,
    examples: Object.create(null) as Record<string, string>,
  };
}

/** Count one attempt in `stats`. The message `key` is kept when the table
 * holds fewer than `limit` distinct messages. Returns whether `key` was
 * added to the table. */
function count(
  stats: JsProfileConsumerStats,
  outcome: JsProfileOutcome,
  key: string,
  limit: number
): boolean {
  stats.attempts += 1;
  stats[outcome] += 1;
  if (outcome === 'admitted') return false;
  const messages =
    outcome === 'declined' ? stats.declinedMessages : stats.failedMessages;
  if (key in messages) messages[key] += 1;
  else if (
    Object.keys(stats.declinedMessages).length +
      Object.keys(stats.failedMessages).length <
    limit
  ) {
    messages[key] = 1;
    return true;
  } else stats.otherMessages += 1;
  return false;
}

function add(
  table: Map<string, JsProfileConsumerStats>,
  consumer: string,
  outcome: JsProfileOutcome,
  message: string | undefined
): void {
  let stats = table.get(consumer);
  if (stats === undefined) table.set(consumer, (stats = emptyStats()));
  count(stats, outcome, message ?? '(no message)', MAX_MESSAGES);
}

/** Count one compilation of the shadow measure (`recordJsProfileShadow()`). */
function addShadow(
  table: Map<string, JsProfileShadowStats>,
  consumer: string,
  baselineSucceeded: boolean,
  outcome: JsProfileOutcome,
  message: string | undefined
): void {
  let stats = table.get(consumer);
  if (stats === undefined) table.set(consumer, (stats = emptyShadowStats()));
  if (!baselineSucceeded) {
    stats.baselineDeclined += 1;
    if (outcome === 'admitted') stats.baselineDeclinedAdmitted += 1;
    return;
  }
  const raw = message ?? '(no message)';
  const key = normalizedMessage(raw);
  if (count(stats, outcome, key, MAX_SHADOW_MESSAGES))
    stats.examples[key] = raw;
}

function snapshot<S extends JsProfileConsumerStats>(
  table: Map<string, S>
): Record<string, S> {
  const result: Record<string, S> = {};
  for (const [consumer, s] of table)
    result[consumer] = {
      ...s,
      declinedMessages: { ...s.declinedMessages },
      failedMessages: { ...s.failedMessages },
      ...('examples' in s
        ? { examples: { ...(s.examples as Record<string, string>) } }
        : {}),
    };
  return result;
}

const engineStats = new WeakMap<object, Map<string, JsProfileConsumerStats>>();

const engineShadowStats = new WeakMap<
  object,
  Map<string, JsProfileShadowStats>
>();

type StatsFile = {
  table: Map<string, JsProfileConsumerStats>;
  shadow: Map<string, JsProfileShadowStats>;
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
    shadow: new Map(),
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
  writeStats(file);
}

/** Count one compilation of the shadow measure by `consumer` on the engine
 * `ce`: `baselineSucceeded` tells whether the existing compiler gave code,
 * `outcome` and `message` give the outcome of the profile. */
export function recordJsProfileShadow(
  ce: object,
  consumer: string,
  baselineSucceeded: boolean,
  outcome: JsProfileOutcome,
  message?: string
): void {
  let table = engineShadowStats.get(ce);
  if (table === undefined) engineShadowStats.set(ce, (table = new Map()));
  addShadow(table, consumer, baselineSucceeded, outcome, message);
  const file = statsAccumulator();
  if (file === null) return;
  addShadow(file.shadow, consumer, baselineSucceeded, outcome, message);
  writeStats(file);
}

function writeStats(file: StatsFile): void {
  try {
    file.write(
      file.path,
      JSON.stringify({
        pid: currentProcess()?.pid,
        consumers: snapshot(file.table),
        ...(file.shadow.size > 0 ? { shadow: snapshot(file.shadow) } : {}),
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

/** A snapshot of the counters of the shadow measure of the engine `ce`, per
 * consumer. A consumer with no compilation measured has no entry.
 * @internal */
export function _jsProfileShadowStats(
  ce: object
): Record<string, JsProfileShadowStats> {
  const table = engineShadowStats.get(ce);
  return table === undefined ? {} : snapshot(table);
}
